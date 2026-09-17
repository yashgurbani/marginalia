import type { JobRunner, ProviderAudit, ProviderHooks, ProviderKind, ProviderRequest, ProviderHandle, AuditedPolicy, ProviderSendBinding } from '../../contracts/job-runner.ts';
import type { JobConsentAuthority, JobSnapshot } from '../../contracts/jobs.ts';
import { AppServerRunner } from '../providers/app-server.ts';
import { initializeMcp, McpServerRunner } from '../providers/mcp-server.ts';
import { inspectAppServer } from '../providers/preflight.ts';
import { assertLaunchCurrent, bindLaunchAudit } from '../providers/launch-facts.ts';
import { launchProvider } from '../providers/runtime.ts';
import type { RpcTransport } from '../providers/stdio.ts';
import { isDeepStrictEqual } from 'node:util';
import { validateProviderSend } from '../providers/send-binding.ts';

export type JobHostHooks = Pick<ProviderHooks, 'checkpoint' | 'validateOutput'> & {
  jobForAttempt(attemptId: string): JobSnapshot | undefined;
  finalizeSend(request: ProviderRequest, handle: ProviderHandle): ProviderHandle;
};
export type RunningProvider = { runner: JobRunner; close(): void; canResume?(handle: ProviderHandle): boolean };

export interface AuthorizedRuntimeFactory {
  /** Optional plan from a trusted runtime module, never a browser or provider reply. */
  readonly jobDefaults?: import('./service.ts').JobServiceOptions['defaults'];
  readonly consent: JobConsentAuthority;
  /** Static bootstrap readiness only; every attempt is still revalidated immediately before egress. */
  readonly dispatchReady: boolean;
  readonly unavailableReason?: string;
  create(job: Readonly<JobSnapshot>, attemptId: string, workspace: string, hooks: JobHostHooks): Promise<RunningProvider>;
}

/** T13 owns every method here. No requested policy value is accepted as observed evidence. */
export interface ProviderAuthorization {
  authorize(job: Readonly<JobSnapshot>, request: ProviderRequest, audit: ProviderAudit, stage: 'bootstrap' | 'dispatch'): ReturnType<ProviderHooks['authorize']>;
  authorizeRecovery(job: Readonly<JobSnapshot>, handle: Parameters<ProviderHooks['authorizeRecovery']>[0], audit: ProviderAudit): Promise<void>;
  verifyThread(job: Readonly<JobSnapshot>, handle: Parameters<ProviderHooks['verifyThread']>[0], response: unknown, audit: ProviderAudit): Promise<void>;
  inspectMcp(rpc: RpcTransport, workspace: string, codexHome: string, tools: unknown[]): Promise<ProviderAudit>;
}

export type CodexRuntimeOptions = {
  executable: string;
  codexHome: string;
  consent: JobConsentAuthority;
  authorization: ProviderAuthorization;
  dispatchReady: boolean;
  unavailableReason?: string;
  configOverrides?: Readonly<Record<string, unknown>>;
  configOverridesFor?: (job: Readonly<JobSnapshot>, workspace: string) => Readonly<Record<string, unknown>>;
  readiness?: () => { ready: boolean; reasons: readonly string[] };
};

export function createCodexRuntimeFactory(options: CodexRuntimeOptions): AuthorizedRuntimeFactory {
  return {
    consent: options.consent,
    get dispatchReady() { return options.readiness?.().ready ?? options.dispatchReady; },
    get unavailableReason() { const state = options.readiness?.(); return state && !state.ready ? state.reasons.join('; ') : options.unavailableReason; },
    async create(job, _attemptId, workspace, host): Promise<RunningProvider> {
      if (!options.consent.withProviderPreparation) throw new Error('non-consuming-provider-preparation-required');
      const transport = await launchProvider(job.provider, { executable: options.executable, workspace, codexHome: options.codexHome,
        configOverrides: options.configOverridesFor?.(job, workspace) ?? options.configOverrides });
      try {
        const audit = await inspect(job.provider, transport, workspace, options.codexHome, options.authorization);
        bindLaunchAudit(audit, transport);
        const policies = new Map<string, AuditedPolicy>();
        const sends = new Map<string, { request: ProviderRequest; handle: ProviderHandle; audit: ProviderAudit; wire: ProviderSendBinding }>();
        let alive = true;
        transport.onDisconnect(() => { alive = false; policies.clear(); sends.clear(); });
        const prepare = <T>(job: JobSnapshot, id: string, observe: () => Promise<T>) => options.consent.withProviderPreparation!(job, id, observe);
        const hooks: ProviderHooks = {
          checkpoint: host.checkpoint,
          validateOutput: host.validateOutput,
          authorize: async (request, observed, stage) => {
            const job = requiredJob(host, request.jobId);
            const policy = await prepare(job, request.jobId, () => options.authorization.authorize(job, request, observed, stage));
            if (stage === 'dispatch') policies.set(request.jobId, structuredClone(policy));
            return policy;
          },
          authorizeSend: async (request, handle, observed, wire) => {
            const policy = policies.get(request.jobId);
            if (!alive || observed !== audit || !policy) throw new Error('provider-send-policy-not-current');
            validateProviderSend(request, handle, policy, wire);
            const exact = structuredClone({ request, handle, audit: observed, wire });
            const job = requiredJob(host, request.jobId);
            if (job.cancelRequested || job.latestAttemptId !== handle.jobId || handle.jobId !== request.jobId) throw new Error('provider-send-fenced');
            const decision = await options.consent.revalidate(job, 'dispatch');
            if (decision.grantId !== job.grantId || decision.policyKey !== job.policyKey) throw new Error('provider-send-consent-changed');
            const current = requiredJob(host, request.jobId);
            if (current.cancelRequested || current.latestAttemptId !== handle.jobId || current.preparedPayloadDigest !== job.preparedPayloadDigest) throw new Error('provider-send-fenced');
            if (!isDeepStrictEqual(exact, { request, handle, audit: observed, wire })) throw new Error('provider-send-binding-changed');
            sends.set(request.jobId, exact);
          },
          finalizeSend: (request, handle, observed, wire) => {
            const exact = sends.get(request.jobId), policy = policies.get(request.jobId);
            sends.delete(request.jobId); policies.delete(request.jobId);
            if (!alive || observed !== audit || !exact || !policy ||
              !isDeepStrictEqual(exact, { request, handle, audit: observed, wire })) throw new Error('provider-send-not-prepared-or-changed');
            validateProviderSend(request, handle, policy, wire);
            assertLaunchCurrent(observed);
            if (options.readiness && !options.readiness().ready) throw new Error('provider-host-readiness-changed');
            return host.finalizeSend(request, handle);
          },
          authorizeRecovery: (handle, observed) => options.authorization.authorizeRecovery(requiredJob(host, handle.jobId), handle, observed),
          verifyThread: (handle, response, observed) => {
            const job = requiredJob(host, handle.jobId);
            if (job.attempts.find(a => a.id === handle.jobId)?.handoffMarked) return options.authorization.verifyThread(job, handle, response, observed);
            return prepare(job, handle.jobId, () => options.authorization.verifyThread(job, handle, response, observed));
          },
        };
        const runner = job.provider === 'app-server' ? new AppServerRunner(transport, audit, hooks) : new McpServerRunner(transport, audit, hooks);
        return { runner, canResume: handle => alive && (runner instanceof McpServerRunner ? runner.canResume(handle) : true),
          close: () => { alive = false; policies.clear(); sends.clear(); transport.close(); } };
      } catch (error) { transport.close(); throw error; }
    },
  };
}

function requiredJob(host: JobHostHooks, attemptId: string) {
  const job = host.jobForAttempt(attemptId);
  if (!job) throw new Error('Durable job context is unavailable for this provider attempt.');
  return job;
}

async function inspect(kind: ProviderKind, rpc: RpcTransport, workspace: string, home: string, authorization: ProviderAuthorization) {
  if (kind === 'app-server') return inspectAppServer(rpc, workspace, home);
  const tools = await initializeMcp(rpc);
  return authorization.inspectMcp(rpc, workspace, home, tools);
}
