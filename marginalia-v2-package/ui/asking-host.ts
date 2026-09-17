import type { QuoteAnchor, SourceCapture, SourceVersion, Thread, ReplyVersion, ReplyViewState, NoteVersion } from '../contracts/reader.ts';
import type { ConsentSheetOptions, ConsentSheet } from './consent.ts';
import type { MountedReply, ReplyOptions } from '../renderer/index.ts';
import type { CandidateReply, Intent } from '../contracts/reply.ts';
import { canonicalReplyData, validateReply } from '../contracts/reply.ts';
import { replySaveLifecycle, type localPersistence } from './persistence.ts';
import type { HelperClient } from './helper.ts';

export type AskingSelection = {
  capture: SourceCapture; anchor: QuoteAnchor; threadId?: string; sourceVersionId?: string;
  answeredNote?: { noteId: string; revision: number; text: string };
  question: string; context: string; intent?: Intent;
  keepMutation?: Extract<import('../contracts/reader.ts').ReaderMutation, { kind: 'keep' }>;
  resumeJobId?: string;
  /** Explicit reopening of this immutable reply permits its recorded historical note version. */
  resumeReplyId?: string;
};
export type AskingMountFactory = (host: HTMLElement, api: AskingContext) => {
  open(selection: AskingSelection): void | Promise<void>; setVisible(visible: boolean): void; destroy(): void;
};
export type AskingContext = {
  helper(): HelperClient; signal: AbortSignal; authorize(sourceUrl: string): Promise<void>;
  currentThread(id: string): Thread | undefined;
  ensureContextSaved(selection: AskingSelection): Promise<void>;
  read<T>(key: string): Promise<T | undefined>; write(key: string, value: unknown): Promise<void>;
  persistence: ReturnType<typeof localPersistence>;
  track<T>(work: Promise<T>): Promise<T>;
  highlight(binding: import('../contracts/reply.ts').SourceBinding | null, original: string): void;
  navigate(binding: import('../contracts/reply.ts').SourceBinding, original: string): void;
  onCommitted(threadId: string): void;
  prepareReplyView?(threadId: string, replyVersionId: string): Promise<void>;
  onClosed?(): void;
  retainedQuestion?(selection: AskingSelection): void;
};
export const createAskingHost = (context: AskingContext) => context;

// Public-peer subset verified against T08 48dc726a. No T08 implementation is
// copied here. The optional build entry permits the owner commits to merge in
// either order without claiming the missing module exists.
type Binding = {
  threadId: string; anchorId: string; captureId: string; sourceVersionId: string; sourceHash: string;
  sourceUrl: string; sourceTitle: string; sourcePageType: string | null; sourceCapturedAt: string | null;
  sourceText: string; anchor: QuoteAnchor; answeredNote?: { noteId: string; revision: number; text: string };
};
type Access = { epoch: string; paired: boolean; canAuthorize: boolean; excluded: boolean; supported: boolean; helper: 'connected' | 'unknown'; surface: 'localhost' | 'native-panel' | 'floating'; login: 'unknown' };
type Result = { reply: ReplyVersion; source: SourceVersion; view?: ReplyViewState; binding: Binding; trace: { jobId: string } };
type FlowState = { phase: string; intent?: Intent; requestId?: string; submitted: boolean; canCheck: boolean; question?: string; job?: { id: string; state: string }; result?: Result };
type Flow = {
  ask(intent: Intent, question: string): Promise<void>; openAsk(): void; reopen(target: { jobId: string } | { replyVersionId: string }): Promise<void>;
  refresh(): Promise<void>; close(): void; invalidate(): void; reconcile(): void;
  getState(): FlowState; subscribe(listener: (state: FlowState) => void): () => void;
};
type PeerHost = { readReply(threadId: string, replyVersionId: string, signal: AbortSignal): Promise<{ reply: ReplyVersion; source: SourceVersion; view?: ReplyViewState }> } & Record<string, unknown>;
type Peer = {
  createAskingHost(transport: { request(path: string, body: unknown): Promise<unknown>; get(path: string): Promise<unknown>; replies(id: string): Promise<{ replies: ReplyVersion[]; source: SourceVersion; views: ReplyViewState[] }> }): PeerHost;
  bindAskingThread(thread: Thread, source: SourceVersion, captureId: string, note?: NoteVersion): Binding;
  createAskingFlow(options: { binding: Binding; host: PeerHost; validateReply: typeof validateReply; currentBinding(): Binding | undefined; currentAccess(): Access; ensureContextSaved(binding: Binding, signal: AbortSignal): Promise<void> }): Flow;
  mountAskingCard(root: HTMLElement, options: {
    flow: Flow; presentation: 'inline'; returnFocus?: HTMLElement;
    mountConsent(host: HTMLElement, options: ConsentSheetOptions): ConsentSheet;
    mountReply(host: HTMLElement, reply: CandidateReply, options: ReplyOptions): MountedReply;
    replyOptions(result: Result): Omit<ReplyOptions, 'sourceText' | 'hostReport' | 'onFollowup'>;
    onCommitted(result: Result): void;
  }): { destroy(): void };
};
async function loadPeer(): Promise<Peer> {
  const modules = import.meta.glob('./asking/index.ts');
  const styles = import.meta.glob('./asking/asking.css');
  const load = modules['./asking/index.ts'];
  if (!load) throw new Error('The T08 asking module is not installed in this build. The draft is retained; no request was sent.');
  const value = await load() as Peer;
  if (typeof value.createAskingFlow !== 'function' || typeof value.createAskingHost !== 'function' || typeof value.mountAskingCard !== 'function' || typeof value.bindAskingThread !== 'function') throw new Error('The installed asking interface is incompatible. Nothing was sent.');
  await styles['./asking/asking.css']?.();
  return value;
}
const equal = (a: unknown, b: unknown) => canonicalReplyData(a ?? null) === canonicalReplyData(b ?? null);

/** Compose the actual T08 flow/card with T13 consent and installed renderer.
 * Mounting, selecting, typing, moving controls and restoring metadata never send
 * a model request. Every model turn remains behind the T08/T13 explicit review.
 * Injection is for focused boundary tests; default loading is build-resolved. */
export function createT08Mount(loader: () => Promise<Peer> = loadPeer): AskingMountFactory {
  return (host, context) => {
    let destroyed = false, visible = true, generation = 0;
    let flow: Flow | undefined, card: { destroy(): void } | undefined, unsubscribe: (() => void) | undefined;
    let currentSelection: AskingSelection | undefined, currentBinding: Binding | undefined;
    let client: HelperClient | undefined, connectionEpoch = -1, connected = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let opening: Promise<void> | undefined;
    let lastDraft: string | undefined, lastCompletion: string | undefined;
    let lastQuestionSnapshot: AskingSelection | undefined;
    const captureId = crypto.randomUUID();
    const abort = new AbortController();
    const cancel = () => abort.abort(); context.signal.addEventListener('abort', cancel, { once: true });
    const readers = new Map<string, Awaited<ReturnType<ReturnType<typeof localPersistence>['replies']['open']>>>();
    const writers = new Set<{ mounted: MountedReply; flush(): Promise<void> }>();
    const active = (epoch: number) => !destroyed && !abort.signal.aborted && epoch === generation;
    function checkBinding(selection: AskingSelection) {
      if (destroyed || abort.signal.aborted) throw new Error('This source interaction is closed.');
      const thread = selection.threadId && context.currentThread(selection.threadId);
      if (!thread || thread.deletedAt || thread.sourceUrl !== selection.capture.url || thread.sourceVersionId !== selection.sourceVersionId || !equal(thread.anchor, selection.anchor)) throw new Error('The source binding changed. Reopen a review for the current saved thread.');
      if (selection.answeredNote) {
        const note = thread.notes.find(note => note.id === selection.answeredNote!.noteId && (selection.resumeReplyId || !note.deletedAt));
        if (!note || !selection.resumeReplyId && (note.text !== selection.answeredNote.text || note.revision !== selection.answeredNote.revision)) throw new Error('The exact note version changed. Its earlier question is retained.');
      }
      return thread;
    }
    async function connection() {
      if (!currentSelection) throw new Error('Choose a saved passage first.');
      checkBinding(currentSelection);
      await context.authorize(currentSelection.capture.url);
      if (!client || client !== context.helper() || client.connectionVersion !== connectionEpoch || !client.token || abort.signal.aborted) throw new Error('The helper connection changed. Earlier outcomes are unconfirmed; nothing is automatically resent.');
      return client;
    }
    function snapshotQuestion() {
      if (!currentSelection) return;
      // The card owns its DOM. Capture retained input at the host boundary only;
      // never change its field values, consent state or generated reply content.
      const question = host.querySelector<HTMLTextAreaElement>('.m-asking form textarea');
      const fields = host.querySelectorAll<HTMLTextAreaElement>('.m-asking form textarea');
      if (!question) return;
      const value = { ...structuredClone(currentSelection), question: question.value, context: fields[1]?.value ?? '', intent: flow?.getState().intent ?? currentSelection.intent };
      const identity = canonicalReplyData(value);
      if (identity === lastDraft) return;
      lastDraft = identity; lastQuestionSnapshot = value; context.retainedQuestion?.(value);
    }
    host.addEventListener('input', snapshotQuestion, { signal: abort.signal });
    async function openNow(selection: AskingSelection) {
      const epoch = ++generation;
      currentSelection = structuredClone(selection);
      const thread = checkBinding(selection);
      client = context.helper(); connectionEpoch = client.connectionVersion;
      if (typeof location === 'undefined' || client.origin !== location.origin) throw new Error('The current backend has no authenticated POST work-status bridge for this browser-panel surface. Your draft remains available; no model request was made.');
      await context.ensureContextSaved(selection);
      const peer = await loader(); if (!active(epoch)) return;
      const { mountConsentSheet } = await import('./consent.ts');
      const renderer = await import('../renderer/index.ts');
      await connection();
      const exported = await client.exportThread(thread.id);
      if (!active(epoch)) return; checkBinding(selection);
      if (!exported?.thread || exported.thread.id !== thread.id || exported.thread.deletedAt || exported.thread.sourceVersionId !== thread.sourceVersionId || exported.thread.sourceUrl !== thread.sourceUrl ||
        !equal(exported.thread.anchor, selection.anchor) || !exported.source || exported.source.id !== thread.sourceVersionId || exported.source.text !== selection.capture.text) throw new Error('This source capture is not the helper-acknowledged source. Save/reopen its exact context explicitly before asking.');
      const note = selection.answeredNote && exported.thread.notes.find(n => n.id === selection.answeredNote!.noteId && !n.deletedAt && n.revision === selection.answeredNote!.revision && n.text === selection.answeredNote!.text);
      let answered: NoteVersion | undefined = note ? { noteId: note.id, revision: note.revision, text: note.text, createdAt: note.createdAt } : undefined;
      if (selection.resumeReplyId) {
        const matching = exported.replies.filter(reply => reply.id === selection.resumeReplyId && reply.threadId === thread.id && !reply.deletedAt);
        if (matching.length !== 1) throw new Error('The exact saved reply is unavailable. Nothing was asked or retried.');
        const original = matching[0].answeredNote;
        const recorded = original && { noteId: original.noteId, revision: original.revision, text: original.text };
        if (!equal(recorded ?? undefined, selection.answeredNote)) throw new Error('The historical note does not match this immutable reply. Nothing was asked.');
        answered = original ?? undefined;
      }
      if (selection.answeredNote && !answered) throw new Error('The helper has not saved this exact note version. No inference was prepared.');
      currentBinding = peer.bindAskingThread(exported.thread, exported.source, captureId, answered);
      // A successful helper response establishes connection reachability, not model login/readiness.
      connected = true;
      let mountedFlow: Flow | undefined;
      const fence = (submissionId?: string) => {
        if (!active(epoch) || !mountedFlow || mountedFlow !== flow) throw new Error('This asking operation is closed or superseded.');
        const state = mountedFlow.getState();
        if (['closed', 'stale', 'cancelled', 'excluded', 'denied'].includes(state.phase)) throw new Error('This asking operation is no longer current.');
        if (submissionId && (state.phase !== 'submitting' || !state.submitted || state.requestId !== submissionId)) throw new Error('The approved submission changed or was cancelled. Its identity is retained; no new request was sent.');
      };
      const raw = peer.createAskingHost({
        request: async (path, body) => {
          const current = await connection();
          fence();
          let submissionId: string | undefined;
          // Store the exact request identity BEFORE a possible job side effect.
          if (path === '/api/jobs' || /\/(retry|followups)$/.test(path)) {
            const input = body as { id?: unknown };
            if (typeof input?.id !== 'string') throw new Error('The request identity is unavailable.');
            submissionId = input.id; fence(submissionId);
            snapshotQuestion();
            const selected = { ...structuredClone(lastQuestionSnapshot ?? currentSelection!), resumeJobId: input.id };
            const retained = { jobId: input.id, binding: currentBinding, question: flow?.getState().question, selection: selected };
            await context.write('request:' + input.id, retained); // Never overwrite an earlier unknown request's identity.
            await context.write('request', retained); // Read-only resume pointer, not the authority for dispatch.
            currentSelection = selected; context.retainedQuestion?.(selected);

            await connection();
          }
          // Final synchronous fence after local durability/authorization awaits.
          // T08 cancellation/Not now may have happened while those writes waited.
          fence(submissionId);
          return current.request(path, body, abort.signal);
        },
        get: async path => { const current = await connection(); fence(); return current.request(path, undefined, abort.signal); },
        replies: async id => { const current = await connection(); fence(); return current.replies(id); },
      });
      const originalRead = raw.readReply.bind(raw);
      const peerHost: PeerHost = { ...raw, readReply: async (threadId, replyVersionId, signal) => {
        const result = await originalRead(threadId, replyVersionId, signal);
        const current = await connection(); if (!active(epoch)) throw new Error('The asking view closed.');
        await context.prepareReplyView?.(threadId, replyVersionId);
        await connection();
        await context.persistence.replies.refresh(current.origin, threadId, () => context.persistence.replies.cache(current.origin, threadId, result.source, [result.reply], result.view ? [result.view] : []));
        const record = (await context.persistence.replies.list(threadId)).find(record => record.origin === current.origin && record.version.id === result.reply.id);
        if (!record) throw new Error('The committed reply could not be saved on this device. Reopen it without asking twice.');
        readers.set(result.reply.id, await context.persistence.replies.open(record));
        return result;
      } };
      const binding = currentBinding;
      flow = peer.createAskingFlow({ binding, host: peerHost, validateReply,
        currentBinding: () => { try { checkBinding(selection); return active(epoch) ? structuredClone(binding) : undefined; } catch { return undefined; } },
        currentAccess: () => ({ epoch: `${captureId}:${context.helper().connectionVersion}:${context.helper().permissionVersion}`, paired: !!context.helper().token,
          canAuthorize: context.helper().origin === location.origin, excluded: false, supported: true,
          helper: connected ? 'connected' : 'unknown', surface: 'localhost', login: 'unknown' }),
        ensureContextSaved: async (_binding, signal) => { signal.throwIfAborted(); await context.ensureContextSaved(selection); await connection(); signal.throwIfAborted(); },
      });
      mountedFlow = flow;
      let mountingReply = '';
      card = peer.mountAskingCard(host, {
        flow, presentation: 'inline',
        returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
        mountConsent: mountConsentSheet,
        replyOptions: result => {
          mountingReply = result.reply.id;
          const session = readers.get(result.reply.id);
          if (!session) throw new Error('The saved reply view is not ready.');
          return { initialState: session.record.local, capabilities: ['samples', 'followup'],
            sampleGenerationRecords: session.record.sampleGenerationRecords,
            onSourceHighlight: binding => context.highlight(binding, result.source.text),
            onSourceNavigate: binding => context.navigate(binding, result.source.text) };
        },
        mountReply: (root, reply, options) => {
          const session = readers.get(mountingReply); if (!session) throw new Error('The saved reply view is not ready.');
          let closed = false, writer: ReturnType<typeof replySaveLifecycle> | undefined;
          const mounted = renderer.mountReply(root, reply, { ...options, onStateChange: state => {
            if (closed || !writer) return Promise.resolve();
            return context.track(writer.save(state));
          } });
          writer = replySaveLifecycle(mounted.getState(), state => session.save(state));
          const tracked = { mounted, flush: () => context.track(writer!.flush(mounted.getState())) }; writers.add(tracked);
          return { ...mounted, destroy() {
            if (closed) return;
            const final = writer!.close(mounted.getState()); closed = true;
            void context.track(final).catch(() => {}); mounted.destroy(); writers.delete(tracked);
          } };
        },
        onCommitted: result => { if (active(epoch)) context.onCommitted(result.binding.threadId); },
      });
      // The current card has no initial-draft option. Seed its two documented
      // form textareas once, before opening/preparing; never replace them later.
      const inputs = host.querySelectorAll<HTMLTextAreaElement>('.m-asking form textarea');
      if (inputs[0]) inputs[0].value = selection.question;
      if (inputs[1]) inputs[1].value = selection.context;
      unsubscribe = flow.subscribe(state => {
        if (!active(epoch)) return;
        if (state.phase === 'closed') { snapshotQuestion(); context.onClosed?.(); }
        // Identity was durably recorded at transport start; subscriptions are view updates only.
        if (state.result) {
          const completion = { jobId: state.result.trace.jobId, replyVersionId: state.result.reply.id }, key = canonicalReplyData(completion);
          if (lastCompletion !== key) { lastCompletion = key; void context.track(context.write('completion', completion)).catch(() => { lastCompletion = undefined; }); }
        }
      });
      const previous = await context.read<{ jobId: string; binding: Binding }>(selection.resumeJobId ? 'request:' + selection.resumeJobId : 'request');
      if (!active(epoch)) return;
      if (!selection.resumeReplyId && selection.resumeJobId && (!previous || previous.jobId !== selection.resumeJobId || !equal({ ...previous.binding, captureId }, binding))) throw new Error('This saved request cannot be rebound to the current source or note. Its identity is retained; nothing was prepared, asked or retried.');
      if (selection.resumeReplyId) {
        // The peer finds the unique recorded completed job for this exact reply; read only.
        await flow.reopen({ replyVersionId: selection.resumeReplyId });
      } else if (previous?.jobId && equal({ ...previous.binding, captureId }, binding)) {
        // Reopening is read-only, even after timeout or an unknown start response.
        await flow.reopen({ jobId: previous.jobId });
      } else {
        const question = selection.question + (selection.context.trim() ? '\n\nReader-stated context:\n' + selection.context.trim() : '');
        flow.openAsk();
        // The T05 Review button was the explicit action; this only prepares consent.
        if (question.trim()) await flow.ask(selection.intent ?? (selection.answeredNote ? 'unsure' : 'define'), question);
      }
      // Read-only lifecycle observation while visible; never retry or dispatch from a timer.
      timer = setInterval(() => { if (!active(epoch) || !visible || !flow) return; const state = flow.getState();
        if (state.submitted && state.canCheck && ['queued', 'sending', 'working', 'provisional', 'validating', 'cancel_requested'].includes(state.phase)) void flow.refresh();
      }, 1000);
    }
    function dispose() {
      snapshotQuestion(); clearInterval(timer); timer = undefined; unsubscribe?.(); unsubscribe = undefined;
      card?.destroy(); card = undefined; flow?.close(); flow = undefined;
    }
    return {
      open(selection) {
        if (destroyed || abort.signal.aborted) return Promise.reject(new Error('This asking view is closed.'));
        if (opening) return opening;
        if (flow && currentSelection && equal(currentSelection, selection) && !['closed', 'stale'].includes(flow.getState().phase)) { host.hidden = false; visible = true; return; }
        dispose();
        opening = openNow(selection).catch(error => { dispose(); throw error; }).finally(() => { opening = undefined; });
        return opening;
      },
      setVisible(value) { visible = value; host.hidden = !value; if (!value) { snapshotQuestion(); for (const writer of writers) void writer.flush().catch(() => {}); } },
      destroy() { if (destroyed) return; dispose(); destroyed = true; generation++; abort.abort(); context.signal.removeEventListener('abort', cancel); },
    };
  };
}
