/** Provider observations, not committed replies. T06 owns durable jobs and validation. */
export type ProviderKind = 'app-server' | 'mcp-server';
export type ProviderState = 'starting' | 'running' | 'cancel_requested' | 'completed' | 'failed' | 'cancelled' | 'outcome_unknown';
export interface ProviderHandle {
  jobId: string;
  provider: ProviderKind;
  workspace: string;
  policyKey: string;
  /** Fresh evidence epoch; separate from the stable semantic policy fingerprint. */
  auditScope?: string;
  providerInstanceId?: string;
  revision?: number;
  mode: 'structured-final' | 'workspace-files';
  model: string;
  threadId?: string;
  turnId?: string;
  state: ProviderState;
  tombstone: boolean;
  /** Only structured-final mode returns text; file mode is watched/validated by T06. */
  output?: string;
  reason?: string;
}
export interface ProviderRequest {
  jobId: string;
  workspace: string;
  policyKey: string;
  model: string;
  prompt: string;
  mode: 'structured-final' | 'workspace-files';
  outputSchema?: Record<string, unknown>;
}
export interface ProviderCapabilities {
  interrupt: 'turn-interrupt' | 'abandon-and-tombstone';
  recovery: 'thread-state' | 'unsupported';
  structuredFinal: boolean;
  schemaEnforced: boolean;
  liveEvents: boolean;
}
export interface JobRunner {
  readonly capabilities: ProviderCapabilities;
  start(request: ProviderRequest): Promise<ProviderHandle>;
  /** Without followup: recover only. With followup: explicit next turn after confirmed completion. Never retries unknown work. */
  resume(handle: ProviderHandle, followup?: ProviderRequest): Promise<ProviderHandle>;
  cancel(handle: ProviderHandle): Promise<ProviderHandle>;
  inspect(handle: ProviderHandle): Promise<ProviderHandle>;
}
export interface ProviderAudit {
  workspace: string;
  codexHome: string;
  initialize: unknown;
  account: unknown;
  config: unknown;
  requirements: unknown;
  skills: unknown;
  mcpServers: unknown[];
  features: unknown[];
  /** A server inventory is not a complete catalog of model tools. */
  completeModelToolCatalog: false;
}
export interface AuditedPolicy {
  /** Must attest to current grants, audited config and platform enforcement, not self-report. */
  policyKey: string;
  auditScope?: string;
  workspace: string;
  thread: Record<string, unknown>;
  turn: Record<string, unknown>;
  mcp: Record<string, unknown>;
}
export interface ProviderHooks {
  /** Persist before dispatch; reject duplicate attempt claims and stale revisions atomically.
   * T06 persists user cancellation before cancel(), and refuses output against its durable fence. */
  checkpoint(handle: ProviderHandle): Promise<void | ProviderHandle>;
  /** T13 integration seam. There is deliberately no allow-by-default implementation. */
  /** Bootstrap separately authorizes session creation side effects, never inference.
   * Dispatch must perform the full current audit, including returned thread observations. */
  authorize(request: ProviderRequest, audit: ProviderAudit, stage: 'bootstrap' | 'dispatch'): Promise<AuditedPolicy>;
  /** Last current grant/policy check after durable handoff, immediately before provider transmission.
   * The adapter performs no awaited work between this result, its cancellation check, and rpc.request. */
  authorizeSend(request: ProviderRequest, handle: ProviderHandle, audit: ProviderAudit): Promise<void>;
  /** Validate recovered operations against current grants and original policy identity. */
  authorizeRecovery(handle: ProviderHandle, audit: ProviderAudit): Promise<void>;
  /** Observe returned effective policy/instruction sources before sending granted input. */
  verifyThread(handle: ProviderHandle, response: unknown, audit: ProviderAudit): Promise<void>;
  /** Required for structured-final; schema + bounds + host validation belongs to caller. */
  validateOutput(text: string, handle: ProviderHandle, request: ProviderRequest | undefined): Promise<boolean>;
}
