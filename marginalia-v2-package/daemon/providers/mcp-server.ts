import { ProviderNotSentError } from '../../contracts/job-runner.ts';
import type { AuditedPolicy, JobRunner, ProviderAudit, ProviderHandle, ProviderHooks, ProviderRequest } from '../../contracts/job-runner.ts';
import type { RpcTransport } from './stdio.ts';
import { sendProviderRequest } from './send.ts';
import { checkPolicy } from './app-server.ts';
import { pages, PINNED_CODEX_VERSION } from './preflight.ts';
import { randomUUID } from 'node:crypto';
import { formatMcpPrompt } from './prompt.ts';

export async function initializeMcp(rpc: RpcTransport): Promise<any[]> {
  const info = await rpc.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'marginalia', version: '0.2.0' } });
  if (info.serverInfo?.version !== PINNED_CODEX_VERSION) throw new Error('codex-version-mismatch');
  rpc.notify('notifications/initialized');
  const tools = await pages(rpc, 'tools/list', {}, 'tools');
  if (!tools.some(tool => tool.name === 'codex') || !tools.some(tool => tool.name === 'codex-reply')) throw new Error('required-mcp-tools-missing');
  return tools;
}

/** MCP has no thread/read or interrupt endpoint. No transport equivalence is implied. */
export class McpServerRunner implements JobRunner {
  readonly capabilities = { interrupt: 'abandon-and-tombstone', recovery: 'unsupported', structuredFinal: true, schemaEnforced: false, liveEvents: false } as const;
  private rpc: RpcTransport;
  private hooks: ProviderHooks;
  private audit: ProviderAudit;
  private handles = new Map<string, ProviderHandle>();
  private staged = new Set<string>();
  private cancelIntents = new Set<string>();
  private requestIds = new Map<string, number>();
  private transportAlive = true;
  private instanceId = randomUUID();
  private ownedAttempts = new Set<string>();
  private latestByThread = new Map<string, string>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(rpc: RpcTransport, audit: ProviderAudit, hooks: ProviderHooks) {
    this.rpc = rpc; this.audit = audit; this.hooks = hooks;
    rpc.onDisconnect(() => { this.transportAlive = false; void this.serial(async () => {
      for (const h of this.handles.values()) if (h.state === 'running') await this.save({ ...h, state: 'outcome_unknown', reason: 'mcp-disconnected-no-state-query' });
    }).catch(() => {}); });
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const next = this.tail.then(fn, fn); this.tail = next.catch(() => {}); return next; }
  private fenced(h: ProviderHandle): ProviderHandle {
    return this.cancelIntents.has(h.jobId) ? { ...h, tombstone: true, state: 'cancelled', output: undefined, reason: 'abandoned-process-stop-unconfirmed' } : h;
  }
  private stage(h: ProviderHandle): ProviderHandle {
    const value = this.fenced(h); this.staged.add(h.jobId); this.handles.set(h.jobId, value); return { ...value };
  }
  private async save(h: ProviderHandle): Promise<ProviderHandle> {
    if (this.staged.has(h.jobId)) return this.stage(h);
    h = this.fenced(h);
    const committed = await this.hooks.checkpoint({ ...h });
    if (committed) {
      if (committed.jobId !== h.jobId || committed.provider !== h.provider || committed.workspace !== h.workspace || committed.policyKey !== h.policyKey) throw new Error('checkpoint-binding-mismatch');
      h = { ...committed };
      if (h.tombstone) this.cancelIntents.add(h.jobId);
    }
    const fenced = this.fenced(h);
    if (fenced.tombstone && !h.tombstone) {
      const cancelled = await this.hooks.checkpoint({ ...fenced });
      if (cancelled && (!cancelled.tombstone || cancelled.jobId !== h.jobId)) throw new Error('cancel-checkpoint-rejected');
      if (cancelled) Object.assign(fenced, cancelled, { tombstone: true, output: undefined });
    }
    this.handles.set(h.jobId, { ...fenced }); return { ...fenced };
  }
  private current(h: ProviderHandle): ProviderHandle {
    if (h.provider !== 'mcp-server') throw new Error('provider-mismatch');
    const known = this.handles.get(h.jobId);
    if (known && (h.workspace !== known.workspace || h.policyKey !== known.policyKey || h.threadId && known.threadId && h.threadId !== known.threadId)) throw new Error('handle-binding-mismatch');
    if (h.tombstone) this.cancelIntents.add(h.jobId);
    const current = !known || (h.revision ?? -1) > (known.revision ?? -1) ? h : known;
    return this.fenced({ ...current });
  }
  start(request: ProviderRequest): Promise<ProviderHandle> { request = structuredClone(request); return this.serial(async () => {
    if (this.handles.has(request.jobId)) throw new Error('attempt-already-dispatched');
    if (!this.transportAlive) throw new Error('mcp-transport-closed');
    if (request.workspace !== this.audit.workspace) throw new Error('provider-process-cwd-mismatch');
    if ([...this.handles.values()].some(h => !['completed', 'failed', 'cancelled'].includes(h.state))) throw new Error('mcp-dedicated-transport-busy');
    if (request.mode === 'structured-final' && !request.outputSchema) throw new Error('output-schema-required');
    let policy: AuditedPolicy;
    try {
      policy = await this.hooks.authorize(request, this.audit, 'dispatch'); checkPolicy(request, policy);
      if (policy.mcp.cwd !== request.workspace || policy.mcp['approval-policy'] !== 'never') throw new Error('mcp-policy-binding-mismatch');
    } catch (error) { throw new ProviderNotSentError('mcp-server', request.jobId, error); }
    const h = this.stage({ jobId: request.jobId, provider: 'mcp-server', workspace: request.workspace,
      policyKey: request.policyKey, auditScope: policy.auditScope, providerInstanceId: this.instanceId, mode: request.mode, model: request.model, state: 'starting', tombstone: false });
    return this.dispatch(h, request, 'codex', { ...policy.mcp, model: request.model });
  }); }
  /** Synchronous process/attempt ownership observation, never an authorization grant. */
  canResume(handle: ProviderHandle): boolean {
    const known = this.handles.get(handle.jobId);
    return this.transportAlive && !handle.tombstone && handle.state === 'completed' && !this.cancelIntents.has(handle.jobId) &&
      this.ownedAttempts.has(handle.jobId) && !!known && handle.revision === known.revision &&
      handle.providerInstanceId === known.providerInstanceId &&
      !known.tombstone && known.state === 'completed' && known.providerInstanceId === this.instanceId &&
      handle.provider === 'mcp-server' && handle.threadId === known.threadId && handle.workspace === known.workspace &&
      handle.policyKey === known.policyKey && handle.model === known.model && handle.mode === known.mode &&
      !!known.threadId && this.latestByThread.get(known.threadId) === handle.jobId;
  }
  private async dispatch(h: ProviderHandle, request: ProviderRequest, name: 'codex' | 'codex-reply', args: Record<string, unknown>): Promise<ProviderHandle> {
    let sent;
    try {
      sent = await sendProviderRequest(this.rpc, this.hooks, this.audit, request, h, 'tools/call',
        { name, arguments: { ...args, prompt: formatMcpPrompt(request) } }, () => this.current(h),
        id => { this.requestIds.set(h.jobId, id); });
    } catch (error) { this.stage({ ...h, state: 'failed', reason: 'not-sent' }); throw error; }
    h = sent.handle; this.staged.delete(h.jobId); this.handles.set(h.jobId, h);
    this.ownedAttempts.add(h.jobId);
    if (h.threadId) this.latestByThread.set(h.threadId, h.jobId);
    // tools/call responds at completion; there is no app-server-style turn acknowledgement.
    void sent.response
      .then(result => this.serial(async () => {
        const now = this.current(h);
        if (now.tombstone) return; // Cancellation was durably fenced before abandoning.
        const structured = result.structuredContent;
        if (result.isError) { await this.save({ ...now, state: 'failed', reason: 'mcp-tool-error' }); return; }
        if (typeof structured?.threadId !== 'string' || !structured.threadId.trim() || name === 'codex-reply' && structured.threadId !== h.threadId) {
          await this.save({ ...now, state: 'outcome_unknown', reason: 'mcp-missing-or-mismatched-thread-id' }); return;
        }
        this.latestByThread.set(structured.threadId, h.jobId);
        let output: string | undefined;
        if (request.mode === 'structured-final') {
          const text = structured.content;
          let valid = false;
          if (typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024) {
            try { JSON.parse(text); valid = await this.hooks.validateOutput(text, now, request); } catch { /* Refusal / malformed data. */ }
          }
          if (!valid) { await this.save({ ...now, threadId: structured.threadId, state: 'failed', reason: 'invalid-or-missing-final-output' }); return; }
          output = text;
        }
        await this.save({ ...now, threadId: structured.threadId, state: 'completed', output });
      }), () => this.serial(async () => {
        const now = this.current(h);
        if (!now.tombstone) await this.save({ ...now, state: 'outcome_unknown', reason: 'mcp-call-outcome-unknown' });
      })).catch(() => {});
    return this.save({ ...h, state: 'running' });
  }
  cancel(handle: ProviderHandle): Promise<ProviderHandle> {
    handle = structuredClone(handle);
    const before = this.current(handle);
    if (!['completed', 'failed', 'cancelled'].includes(before.state)) this.cancelIntents.add(handle.jobId);
    return this.serial(async () => {
    const h = this.current(handle);
    if (this.staged.has(h.jobId)) return this.stage({ ...h, tombstone: true, state: 'cancelled', output: undefined });
    const ownedHere = this.ownedAttempts.has(h.jobId) && h.providerInstanceId === this.instanceId;
    if (['completed', 'failed', 'cancelled'].includes(h.state) && !this.cancelIntents.has(h.jobId)) return h;
    // This closes this adapter's dedicated transport, not proof that the server-side work stopped.
    const cancelled = await this.save({ ...h, tombstone: true, state: 'cancelled', output: undefined, reason: 'abandoned-process-stop-unconfirmed' });
    if (!ownedHere) return cancelled; // Fence imported work without closing another attempt's worker.
    const requestId = this.requestIds.get(h.jobId);
    if (requestId !== undefined) {
      try { this.rpc.notify('notifications/cancelled', { requestId, reason: 'User cancelled' }); } catch { /* Best effort only. */ }
    }
    this.rpc.close(); return cancelled;
  }); }
  resume(handle: ProviderHandle, followup?: ProviderRequest): Promise<ProviderHandle> { handle = structuredClone(handle); followup = followup && structuredClone(followup); return this.serial(async () => {
    const h = this.current(handle); await this.hooks.authorizeRecovery(h, this.audit);
    if (h.workspace !== this.audit.workspace) throw new Error('provider-process-cwd-mismatch');
    if (followup) {
      if (!this.transportAlive || !this.ownedAttempts.has(handle.jobId)) throw new Error('unsupported:mcp-continuation-after-process-restart');
      if (h.state !== 'completed' || h.tombstone || !h.threadId) throw new Error('followup-requires-confirmed-completion');
      if (followup.workspace !== h.workspace || followup.policyKey !== h.policyKey || followup.model !== h.model) throw new Error('policy-change-requires-new-thread');
      if (this.handles.has(followup.jobId)) throw new Error('attempt-already-dispatched');
      if (this.latestByThread.get(h.threadId) !== h.jobId) throw new Error('thread-advanced');
      if ([...this.handles.values()].some(other => !['completed', 'failed', 'cancelled'].includes(other.state))) throw new Error('mcp-dedicated-transport-busy');
      let policy: AuditedPolicy;
      try { policy = await this.hooks.authorize(followup, this.audit, 'dispatch'); checkPolicy(followup, policy); }
      catch (error) { throw new ProviderNotSentError('mcp-server', followup.jobId, error); }
      if (followup.mode === 'structured-final' && !followup.outputSchema) throw new Error('output-schema-required');
      const next = this.stage({ ...h, revision: undefined, auditScope: policy.auditScope, providerInstanceId: this.instanceId, jobId: followup.jobId, mode: followup.mode, state: 'starting', output: undefined, reason: undefined });
      // codex-reply cannot accept changed policy/model: the host's identity must be unchanged.
      return this.dispatch(next, followup, 'codex-reply', { threadId: h.threadId });
    }
    if (h.tombstone || ['completed', 'failed', 'cancelled'].includes(h.state)) return h;
    return this.save({ ...h, state: 'outcome_unknown', reason: 'unsupported:mcp-recovery-without-new-model-turn' });
  }); }
  inspect(handle: ProviderHandle): Promise<ProviderHandle> { handle = structuredClone(handle); return this.serial(async () => {
    const known = this.handles.get(handle.jobId);
    if (known) return this.current(handle);
    const h = this.current(handle);
    return h.tombstone || ['completed', 'failed', 'cancelled'].includes(h.state) ? h
      : this.save({ ...h, state: 'outcome_unknown', reason: 'unsupported:mcp-state-query' });
  }); }
}
