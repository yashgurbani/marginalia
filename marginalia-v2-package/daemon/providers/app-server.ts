import { ProviderNotSentError } from '../../contracts/job-runner.ts';
import type { AuditedPolicy, JobRunner, ProviderAudit, ProviderHandle, ProviderHooks, ProviderRequest } from '../../contracts/job-runner.ts';
import type { RpcTransport } from './stdio.ts';
import { pages } from './preflight.ts';
import { randomUUID } from 'node:crypto';

export function checkPolicy(request: ProviderRequest, policy: AuditedPolicy): void {
  if (policy.policyKey !== request.policyKey || policy.workspace !== request.workspace) throw new Error('policy-binding-mismatch');
  if (policy.thread.approvalPolicy !== 'never' || policy.turn.approvalPolicy !== 'never') throw new Error('approval-policy-required');
  if (policy.thread.cwd !== request.workspace || policy.turn.cwd !== request.workspace) throw new Error('policy-cwd-mismatch');
}

export class AppServerRunner implements JobRunner {
  readonly capabilities = { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true } as const;
  private rpc: RpcTransport;
  private audit: ProviderAudit;
  private hooks: ProviderHooks;
  private handles = new Map<string, ProviderHandle>();
  private requests = new Map<string, ProviderRequest>();
  private cancelIntents = new Set<string>();
  private instanceId = randomUUID();
  private successorByAttempt = new Map<string, string>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(rpc: RpcTransport, audit: ProviderAudit, hooks: ProviderHooks) {
    this.rpc = rpc; this.audit = audit; this.hooks = hooks;
    rpc.onNotification((method, params) => {
      if (method !== 'turn/completed') return;
      void this.serial(async () => {
        const h = [...this.handles.values()].find(h => h.threadId === params.threadId && h.turnId === params.turn?.id);
        if (h) await this.observe(h, params.turn);
      }).catch(() => { /* Failed persistence never publishes success; inspect can recover. */ });
    });
    rpc.onDisconnect(() => { void this.serial(async () => {
      for (const h of this.handles.values()) if (['starting', 'running', 'cancel_requested'].includes(h.state)) {
        await this.save({ ...h, state: 'outcome_unknown', reason: 'transport-disconnected' });
      }
    }).catch(() => {}); });
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn); this.tail = next.catch(() => {}); return next;
  }
  private fenced(h: ProviderHandle): ProviderHandle {
    return this.cancelIntents.has(h.jobId) ? { ...h, tombstone: true, output: undefined,
      state: ['completed', 'failed', 'cancelled'].includes(h.state) ? 'cancelled' : h.state === 'outcome_unknown' ? 'outcome_unknown' : 'cancel_requested' } : h;
  }
  private async save(h: ProviderHandle): Promise<ProviderHandle> {
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
    if (h.provider !== 'app-server') throw new Error('provider-mismatch');
    const known = this.handles.get(h.jobId);
    if (known && (h.workspace !== known.workspace || h.policyKey !== known.policyKey || h.threadId && known.threadId && h.threadId !== known.threadId || h.turnId && known.turnId && h.turnId !== known.turnId)) throw new Error('handle-binding-mismatch');
    if (h.tombstone) this.cancelIntents.add(h.jobId);
    const current = !known || (h.revision ?? -1) > (known.revision ?? -1) ? h : known;
    return this.fenced({ ...current });
  }
  start(request: ProviderRequest): Promise<ProviderHandle> { request = structuredClone(request); return this.serial(async () => {
    if (this.handles.has(request.jobId)) throw new Error('attempt-already-dispatched');
    if (request.workspace !== this.audit.workspace) throw new Error('provider-process-cwd-mismatch');
    if (request.mode === 'structured-final' && !request.outputSchema) throw new Error('output-schema-required');
    let policy: AuditedPolicy;
    try { policy = await this.hooks.authorize(request, this.audit, 'bootstrap'); checkPolicy(request, policy); }
    catch (error) { throw new ProviderNotSentError('app-server', request.jobId, error); }
    let h: ProviderHandle = { jobId: request.jobId, provider: 'app-server', workspace: request.workspace,
      policyKey: request.policyKey, auditScope: policy.auditScope, providerInstanceId: this.instanceId, mode: request.mode, model: request.model, state: 'starting', tombstone: false };
    h = await this.save(h); this.requests.set(h.jobId, request);
    let dispatched = false;
    try {
      if (this.fenced(h).tombstone) return this.save({ ...h, state: 'cancelled', tombstone: true, reason: 'cancelled-before-thread' });
      const started = await this.rpc.request('thread/start', { ...policy.thread, model: request.model, allowProviderModelFallback: false });
      if (!started.thread?.id) throw new Error('missing-thread-id');
      h = await this.save({ ...h, threadId: started.thread.id });
      await this.hooks.verifyThread(h, started, this.audit);
      const dispatchPolicy = await this.hooks.authorize(request, this.audit, 'dispatch'); checkPolicy(request, dispatchPolicy);
      if (this.cancelIntents.has(h.jobId)) return this.save({ ...h, tombstone: true, state: 'cancelled', reason: 'cancelled-before-turn' });
      // Persist the dispatch boundary. A timeout from this point is not permission to retry.
      h = await this.save({ ...h, auditScope: dispatchPolicy.auditScope, state: 'starting', reason: 'turn-dispatch-pending' });
      await this.hooks.authorizeSend(structuredClone(request), structuredClone(h), this.audit);
      const sendHandle = this.current(h);
      if (sendHandle.tombstone) return this.save({ ...sendHandle, state: 'cancelled', tombstone: true, reason: 'cancelled-before-turn' });
      dispatched = true;
      const result = await this.rpc.request('turn/start', { ...dispatchPolicy.turn, threadId: sendHandle.threadId, model: request.model,
        input: [{ type: 'text', text: request.prompt, text_elements: [] }],
        ...(request.mode === 'structured-final' ? { outputSchema: request.outputSchema } : {}) });
      if (!result.turn?.id) throw new Error('missing-turn-id');
      h = await this.save({ ...h, turnId: result.turn.id, state: 'running', reason: undefined });
      return result.turn.status !== 'inProgress' ? this.observe(h, result.turn) : h;
    } catch { return this.save({ ...h, state: dispatched ? 'outcome_unknown' : 'failed', reason: dispatched ? 'dispatch-outcome-unknown' : 'pre-dispatch-preparation-rejected' }); }
  }); }
  private async observe(h: ProviderHandle, turn: any): Promise<ProviderHandle> {
    if (h.tombstone) return this.save({ ...h, state: turn.status === 'inProgress' ? 'cancel_requested' : 'cancelled', output: undefined });
    if (turn.status === 'inProgress') return this.save({ ...h, state: 'running' });
    if (turn.status === 'interrupted') return this.save({ ...h, state: 'cancelled', tombstone: true, output: undefined });
    if (turn.status !== 'completed') return this.save({ ...h, state: 'failed', reason: 'provider-turn-failed' });
    if (h.mode === 'workspace-files') return this.save({ ...h, state: 'completed' });
    const items = await pages(this.rpc, 'thread/items/list', { threadId: h.threadId, turnId: h.turnId, sortDirection: 'asc' });
    const messages = items.filter(entry => entry.turnId === h.turnId && entry.item?.type === 'agentMessage').map(entry => entry.item);
    const finals = messages.filter(item => item.phase === 'final_answer');
    // Legacy unknown phase is accepted only for a single unambiguous message, after completion.
    const candidate = finals.length === 1 ? finals[0] : finals.length === 0 && messages.length === 1 && messages[0].phase == null ? messages[0] : undefined;
    const text = candidate?.text;
    let valid = false;
    if (typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024) {
      try { JSON.parse(text); valid = await this.hooks.validateOutput(text, h, this.requests.get(h.jobId)); } catch { /* refusal / malformed data */ }
    }
    return this.save(valid ? { ...h, state: 'completed', output: text, reason: undefined }
      : { ...h, state: 'failed', output: undefined, reason: 'invalid-or-missing-final-output' });
  }
  private async recover(handle: ProviderHandle, resume: boolean): Promise<ProviderHandle> {
    const h = this.current(handle);
    if (h.workspace !== this.audit.workspace) throw new Error('provider-process-cwd-mismatch');
    await this.hooks.authorizeRecovery(h, this.audit);
    if (resume && (h.state !== 'completed' || h.tombstone || !h.threadId || !h.turnId)) throw new Error('followup-requires-confirmed-completion');
    if (!h.turnId && ['failed', 'cancelled'].includes(h.state)) return h;
    if (!h.threadId || !h.turnId) return this.save({ ...h, state: 'outcome_unknown', reason: 'missing-provider-identifiers' });
    try {
      await this.rpc.request('thread/read', { threadId: h.threadId, includeTurns: false });
      const turns = await pages(this.rpc, 'thread/turns/list', { threadId: h.threadId, itemsView: 'notLoaded' });
      const turn = turns.find(turn => turn.id === h.turnId);
      if (!turn) {
        if (resume) throw new Error('recorded-turn-not-found');
        return this.save({ ...h, state: 'outcome_unknown', reason: 'recorded-turn-not-found' });
      }
      if (resume) {
        if (turn.status !== 'completed') throw new Error('followup-requires-confirmed-completion');
        const response = await this.rpc.request('thread/resume', { threadId: h.threadId, cwd: h.workspace, approvalPolicy: 'never', excludeTurns: true });
        await this.hooks.verifyThread(h, response, this.audit);
        // Verify the completed predecessor without rewriting its terminal host record.
        // Reconcile cancellation that arrived during the read/load/authorization awaits.
        return this.current(h);
      }
      return await this.observe(h, turn);
    } catch (error) {
      if (resume) throw error; // A failed continuation check must not mutate its parent either.
      return this.save({ ...h, state: 'outcome_unknown', reason: 'provider-state-unavailable' });
    }
  }
  resume(h: ProviderHandle, followup?: ProviderRequest): Promise<ProviderHandle> { h = structuredClone(h); followup = followup && structuredClone(followup); return this.serial(async () => {
    const recovered = await this.recover(h, !!followup);
    if (!followup) return recovered;
    if (recovered.state !== 'completed' || recovered.tombstone) throw new Error('followup-requires-confirmed-completion');
    if (followup.workspace !== recovered.workspace || followup.policyKey !== recovered.policyKey || followup.model !== recovered.model) throw new Error('policy-change-requires-new-thread');
    if (this.handles.has(followup.jobId)) throw new Error('attempt-already-dispatched');
    if (this.successorByAttempt.has(recovered.jobId)) throw new Error('thread-advanced');
    const latest = await pages(this.rpc, 'thread/turns/list', { threadId: recovered.threadId, sortDirection: 'desc', itemsView: 'notLoaded' });
    if (latest[0]?.id !== recovered.turnId || latest.some(t => t.status === 'inProgress')) throw new Error('thread-advanced-or-active');
    let policy: AuditedPolicy;
    try { policy = await this.hooks.authorize(followup, this.audit, 'dispatch'); checkPolicy(followup, policy); }
    catch (error) { throw new ProviderNotSentError('app-server', followup.jobId, error); }
    if (followup.mode === 'structured-final' && !followup.outputSchema) throw new Error('output-schema-required');
    let next = await this.save({ ...recovered, revision: undefined, providerInstanceId: this.instanceId, auditScope: policy.auditScope, jobId: followup.jobId, mode: followup.mode, turnId: undefined,
      output: undefined, state: 'starting', reason: 'turn-dispatch-pending' });
    this.requests.set(next.jobId, followup);
    let dispatched = false;
    try {
      await this.hooks.authorizeSend(structuredClone(followup), structuredClone(next), this.audit);
      const sendHandle = this.current(next);
      if (sendHandle.tombstone) return this.save({ ...sendHandle, state: 'cancelled', tombstone: true, reason: 'cancelled-before-turn' });
      this.successorByAttempt.set(recovered.jobId, next.jobId);
      dispatched = true;
      const result = await this.rpc.request('turn/start', { ...policy.turn, threadId: sendHandle.threadId, model: followup.model,
        input: [{ type: 'text', text: followup.prompt, text_elements: [] }],
        ...(followup.mode === 'structured-final' ? { outputSchema: followup.outputSchema } : {}) });
      if (!result.turn?.id) throw new Error('missing-turn-id');
      next = await this.save({ ...next, turnId: result.turn.id, state: 'running', reason: undefined });
      return result.turn.status === 'inProgress' ? next : this.observe(next, result.turn);
    } catch { return this.save({ ...next, state: dispatched ? 'outcome_unknown' : 'failed',
      reason: dispatched ? 'dispatch-outcome-unknown' : 'pre-dispatch-authorization-rejected' }); }
  }); }
  inspect(h: ProviderHandle): Promise<ProviderHandle> { h = structuredClone(h); return this.serial(() => this.recover(h, false)); }
  cancel(handle: ProviderHandle): Promise<ProviderHandle> {
    handle = structuredClone(handle);
    const before = this.current(handle);
    if (!['completed', 'failed', 'cancelled'].includes(before.state)) this.cancelIntents.add(handle.jobId);
    return this.serial(async () => {
    let h = this.current(handle);
    if (h.workspace !== this.audit.workspace) throw new Error('provider-process-cwd-mismatch');
    if (h.providerInstanceId !== this.instanceId) await this.hooks.authorizeRecovery(h, this.audit);
    if (['completed', 'failed', 'cancelled'].includes(h.state)) return { ...h };
    h = await this.save({ ...h, tombstone: true, state: 'cancel_requested', output: undefined });
    if (!h.threadId || !h.turnId) return this.save({ ...h, state: 'outcome_unknown', reason: 'cancel-fenced-missing-identifiers' });
    try { await this.rpc.request('turn/interrupt', { threadId: h.threadId, turnId: h.turnId }); }
    catch { return this.save({ ...h, state: 'outcome_unknown', reason: 'interrupt-unconfirmed' }); }
    return h; // Acknowledgment is not a terminal event.
  }); }
}
