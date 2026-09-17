import type { JobRunner, ProviderAudit, ProviderHooks, ProviderKind, ProviderRequest } from '../../contracts/job-runner.ts';
import type { JobConsentAuthority, JobSnapshot } from '../../contracts/jobs.ts';
import { AppServerRunner } from '../providers/app-server.ts';
import { initializeMcp, McpServerRunner } from '../providers/mcp-server.ts';
import { inspectAppServer } from '../providers/preflight.ts';
import { launchProvider } from '../providers/runtime.ts';
import type { RpcTransport } from '../providers/stdio.ts';

export type JobHostHooks = Pick<ProviderHooks, 'checkpoint' | 'validateOutput'> & { jobForAttempt(attemptId: string): JobSnapshot | undefined };
export type RunningProvider = { runner: JobRunner; close(): void };

export interface AuthorizedRuntimeFactory {
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
};

export function createCodexRuntimeFactory(options: CodexRuntimeOptions): AuthorizedRuntimeFactory {
  return {
    consent: options.consent,
    dispatchReady: options.dispatchReady,
    ...(options.unavailableReason ? { unavailableReason: options.unavailableReason } : {}),
    async create(job, _attemptId, workspace, host): Promise<RunningProvider> {
      const transport = await launchProvider(job.provider, { executable: options.executable, workspace, codexHome: options.codexHome,
        configOverrides: options.configOverrides });
      try {
        const audit = await inspect(job.provider, transport, workspace, options.codexHome, options.authorization);
        const hooks: ProviderHooks = {
          checkpoint: host.checkpoint,
          validateOutput: host.validateOutput,
          authorize: (request, observed, stage) => options.authorization.authorize(requiredJob(host, request.jobId), request, observed, stage),
          authorizeSend: async (request, handle) => {
            const job = requiredJob(host, request.jobId);
            if (job.cancelRequested || job.latestAttemptId !== handle.jobId || handle.jobId !== request.jobId) throw new Error('provider-send-fenced');
            const decision = await options.consent.revalidate(job, 'dispatch');
            if (decision.grantId !== job.grantId || decision.policyKey !== job.policyKey) throw new Error('provider-send-consent-changed');
            const current = requiredJob(host, request.jobId);
            if (current.cancelRequested || current.latestAttemptId !== handle.jobId || current.preparedPayloadDigest !== job.preparedPayloadDigest) throw new Error('provider-send-fenced');
          },
          authorizeRecovery: (handle, observed) => options.authorization.authorizeRecovery(requiredJob(host, handle.jobId), handle, observed),
          verifyThread: (handle, response, observed) => options.authorization.verifyThread(requiredJob(host, handle.jobId), handle, response, observed),
        };
        const runner = job.provider === 'app-server' ? new AppServerRunner(transport, audit, hooks) : new McpServerRunner(transport, audit, hooks);
        return { runner, close: () => transport.close() };
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
