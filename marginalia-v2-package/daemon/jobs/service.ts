import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ProviderNotSentError, type ProviderHandle, type ProviderRequest } from '../../contracts/job-runner.ts';
import { canonicalReplyData, parseAndValidateReply, type CandidateReply, type ReplyCapability } from '../../contracts/reply.ts';
import type { FollowupJobInput, FrozenJobContext, JobSnapshot, PreparedJobResult, PrepareFollowupJobInput, PrepareJobInput, PrepareRetryJobInput, ProviderJobPacket, RetryJobInput, StartJobInput } from '../../contracts/jobs.ts';
import type { OutgoingPart, PrepareConsentInput } from '../../contracts/consent.ts';
import type { ReaderStore } from '../store.ts';
import type { QuoteAnchor, SourceVersion } from '../../contracts/reader.ts';
import type { AuthorizedRuntimeFactory, RunningProvider } from './runtime.ts';
import { JobConflictError, JobStore, packetDigest } from './store.ts';
import { prepareContinuationWorkspace, prepareWorkspace, provisionalForDisplay, readReplyFile, restoreCompletedWorkspace, verifyContinuationWorkspace } from './workspace.ts';
import { buildProviderPrompt, prepareEnvelope } from './envelope.ts';
import type { LibrarySettingsService } from '../library.ts';

const ID = /^[\w-]{1,100}$/;
const PROVIDER_TERMINAL = new Set(['completed', 'failed', 'cancelled', 'outcome_unknown']);

export type JobServiceOptions = {
  reader: ReaderStore;
  workspaceRoot: string;
  runtimeFactory?: AuthorizedRuntimeFactory;
  timeoutMs?: number;
  library: Pick<LibrarySettingsService, 'modelFor' | 'continuationIdentity'>;
  defaults?: { provider: StartJobInput['provider']; mode: StartJobInput['mode']; policyKey?: string;
    policyFor?: (workspace: string, mode: StartJobInput['mode'], model: string, provider: StartJobInput['provider']) => string;
    capabilities: ReplyCapability[] };
};

export class JobService {
  readonly store: JobStore;
  readonly available: boolean;
  readonly configured: boolean;
  readonly unavailableReason?: string;
  private reader: ReaderStore;
  private workspaceRoot: string;
  private factory?: AuthorizedRuntimeFactory;
  private timeoutMs: number;
  private schema?: string;
  private runtimes = new Map<string, RunningProvider>();
  private workspaces = new Map<string, string>();
  private timers = new Map<string, NodeJS.Timeout>();
  private watchers = new Map<string, NodeJS.Timeout>();
  private retentionTimers = new Map<string, NodeJS.Timeout>();
  private settling = new Set<string>();
  private markedDispatch = new Set<string>();
  private pending = new Set<Promise<void>>();
  private closing = false;
  private library: JobServiceOptions['library'];
  private defaults?: JobServiceOptions['defaults'];
  constructor(options: JobServiceOptions) {
    this.reader = options.reader;
    this.store = new JobStore(options.reader);
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.factory = options.runtimeFactory;
    this.library = options.library;
    this.defaults = options.defaults && { ...options.defaults, capabilities: [...options.defaults.capabilities] };
    this.configured = !!options.runtimeFactory && !!this.defaults &&
      (typeof this.defaults.policyFor === 'function' || !!this.defaults.policyKey && /^[a-f0-9]{64}$/.test(this.defaults.policyKey));
    this.available = this.configured && options.runtimeFactory!.dispatchReady;
    this.unavailableReason = !this.defaults || !this.configured && !!options.runtimeFactory ? 'No host-owned execution policy is configured.'
      : options.runtimeFactory?.unavailableReason ?? (!options.runtimeFactory ? 'No authorized provider runtime is configured.'
        : !options.runtimeFactory.dispatchReady ? 'Dedicated sign-in and runtime policy evidence are not ready.' : undefined);
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 60 * 60 * 1000) throw new Error('Invalid job timeout.');
  }
  async recover() {
    for (const job of this.store.list()) {
      if (job.state === 'queued' && !job.latestAttemptId) { this.store.failQueuedWithoutAttempt(job.id); continue; }
      if (!job.latestAttemptId || !['queued', 'preparing', 'sending', 'running', 'validating', 'cancel_requested'].includes(job.state)) continue;
      const attempt = job.attempts.find(a => a.id === job.latestAttemptId);
      if (!attempt) continue;
      if (!attempt.dispatchClaimed || !attempt.providerHandle) {
        if (job.cancelRequested && !attempt.handoffMarked) {
          this.store.cancelBeforeHandoff(job.id, attempt.id);
          this.store.releaseUndispatchedContinuation(attempt.id);
          continue;
        }
        this.store.setState(job.id, attempt.id, attempt.handoffMarked ? 'outcome_unknown' : 'failed',
          attempt.handoffMarked ? 'daemon-restarted-after-provider-handoff' : 'daemon-restarted-before-provider-dispatch');
        continue;
      }
      if (attempt.state === 'validating' && attempt.providerHandle.state === 'completed') {
        if (!this.factory) { this.store.setState(job.id, attempt.id, 'outcome_unknown', 'authorized-runtime-unavailable-after-restart'); continue; }
        try {
          if (job.mode === 'workspace-files') this.workspaces.set(attempt.id,
            await restoreCompletedWorkspace(this.workspaceRoot, attempt.providerHandle.workspace, job.context.outgoing));
          await this.settle(job.id, attempt.id, attempt.revision);
        } catch (error) { this.store.setState(job.id, attempt.id, 'failed', `completed-workspace-unavailable:${safeReason(error)}`); }
        continue;
      }
      if (!this.factory) {
        this.store.setState(job.id, attempt.id, 'outcome_unknown', 'authorized-runtime-unavailable-after-restart');
        continue;
      }
      const deadline = attempt.deadlineAt ? Date.parse(attempt.deadlineAt) : Date.now() + this.timeoutMs;
      if (deadline <= Date.now()) { this.store.markTimedOut(job.id, attempt.id); continue; }
      try {
        const runtime = await this.factory.create(job, attempt.id, attempt.providerHandle.workspace, this.hostHooks());
        this.runtimes.set(attempt.id, runtime);
        this.workspaces.set(attempt.id, attempt.providerHandle.workspace);
        this.armTimeout(job.id, attempt.id, deadline);
        if (job.mode === 'workspace-files') this.watchWorkspace(job.id, attempt.id, attempt.providerHandle.workspace, this.store.capabilities(job.id));
        const observed = job.cancelRequested ? await runtime.runner.cancel(attempt.providerHandle) : await runtime.runner.inspect(attempt.providerHandle);
        if (PROVIDER_TERMINAL.has(observed.state)) await this.settleFromDurable(job.id, attempt.id);
      } catch (error) {
        this.store.setState(job.id, attempt.id, 'outcome_unknown', `recovery-unavailable:${safeReason(error)}`);
      }
    }
  }
  get(id: string) { return this.store.get(id); }
  list(threadId?: string) { if (threadId !== undefined) requireId(threadId, 'thread'); return this.store.list(threadId); }
  async prepare(raw: PrepareJobInput, admit?: () => boolean): Promise<PreparedJobResult> {
    if (!this.configured || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    const draft = validatePrepare(raw);
    const tier = draft.intent === 'define' ? 'fast' : 'deep';
    const selection = this.library.modelFor(tier);
    const input: StartJobInput = { ...draft, provider: this.defaults.provider, mode: this.defaults.mode,
      capabilities: [...this.defaults.capabilities], model: selection.model,
      policyKey: this.policyFor(draft.id, this.defaults.mode, selection.model), grantId: 'pending', preparedPayloadDigest: '0'.repeat(64) };
    const context = this.freezeContext(input, selection);
    const prepared = await this.prepared(input, context);
    assertAdmission(admit);
    this.store.savePreparation(input.id, preparationIdentity(input), prepared.digest);
    return this.preparedResult(input, context, prepared);
  }
  async prepareRetry(jobId: string, raw: PrepareRetryJobInput, admit?: () => boolean): Promise<PreparedJobResult> {
    if (!this.configured || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    requireId(jobId, 'job'); requireId(raw?.id, 'job'); requireId(raw?.idempotencyKey, 'request');
    const previous = this.store.get(jobId);
    if (!previous || !['failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(previous.state)) throw new JobConflictError('Only finished unsuccessful work can be tried again.');
    const selection = this.library.modelFor(previous.context.intent === 'define' ? 'fast' : 'deep');
    const input: StartJobInput = { id: raw.id, idempotencyKey: raw.idempotencyKey, threadId: previous.threadId, intent: previous.context.intent,
      question: previous.context.question, provider: this.defaults.provider, mode: this.defaults.mode,
      capabilities: [...this.defaults.capabilities], model: selection.model,
      policyKey: this.policyFor(raw.id, this.defaults.mode, selection.model), grantId: 'pending', preparedPayloadDigest: '0'.repeat(64), parentReplyId: previous.context.parentReplyId };
    const context: FrozenJobContext = { ...structuredClone(previous.context), retryOfJobId: previous.id, parentJobId: undefined,
      parentAttemptId: undefined, preparedPayloadDigest: input.preparedPayloadDigest,
      modelSettingsRevision: selection.settingsRevision, modelCompatibilityKey: selection.compatibilityKey };
    context.outgoing = { ...context.outgoing, availableCapabilities: [...input.capabilities!] };
    const prepared = await this.prepared(input, context);
    assertAdmission(admit);
    this.store.savePreparation(input.id, preparationIdentity(input), prepared.digest);
    return this.preparedResult(input, context, prepared);
  }
  async prepareFollowup(parentJobId: string, raw: PrepareFollowupJobInput, admit?: () => boolean): Promise<PreparedJobResult> {
    if (!this.configured || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    requireId(parentJobId, 'job');
    validateFollowup({ ...raw, grantId: 'pending', preparedPayloadDigest: '0'.repeat(64) });
    const parent = this.store.get(parentJobId);
    if (!parent || parent.state !== 'succeeded' || !parent.replyVersionId || !parent.latestAttemptId) throw new JobConflictError('A follow-up requires a confirmed completed reply.');
    const selection = this.library.modelFor(parent.context.intent === 'define' ? 'fast' : 'deep');
    const input: StartJobInput = { id: raw.id, idempotencyKey: raw.idempotencyKey, threadId: parent.threadId, intent: parent.context.intent,
      question: raw.question.trim(), provider: this.defaults.provider, mode: this.defaults.mode,
      capabilities: [...this.defaults.capabilities], model: selection.model,
      policyKey: this.policyFor(raw.id, this.defaults.mode, selection.model, parent), grantId: 'pending', preparedPayloadDigest: '0'.repeat(64), parentReplyId: parent.replyVersionId };
    const context: FrozenJobContext = { ...this.freezeContext(input, selection), parentJobId: parent.id,
      ...(this.canResume(parent, this.defaults.mode, selection.model) ? { parentAttemptId: parent.latestAttemptId } : {}) };
    const prepared = await this.prepared(input, context);
    assertAdmission(admit);
    this.store.savePreparation(input.id, preparationIdentity(input), prepared.digest);
    return this.preparedResult(input, context, prepared);
  }
  async create(raw: StartJobInput, admit?: () => boolean): Promise<JobSnapshot> {
    if (!this.available || !this.factory || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    const validated = validateStart(raw);
    const tier = validated.intent === 'define' ? 'fast' : 'deep';
    const selection = this.library.modelFor(tier);
    const input = { ...validated, model: selection.model };
    this.assertHostPlan(input);
    const requestDigest = packetDigest(input);
    const prior = this.store.findByIdempotencyKey(input.idempotencyKey);
    if (prior) {
      if (prior.id !== input.id || prior.requestDigest !== requestDigest) throw new JobConflictError('This request key already identifies different work.');
      return prior;
    }
    const context = this.freezeContext(input, selection);
    if ((await this.prepared(input, context)).digest !== input.preparedPayloadDigest) throw new JobConflictError('The reviewed outgoing content changed. Review it again.');
    assertAdmission(admit);
    const digest = packetDigest({ input, context });
    const created = this.store.createAndAttempt(input, context, digest, requestDigest, preparationIdentity(input));
    if (created.attempt) this.launch(this.dispatch(created.job.id, created.attempt.id), created.job.id, created.attempt.id);
    return this.store.get(created.job.id)!;
  }
  async retry(jobId: string, raw: RetryJobInput, admit?: () => boolean): Promise<JobSnapshot> {
    if (!this.available || !this.factory || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    requireId(jobId, 'job');
    validateRetry(raw);
    const previous = this.store.get(jobId);
    if (!previous || !['failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(previous.state)) throw new JobConflictError('Only finished unsuccessful work can be tried again.');
    const selection = this.library.modelFor(previous.context.intent === 'define' ? 'fast' : 'deep');
    const input: StartJobInput = { id: raw.id, idempotencyKey: raw.idempotencyKey, threadId: previous.threadId, intent: previous.context.intent,
      question: previous.context.question, provider: this.defaults.provider, model: selection.model, mode: this.defaults.mode, policyKey: this.policyFor(raw.id, this.defaults.mode, selection.model),
      grantId: raw.grantId, preparedPayloadDigest: raw.preparedPayloadDigest, parentReplyId: previous.context.parentReplyId,
      capabilities: [...this.defaults.capabilities] };
    const context: FrozenJobContext = { ...structuredClone(previous.context), retryOfJobId: previous.id, parentJobId: undefined,
      parentAttemptId: undefined, preparedPayloadDigest: raw.preparedPayloadDigest,
      modelSettingsRevision: selection.settingsRevision, modelCompatibilityKey: selection.compatibilityKey };
    context.outgoing = { ...context.outgoing, question: context.question, availableCapabilities: [...input.capabilities!] };
    if ((await this.prepared(input, context)).digest !== input.preparedPayloadDigest) throw new JobConflictError('The reviewed outgoing content changed. Review it again.');
    assertAdmission(admit);
    const requestDigest = packetDigest(input);
    const prior = this.store.findByIdempotencyKey(input.idempotencyKey);
    if (prior) {
      if (prior.id !== input.id || prior.requestDigest !== requestDigest) throw new JobConflictError('This request key already identifies different work.');
      return prior;
    }
    const created = this.store.createAndAttempt(input, context, packetDigest({ input, context }), requestDigest, preparationIdentity(input));
    if (created.attempt) this.launch(this.dispatch(created.job.id, created.attempt.id), created.job.id, created.attempt.id);
    return this.store.get(created.job.id)!;
  }
  async followup(parentJobId: string, raw: FollowupJobInput, admit?: () => boolean): Promise<JobSnapshot> {
    if (!this.available || !this.factory || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    requireId(parentJobId, 'job');
    validateFollowup(raw);
    const parent = this.store.get(parentJobId);
    if (!parent || parent.state !== 'succeeded' || !parent.replyVersionId || !parent.latestAttemptId) throw new JobConflictError('A follow-up requires a confirmed completed reply.');
    const parentAttempt = parent.attempts.find(a => a.id === parent.latestAttemptId);
    if (!parentAttempt?.providerHandle || parentAttempt.providerHandle.state !== 'completed') throw new JobConflictError('The provider completion is not confirmed.');
    const selection = this.library.modelFor(parent.context.intent === 'define' ? 'fast' : 'deep');
    const input: StartJobInput = { id: raw.id, idempotencyKey: raw.idempotencyKey, threadId: parent.threadId, intent: parent.context.intent,
      question: raw.question, provider: this.defaults.provider, model: selection.model,
      mode: this.defaults.mode, policyKey: this.policyFor(raw.id, this.defaults.mode, selection.model, parent),
      grantId: raw.grantId, preparedPayloadDigest: raw.preparedPayloadDigest, parentReplyId: parent.replyVersionId, capabilities: [...this.defaults.capabilities] };
    const requestDigest = packetDigest(input);
    const prior = this.store.findByIdempotencyKey(input.idempotencyKey);
    if (prior) {
      if (prior.id !== input.id || prior.requestDigest !== requestDigest) throw new JobConflictError('This request key already identifies different work.');
      return prior;
    }
    const context: FrozenJobContext = { ...this.freezeContext(input, selection), parentJobId: parent.id,
      ...(this.canResume(parent, this.defaults.mode, selection.model) ? { parentAttemptId: parentAttempt.id } : {}) };
    if ((await this.prepared(input, context)).digest !== input.preparedPayloadDigest) throw new JobConflictError('The reviewed outgoing content changed. Review it again.');
    assertAdmission(admit);
    const digest = packetDigest({ input, context });
    const created = this.store.createAndAttempt(input, context, digest, requestDigest, preparationIdentity(input));
    if (created.attempt) this.launch(this.dispatch(created.job.id, created.attempt.id, parentAttempt.providerHandle), created.job.id, created.attempt.id);
    return this.store.get(created.job.id)!;
  }
  async cancel(jobId: string): Promise<JobSnapshot> {
    requireId(jobId, 'job');
    const { job, handle } = this.store.requestCancel(jobId);
    if (!handle && job.latestAttemptId) {
      if (this.store.cancelBeforeHandoff(job.id, job.latestAttemptId)) {
        this.clearActivity(job.latestAttemptId);
        this.store.releaseUndispatchedContinuation(job.latestAttemptId);
        this.recordOutcome(job.latestAttemptId, 'cancelled-before-provider-handoff');
      }
      return this.store.get(jobId)!;
    }
    if (!handle || job.state === 'succeeded') return this.store.get(jobId)!;
    const runtime = job.latestAttemptId && this.runtimes.get(job.latestAttemptId);
    if (runtime) {
      try { await runtime.runner.cancel(handle); }
      catch { this.store.setState(job.id, job.latestAttemptId!, 'outcome_unknown', 'cancel-fenced-provider-stop-unconfirmed'); }
    }
    this.recordOutcome(job.latestAttemptId, this.store.get(jobId)?.state ?? 'cancel_requested');
    return this.store.get(jobId)!;
  }
  private freezeContext(input: StartJobInput, selection: { model: string; settingsRevision: number; compatibilityKey: string }): FrozenJobContext {
    const thread = this.reader.get(input.threadId);
    if (!thread || thread.deletedAt) throw new Error('This thread is unavailable.');
    const source = this.reader.sourceVersion(thread.sourceVersionId);
    if (!source) throw new Error('The source version is unavailable.');
    if (input.parentReplyId && this.reader.reply(input.parentReplyId)?.threadId !== thread.id) throw new Error('The parent reply is unavailable in this thread.');
    let answeredNote: FrozenJobContext['answeredNote'];
    if (input.answeredNote) {
      const note = this.reader.noteVersion(input.answeredNote);
      if (!note || !thread.notes.some(n => n.id === note.noteId)) throw new Error('The note version is unavailable in this thread.');
      answeredNote = note;
    }
    const outgoing = providerPacket(input, thread.anchor, source, thread.sourceUrl, thread.sourceTitle, answeredNote);
    if (input.parentReplyId) {
      const parent = this.reader.reply(input.parentReplyId);
      if (!parent || parent.deletedAt) throw new Error('The parent reply is unavailable.');
      const sourceBytes = Buffer.from(canonicalReplyData(parent.reply), 'utf8');
      const excerpt = utf8Prefix(sourceBytes, 4_000);
      outgoing.parentReply = { replyVersionId: parent.id, excerpt, omittedBytes: sourceBytes.length - Buffer.byteLength(excerpt) };
      if (outgoing.parentReply.omittedBytes) outgoing.omissions.push('The accepted parent reply was truncated to a 4,000-byte host-owned excerpt.');
    }
    return { threadId: thread.id, sourceVersionId: thread.sourceVersionId, sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle,
      sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt, sourceHash: source.hash,
      sourceText: source.text, passage: structuredClone(thread.anchor), answeredNote, question: input.question, intent: input.intent,
      parentReplyId: input.parentReplyId, preparedPayloadDigest: input.preparedPayloadDigest,
      modelSettingsRevision: selection.settingsRevision, modelCompatibilityKey: selection.compatibilityKey, outgoing };
  }
  private async dispatch(jobId: string, attemptId: string, predecessor?: ProviderHandle) {
    if (this.closing) throw new Error('service-closing');
    const factory = this.factory;
    if (!factory) throw new JobUnavailableError();
    let job = this.store.get(jobId)!;
    this.store.setDeadline(jobId, attemptId, new Date(Date.now() + this.timeoutMs).toISOString());
    this.store.markPreparing(jobId, attemptId);
    const persistedAttempt = this.store.get(jobId)!.attempts.find(a => a.id === attemptId)!;
    this.armTimeout(jobId, attemptId, Date.parse(persistedAttempt.deadlineAt!));
    const decision = await factory.consent.revalidate(job, 'dispatch');
    if (decision.grantId !== job.grantId || decision.policyKey !== job.policyKey) throw new Error('Current consent no longer matches the persisted request.');
    if (!decision.auditScope) throw new Error('Consent authorization identity is unavailable.');
    if (!this.active(jobId, attemptId)) { this.store.releaseUndispatchedContinuation(attemptId); return; }
    const compatible = this.store.bindAuthorization(attemptId, this.library.continuationIdentity({ model: job.model,
      settingsRevision: job.context.modelSettingsRevision, compatibilityKey: job.context.modelCompatibilityKey }, decision.auditScope));
    if (!job.context.parentAttemptId || !compatible || (predecessor && (predecessor.policyKey !== job.policyKey || predecessor.model !== job.model || predecessor.mode !== job.mode))) predecessor = undefined;
    // MCP continuation is owned by the live loaded process. After restart/retention it must fork.
    if (predecessor?.provider === 'mcp-server' && (!job.context.parentAttemptId || !this.runtimes.has(job.context.parentAttemptId))) predecessor = undefined;
    if (!predecessor) this.store.forkUndispatchedContinuation(attemptId);
    const plannedWorkspace = predecessor?.workspace ?? resolve(this.workspaceRoot, job.id);
    if (this.defaults?.policyFor && this.defaults.policyFor(plannedWorkspace, job.mode, job.model, job.provider) !== job.policyKey) {
      throw new JobConflictError('Continuation workspace or permission changed after review. Prepare this follow-up again.');
    }
    const schema = await this.replySchema();
    if (predecessor) await verifyContinuationWorkspace(predecessor.workspace, schema);
    if (!this.active(jobId, attemptId)) { this.store.releaseUndispatchedContinuation(attemptId); return; }
    this.store.markWorkspacePrepared(jobId, attemptId);
    const workspace = predecessor
      ? await prepareContinuationWorkspace(predecessor.workspace, predecessor.jobId, job.context.outgoing, schema)
      : await prepareWorkspace(this.workspaceRoot, job.id, job.context.outgoing, schema);
    this.workspaces.set(attemptId, workspace);
    if (!this.active(jobId, attemptId)) { this.workspaces.delete(attemptId); return; }
    const capabilities = this.store.capabilities(job.id);
    const host = this.hostHooks();
    let runtime: RunningProvider;
    if (predecessor && job.context.parentAttemptId && this.runtimes.has(job.context.parentAttemptId)) {
      runtime = this.runtimes.get(job.context.parentAttemptId)!;
      const retention = this.retentionTimers.get(job.context.parentAttemptId); if (retention) clearTimeout(retention);
      this.retentionTimers.delete(job.context.parentAttemptId); this.runtimes.delete(job.context.parentAttemptId);
    } else runtime = await factory.create(job, attemptId, workspace, host);
    if (this.closing) { await runtime.close(); throw new Error('service-closing'); }
    this.runtimes.set(attemptId, runtime);
    if (!this.active(jobId, attemptId)) { await this.releaseRuntime(attemptId); return; }
    if (job.mode === 'workspace-files') this.watchWorkspace(jobId, attemptId, workspace, capabilities);
    job = this.store.get(jobId)!;
    if (job.cancelRequested) return;
    const request = this.providerRequest(job, attemptId, workspace, JSON.parse(schema));
    this.store.withDispatchHandoff(jobId, attemptId, () => factory.consent.markDispatched(job, attemptId));
    this.markedDispatch.add(attemptId);
    const operation = predecessor ? runtime.runner.resume(predecessor, request) : runtime.runner.start(request);
    const observed = await operation;
    if (PROVIDER_TERMINAL.has(observed.state)) await this.settleFromDurable(jobId, attemptId);
  }
  private hostHooks() {
    return {
      jobForAttempt: (attemptId: string) => this.store.jobForAttempt(attemptId),
      checkpoint: async (handle: ProviderHandle) => {
        const acknowledged = this.store.acknowledgeStopFence(handle.jobId, handle);
        if (acknowledged) return acknowledged;
        const canonical = this.store.checkpoint(handle.jobId, handle);
        const owner = this.store.jobForAttempt(handle.jobId);
        if (owner && canonical.revision !== undefined && PROVIDER_TERMINAL.has(canonical.state)) queueMicrotask(() => this.launch(this.settle(owner.id, handle.jobId, canonical.revision!), owner.id, handle.jobId));
        return canonical;
      },
      validateOutput: async (text: string, handle: ProviderHandle) => {
        const current = this.store.jobForAttempt(handle.jobId);
        if (!current || current.cancelRequested || current.latestAttemptId !== handle.jobId) return false;
        return parseAndValidateReply(text, { sourceText: current.context.sourceText, capabilities: this.store.capabilities(current.id) }).ok;
      },
    };
  }
  private providerRequest(job: JobSnapshot, attemptId: string, workspace: string, outputSchema: Record<string, unknown>): ProviderRequest {
    return { jobId: attemptId, workspace, policyKey: job.policyKey, model: job.model, mode: job.mode,
      prompt: buildProviderPrompt(job.context), ...(job.mode === 'structured-final' ? { outputSchema } : {}) };
  }
  private async settleFromDurable(jobId: string, attemptId: string) {
    const attempt = this.store.get(jobId)?.attempts.find(candidate => candidate.id === attemptId);
    if (attempt?.providerHandle && PROVIDER_TERMINAL.has(attempt.providerHandle.state)) await this.settle(jobId, attemptId, attempt.revision);
  }
  private async settle(jobId: string, attemptId: string, expectedRevision: number) {
    if (this.settling.has(attemptId)) return;
    this.settling.add(attemptId);
    try {
      const before = this.store.get(jobId);
      if (!before || before.latestAttemptId !== attemptId || ['succeeded', 'timed_out'].includes(before.state)) return;
      const durableAttempt = before.attempts.find(attempt => attempt.id === attemptId);
      if (!durableAttempt?.dispatchClaimed || durableAttempt.revision !== expectedRevision || !durableAttempt.providerHandle) return;
      const handle = durableAttempt.providerHandle;
      if (handle.state === 'outcome_unknown') { this.store.setState(jobId, attemptId, 'outcome_unknown', handle.reason ?? 'provider-outcome-unknown'); this.recordOutcome(attemptId, 'outcome_unknown'); return; }
      if (handle.state === 'failed') { this.store.setState(jobId, attemptId, 'failed', handle.reason ?? 'provider-failed'); this.recordOutcome(attemptId, 'failed'); return; }
      if (handle.state === 'cancelled' || handle.state === 'cancel_requested' || handle.tombstone) { this.store.setState(jobId, attemptId, 'cancelled', handle.reason ?? 'cancelled'); this.recordOutcome(attemptId, 'cancelled'); return; }
      if (handle.state !== 'completed') return;
      if (durableAttempt.state !== 'validating') return;
      let job = this.store.get(jobId)!;
      if (job.cancelRequested) { this.store.setState(jobId, attemptId, 'cancelled', 'late-output-fenced'); this.recordOutcome(attemptId, 'cancelled'); return; }
      const capabilities = this.store.capabilities(jobId);
      let reply: CandidateReply | undefined;
      if (job.mode === 'structured-final' && handle.output) {
        const parsed = parseAndValidateReply(handle.output, { sourceText: job.context.sourceText, capabilities });
        if (parsed.ok && parsed.value.status === 'complete') reply = parsed.value;
      } else if (job.mode === 'workspace-files') {
        const workspace = this.workspaces.get(attemptId);
        if (workspace) reply = await readReplyFile(workspace, 'reply.json', job.context.sourceText, capabilities);
      }
      if (!reply) { this.store.setState(jobId, attemptId, 'failed', 'invalid-or-missing-final-reply'); this.recordOutcome(attemptId, 'invalid-output'); return; }
      job = this.store.get(jobId)!;
      const decision = await this.factory!.consent.revalidate(job, 'commit');
      if (decision.grantId !== job.grantId || decision.policyKey !== job.policyKey) { this.store.setState(jobId, attemptId, 'cancelled', 'consent-revoked-before-commit'); this.recordOutcome(attemptId, 'consent-revoked'); return; }
      const latest = this.store.get(jobId)?.attempts.find(a => a.id === attemptId);
      if (!latest || latest.revision !== expectedRevision || latest.providerHandle?.state !== 'completed') return;
      this.factory!.consent.withResultAcceptance(job, attemptId, () => this.store.succeed(jobId, attemptId, expectedRevision, reply));
    } catch (error) {
      const current = this.store.get(jobId)?.attempts.find(a => a.id === attemptId);
      if (current?.revision === expectedRevision) this.store.setState(jobId, attemptId, 'failed', safeReason(error));
    } finally {
      this.settling.delete(attemptId);
      this.clearActivity(attemptId);
      const final = this.store.get(jobId);
      if (final?.state === 'succeeded') this.retainRuntime(attemptId);
      else if (final && ['failed', 'cancelled'].includes(final.state)) await this.releaseRuntime(attemptId);
      else {
        const latest = final?.attempts.find(a => a.id === attemptId);
        if (latest?.revision !== expectedRevision && latest?.providerHandle?.state === 'completed' && final?.state === 'validating') {
          queueMicrotask(() => this.launch(this.settle(jobId, attemptId, latest.revision), jobId, attemptId));
        }
      }
    }
  }
  private watchWorkspace(jobId: string, attemptId: string, workspace: string, capabilities: readonly ReplyCapability[]) {
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      void (async () => {
        const job = this.store.get(jobId);
        if (!job || job.latestAttemptId !== attemptId || job.cancelRequested || ['succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(job.state)) return;
        const partial = await readReplyFile(workspace, 'reply.partial.json', job.context.sourceText, capabilities);
        if (partial) this.store.saveProvisional(jobId, attemptId, provisionalForDisplay(partial));
      })().catch(() => { /* A transient or invalid partial never gains authority. */ }).finally(() => { reading = false; });
    }, 250);
    timer.unref();
    this.watchers.set(attemptId, timer);
  }
  private armTimeout(jobId: string, attemptId: string, deadline = Date.now() + this.timeoutMs) {
    const timer = setTimeout(() => void (async () => {
      const handle = this.store.markTimedOut(jobId, attemptId);
      this.recordOutcome(attemptId, 'timed_out');
      const runtime = this.runtimes.get(attemptId);
      if (handle && runtime) try { await runtime.runner.cancel(handle); } catch { /* Durable timeout preserves uncertainty. */ }
      this.clearActivity(attemptId);
    })(), Math.max(1, deadline - Date.now()));
    timer.unref();
    this.timers.set(attemptId, timer);
  }
  private clearActivity(attemptId: string) {
    const timer = this.timers.get(attemptId); if (timer) clearTimeout(timer); this.timers.delete(attemptId);
    const watcher = this.watchers.get(attemptId); if (watcher) clearInterval(watcher); this.watchers.delete(attemptId);
  }
  private failDispatch(jobId: string, attemptId: string, error: unknown) {
    this.clearActivity(attemptId);
    const job = this.store.get(jobId);
    const attempt = job?.attempts.find(value => value.id === attemptId);
    const handedOff = attempt?.handoffMarked ?? this.markedDispatch.has(attemptId);
    const confirmedNotSent = error instanceof ProviderNotSentError && error.provider === job?.provider &&
      error.attemptId === attemptId && attempt && attempt.revision === 0 && !attempt.dispatchClaimed && !attempt.providerHandle && !job?.cancelRequested &&
      !['succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(job!.state);
    this.store.setState(jobId, attemptId, handedOff && !confirmedNotSent ? 'outcome_unknown' : 'failed', safeReason(error));
    if (!handedOff) this.store.releaseUndispatchedContinuation(attemptId);
    this.recordOutcome(attemptId, handedOff && !confirmedNotSent ? 'outcome_unknown' : 'dispatch-failed');
  }
  private launch(operation: Promise<void>, jobId: string, attemptId: string) {
    const tracked = operation.catch(error => this.failDispatch(jobId, attemptId, error)).finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }
  private async releaseRuntime(attemptId: string) {
    const retention = this.retentionTimers.get(attemptId); if (retention) clearTimeout(retention); this.retentionTimers.delete(attemptId);
    const runtime = this.runtimes.get(attemptId);
    this.runtimes.delete(attemptId);
    this.workspaces.delete(attemptId);
    this.markedDispatch.delete(attemptId);
    if (runtime) await runtime.close();
  }
  private retainRuntime(attemptId: string) {
    if (!this.runtimes.has(attemptId)) return;
    const timer = setTimeout(() => void this.releaseRuntime(attemptId), 5 * 60 * 1000);
    timer.unref(); this.retentionTimers.set(attemptId, timer);
  }
  private recordOutcome(attemptId: string | undefined, outcome: string) {
    if (!attemptId || !this.factory) return;
    try { this.factory.consent.recordOutcome(attemptId, outcome); } catch { /* No authorization may have existed yet. */ }
  }
  private active(jobId: string, attemptId: string) {
    const job = this.store.get(jobId);
    return !!job && job.latestAttemptId === attemptId && !job.cancelRequested && !['succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(job.state);
  }
  private async replySchema() {
    return this.schema ??= await readFile(new URL('../../contracts/reply.schema.json', import.meta.url), 'utf8');
  }
  private async prepared(input: StartJobInput, context: FrozenJobContext) {
    const replySchemaText = await this.replySchema();
    const envelopeInput = { sourceUrl: context.sourceUrl,
      scope: input.intent === 'evidence' || input.intent === 'explore' ? 'open-session' : 'cloud-inference',
      recipient: 'openai-codex', provider: input.provider, model: input.model, mode: input.mode, policyKey: input.policyKey,
      context, outputSchema: input.mode === 'structured-final' ? JSON.parse(replySchemaText) as Record<string, unknown> : undefined,
      replySchemaText } as const;
    const packet = context.outgoing;
    const omission = 'Additional context was omitted to keep the complete duplicated prompt, packet, instructions, and schema within 64 KiB UTF-8.';
    let prepared = prepareEnvelope(envelopeInput);
    for (let pass = 0; totalOutgoingBytes(prepared.outgoing) > 64 * 1024; pass++) {
      if (pass > 16) throw new JobConflictError('The fixed outgoing instructions and schema exceed the preview limit.');
      if (!packet.omissions.includes(omission)) packet.omissions.push(omission);
      const overflow = totalOutgoingBytes(prepared.outgoing) - 64 * 1024;
      const budget = Math.max(16, Math.ceil(overflow / 2) + 16);
      if (packet.adjacentContext.after) packet.adjacentContext.after = trimUtf8Tail(packet.adjacentContext.after, budget);
      else if (packet.adjacentContext.before) packet.adjacentContext.before = trimUtf8Head(packet.adjacentContext.before, budget);
      else if (packet.parentReply?.excerpt) {
        const excerpt = packet.parentReply.excerpt, shortened = trimUtf8Tail(excerpt, budget);
        packet.parentReply.excerpt = shortened;
        packet.parentReply.omittedBytes += Buffer.byteLength(excerpt) - Buffer.byteLength(shortened);
      } else if (packet.answeredNote?.text) {
        packet.answeredNote.text = trimUtf8Tail(packet.answeredNote.text, budget);
        packet.answeredNote.omittedCharacters = packet.answeredNote.originalCharacters - packet.answeredNote.text.length;
      } else if (packet.selection.exact) {
        packet.selection.exact = trimUtf8Tail(packet.selection.exact, budget);
        packet.selection.end = packet.selection.start + packet.selection.exact.length;
        packet.selection.omittedCharacters = packet.selection.originalEnd - packet.selection.end;
      } else throw new JobConflictError('The required outgoing content exceeds the 64 KiB preview limit.');
      prepared = prepareEnvelope(envelopeInput);
    }
    return prepared;
  }
  private assertHostPlan(input: StartJobInput) {
    if (!this.defaults || input.provider !== this.defaults.provider || input.mode !== this.defaults.mode || input.policyKey !== this.policyFor(input.id, input.mode, input.model) ||
      packetDigest(input.capabilities ?? []) !== packetDigest(this.defaults.capabilities)) throw new JobConflictError('The requested execution plan is not the current host plan. Review it again.');
  }
  private policyFor(jobId: string, mode: StartJobInput['mode'], model: string, parent?: JobSnapshot): string {
    const defaults = this.defaults;
    if (!defaults) throw new JobUnavailableError();
    const parentAttempt = parent?.attempts.find(a => a.id === parent.latestAttemptId);
    const workspace = parent && this.canResume(parent, mode, model) ? parentAttempt!.providerHandle!.workspace : resolve(this.workspaceRoot, jobId);
    return defaults.policyFor?.(workspace, mode, model, defaults.provider) ?? defaults.policyKey ?? '';
  }
  private canResume(parent: JobSnapshot, mode: StartJobInput['mode'], model: string) {
    const attempt = parent.attempts.find(a => a.id === parent.latestAttemptId), handle = attempt?.providerHandle;
    return !!handle && handle.state === 'completed' && !handle.tombstone &&
      parent.provider === this.defaults?.provider && parent.mode === mode && parent.model === model &&
      (parent.provider === 'app-server' || (parent.provider === 'mcp-server' && this.runtimes.has(attempt!.id)));
  }
  private consentInput(input: StartJobInput, context: FrozenJobContext, prepared: { digest: string; outgoing: OutgoingPart[] }): PrepareConsentInput {
    return { requestId: input.id, bindingDigest: prepared.digest, sourceUrl: context.sourceUrl,
      scope: input.intent === 'evidence' || input.intent === 'explore' ? 'open-session' : 'cloud-inference',
      recipient: 'openai-codex', recipientLabel: 'OpenAI Codex', provider: input.provider, policyKey: input.policyKey, outgoing: prepared.outgoing };
  }
  private preparedResult(input: StartJobInput, context: FrozenJobContext, prepared: { digest: string; outgoing: OutgoingPart[] }): PreparedJobResult {
    const { grantId: _grantId, ...job } = input;
    return { consent: this.consentInput(input, context, prepared), job: { ...job, preparedPayloadDigest: prepared.digest } };
  }
  async close() {
    this.closing = true;
    for (const attemptId of new Set([...this.timers.keys(), ...this.watchers.keys()])) this.clearActivity(attemptId);
    for (const timer of this.retentionTimers.values()) clearTimeout(timer);
    this.retentionTimers.clear();
    await Promise.allSettled([...this.pending]);
    await Promise.allSettled([...new Set(this.runtimes.values())].map(runtime => runtime.close()));
    this.runtimes.clear();
    this.workspaces.clear();
  }
}

export class JobUnavailableError extends Error { override name = 'JobUnavailable'; constructor(reason?: string) { super(reason ?? 'Codex execution is not ready. Reading and saved work remain available.'); } }
function assertAdmission(admit?: () => boolean) {
  if (admit && !admit()) throw new JobConflictError('Pairing changed before work was admitted. Pair again.');
}
function totalOutgoingBytes(parts: readonly OutgoingPart[]) { return parts.reduce((sum, part) => sum + Buffer.byteLength(part.text), 0); }
function utf8Prefix(value: string | Buffer, limit: number) {
  let result = '', used = 0;
  for (const character of value.toString()) {
    const size = Buffer.byteLength(character);
    if (used + size > limit) break;
    result += character; used += size;
  }
  return result;
}
function trimUtf8Tail(value: string, removeBytes: number) {
  return utf8Prefix(value, Math.max(0, Buffer.byteLength(value) - removeBytes));
}
function trimUtf8Head(value: string, removeBytes: number) {
  const characters = [...value];
  let removed = 0, index = 0;
  while (index < characters.length && removed < removeBytes) removed += Buffer.byteLength(characters[index++]);
  return characters.slice(index).join('');
}

function providerPacket(input: StartJobInput, anchor: QuoteAnchor, source: SourceVersion, url: string, title: string, answeredNote?: FrozenJobContext['answeredNote']): ProviderJobPacket {
  const CONTEXT_LIMIT = 12_000;
  const selectionText = anchor.exact.slice(0, 4_000);
  const noteText = answeredNote?.text.slice(0, 4_000);
  const beforeAvailable = source.text.slice(0, anchor.start);
  const afterAvailable = source.text.slice(anchor.end);
  let before: string, after: string, basis: 'section-adjacent-context' | 'bounded-character-context' | 'whole-page-opening';
  if (anchor.kind === 'whole-page') {
    before = ''; after = source.text.slice(selectionText.length, selectionText.length + CONTEXT_LIMIT); basis = 'whole-page-opening';
  } else if (source.sections?.length) {
    const first = source.sections.findIndex(section => anchor.start < section.end && anchor.end > section.start);
    const last = source.sections.findLastIndex(section => anchor.start < section.end && anchor.end > section.start);
    if (first >= 0 && last >= first) {
      const rangeStart = source.sections[Math.max(0, first - 1)].start;
      const rangeEnd = source.sections[Math.min(source.sections.length - 1, last + 1)].end;
      const availableBefore = source.text.slice(rangeStart, anchor.start);
      const availableAfter = source.text.slice(anchor.end, rangeEnd);
      const beforeLimit = Math.min(availableBefore.length, Math.floor(CONTEXT_LIMIT / 2));
      before = availableBefore.slice(-beforeLimit);
      after = availableAfter.slice(0, CONTEXT_LIMIT - before.length);
      basis = 'section-adjacent-context';
    } else {
      const beforeLimit = Math.floor(CONTEXT_LIMIT / 2);
      before = beforeAvailable.slice(-beforeLimit); after = afterAvailable.slice(0, CONTEXT_LIMIT - before.length); basis = 'bounded-character-context';
    }
  } else {
    const beforeLimit = Math.floor(CONTEXT_LIMIT / 2);
    before = beforeAvailable.slice(-beforeLimit);
    after = afterAvailable.slice(0, CONTEXT_LIMIT - before.length);
    basis = 'bounded-character-context';
  }
  const omissions = [
    'The full captured page is retained locally for validation and is not included in this provider packet.',
    'No vocabulary or library matches were included because no scoped host-owned matches were supplied for this request.',
  ];
  if (basis === 'bounded-character-context') omissions.push('Section boundaries were not available for this passage, so adjacent context is a bounded character window.');
  if (beforeAvailable.length > before.length || afterAvailable.length > after.length) omissions.push('Adjacent source text outside the 12,000-character bound was omitted.');
  if (basis === 'whole-page-opening' && source.text.length > selectionText.length + after.length) omissions.push('The captured page beyond the bounded 16,000-character opening was omitted from provider context.');
  if (selectionText.length < anchor.exact.length) omissions.push(`The selected-passage field was deterministically bounded to its first 4,000 characters; ${anchor.exact.length - selectionText.length} trailing characters (${anchor.start + selectionText.length}-${anchor.end}) were omitted from that field.`);
  if (answeredNote && noteText!.length < answeredNote.text.length) omissions.push(`The answered note was deterministically bounded to its first 4,000 characters; ${answeredNote.text.length - noteText!.length} trailing characters were omitted from provider context.`);
  return {
    schema: 'marginalia.job-packet.v1' as const,
    intent: input.intent,
    question: input.question,
    source: { url, title, pageType: source.pageType,
      capturedAt: source.capturedAt, sourceHash: source.hash, sourceVersionId: source.id },
    selection: { exact: selectionText, prefix: anchor.prefix, suffix: anchor.suffix, start: anchor.start,
      end: anchor.start + selectionText.length, originalEnd: anchor.end, omittedCharacters: anchor.exact.length - selectionText.length },
    adjacentContext: { before, after, basis },
    ...(answeredNote ? { answeredNote: { noteId: answeredNote.noteId, revision: answeredNote.revision, text: noteText!,
      originalCharacters: answeredNote.text.length, omittedCharacters: answeredNote.text.length - noteText!.length } } : {}),
    ...(input.parentReplyId ? { parentReplyId: input.parentReplyId } : {}),
    availableCapabilities: input.capabilities ?? [],
    omissions,
  };
}

function validateStart(value: StartJobInput): StartJobInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid work request.');
  for (const [name, item] of [['id', value.id], ['idempotencyKey', value.idempotencyKey], ['threadId', value.threadId], ['policyKey', value.policyKey], ['grantId', value.grantId]] as const) requireId(item, name);
  if (!/^[a-f0-9]{64}$/.test(value.preparedPayloadDigest)) throw new Error('Invalid prepared outgoing digest.');
  if (!['define', 'simulate', 'instantiate', 'derive', 'diagram', 'evidence', 'explore', 'unsure'].includes(value.intent)) throw new Error('Invalid help type.');
  if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 4000) throw new Error('Invalid question.');
  if (!['app-server', 'mcp-server'].includes(value.provider) || !['structured-final', 'workspace-files'].includes(value.mode)) throw new Error('Invalid execution mode.');
  if (typeof value.model !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(value.model)) throw new Error('Invalid model.');
  if (value.parentReplyId !== undefined) requireId(value.parentReplyId, 'parent reply');
  if (value.answeredNote && (!ID.test(value.answeredNote.noteId) || !Number.isSafeInteger(value.answeredNote.revision) || value.answeredNote.revision < 1)) throw new Error('Invalid note version.');
  const capabilities = value.capabilities ?? [];
  const allowed = new Set<ReplyCapability>(['samples', 'solver', 'media.audio', 'media.image', 'media.video', 'network.citations', 'network.shelf']);
  if (!Array.isArray(capabilities) || capabilities.length > allowed.size || capabilities.some(c => !allowed.has(c))) throw new Error('Invalid reply capabilities.');
  return structuredClone({ ...value, question: value.question.trim(), capabilities: [...new Set(capabilities)] });
}
function validatePrepare(value: PrepareJobInput): PrepareJobInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid work request.');
  for (const [name, item] of [['id', value.id], ['idempotencyKey', value.idempotencyKey], ['threadId', value.threadId]] as const) requireId(item, name);
  if (!['define', 'simulate', 'instantiate', 'derive', 'diagram', 'evidence', 'explore', 'unsure'].includes(value.intent)) throw new Error('Invalid help type.');
  if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 4000) throw new Error('Invalid question.');
  if (value.parentReplyId !== undefined) requireId(value.parentReplyId, 'parent reply');
  if (value.answeredNote && (!ID.test(value.answeredNote.noteId) || !Number.isSafeInteger(value.answeredNote.revision) || value.answeredNote.revision < 1)) throw new Error('Invalid note version.');
  return structuredClone({ ...value, question: value.question.trim() });
}
function validateFollowup(value: FollowupJobInput) {
  if (!value || typeof value !== 'object') throw new Error('Invalid follow-up.');
  requireId(value.id, 'job'); requireId(value.idempotencyKey, 'request'); requireId(value.grantId, 'grant');
  if (!/^[a-f0-9]{64}$/.test(value.preparedPayloadDigest)) throw new Error('Invalid prepared outgoing digest.');
  if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 4000) throw new Error('Invalid follow-up.');
  value.question = value.question.trim();
}
function validateRetry(value: RetryJobInput) {
  if (!value || typeof value !== 'object') throw new Error('Invalid retry.');
  requireId(value.id, 'job'); requireId(value.idempotencyKey, 'request'); requireId(value.grantId, 'grant');
  if (!/^[a-f0-9]{64}$/.test(value.preparedPayloadDigest)) throw new Error('Invalid prepared outgoing digest.');
}
function requireId(value: unknown, name: string): asserts value is string { if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Invalid ${name} identifier.`); }
function safeReason(error: unknown) { const message = error instanceof Error ? error.message : 'execution-failed'; return message.slice(0, 500); }
function preparationIdentity(input: StartJobInput) {
  const { grantId: _grantId, preparedPayloadDigest: _preparedPayloadDigest, ...plan } = input;
  return packetDigest(plan);
}
