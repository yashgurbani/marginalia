import type { ConsentChoice, ConsentGrant, ConsentPreview } from '../../contracts/consent.ts';
import type { JobSnapshot, PrepareJobInput } from '../../contracts/jobs.ts';
import type { Intent } from '../../contracts/reply.ts';
import { assertBinding, assertGrant, assertJob, assertPreparation, assertSavedReply, checkedCandidate, definitionFromPage,
  hostCopy, isId, sameData, type ExpectedRequest } from './binding.ts';
import type { AskingAccess, AskingBinding, AskingBlocker, AskingHost, AskingPhase, AskingPreparation, AskingResult, AskingState, AskingValidator } from './types.ts';

const terminal = new Set<JobSnapshot['state']>(['succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown']);
const retryable = new Set<JobSnapshot['state']>(['failed', 'cancelled', 'timed_out', 'outcome_unknown']);
const activeOrder: Partial<Record<JobSnapshot['state'], number>> = { queued: 0, preparing: 1, sending: 2, running: 3, validating: 4, cancel_requested: 5 };
const intents = new Set<Intent>(['define', 'simulate', 'instantiate', 'derive', 'diagram', 'evidence', 'explore', 'unsure']);
const inactive = () => new Error('This review changed or closed. Review the current request again.');
const messages: Record<AskingBlocker, string> = {
  excluded: 'This site is excluded. Reading and local notes remain available.',
  unsupported: 'Asking is unavailable for this page. Your saved work remains available.',
  'browser-owned-required': 'Open the browser-owned margin to review and approve a request.',
  unpaired: 'Pair with the local helper before asking. Your passage and note remain here.',
  'helper-off': 'The local helper is off. Reading and local saving do not require it.',
  disconnected: 'The local helper connection is unavailable. Reading and local notes remain here.',
  'signed-out': 'Codex is signed out in the dedicated local setup. Reading and local notes remain available.',
  'runtime-unavailable': 'Codex execution is not ready. Pairing alone does not make it available. Nothing was asked.',
  'invalid-response': 'The response was unavailable or did not match this request. Review it again; nothing was asked.',
  'unsaved-context': 'This exact passage and note could not be confirmed saved. Nothing was asked. Your note remains unchanged.',
  'expired-preview': 'This preview expired or changed. Review a new request; nothing was asked.',
};
type Operation = {
  abort: AbortController; access: AskingAccess; mode: 'send' | 'read'; id: string;
  expected?: ExpectedRequest; preparation?: AskingPreparation; grant?: ConsentGrant; job?: JobSnapshot;
  dispatched: boolean; receiveEpoch: number; preparing?: Promise<void>; reading?: Promise<void>;
  decision?: { choice: ConsentChoice; preview: ConsentPreview; task: Promise<ConsentGrant> };
  cancellation?: Promise<void>; cancelIssued: boolean;
};
export type AskingOptions = {
  binding: AskingBinding;
  host: AskingHost;
  /** Existing contracts/reply.validateReply. Required: no permissive default validator. */
  validateReply: AskingValidator;
  currentBinding(): AskingBinding | undefined;
  currentAccess(): AskingAccess;
  /** Confirm/drain the existing T05/T07 journal for this exact saved context; never a second store. */
  ensureContextSaved(binding: AskingBinding, signal: AbortSignal): Promise<void>;
  now?: () => number;
  newId?: () => string;
};

/** One ephemeral interaction. All permission, durable state and provider effects stay in the existing host. */
export function createAskingFlow(options: AskingOptions) {
  const binding = hostCopy(options.binding); assertBinding(binding);
  if (typeof options.validateReply !== 'function') throw new Error('The installed reply validator is required.');
  const now = options.now ?? Date.now, newId = options.newId ?? (() => crypto.randomUUID());
  const listeners = new Set<(state: AskingState) => void>();
  let operation: Operation | undefined, closed = false, invalidated = false;
  let state: AskingState = { phase: 'local', message: '', definition: definitionFromPage(binding.anchor.exact, binding.sourceText),
    sending: false, canAsk: true, canCancel: false, canRetry: false, canCheck: false, canFollowup: false, submitted: false };

  function accessBlocker(a: AskingAccess, mode: 'send' | 'read'): AskingBlocker | undefined {
    if (mode === 'send') {
      if (a.excluded) return 'excluded';
      if (!a.supported) return 'unsupported';
      if (!a.canAuthorize || a.surface === 'floating') return 'browser-owned-required';
    }
    if (a.helper === 'off') return 'helper-off';
    if (a.helper !== 'connected') return 'disconnected';
    if (!a.paired) return 'unpaired';
    if (mode === 'send' && a.login === 'signed-out') return 'signed-out';
  }
  function getState(): AskingState {
    const view = hostCopy(state), op = operation;
    let eligible = !closed && !invalidated;
    try { eligible = eligible && sameData(options.currentBinding(), binding); } catch { eligible = false; }
    let maySend = false;
    try {
      const access = options.currentAccess();
      if (op && (access.epoch !== op.access.epoch || access.surface !== op.access.surface || accessBlocker(access, op.mode))) eligible = false;
      maySend = eligible && !accessBlocker(access, 'send');
    } catch { eligible = false; }
    // Earlier observers can synchronously change the host context during publish. Later observers must not see stale content.
    if (!eligible && !closed && !invalidated) {
      view.phase = 'stale'; view.message = 'The passage, note, or connection changed. Reopen this saved work in its current context.';
      delete view.result; delete view.previousResult; delete view.preparation; delete view.provisional; delete view.definition;
    }
    view.requestId = eligible && op?.id ? op.id : undefined;
    view.sending = eligible && view.phase === 'sending';
    view.submitted = !!op?.dispatched;
    const busy = !!op?.preparing || !!op?.cancellation || view.phase === 'deciding' || view.phase === 'submitting';
    view.canAsk = eligible && !op?.dispatched && !busy && !['consent', 'denied', 'excluded'].includes(view.phase);
    view.canCancel = eligible && !!op && !op.cancelIssued && (!op.dispatched || !op.job || !terminal.has(op.job.state));
    view.canRetry = maySend && !!op?.job && retryable.has(op.job.state) && !busy;
    view.canCheck = eligible && !!op?.dispatched && view.phase !== 'committed' && !op.cancellation;
    view.canFollowup = maySend && !!view.result && op?.job?.state === 'succeeded' && view.phase === 'committed' && !busy;
    const attempt = op?.job?.attempts.find(a => a.id === op.job!.latestAttemptId);
    const elapsed = attempt?.startedAt ? Math.floor((now() - Date.parse(attempt.startedAt)) / 1000) : NaN;
    if (eligible && op?.job && !terminal.has(op.job.state) && Number.isFinite(elapsed) && elapsed >= 30) view.elapsedSeconds = elapsed;
    return view;
  }
  function publish(patch: Partial<AskingState>) {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(getState()); } catch { /* A display callback cannot repeat or interrupt a host operation. */ }
    }
  }
  function blocked(blocker: AskingBlocker) {
    publish({ phase: blocker === 'excluded' ? 'excluded' : 'unavailable', blocker, message: messages[blocker], preparation: undefined });
  }
  function invalidate() {
    if (closed || invalidated) return;
    invalidated = true; operation?.abort.abort();
    publish({ phase: 'stale', message: 'The passage, note, or connection changed. Reopen Ask for the current context. Saved work stays in its thread.',
      definition: undefined, preparation: undefined, provisional: undefined, result: undefined, previousResult: undefined });
  }
  function current(op: Operation): boolean {
    if (closed || invalidated || op !== operation || op.abort.signal.aborted) return false;
    try {
      const access = options.currentAccess();
      if (sameData(options.currentBinding(), binding) && access.epoch === op.access.epoch && access.surface === op.access.surface &&
          !accessBlocker(access, op.mode)) return true;
    } catch { /* Unreadable access/binding cannot authorize anything. */ }
    invalidate(); return false;
  }
  function requireCurrent(op: Operation) { if (!current(op)) throw inactive(); }
  function entryAccess(mode: 'send' | 'read'): AskingAccess | undefined {
    if (closed || invalidated) return;
    try {
      if (!sameData(options.currentBinding(), binding)) { invalidate(); return; }
      const a = hostCopy(options.currentAccess()), blocker = accessBlocker(a, mode);
      if (blocker) { blocked(blocker); return; }
      if (typeof a.epoch !== 'string' || !a.epoch || !['native-panel', 'localhost', 'floating'].includes(a.surface)) throw inactive();
      return a;
    } catch { blocked('disconnected'); return; }
  }
  async function available(op: Operation) {
    requireCurrent(op);
    const value = hostCopy(await options.host.availability(op.abort.signal));
    requireCurrent(op);
    if (value?.configured !== true || value.available !== true) { blocked('runtime-unavailable'); throw inactive(); }
  }
  function question(raw: string): string | undefined {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 4000) {
      publish({ message: 'Write a question of at most 4,000 characters. No new request was made.' }); return;
    }
    return raw.trim();
  }

  function begin(intent: Intent, q: string, kind: ExpectedRequest['kind'] = 'initial', parent?: JobSnapshot): Promise<void> {
    const access = entryAccess('send'); if (!access) return Promise.resolve();
    let input: PrepareJobInput;
    try {
      input = { id: newId(), idempotencyKey: newId(), threadId: binding.threadId, intent, question: q,
        ...(binding.answeredNote ? { answeredNote: { noteId: binding.answeredNote.noteId, revision: binding.answeredNote.revision } } : {}),
        ...(kind === 'retry' && parent?.context.parentReplyId ? { parentReplyId: parent.context.parentReplyId } : {}),
        ...((kind === 'followup' || kind === 'note-followup') && parent?.replyVersionId ? { parentReplyId: parent.replyVersionId } : {}) };
      if (!isId(input.id) || !isId(input.idempotencyKey) || input.id === parent?.id) throw inactive();
    } catch { blocked('invalid-response'); return Promise.resolve(); }
    const previousResult = state.result ?? state.previousResult;
    operation?.abort.abort();
    const expected: ExpectedRequest = { input, kind,
      ...(kind === 'retry' ? { retryOfJobId: parent!.id } : {}),
      ...(kind === 'followup' ? { parentJobId: parent!.id, parentAttemptId: parent!.latestAttemptId } : {}) };
    const op: Operation = { abort: new AbortController(), access, mode: 'send', id: input.id, expected,
      dispatched: false, receiveEpoch: 0, cancelIssued: false };
    operation = op;
    op.preparing = Promise.resolve().then(async () => {
      let stage: AskingBlocker = 'unsaved-context';
      try {
        requireCurrent(op);
        await options.ensureContextSaved(hostCopy(binding), op.abort.signal);
        requireCurrent(op); stage = 'invalid-response';
        await available(op);
        if (parent && kind !== 'retry') {
          // Re-read the exact parent, never whichever reply happens to be newest.
          const observed = hostCopy(await options.host.inspect(parent.id, op.abort.signal)); requireCurrent(op);
          assertJob(observed, binding, parent.id);
          if (observed.state !== 'succeeded' || observed.replyVersionId !== parent.replyVersionId || observed.latestAttemptId !== parent.latestAttemptId) throw inactive();
          const saved = hostCopy(await options.host.readReply(binding.threadId, parent.replyVersionId!, op.abort.signal)); requireCurrent(op);
          assertSavedReply(saved, observed, binding, options.validateReply);
        }
        requireCurrent(op);
        const prepared = kind === 'retry'
          ? await options.host.prepareRetry(parent!.id, { id: input.id, idempotencyKey: input.idempotencyKey }, op.abort.signal)
          : kind === 'followup'
            ? await options.host.prepareFollowup(parent!.id, { id: input.id, idempotencyKey: input.idempotencyKey, question: q }, op.abort.signal)
            : await options.host.prepare(hostCopy(input), op.abort.signal);
        requireCurrent(op);
        const copy = hostCopy(prepared); assertPreparation(copy, expected, binding, now());
        op.preparation = copy;
        const phase = copy.preview.state === 'ready' ? 'consent' : copy.preview.state;
        publish({ phase, blocker: undefined, preparation: copy, message: phase === 'consent'
          ? (kind === 'note-followup' ? 'Review a new request in this thread. It includes the original note version and a saved-parent excerpt; it does not resume the old provider session.'
            : 'Review the exact outgoing text, recipient, and permission before asking.')
          : phase === 'denied' ? 'Sending is denied for this site. Change the decision in Settings before asking again.' : messages.excluded });
      } catch {
        if (current(op) && state.blocker !== 'runtime-unavailable') blocked(stage);
      } finally { op.preparing = undefined; if (current(op)) publish({}); }
    });
    publish({ phase: 'preparing', blocker: undefined, message: 'Preparing the exact request for review. Nothing has been asked yet.',
      intent, question: q, preparation: undefined, job: undefined, provisional: undefined, result: undefined, previousResult });
    return op.preparing;
  }

  function ask(intent: Intent, rawQuestion: string): Promise<void> {
    if (closed || invalidated) return Promise.resolve();
    if (operation?.preparing) return operation.preparing;
    if (operation?.dispatched || ['consent', 'deciding', 'submitting'].includes(state.phase)) return Promise.resolve();
    const q = question(rawQuestion);
    if (!q || !intents.has(intent)) return Promise.resolve();
    return begin(intent, q);
  }
  function choose(choice: ConsentChoice, offered: ConsentPreview, signal?: AbortSignal): Promise<ConsentGrant> {
    const op = operation;
    if (!op || !current(op) || !op.preparation || !op.expected || !['this-time', 'always-site', 'never-site'].includes(choice)) return Promise.reject(inactive());
    const p = op.preparation;
    try { offered = hostCopy(offered); } catch { return Promise.reject(inactive()); }
    if (op.decision) return op.decision.choice === choice && sameData(op.decision.preview, offered) ? op.decision.task : Promise.reject(inactive());
    if (state.phase !== 'consent' || p.preview.state !== 'ready' || !sameData(offered, p.preview) || signal?.aborted) return Promise.reject(inactive());
    try { assertPreparation(p, op.expected, binding, now()); } catch { blocked('expired-preview'); return Promise.reject(inactive()); }
    const stop = () => dismissPreview(); signal?.addEventListener('abort', stop, { once: true });
    const task = Promise.resolve().then(async () => {
      try {
        requireCurrent(op);
        // Never remains a permission write, not a request to start provider work.
        if (choice !== 'never-site') await available(op);
        requireCurrent(op); assertPreparation(p, op.expected!, binding, now());
        const grant = hostCopy(await options.host.decide({ previewId: p.preview.id, expectedRevision: p.preview.revision, choice }, op.abort.signal));
        requireCurrent(op); assertGrant(grant, p.preview, choice);
        // Destroying the existing consent sheet aborts its decision signal. That is not provider cancellation.
        signal?.removeEventListener('abort', stop);
        if (choice === 'never-site') { publish({ phase: 'denied', preparation: undefined, message: 'Sending is now blocked for this site. Nothing was asked.' }); return grant; }
        assertPreparation(p, op.expected!, binding, now()); requireCurrent(op);
        op.grant = grant;
        const receiveEpoch = op.receiveEpoch;
        publish({ phase: 'submitting', preparation: undefined, message: 'Submitting the approved request. Provider sending has not yet been observed.' });
        try {
          requireCurrent(op);
          // A synchronous display callback may outlive the preview; check expiry again at the local handoff.
          assertPreparation(p, op.expected!, binding, now());
          op.dispatched = true; // No await after this final local fence and before the existing host endpoint.
          const continuation = { id: p.job.id, idempotencyKey: p.job.idempotencyKey, grantId: grant.id, preparedPayloadDigest: p.job.preparedPayloadDigest };
          const response = op.expected!.kind === 'retry'
            ? await options.host.retry(op.expected!.retryOfJobId!, continuation, op.abort.signal)
            : op.expected!.kind === 'followup'
              ? await options.host.followup(op.expected!.parentJobId!, { ...continuation, question: p.job.question }, op.abort.signal)
              : await options.host.start({ ...hostCopy(p.job), grantId: grant.id }, op.abort.signal);
          if (current(op) && receiveEpoch === op.receiveEpoch) await acceptJob(op, response, receiveEpoch);
        } catch {
          if (current(op) && receiveEpoch === op.receiveEpoch) {
            if (!op.dispatched) blocked('expired-preview');
            // A later read may already have established the terminal outcome while this HTTP response was pending.
            else if (!op.job || !terminal.has(op.job.state)) publish({ phase: 'unknown',
              message: 'The request outcome is unknown. Check its status before trying again; it will not be resent automatically.' });
          }
        }
        return grant;
      } catch {
        signal?.removeEventListener('abort', stop);
        if (current(op) && !op.dispatched && state.blocker !== 'runtime-unavailable') blocked('invalid-response');
        throw inactive();
      } finally { signal?.removeEventListener('abort', stop); }
    });
    op.decision = { choice, preview: hostCopy(offered), task };
    publish({ phase: 'deciding', message: 'Checking and saving your permission choice. Nothing has been asked yet.' });
    return task;
  }

  async function acceptJob(op: Operation, raw: JobSnapshot, receiveEpoch: number) {
    requireCurrent(op); if (receiveEpoch !== op.receiveEpoch) return;
    const job = hostCopy(raw); assertJob(job, binding, op.id, op.expected, op.preparation);
    if (op.grant && job.grantId !== op.grant.id) throw inactive();
    const old = op.job;
    if (old) {
      if (terminal.has(old.state) && job.state !== old.state || Date.parse(job.updatedAt) < Date.parse(old.updatedAt)) return;
      if (old.latestAttemptId && job.latestAttemptId !== old.latestAttemptId) throw inactive();
      if (old.replyVersionId && job.replyVersionId !== old.replyVersionId) throw inactive();
      if (!sameData(old.context, job.context) ||
          (['idempotencyKey', 'packetDigest', 'preparedPayloadDigest', 'provider', 'model', 'mode', 'policyKey', 'grantId', 'createdAt'] as const)
            .some(key => old[key] !== job[key])) throw inactive();
      const before = old.attempts.find(a => a.id === old.latestAttemptId), after = job.attempts.find(a => a.id === job.latestAttemptId);
      if (before && after && after.revision < before.revision) return;
      if (!terminal.has(old.state) && !terminal.has(job.state) && activeOrder[job.state]! < activeOrder[old.state]!) return;
      if (old.cancelRequested && !job.cancelRequested && job.state !== 'succeeded') return;
    }
    op.job = job;
    let provisional = state.provisional, invalidPartial = false;
    if (job.provisional !== undefined) {
      try { provisional = checkedCandidate(job.provisional, binding, options.validateReply, 'partial'); }
      catch { invalidPartial = true; }
    }
    if (job.state !== 'succeeded') {
      const phase: Record<Exclude<JobSnapshot['state'], 'succeeded'>, AskingPhase> = {
        queued: 'queued', preparing: 'preparing', sending: 'sending', running: provisional ? 'provisional' : 'working', validating: 'validating',
        failed: 'failed', cancelled: 'cancelled', timed_out: 'timed_out', outcome_unknown: 'unknown', cancel_requested: 'cancel_requested',
      };
      const message: Record<Exclude<JobSnapshot['state'], 'succeeded'>, string> = {
        queued: 'Queued. You can keep reading.', preparing: 'The local helper is preparing this work.', sending: 'The local helper reports that this request is sending.',
        running: provisional ? 'A provisional reply is available. It is not a saved completed reply.' : 'Working. You can keep reading.',
        validating: 'Checking the reply before it is saved.', failed: 'This attempt failed. Any partial reply remains provisional.',
        cancelled: 'This attempt was cancelled. Saved work was not removed.', timed_out: 'This attempt timed out. A timeout alone does not confirm the provider stopped.',
        outcome_unknown: 'The outcome is unknown. Trying again creates new work and may repeat computation; nothing is retried automatically.',
        cancel_requested: 'Cancellation was requested. Stopping is not yet confirmed.',
      };
      publish({ phase: phase[job.state], blocker: invalidPartial ? 'invalid-response' : undefined, job, provisional,
        message: message[job.state] + (invalidPartial ? ' A malformed provisional update was withheld.' : '') }); return;
    }
    if (state.result?.reply.id === job.replyVersionId) { publish({ job }); return; }
    publish({ phase: 'loading-reply', message: 'Completed. Opening the saved reply.', job, provisional });
    try {
      requireCurrent(op);
      const saved = hostCopy(await options.host.readReply(binding.threadId, job.replyVersionId!, op.abort.signal));
      if (!current(op) || receiveEpoch !== op.receiveEpoch || op.job !== job) return;
      assertSavedReply(saved, job, binding, options.validateReply);
      const attempt = job.attempts.find(a => a.id === job.latestAttemptId)!;
      const result: AskingResult = { ...saved, binding: hostCopy(binding), trace: {
        jobId: job.id, attemptId: attempt.id, replyVersionId: saved.reply.id, provider: job.provider, model: job.model, grantId: job.grantId,
        preparedPayloadDigest: job.preparedPayloadDigest, sourceVersionId: binding.sourceVersionId, sourceHash: binding.sourceHash,
        requestedAt: job.createdAt, savedAt: saved.reply.createdAt, ...(attempt.endedAt ? { attemptEndedAt: attempt.endedAt } : {}),
        ...(job.context.parentReplyId ? { parentReplyId: job.context.parentReplyId } : {}),
        ...(binding.answeredNote ? { answeredNote: { noteId: binding.answeredNote.noteId, revision: binding.answeredNote.revision } } : {}),
      } };
      publish({ phase: 'committed', blocker: undefined, message: 'Ready. Saved in this thread.', provisional: undefined, result });
    } catch {
      if (current(op) && receiveEpoch === op.receiveEpoch) publish({ phase: 'reply-unavailable', blocker: 'invalid-response',
        message: 'This work completed, but its matching saved reply could not be opened. Check again without asking twice.' });
    }
  }
  function refresh(): Promise<void> {
    const op = operation;
    if (!op || !op.dispatched || !current(op)) return Promise.resolve();
    if (op.cancellation) return op.cancellation;
    if (op.reading) return op.reading;
    const receiveEpoch = op.receiveEpoch;
    op.reading = Promise.resolve().then(async () => {
      try {
        requireCurrent(op);
        const response = await options.host.inspect(op.id, op.abort.signal);
        if (current(op) && receiveEpoch === op.receiveEpoch) {
          await acceptJob(op, response, receiveEpoch);
          if (op.job && !terminal.has(op.job.state) && !op.job.cancelRequested) op.cancelIssued = false;
        }
      } catch {
        if (current(op) && receiveEpoch === op.receiveEpoch && state.phase !== 'committed') publish({
          ...(!op.job || !terminal.has(op.job.state) ? { phase: 'unknown' as const } : {}),
          message: 'The current status could not be confirmed. Your saved work remains; no request was resent.' });
      } finally { op.reading = undefined; if (current(op)) publish({}); }
    });
    return op.reading;
  }
  function cancel(): Promise<void> {
    const op = operation;
    if (!op || !current(op)) return Promise.resolve();
    if (!op.dispatched) {
      op.abort.abort(); operation = undefined;
      publish({ phase: 'cancelled', preparation: undefined, message: 'Dismissed before asking. Nothing was sent to Codex.' }); return Promise.resolve();
    }
    if (op.cancellation) return op.cancellation;
    if (op.cancelIssued || op.job && terminal.has(op.job.state)) return Promise.resolve();
    op.cancelIssued = true;
    const receiveEpoch = ++op.receiveEpoch;
    op.cancellation = Promise.resolve().then(async () => {
      try {
        requireCurrent(op);
        const response = await options.host.cancel(op.id, op.abort.signal);
        if (current(op)) await acceptJob(op, response, receiveEpoch);
      } catch {
        if (current(op)) publish({ phase: 'unknown', message: 'Cancellation could not be confirmed. The provider may still be working. Check status; nothing will be resent.' });
      } finally { op.cancellation = undefined; if (current(op)) publish({}); }
    });
    publish({ phase: 'cancel_requested', message: 'Requesting cancellation. Stopping is not yet confirmed.' });
    return op.cancellation;
  }
  function retry(): Promise<void> {
    const op = operation;
    if (!op || !current(op) || !op.job || !retryable.has(op.job.state) || op.cancellation || op.preparing) return Promise.resolve();
    return begin(op.job.context.intent, op.job.context.question, 'retry', op.job);
  }
  function followup(rawQuestion: string): Promise<void> {
    if (operation?.preparing) return operation.preparing;
    const op = operation, q = question(rawQuestion);
    if (!q || !op || !current(op) || state.phase !== 'committed' || !state.result || op.job?.state !== 'succeeded') return Promise.resolve();
    // The current continuation route drops answeredNote. The supported generic route preserves both note and reply lineage.
    return begin(op.job.context.intent, q, binding.answeredNote ? 'note-followup' : 'followup', op.job);
  }
  function reopen(target: { jobId: string; replyVersionId?: string } | { replyVersionId: string; jobId?: never }): Promise<void> {
    if (closed || invalidated || operation?.dispatched) return Promise.resolve();
    if (operation?.preparing) return operation.preparing;
    if ((!target.jobId && !target.replyVersionId) || target.jobId !== undefined && !isId(target.jobId) || target.replyVersionId !== undefined && !isId(target.replyVersionId)) {
      blocked('invalid-response'); return Promise.resolve();
    }
    const access = entryAccess('read'); if (!access) return Promise.resolve();
    operation?.abort.abort();
    const op: Operation = { abort: new AbortController(), access, mode: 'read', id: target.jobId ?? '', dispatched: false, receiveEpoch: 0, cancelIssued: false };
    operation = op;
    op.preparing = Promise.resolve().then(async () => {
      try {
        requireCurrent(op);
        let job: JobSnapshot;
        if (target.jobId) job = hostCopy(await options.host.inspect(target.jobId, op.abort.signal));
        else {
          const candidates = hostCopy(await options.host.listJobs(binding.threadId, op.abort.signal)); requireCurrent(op);
          if (!Array.isArray(candidates) || candidates.length > 10_000) throw inactive();
          const matches = candidates.filter(j => j?.threadId === binding.threadId && j.state === 'succeeded' && j.replyVersionId === target.replyVersionId);
          if (matches.length !== 1) throw inactive();
          job = matches[0];
        }
        requireCurrent(op); if (!isId(job.id)) throw inactive();
        assertJob(job, binding, target.jobId ?? job.id);
        if (target.replyVersionId && job.replyVersionId !== target.replyVersionId) throw inactive();
        op.id = job.id; op.dispatched = true;
        await acceptJob(op, job, op.receiveEpoch);
      } catch {
        if (current(op)) publish({ phase: 'reply-unavailable', blocker: 'invalid-response',
          message: 'The exact saved request or reply could not be reopened. Nothing was asked or retried.' });
      } finally { op.preparing = undefined; if (current(op)) publish({}); }
    });
    publish({ phase: 'reopening', message: 'Opening saved work. No new question is being asked.', preparation: undefined });
    return op.preparing;
  }
  function dismissPreview() {
    if (closed || invalidated || operation?.dispatched) return;
    operation?.abort.abort(); operation = undefined;
    publish({ phase: 'suggestions', preparation: undefined, message: 'Not now. Nothing was asked.' });
  }
  function close() {
    if (closed) return;
    closed = true; operation?.abort.abort();
    publish({ phase: 'closed', preparation: undefined, result: undefined, previousResult: undefined, provisional: undefined,
      message: 'This card is closed. Closing does not confirm already submitted work stopped.' });
    listeners.clear();
  }
  return {
    getState, ask, choose, cancel, retry, followup, reopen, refresh, dismissPreview, invalidate, close,
    getBinding: () => hostCopy(binding), getAccess: () => hostCopy(options.currentAccess()),
    reconcile() {
      if (closed || invalidated) return;
      if (operation) { current(operation); return; }
      try { if (!sameData(options.currentBinding(), binding)) invalidate(); } catch { invalidate(); }
    },
    openAsk() {
      if (!closed && !invalidated && !operation?.dispatched && !operation?.preparing && !['consent', 'deciding', 'submitting'].includes(state.phase))
        publish({ phase: 'suggestions', message: 'Choose a question, then Ask to review it. Selecting sends nothing.' });
    },
    subscribe(listener: (state: AskingState) => void) {
      if (closed) return () => {};
      listeners.add(listener); try { listener(getState()); } catch { /* See publish. */ }
      return () => { listeners.delete(listener); };
    },
  };
}
export type AskingFlow = ReturnType<typeof createAskingFlow>;
