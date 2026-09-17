import { auditCodexPolicy, type AuditStage, type CodexPolicy, type PolicyEvidence } from '../codex-policy.ts';
import { createHash } from 'node:crypto';
import type { AuditedPolicy, ProviderAudit, ProviderRequest } from '../../contracts/job-runner.ts';
import type { ConsentAuthorization } from '../../contracts/consent.ts';

/** Semantic identity survives a worker restart; evidenceScope deliberately does not. */
export function policyFingerprint(policy: CodexPolicy): string {
  const { evidenceScope: _epoch, ...semanticPolicy } = policy;
  return createHash('sha256').update(JSON.stringify(semanticPolicy)).digest('hex');
}

/** Connects T13's pure audit to T02. The host must supply observations and current consent.
 * No requested value is promoted to observed evidence here. */
export function authorizePolicy(policy: CodexPolicy, request: ProviderRequest, audit: ProviderAudit,
  evidence: PolicyEvidence, authorization: ConsentAuthorization, stage: AuditStage): AuditedPolicy {
  if (!authorization || authorization.attemptId !== request.jobId || authorization.policyKey !== request.policyKey ||
      authorization.provider !== policy.adapter || (stage === 'dispatch' && !authorization.dispatchedAt)) throw new Error('current-attempt-authorization-required');
  if (!policy.modelTurn) throw new Error('saved-solver-is-not-a-model-job');
  if (audit.workspace !== policy.workspace || audit.codexHome !== policy.codexHome) throw new Error('policy-runtime-binding-mismatch');
  if (policyFingerprint(policy) !== request.policyKey || policy.workspace !== request.workspace
    || policy.threadStart.params.model !== request.model) throw new Error('policy-request-mismatch');
  if ((policy.operation === 'definition') !== (request.mode === 'structured-final')) throw new Error('policy-mode-mismatch');
  if (policy.operation === 'definition' && JSON.stringify(policy.turnPolicy.outputSchema) !== JSON.stringify(request.outputSchema)) throw new Error('policy-output-schema-mismatch');
  const decision = auditCodexPolicy(policy, evidence, stage);
  if (stage === 'bootstrap' ? !decision.bootstrapPolicySatisfied : !decision.dispatchPolicySatisfied) throw new Error(`policy-evidence-rejected:${decision.issues.map(x => `${x.code}:${x.field}`).join(',')}`);
  if (decision.perRequestCatalogVeto === 'unsupported') throw new Error(`policy-catalog-veto:${decision.unsupportedCatalogEntries.join(',')}`);
  return { policyKey: request.policyKey, auditScope: policy.evidenceScope, workspace: request.workspace,
    thread: { ...policy.threadStart.params, config: policy.configOverrides }, turn: { ...policy.turnPolicy },
    mcp: { cwd: policy.workspace, sandbox: policy.threadStart.params.sandbox, 'approval-policy': 'never', config: policy.configOverrides,
      schemaEnforced: false, recovery: 'unsupported', cancellation: 'abandon-and-tombstone' } };
}
