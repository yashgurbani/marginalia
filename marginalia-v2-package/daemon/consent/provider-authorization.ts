import type { ProviderAudit, ProviderHandle, ProviderRequest } from '../../contracts/job-runner.ts';
import type { JobSnapshot } from '../../contracts/jobs.ts';
import { createCodexPolicy, PINNED_CODEX_VERSION, type AuditStage, type JsonValue, type Platform, type PolicyEvidence } from '../codex-policy.ts';
import type { ProviderAuthorization } from '../jobs/runtime.ts';
import { authorizePolicy, policyFingerprint } from '../providers/policy-gate.ts';
import type { RpcTransport } from '../providers/stdio.ts';
import { ConsentSessionService } from './service.ts';

/**
 * Host collectors normalize real observations. They must not copy requested policy values into
 * evidence, borrow another adapter's observations, or treat MCP tools/list as a complete catalog.
 */
export interface PolicyEvidenceCollector {
  auditId(context: { job: Readonly<JobSnapshot>; request: ProviderRequest; audit: ProviderAudit; stage: AuditStage }): string;
  collect(context: { job: Readonly<JobSnapshot>; request: ProviderRequest; audit: ProviderAudit; stage: AuditStage; policy: ReturnType<typeof createCodexPolicy> }): Promise<PolicyEvidence>;
  observeThread(context: { job: Readonly<JobSnapshot>; handle: ProviderHandle; response: unknown; audit: ProviderAudit }): Promise<void>;
  authorizeRecovery(context: { job: Readonly<JobSnapshot>; handle: ProviderHandle; audit: ProviderAudit }): Promise<void>;
  inspectMcp(rpc: RpcTransport, workspace: string, codexHome: string, tools: unknown[]): Promise<ProviderAudit>;
}

export type ConsentProviderAuthorizationOptions = {
  consent: ConsentSessionService;
  platform: Platform;
  evidence: PolicyEvidenceCollector;
};

/** Real T02/T06 bridge. Missing or unresolved collector evidence rejects; there is no development allow path. */
export function createConsentProviderAuthorization(options: ConsentProviderAuthorizationOptions): ProviderAuthorization {
  return {
    async authorize(job, request, audit, stage) {
      const attemptId = job.latestAttemptId;
      if (!attemptId || attemptId !== request.jobId) throw new Error('current-provider-attempt-required');
      const auditId = options.evidence.auditId({ job, request, audit, stage });
      const operation = job.mode === 'structured-final' ? 'definition' : 'generation';
      const common = {
        version: PINNED_CODEX_VERSION, platform: options.platform, adapter: job.provider,
        model: request.model, workspace: request.workspace, codexHome: audit.codexHome, auditId,
      } as const;
      const policy = operation === 'definition'
        ? createCodexPolicy({ ...common, operation, outputSchema: requireSchema(request.outputSchema) })
        : createCodexPolicy({ ...common, operation });
      if (policyFingerprint(policy) !== request.policyKey) throw new Error('policy-request-mismatch');
      const evidence = await options.evidence.collect({ job, request, audit, stage, policy });
      // The current durable grant/exclusion fence is checked after all asynchronous observation.
      // T06 has already marked dispatch immediately before entering the runner; app-server calls
      // this again after its thread observation. A later adapter checkpoint gap remains recorded.
      const authorization = options.consent.currentAuthorization(job, attemptId, stage === 'dispatch');
      return authorizePolicy(policy, request, audit, evidence, authorization, stage);
    },
    async authorizeRecovery(job, handle, audit) {
      if (!job.latestAttemptId || handle.jobId !== job.latestAttemptId || handle.policyKey !== job.policyKey) throw new Error('recovery-binding-mismatch');
      options.consent.currentAuthorization(job, handle.jobId, true);
      await options.evidence.authorizeRecovery({ job, handle, audit });
    },
    async verifyThread(job, handle, response, audit) {
      if (handle.jobId !== job.latestAttemptId || handle.provider !== 'app-server') throw new Error('thread-observation-binding-mismatch');
      options.consent.currentAuthorization(job, handle.jobId, false);
      await options.evidence.observeThread({ job, handle, response, audit });
    },
    inspectMcp: (rpc, workspace, codexHome, tools) => options.evidence.inspectMcp(rpc, workspace, codexHome, tools),
  };
}

function requireSchema(value: ProviderRequest['outputSchema']) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !jsonValue(value)) throw new Error('definition-output-schema-required');
  return structuredClone(value) as Record<string, JsonValue>;
}
function jsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(jsonValue);
  return false;
}
