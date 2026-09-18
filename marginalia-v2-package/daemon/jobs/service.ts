import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ProviderNotSentError, type ProviderHandle, type ProviderRequest } from '../../contracts/job-runner.ts';
import { capabilitiesForIntent, canonicalReplyData, parseAndValidateReply, type CandidateReply, type ReplyCapability } from '../../contracts/reply.ts';
import { isDigest } from '../../contracts/digest.ts';
import type { FollowupJobInput, FrozenJobContext, JobSnapshot, PreparedJobResult, PrepareFollowupJobInput, PrepareJobInput, PrepareRetryJobInput, RetryJobInput, StartJobInput } from '../../contracts/jobs.ts';
import type { OutgoingPart, PrepareConsentInput } from '../../contracts/consent.ts';
import type { ReaderStore } from '../store.ts';
import type { AuthorizedRuntimeFactory, RunningProvider } from './runtime.ts';
import { ClarificationLimitError, JobConflictError, JobStore, packetDigest } from './store.ts';
import { prepareContinuationWorkspace, prepareWorkspace, provisionalForDisplay, readReplyFile, restoreCompletedWorkspace, verifyContinuationWorkspace } from './workspace.ts';
import { buildProviderPrompt, prepareEnvelope } from './envelope.ts';
import type { LibrarySettingsService } from '../library.ts';
import { prepareSendCheckpoint } from './send-checkpoint.ts';
import { fitOutgoingPacket, utf8Prefix } from './outgoing-budget.ts';
import { frozenFollowup } from './followup-context.ts';
import { buildProviderPacket } from './packet.ts';
import { loadHostInstructions } from './host-instructions.ts';
import { commitSucceededReplyWithSolverBindings } from './solver-bindings.ts';

const ID = /^[\w-]{1,100}$/;
const CAPABILITIES = new Set<ReplyCapability>(['samples', 'solver', 'media.audio', 'media.image', 'media.video', 'network.citations', 'network.shelf']);
const PROVIDER_TERMINAL = new Set(['completed', 'failed', 'cancelled', 'outcome_unknown']);

export type JobServiceOptions = {
  reader: ReaderStore;
  workspaceRoot: string;
  runtimeFactory?: AuthorizedRuntimeFactory;
  timeoutMs?: number;
  library: Pick<LibrarySettingsService, 'modelFor' | 'continuationIdentity'>;
  defaults?: { provider: StartJobInput['provider']; mode: StartJobInput['mode']; policyKey?: string;
    modeFor?: (intent: StartJobInput['intent']) => StartJobInput['mode'];
    policyFor?: (workspace: string, mode: StartJobInput['mode'], model: string, provider: StartJobInput['provider']) => string;
    capabilities: ReplyCapability[] };
};

export class JobService {
  readonly store: JobStore;
  readonly configured: boolean;
  get available(): boolean { return this.configured && this.factory?.dispatchReady === true && !this.closing; }
  get unavailableReason(): string | undefined {
    return !this.defaults || !this.configured && !!this.factory ? 'No host-owned execution policy is configured.'
      : this.factory?.unavailableReason ?? (!this.factory ? 'No authorized provider runtime is configured.'
        : !this.available ? 'Dedicated sign-in and runtime policy evidence are not ready.' : undefined);
  }
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
  private sends = new Map<string, { checkpoint: ReturnType<typeof prepareSendCheckpoint>; sentContent: OutgoingPart[] }>();
  private pending = new Set<Promise<void>>();
  private recovery?: Promise<void>;
  private closing = false;
  private library: JobServiceOptions['library'];
  private defaults?: JobServiceOptions['defaults'];
  constructor(options: JobServiceOptions) {
    this.reader = options.reader;
    this.store = new JobStore(options.reader);
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.factory = options.runtimeFactory;
    this.library = options.library;
    const defaults = options.defaults;
    this.defaults = defaults && ['app-server', 'mcp-server'].includes(defaults.provider) &&
      ['structured-final', 'workspace-files'].includes(defaults.mode) && Array.isArray(defaults.capabilities) &&
      defaults.capabilities.length <= CAPABILITIES.size && defaults.capabilities.every(value => CAPABILITIES.has(value)) &&
      (defaults.modeFor === undefined || typeof defaults.modeFor === 'function') &&
      (defaults.policyFor === undefined || typeof defaults.policyFor === 'function')
      ? { ...defaults, capabilities: [...new Set(defaults.capabilities)] } : undefined;
    this.configured = !!options.runtimeFactory && !!this.defaults &&
      (typeof this.defaults.policyFor === 'function' || !!this.defaults.policyKey && isDigest(this.defaults.policyKey));
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 60 * 60 * 1000) throw new Error('Invalid job timeout.');
  }
  recover(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (this.recovery) return this.recovery;
    const task = this.recoverRecorded().finally(() => {
      this.pending.delete(task);
      if (this.recovery === task) this.recovery = undefined;
    });
    this.recovery = task; this.pending.add(task);
    return task;
  }
  private async recoverRecorded() {
    for (const job of this.store.list()) {
      if (this.closing) return;
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
        const workspace = await restoreCompletedWorkspace(this.workspaceRoot, attempt.providerHandle.workspace, job.context.outgoing);
        if (this.closing) return;
        const runtime = await this.factory.create(job, attempt.id, workspace, this.hostHooks());
        this.runtimes.set(attempt.id, runtime);
        if (this.closing) { await this.releaseRuntime(attempt.id); return; }
        this.workspaces.set(attempt.id, workspace);
        this.armTimeout(job.id, attempt.id, deadline);
        if (job.mode === 'workspace-files') this.watchWorkspace(job.id, attempt.id, workspace, this.store.capabilities(job.id));
        const observed = job.cancelRequested ? await runtime.runner.cancel(attempt.providerHandle) : await runtime.runner.inspect(attempt.providerHandle);
        if (PROVIDER_TERMINAL.has(observed.state)) await this.settleFromDurable(job.id, attempt.id);
      } catch (error) {
        this.store.setState(job.id, attempt.id, 'outcome_unknown', `recovery-unavailable:${safeReason(error)}`);
        this.clearActivity(attempt.id); await this.releaseRuntime(attempt.id);
      }
    }
  }
  get(id: string) { return this.store.get(id); }
  list(threadId?: string) { if (threadId !== undefined) requireId(threadId, 'thread'); return this.store.list(threadId); }
  async prepare(raw: PrepareJobInput, admit?: () => boolean): Promise<PreparedJobResult> {
    if (this.closing || !this.configured || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    const draft = validatePrepare(raw);
    const tier = draft.intent === 'define' ? 'fast' : 'deep';
    const selection = this.library.modelFor(tier);
    const mode = this.modeFor(draft.intent);
    const input: StartJobInput = { ...draft, provider: this.defaults.provider, mode: mode,
      capabilities: this.grantedCapabilities(draft.intent), model: selection.model,
      policyKey: this.policyFor(draft.id, mode, selection.model), grantId: 'pending', preparedPayloadDigest: '0'.repeat(64) };
    const context = this.freezeContext(input, selection);
    const prepared = await this.prepared(input, context);
    assertAdmission(admit);
    this.store.savePreparation(input.id, preparationIdentity(input), prepared.digest);
    return this.preparedResult(input, context, prepared);
  }
  async prepareRetry(jobId: string, raw: PrepareRetryJobInput, admit?: () => boolean): Promise<PreparedJobResult> {
    if (this.closing || !this.configured || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    requireId(jobId, 'job'); requireId(raw?.id, 'job'); requireId(raw?.idempotencyKey, 'request');
    const previous = this.store.get(jobId);
    if (!previous || !['failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(previous.state)) throw new JobConflictError('Only finished unsuccessful work can be tried again.');
    const selection = this.library.modelFor(previous.context.intent === 'define' ? 'fast' : 'deep');
    const mode = this.modeFor(previous.context.intent);
    const input: StartJobInput = { id: raw.id, idempotencyKey: raw.idempotencyKey, threadId: previous.threadId, intent: previous.context.intent,
      question: previous.context.question, provider: this.defaults.provider, mode: mode,
      capabilities: this.store.capabilities(previous.id), model: selection.model,
      policyKey: this.policyFor(raw.id, mode, selection.model), grantId: 'pending', preparedPayloadDigest: '0'.repeat(64), parentReplyId: previous.context.parentReplyId };
    const context = this.retryContext(previous, input, selection);
    const prepared = await this.prepared(input, context);
    assertAdmission(admit);
    this.store.savePreparation(input.id, preparationIdentity(input), prepared.digest);
    return this.preparedResult(input, context, prepared);
  }
  async prepareFollowup(parentJobId: string, raw: PrepareFollowupJobInput, admit?: () => boolean): Promise<PreparedJobResult> {
    if (this.closing || !this.configured || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    requireId(parentJobId, 'job');
    validateFollowup({ ...raw, grantId: 'pending', preparedPayloadDigest: '0'.repeat(64) });
    const parent = this.store.get(parentJobId);
    if (!parent || parent.state !== 'succeeded' || !parent.replyVersionId || !parent.latestAttemptId) throw new JobConflictError('A follow-up requires a confirmed completed reply.');
    const selection = this.library.modelFor(parent.context.intent === 'define' ? 'fast' : 'deep');
    const mode = this.modeFor(parent.context.intent);
    const input: StartJobInput = { id: raw.id, idempotencyKey: raw.idempotencyKey, threadId: parent.threadId, intent: parent.context.intent,
      question: raw.question.trim(), provider: this.defaults.provider, mode: mode,
      capabilities: this.store.capabilities(parent.id), model: selection.model,
      policyKey: this.policyFor(raw.id, mode, selection.model, parent), grantId: 'pending', preparedPayloadDigest: '0'.repeat(64), parentReplyId: parent.replyVersionId };
    const context = this.followupContext(parent, input, selection);
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
    const prepared = await this.prepared(input, context);
    if (prepared.digest !== input.preparedPayloadDigest) throw new JobConflictError('The reviewed outgoing content changed. Review it again.');
    assertAdmission(admit);
    const digest = packetDigest({ input, context });
    const created = this.store.createAndAttempt(input, context, digest, requestDigest, preparationIdentity(input));
    if (created.attempt) this.launch(this.dispatch(created.job.id, created.attempt.id, prepared.outgoing, undefined, admit), created.job.id, created.attempt.id);
    return this.store.get(created.job.id)!;
  }
  async retry(jobId: string, raw: RetryJobInput, admit?: () => boolean): Promise<JobSnapshot> {
    if (!this.available || !this.factory || !this.defaults) throw new JobUnavailableError(this.unavailableReason);
    requireId(jobId, 'job');
    validateRetry(raw);
    const previous = this.store.get(jobId);
    if (!previous || !['failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(previous.state)) throw new JobConflictError('Only finished unsuccessful work can be tried again.');
    const selection = this.library.modelFor(previous.context.intent === 'define' ? 'fast' : 'deep');
    const mode = this.modeFor(previous.context.intent);
    const input: StartJobInput = { id: raw.id, idempotencyKey: raw.idempotencyKey, threadId: previous.threadId, intent: previous.context.intent,
      question: previous.context.question, provider: this.defaults.provider, model: selection.model, mode: mode, policyKey: this.policyFor(raw.id, mode, selection.model),
      grantId: raw.grantId, preparedPayloadDigest: raw.preparedPayloadDigest, parentReplyId: previous.context.parentReplyId,
      capabilities: this.store.capabilities(previous.id) };
    const context = this.retryContext(previous, input, selection);
    const prepared = await this.prepared(input, context);
    if (prepared.digest !== input.preparedPayloadDigest) throw new JobConflictError('The reviewed outgoing content changed. Review it again.');
    assertAdmission(admit);
    const requestDigest = packetDigest(input);
    const prior = this.store.findByIdempotencyKey(input.idempotencyKey);
    if (prior) {
      if (prior.id !== input.id || prior.requestDigest !== requestDigest) throw new JobConflictError('This request key already identifies different work.');
      return prior;
    }
    const created = this.store.createAndAttempt(input, context, packetDigest({ input, context }), requestDigest, preparationIdentity(input));
    if (created.attempt) this.launch(this.dispatch(created.job.id, created.attempt.id, prepared.outgoing, undefined, admit), created.job.id, created.attempt.id);
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
    const mode = this.modeFor(parent.context.intent);
    const input: StartJobInput = { id: raw.id, idempotencyKey: raw.idempotencyKey, threadId: parent.threadId, intent: parent.context.intent,
      question: raw.question, provider: this.defaults.provider, model: selection.model,
      mode: mode, policyKey: this.policyFor(raw.id, mode, selection.model, parent),
      grantId: raw.grantId, preparedPayloadDigest: raw.preparedPayloadDigest, parentReplyId: parent.replyVersionId, capabilities: this.store.capabilities(parent.id) };
    const requestDigest = packetDigest(input);
    const prior = this.store.findByIdempotencyKey(input.idempotencyKey);
    if (prior) {
      if (prior.id !== input.id || prior.requestDigest !== requestDigest) throw new JobConflictError('This request key already identifies different work.');
      return prior;
    }
    const context = this.followupContext(parent, input, selection);
    const prepared = await this.prepared(input, context);
    if (prepared.digest !== input.preparedPayloadDigest) throw new JobConflictError('The reviewed outgoing content changed. Review it again.');
    assertAdmission(admit);
    const digest = packetDigest({ input, context });
    const created = this.store.createAndAttempt(input, context, digest, requestDigest, preparationIdentity(input));
    if (created.attempt) this.launch(this.dispatch(created.job.id, created.attempt.id, prepared.outgoing, parentAttempt.providerHandle, admit), created.job.id, created.attempt.id);
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
        await this.releaseRuntime(job.latestAttemptId);
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
    const outgoing = buildProviderPacket(input, thread.anchor, source, thread.sourceUrl, thread.sourceTitle, answeredNote);
    if (input.parentReplyId) {
      const parent = this.reader.reply(input.parentReplyId);
      if (!parent || parent.deletedAt) throw new Error('The parent reply is unavailable.');
      const sourceBytes = Buffer.from(canonicalReplyData(parent.reply), 'utf8');
      const excerpt = utf8Prefix(sourceBytes.toString('utf8'), 4_000);
      outgoing.parentReply = { replyVersionId: parent.id, attribution: 'Prior generated work, not source evidence.',
        excerpt, omittedBytes: sourceBytes.length - Buffer.byteLength(excerpt), sha256: packetDigest(parent.reply) };
      if (outgoing.parentReply.omittedBytes) outgoing.omissions.push('The accepted parent reply was truncated to a 4,000-byte host-owned excerpt.');
    }
    return { threadId: thread.id, sourceVersionId: thread.sourceVersionId, sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle,
      sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt, sourceHash: source.hash,
      sourceText: source.text, passage: structuredClone(thread.anchor), answeredNote, question: input.question, intent: input.intent,
      parentReplyId: input.parentReplyId, preparedPayloadDigest: input.preparedPayloadDigest,
      modelSettingsRevision: selection.settingsRevision, modelCompatibilityKey: selection.compatibilityKey, outgoing };
  }
  private followupContext(parent: JobSnapshot, input: StartJobInput, selection: ReturnType<LibrarySettingsService['modelFor']>): FrozenJobContext {
    const thread = this.reader.get(parent.threadId), accepted = parent.replyVersionId && this.reader.reply(parent.replyVersionId);
    if (!thread || thread.deletedAt || !accepted || accepted.deletedAt || accepted.threadId !== parent.threadId) throw new JobConflictError('The accepted parent reply is unavailable.');
    return frozenFollowup(parent, input, selection, accepted.id, canonicalReplyData(accepted.reply), this.canResume(parent, input.mode, input.model));
  }
  private retryContext(previous: JobSnapshot, input: StartJobInput, selection: ReturnType<LibrarySettingsService['modelFor']>): FrozenJobContext {
    const context: FrozenJobContext = { ...structuredClone(previous.context), retryOfJobId: previous.id, parentJobId: undefined,
      parentAttemptId: undefined, preparedPayloadDigest: input.preparedPayloadDigest,
      modelSettingsRevision: selection.settingsRevision, modelCompatibilityKey: selection.compatibilityKey };
    context.outgoing = { ...context.outgoing, question: context.question, availableCapabilities: [...input.capabilities!] };
    return context;
  }
  private async dispatch(jobId: string, attemptId: string, sentContent: OutgoingPart[], predecessor?: ProviderHandle, admit?: () => boolean) {
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
    if (!decision.eligibilityFingerprint || !isDigest(decision.eligibilityFingerprint)) throw new Error('Current consent eligibility token is unavailable.');
    if (!this.active(jobId, attemptId)) { this.store.releaseUndispatchedContinuation(attemptId); await this.releaseRuntime(attemptId); return; }
    const compatible = this.store.bindAuthorization(attemptId, this.library.continuationIdentity({ model: job.model,
      settingsRevision: job.context.modelSettingsRevision, compatibilityKey: job.context.modelCompatibilityKey }, decision.auditScope));
    if (!job.context.parentAttemptId || !compatible || (predecessor && (predecessor.policyKey !== job.policyKey || predecessor.model !== job.model || predecessor.mode !== job.mode))) predecessor = undefined;
    // MCP continuation is owned by the live loaded process. After restart/retention it must fork.
    let retained = job.context.parentAttemptId ? this.runtimes.get(job.context.parentAttemptId) : undefined;
    if (predecessor?.provider === 'mcp-server' && !retained?.canResume?.(predecessor)) predecessor = undefined;
    if (!predecessor) this.store.forkUndispatchedContinuation(attemptId);
    const plannedWorkspace = predecessor?.workspace ?? resolve(this.workspaceRoot, job.id);
    if (this.defaults?.policyFor && this.defaults.policyFor(plannedWorkspace, job.mode, job.model, job.provider) !== job.policyKey) {
      throw new JobConflictError('Continuation workspace or permission changed after review. Prepare this follow-up again.');
    }
    if (predecessor && retained && job.context.parentAttemptId) {
      const timer = this.retentionTimers.get(job.context.parentAttemptId); if (timer) clearTimeout(timer);
      this.retentionTimers.delete(job.context.parentAttemptId); this.runtimes.delete(job.context.parentAttemptId);
      this.runtimes.set(attemptId, retained);
    } else retained = undefined;
    const schema = await this.replySchema();
    if (predecessor) {
      const parent = job.context.parentJobId && this.store.get(job.context.parentJobId);
      if (!parent) throw new JobConflictError('The continuation predecessor is unavailable.');
      await restoreCompletedWorkspace(this.workspaceRoot, predecessor.workspace, parent.context.outgoing);
      await verifyContinuationWorkspace(predecessor.workspace, schema);
      if (predecessor.provider === 'mcp-server' && !retained?.canResume?.(predecessor)) throw new Error('mcp-session-lost-before-handoff');
    }
    if (!this.active(jobId, attemptId)) { this.store.releaseUndispatchedContinuation(attemptId); await this.releaseRuntime(attemptId); return; }
    this.store.markWorkspacePrepared(jobId, attemptId);
    // Capture the prepared state before the filesystem and provider startup awaits.
    const expectedHandoff = this.store.get(jobId)!;
    const workspace = predecessor
      ? await prepareContinuationWorkspace(predecessor.workspace, predecessor.jobId, job.context.outgoing, schema)
      : await prepareWorkspace(this.workspaceRoot, job.id, job.context.outgoing, schema);
    this.workspaces.set(attemptId, workspace);
    if (!this.active(jobId, attemptId)) { await this.releaseRuntime(attemptId); return; }
    const capabilities = this.store.capabilities(job.id);
    const host = this.hostHooks();
    const runtime = retained ?? await factory.create(job, attemptId, workspace, host);
    if (this.closing) { await runtime.close(); throw new Error('service-closing'); }
    this.runtimes.set(attemptId, runtime);
    if (!this.active(jobId, attemptId)) { await this.releaseRuntime(attemptId); return; }
    if (job.mode === 'workspace-files') this.watchWorkspace(jobId, attemptId, workspace, capabilities);
    job = this.store.get(jobId)!;
    if (job.cancelRequested) { await this.releaseRuntime(attemptId); return; }
    if (predecessor?.provider === 'mcp-server' && !runtime.canResume?.(predecessor)) throw new Error('mcp-session-lost-before-handoff');
    const request = this.providerRequest(expectedHandoff, attemptId, workspace, JSON.parse(schema));
    this.sends.set(attemptId, { checkpoint: prepareSendCheckpoint(this.store, expectedHandoff, request, factory.consent,
      decision.eligibilityFingerprint!, () => !this.closing && (!admit || admit() === true)), sentContent: structuredClone(sentContent) });
    try {
      const observed = await (predecessor ? runtime.runner.resume(predecessor, request) : runtime.runner.start(request));
      if (PROVIDER_TERMINAL.has(observed.state)) await this.settleFromDurable(jobId, attemptId);
    } finally { this.sends.delete(attemptId); }
  }
  private hostHooks() {
    return {
      jobForAttempt: (attemptId: string) => this.store.jobForAttempt(attemptId),
      finalizeSend: (request: ProviderRequest, handle: ProviderHandle) => {
        const prepared = this.sends.get(request.jobId);
        if (!prepared) throw new JobConflictError('No current prepared provider send exists.');
        const canonical = this.store.db.transaction(() => {
          const finalized = prepared.checkpoint.finalize(request, handle);
          this.store.recordSentContent(request.jobId, prepared.sentContent);
          return finalized;
        })();
        this.markedDispatch.add(request.jobId);
        return canonical;
      },
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
      if (!this.currentSettlement(jobId, attemptId, expectedRevision)) return;
      if (!reply) { this.store.setState(jobId, attemptId, 'failed', 'invalid-or-missing-final-reply'); this.recordOutcome(attemptId, 'invalid-output'); return; }
      job = this.store.get(jobId)!;
      const decision = await this.factory!.consent.revalidate(job, 'commit');
      if (!this.currentSettlement(jobId, attemptId, expectedRevision)) return;
      if (decision.grantId !== job.grantId || decision.policyKey !== job.policyKey) { this.store.setState(jobId, attemptId, 'cancelled', 'consent-revoked-before-commit'); this.recordOutcome(attemptId, 'consent-revoked'); return; }
      const latest = this.store.get(jobId)?.attempts.find(a => a.id === attemptId);
      if (!latest || latest.revision !== expectedRevision || latest.providerHandle?.state !== 'completed') return;
      const accepted = reply;
      await commitSucceededReplyWithSolverBindings({ store: this.store, authority: this.factory!.consent, job, attemptId,
        expectedRevision, reply: accepted, workspace: this.workspaces.get(attemptId) ?? latest.providerHandle.workspace });
    } catch (error) {
      if (this.currentSettlement(jobId, attemptId, expectedRevision)) this.store.setState(jobId, attemptId, 'failed', safeReason(error));
    } finally {
      this.settling.delete(attemptId);
      let final = this.store.get(jobId);
      const latest = final?.attempts.find(a => a.id === attemptId);
      if (final?.cancelRequested && final.state === 'cancel_requested' && latest?.providerHandle?.state === 'completed') {
        this.store.setState(jobId, attemptId, 'cancelled', 'late-output-fenced'); this.recordOutcome(attemptId, 'cancelled'); final = this.store.get(jobId);
      }
      if (latest && latest.revision !== expectedRevision && this.currentSettlement(jobId, attemptId, latest.revision)) {
        this.launch(this.settle(jobId, attemptId, latest.revision), jobId, attemptId);
      } else if (final && ['succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(final.state)) {
        this.clearActivity(attemptId);
        if (final.state === 'succeeded') this.retainRuntime(attemptId);
        else if (['failed', 'cancelled', 'outcome_unknown'].includes(final.state)) await this.releaseRuntime(attemptId);
      }
    }
  }
  private currentSettlement(jobId: string, attemptId: string, revision: number): boolean {
    const job = this.store.get(jobId), attempt = job?.attempts.find(a => a.id === attemptId);
    return !!job && !job.cancelRequested && job.latestAttemptId === attemptId && job.state === 'validating' &&
      attempt?.state === 'validating' && attempt.revision === revision && attempt.providerHandle?.state === 'completed';
  }
  private watchWorkspace(jobId: string, attemptId: string, workspace: string, capabilities: readonly ReplyCapability[]) {
    let reading = false;
    const timer = setInterval(() => {
      if (reading || this.closing) return;
      reading = true;
      const observed = (async () => {
        const job = this.store.get(jobId);
        if (!job || job.latestAttemptId !== attemptId || job.cancelRequested || ['succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(job.state)) return;
        const partial = await readReplyFile(workspace, 'reply.partial.json', job.context.sourceText, capabilities);
        if (partial && !this.closing) this.store.saveProvisional(jobId, attemptId, provisionalForDisplay(partial));
      })().catch(async error => {
        if (error instanceof ClarificationLimitError) {
          this.store.setState(jobId, attemptId, 'failed', error.message);
          this.recordOutcome(attemptId, 'invalid-output');
          this.clearActivity(attemptId);
          await this.releaseRuntime(attemptId);
        }
        // A transient or invalid partial never gains authority.
      })
        .finally(() => { reading = false; this.pending.delete(observed); });
      this.pending.add(observed);
    }, 250);
    timer.unref();
    this.watchers.set(attemptId, timer);
  }
  private armTimeout(jobId: string, attemptId: string, deadline = Date.now() + this.timeoutMs) {
    const timer = setTimeout(() => this.launch((async () => {
      const handle = this.store.markTimedOut(jobId, attemptId);
      const current = this.store.get(jobId);
      if (current?.state !== 'timed_out' || current.latestAttemptId !== attemptId) return;
      this.recordOutcome(attemptId, 'timed_out');
      const runtime = this.runtimes.get(attemptId);
      if (handle && runtime) try { await runtime.runner.cancel(handle); } catch { /* Timeout remains durable; stopping is unconfirmed. */ }
      this.clearActivity(attemptId);
      await this.releaseRuntime(attemptId);
    })(), jobId, attemptId), Math.max(1, deadline - Date.now()));
    timer.unref(); this.timers.set(attemptId, timer);
  }
  private clearActivity(attemptId: string) {
    const timer = this.timers.get(attemptId); if (timer) clearTimeout(timer); this.timers.delete(attemptId);
    const watcher = this.watchers.get(attemptId); if (watcher) clearInterval(watcher); this.watchers.delete(attemptId);
  }
  private async failDispatch(jobId: string, attemptId: string, error: unknown) {
    this.clearActivity(attemptId);
    const job = this.store.get(jobId);
    if (job?.state === 'succeeded') return; // Cleanup failure cannot relabel committed success.
    const attempt = job?.attempts.find(value => value.id === attemptId);
    const handedOff = attempt?.handoffMarked ?? this.markedDispatch.has(attemptId);
    const confirmedNotSent = error instanceof ProviderNotSentError && error.provider === job?.provider &&
      error.attemptId === attemptId && attempt && attempt.revision === 0 && !attempt.dispatchClaimed && !attempt.providerHandle && !job?.cancelRequested &&
      !['succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown'].includes(job!.state);
    this.store.setState(jobId, attemptId, handedOff && !confirmedNotSent ? 'outcome_unknown' : 'failed', safeReason(error));
    if (!handedOff) this.store.releaseUndispatchedContinuation(attemptId);
    const state = this.store.get(jobId)?.state;
    this.recordOutcome(attemptId, state === 'timed_out' || state === 'cancelled' ? state : handedOff && !confirmedNotSent ? 'outcome_unknown' : 'dispatch-failed');
    if (!handedOff || ['cancelled', 'failed', 'outcome_unknown'].includes(state ?? '')) await this.releaseRuntime(attemptId);
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
    if (runtime) try { await runtime.close(); } catch { /* Disposal is best effort, never proof of a stopped provider. */ }
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
    context.hostInstructions = await loadHostInstructions(input.intent);
    const envelopeInput = { sourceUrl: context.sourceUrl,
      scope: input.intent === 'evidence' || input.intent === 'explore' ? 'open-session' : 'cloud-inference',
      recipient: 'openai-codex', provider: input.provider, model: input.model, mode: input.mode, policyKey: input.policyKey,
      context, outputSchema: input.mode === 'structured-final' ? JSON.parse(replySchemaText) as Record<string, unknown> : undefined,
      replySchemaText } as const;
    const fitted = fitOutgoingPacket(context.outgoing, packet => prepareEnvelope({ ...envelopeInput, context: { ...context, outgoing: packet } }));
    context.outgoing = fitted.packet;
    return fitted.prepared;
  }
  private modeFor(intent: StartJobInput['intent']): StartJobInput['mode'] {
    const mode = this.defaults?.modeFor?.(intent) ?? this.defaults!.mode;
    if (!['structured-final', 'workspace-files'].includes(mode)) throw new JobConflictError('The host execution mode is unavailable.');
    return mode;
  }
  private grantedCapabilities(intent: StartJobInput['intent']): ReplyCapability[] {
    return capabilitiesForIntent(intent).filter(capability => this.defaults!.capabilities.includes(capability));
  }
  private assertHostPlan(input: StartJobInput) {
    if (!this.defaults || input.provider !== this.defaults.provider || input.mode !== this.modeFor(input.intent) || input.policyKey !== this.policyFor(input.id, input.mode, input.model) ||
      packetDigest(input.capabilities ?? []) !== packetDigest(this.grantedCapabilities(input.intent))) throw new JobConflictError('The requested execution plan is not the current host plan. Review it again.');
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
      (parent.provider === 'app-server' || (parent.provider === 'mcp-server' && this.runtimes.get(attempt!.id)?.canResume?.(handle) === true));
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
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    await Promise.allSettled([...new Set(this.runtimes.values())].map(async runtime => { await runtime.close(); }));
    this.runtimes.clear();
    this.workspaces.clear();
    this.sends.clear();
  }
}

export class JobUnavailableError extends Error { override name = 'JobUnavailable'; constructor(reason?: string) { super(reason ?? 'Codex execution is not ready. Reading and saved work remain available.'); } }
export class JobAdmissionError extends JobConflictError { override name = 'JobAdmission'; constructor() { super('Pairing changed before work was admitted. Pair again.'); } }
function assertAdmission(admit?: () => boolean) {
  if (admit && admit() !== true) throw new JobAdmissionError();
}

function validateStart(value: StartJobInput): StartJobInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid work request.');
  for (const [name, item] of [['id', value.id], ['idempotencyKey', value.idempotencyKey], ['threadId', value.threadId], ['policyKey', value.policyKey], ['grantId', value.grantId]] as const) requireId(item, name);
  if (!isDigest(value.preparedPayloadDigest)) throw new Error('Invalid prepared outgoing digest.');
  if (!['define', 'simulate', 'instantiate', 'derive', 'diagram', 'evidence', 'explore', 'unsure'].includes(value.intent)) throw new Error('Invalid help type.');
  if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 4000) throw new Error('Invalid question.');
  if (!['app-server', 'mcp-server'].includes(value.provider) || !['structured-final', 'workspace-files'].includes(value.mode)) throw new Error('Invalid execution mode.');
  if (typeof value.model !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(value.model)) throw new Error('Invalid model.');
  if (value.parentReplyId !== undefined) requireId(value.parentReplyId, 'parent reply');
  if (value.answeredNote && (!ID.test(value.answeredNote.noteId) || !Number.isSafeInteger(value.answeredNote.revision) || value.answeredNote.revision < 1)) throw new Error('Invalid note version.');
  const capabilities = value.capabilities ?? [];
  const allowed = CAPABILITIES;
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
  if (!isDigest(value.preparedPayloadDigest)) throw new Error('Invalid prepared outgoing digest.');
  if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 4000) throw new Error('Invalid follow-up.');
  value.question = value.question.trim();
}
function validateRetry(value: RetryJobInput) {
  if (!value || typeof value !== 'object') throw new Error('Invalid retry.');
  requireId(value.id, 'job'); requireId(value.idempotencyKey, 'request'); requireId(value.grantId, 'grant');
  if (!isDigest(value.preparedPayloadDigest)) throw new Error('Invalid prepared outgoing digest.');
}
function requireId(value: unknown, name: string): asserts value is string { if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Invalid ${name} identifier.`); }
function safeReason(error: unknown) { const message = error instanceof Error ? error.message : 'execution-failed'; return message.slice(0, 500); }
function preparationIdentity(input: StartJobInput) {
  const { grantId: _grantId, preparedPayloadDigest: _preparedPayloadDigest, ...plan } = input;
  return packetDigest(plan);
}
