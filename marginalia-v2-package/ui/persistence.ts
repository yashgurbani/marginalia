import { ReaderJournal, type Persistence, type JournalState } from './journal.ts';
import type { QuoteAnchor, ReaderMutation, SourceCapture, Thread, ReplyVersion, ReplyViewState, SourceVersion, ReplyRemovalChange } from '../contracts/reader.ts';
import type { AskingSelection } from './asking-host.ts';
import type { HostCheckReport } from '../contracts/host-checks.ts';
import type { SampleGenerationRecord } from '../contracts/sample-provenance.ts';
import { canonicalReplyData } from '../contracts/reply.ts';

export const SUGGESTION_POLICY_VERSION = 'marginalia.suggestions.v1' as const;
export type SuggestionExposureResolution = 'chosen' | 'dismissed' | 'replaced' | 'page-closed';
export type SuggestionExposureRecord = {
  exposureId: string;
  policyVersion: typeof SUGGESTION_POLICY_VERSION;
  contextHash: string;
  eligible: string[];
  shown: { intent: string; label: string; position: number }[];
  shownAt: string;
  resolvedAt: string | null;
  choice: string | null;
  resolution: SuggestionExposureResolution | null;
  latencyMs: number | null;
  resultingId?: string;
  eventualOutcome: string | 'unknown';
};
export const SUGGESTION_PAGE_SIZE = 64;
const suggestionIntents = new Set(['define', 'simulate', 'evidence', 'instantiate', 'derive', 'diagram', 'explore', 'unsure']);
const boundedString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const exposureTime = (value: unknown): value is string => boundedString(value, 40) && Number.isFinite(Date.parse(value));
function onlyFields(value: object, allowed: readonly string[]) {
  let count = 0;
  for (const key in value) { if (++count > allowed.length || !Object.hasOwn(value, key) || !allowed.includes(key)) return false; }
  return true;
}
/** Validate bounded fields before cloning/stringifying untrusted local data. */
export function validSuggestionExposure(value: unknown): value is SuggestionExposureRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as SuggestionExposureRecord;
  const allowed = ['exposureId', 'policyVersion', 'contextHash', 'eligible', 'shown', 'shownAt', 'resolvedAt', 'choice', 'resolution', 'latencyMs', 'resultingId', 'eventualOutcome'];
  if (!onlyFields(r, allowed) || !boundedString(r.exposureId, 128) || !/^[\w-]+$/.test(r.exposureId) || r.policyVersion !== SUGGESTION_POLICY_VERSION || typeof r.contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.contextHash)) return false;
  if (!Array.isArray(r.eligible) || r.eligible.length > 8 || r.eligible.some(intent => !suggestionIntents.has(intent)) || new Set(r.eligible).size !== r.eligible.length) return false;
  if (!Array.isArray(r.shown) || r.shown.length > suggestionIntents.size || r.shown.some((entry, index) => !entry || typeof entry !== 'object' || !onlyFields(entry, ['intent', 'label', 'position']) || !r.eligible.includes(entry.intent) || !boundedString(entry.label, 160) || entry.position !== index + 1) || new Set(r.shown.map(entry => entry.intent)).size !== r.shown.length) return false;
  if (!exposureTime(r.shownAt) || (r.resultingId !== undefined && !boundedString(r.resultingId, 128)) || !boundedString(r.eventualOutcome, 80)) return false;
  if (r.resolution === null) return r.resolvedAt === null && r.choice === null && r.latencyMs === null;
  if (!['chosen', 'dismissed', 'replaced', 'page-closed'].includes(r.resolution) || !exposureTime(r.resolvedAt) || Date.parse(r.resolvedAt) < Date.parse(r.shownAt)) return false;
  if (r.latencyMs !== null && (!Number.isSafeInteger(r.latencyMs) || r.latencyMs < 0)) return false;
  return r.resolution === 'chosen' ? r.shown.some(entry => entry.intent === r.choice) : r.choice === null;
}
// Exact failed writes survive a same-document remount. Session receipts also survive
// reload in the same tab where sessionStorage is available; no durability is claimed
// if both stores refuse writes.
const pendingExposures = new Map<string, SuggestionExposureRecord>();
const knownExposures = new Map<string, SuggestionExposureRecord>();

export type ReplyState = Pick<ReplyViewState, 'parameters' | 'view'>;
export type ReplyViewChange = ReplyState & { id: string; replyVersionId: string; expectedRevision: number };
type RecoveredView = { id?: string; state: ReplyState; savedAt: string };
type ReplyHistory = { kind: 'recovered'; value: RecoveredView } | { kind: 'rejected'; value: ReplyViewChange };
export type ReplyRemovalRecord = {
  operationId: string; replyVersionId: string; desiredRemoved: boolean; expectedRevision: number;
  status: 'local' | 'pending' | 'acknowledged' | 'conflict';
  /** Local choice made while this exact request still has an unknown outcome. */
  queuedRemoved?: boolean;
};
export type CachedReply = {
  origin: string; version: ReplyVersion; source: SourceVersion;
  remoteView: ReplyViewState; local: ReplyState; localRevision: number; dirty: boolean;
  pending?: ReplyViewChange; conflict?: boolean; report?: HostCheckReport;
  reports?: Record<string, HostCheckReport>;
  sampleGenerationRecords?: Record<string, SampleGenerationRecord>;
  recovered?: RecoveredView[];
  rejected?: ReplyViewChange[];
  /** Latest reader intent; acknowledged predecessors remain exportable in removalHistory. */
  removal?: ReplyRemovalRecord;
  removalHistory?: ReplyRemovalRecord[];
};
export const replyIsRemoved = (record: CachedReply) => record.removal?.queuedRemoved ?? record.removal?.desiredRemoved ?? !!record.version.deletedAt;
const replyQueues = new Map<string, Promise<unknown>>();
// A failed IndexedDB write must survive a same-document unmount. These snapshots
// remain explicitly unsaved and exportable; they are not claimed as durable.
const unsavedReplyViews = new Map<string, { namespace: string; record: CachedReply; recovery: RecoveredView }>();
/** Shared by every mount in this document; Web Locks serialize other documents too. */
function replyLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const prior = replyQueues.get(key) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(async (): Promise<T> => {
    if (!navigator.locks) throw new Error('Safe reply saving needs Web Locks support.');
    return await navigator.locks.request(key, operation);
  });
  replyQueues.set(key, next);
  void next.finally(() => { if (replyQueues.get(key) === next) replyQueues.delete(key); }).catch(() => {});
  return next;
}


/** A note's attachment belongs to its original capture, including while storage is unavailable. */
export type MarginDraft = {
  anchor: QuoteAnchor; text: string; source?: SourceCapture; position?: number;
  threadId?: string; noteId?: string; revision?: number; mutation?: ReaderMutation;
};

// Retaining the actual journal preserves its private durable baseline and operation queue.
// This is document-lifetime recovery over the same IndexedDB store, not another database.
const documentJournals = new Map<string, { journal: ReaderJournal; bind(backend: Persistence): void }>();
export function documentJournal(namespace: string, backend: Persistence): ReaderJournal {
  const existing = documentJournals.get(namespace);
  if (existing) { existing.bind(backend); return existing.journal; }
  let current = backend;
  const journal = new ReaderJournal({ load: () => current.load(), save: state => current.save(state) });
  documentJournals.set(namespace, { journal, bind(next) { current = next; } });
  return journal;
}

/** Called inside the shared journal lock. Durable history/conflict is NOT an applied note. */
export async function applyIntendedNote(journal: ReaderJournal, mutation: ReaderMutation): Promise<void> {
  if (mutation.kind !== 'note' && mutation.kind !== 'keep') throw new Error('A note change is required.');
  await journal.retryPersistence();
  await journal.load();
  await journal.change(mutation); // Validates identity even for an idempotent replay.
  const applied = journal.state.pending.some(change => change.id === mutation.id) ||
    journal.state.acknowledged?.some(receipt => receipt.id === mutation.id);
  if (journal.unsaved || journal.state.conflicts.some(item => item.change.id === mutation.id) || !applied) {
    throw new Error('This note has not been applied. Its draft and change identity are preserved; review the conflict in Settings.');
  }
}

/** A resolution is not an applied note. Release only this exact retained draft
 * after the resolution itself is durable; preserve its text and original anchor. */
export function draftAfterResolution(journal: ReaderJournal, draft?: MarginDraft): MarginDraft | undefined {
  const mutation = draft?.mutation;
  if (!mutation || journal.unsaved || journal.state.conflicts.some(item => item.change.id === mutation.id)) return;
  const resolution = journal.state.resolutions?.find(item => item.change.id === mutation.id && item.resolution !== 'device-choice-recovered');
  if (!resolution) return;
  if (canonicalReplyData(resolution.change) !== canonicalReplyData(mutation)) throw new Error('This draft identity belongs to different content. The draft is preserved.');
  const next = structuredClone(draft!); delete next.mutation;
  const thread = journal.state.threads.find(item => item.id === mutation.threadId && !item.deletedAt);
  if (thread && thread.sourceUrl === (draft?.source?.url ?? thread.sourceUrl) && canonicalReplyData(thread.anchor) === canonicalReplyData(draft!.anchor)) {
    next.threadId = thread.id;
    const noteId = mutation.kind === 'keep' ? mutation.id + '-note' : mutation.kind === 'note' ? mutation.noteId : draft?.noteId;
    const note = thread.notes.find(item => item.id === noteId && !item.deletedAt);
    next.noteId = note?.id ?? crypto.randomUUID(); next.revision = note?.revision ?? 0;
  } else { delete next.threadId; delete next.noteId; delete next.revision; }
  return next;
}

/** Caller holds the shared journal lock. Never invoke a transport here. */
export async function retryDraftMutation(journal: ReaderJournal, draft: MarginDraft): Promise<
  { kind: 'applied' } | { kind: 'resolved'; draft: MarginDraft }
> {
  if (!draft.mutation) throw new Error('The draft has no saved change identity.');
  await journal.retryPersistence(); await journal.load();
  const resolved = draftAfterResolution(journal, draft);
  if (resolved) return { kind: 'resolved', draft: resolved };
  await applyIntendedNote(journal, draft.mutation);
  return { kind: 'applied' };
}

/** Explicit local choice. Failed saves remain unsaved in the real T07 journal. */
export async function keepDeviceConflict(journal: ReaderJournal, lock: (operation: () => Promise<void>) => Promise<void>, changeId: string) {
  await lock(async () => { await journal.load(); await journal.keepDeviceVersion(changeId); });
}

/** Serialize the helper read with current journal loading and reconciliation.
 * Remote merge monotonicity itself remains ReaderJournal/T07's responsibility. */
export async function resolveHelperConflict(
  journal: ReaderJournal,
  lock: (operation: () => Promise<void>) => Promise<void>,
  changeId: string,
  list: (change: ReaderMutation) => Promise<Thread[]>,
): Promise<void> {
  await lock(async () => {
    await journal.load();
    const conflict = journal.state.conflicts.find(item => item.change.id === changeId);
    if (!conflict) throw new Error('This conflict changed elsewhere. Reload before resolving it.');
    const remote = await list(structuredClone(conflict.change));
    await journal.resolveConflict(changeId, remote);
  });
}

/** Order an explicit final snapshot after all issued saves, even for A -> B -> A.
 * A recovered competing snapshot is preserved, but is not the active completed view. */
export function replySaveLifecycle(initial: ReplyState, save: (state: ReplyState) => Promise<void>) {
  let tail: Promise<void> = Promise.resolve(), closing: Promise<void> | undefined;
  let pending = 0, closed = false;
  let completed = canonicalReplyData(initial), preserved = completed;
  const recovered = (error: unknown) => error instanceof Error && error.name === 'RecoveredViewConflict';
  const enqueue = (state: ReplyState) => {
    const snapshot = structuredClone(state), key = canonicalReplyData(snapshot);
    pending++;
    const work = tail.then(async () => {
      try { await save(snapshot); completed = key; preserved = key; }
      catch (error) { if (recovered(error)) preserved = key; throw error; }
      finally { pending--; }
    });
    tail = work.catch(() => {});
    return work;
  };
  const flush = (state: ReplyState): Promise<void> => {
    if (closed) return closing ?? tail;
    if (!pending && canonicalReplyData(state) === preserved) return tail;
    return enqueue(state).catch(error => { if (!recovered(error)) throw error; });
  };
  return {
    save(state: ReplyState) { return closed ? Promise.resolve() : enqueue(state); },
    flush,
    close(state: ReplyState) {
      if (closing) return closing;
      closing = flush(state); // Enqueue before fencing later renderer callbacks.
      closed = true;
      return closing;
    },
    status: () => ({ pending, completed, preserved, closed }),
  };
}

type DraftIO = { read(): Promise<MarginDraft | undefined>; write(value: MarginDraft | undefined): Promise<void> };
function createDraftBuffer(io: DraftIO, source: SourceCapture) {
  let value: MarginDraft | undefined, known = false, generation = 0, dirty = false;
  let tail: Promise<void> = Promise.resolve(), pending = 0;
  const save = (next: MarginDraft | undefined) => {
    const snapshot = structuredClone(next), revision = ++generation, writer = io.write;
    value = snapshot; known = true; dirty = true; pending++;
    const work = tail.then(async () => {
      try { await writer(structuredClone(snapshot)); if (revision === generation) dirty = false; }
      finally { pending--; }
    });
    tail = work.catch(() => {});
    return work;
  };
  return {
    source: structuredClone(source),
    bind(next: DraftIO) { io = next; },
    async load() {
      if (!known) {
        const revision = generation, saved = await io.read();
        if (revision === generation && !known) { value = structuredClone(saved); known = true; }
      }
      return structuredClone(value);
    },
    get: () => structuredClone(value),
    unsaved: () => dirty,
    save,
    flush() { return dirty || pending ? save(value) : tail; },
  };
}
const draftBuffers = new Map<string, { namespace: string; key: string; buffer: ReturnType<typeof createDraftBuffer> }>();
export function documentDraft(namespace: string, key: string, source: SourceCapture, io: DraftIO) {
  const identity = JSON.stringify([namespace, key, source.url]);
  const existing = draftBuffers.get(identity);
  if (existing) { existing.buffer.bind(io); return existing.buffer; }
  const buffer = createDraftBuffer(io, source);
  draftBuffers.set(identity, { namespace, key, buffer });
  return buffer;
}
export function unsavedDrafts(namespace: string, sourceUrl?: string) {
  return [...draftBuffers.values()].filter(entry => entry.namespace === namespace && (sourceUrl === undefined || entry.buffer.source.url === sourceUrl) && entry.buffer.unsaved())
    .map(entry => ({ key: entry.key, source: structuredClone(entry.buffer.get()?.source ?? entry.buffer.source), draft: entry.buffer.get() ?? null, durable: false as const }));
}

/** Question drafts share the existing reader store, but retain failed values
 * in this document just like note drafts. A delayed read never beats typing. */
type QuestionIO = { read(): Promise<AskingSelection | undefined>; write(value: AskingSelection | undefined): Promise<void> };
function questionBuffer(io: QuestionIO) {
  let value: AskingSelection | undefined, known = false, dirty = false, revision = 0;
  let tail: Promise<void> = Promise.resolve();
  return {
    bind(next: QuestionIO) { io = next; },
    get: () => structuredClone(value), unsaved: () => dirty,
    async flush() {
      // Follow the tail if another input arrived during this write.
      let pending: Promise<void>;
      do { pending = tail; await pending; } while (pending !== tail);
      if (dirty) throw new Error('Your question is still unsaved. Keep it open and retry saving.');
    },
    async load() {
      if (!known) { const before = revision, saved = await io.read(); if (!known && before === revision) { value = structuredClone(saved); known = true; } }
      return structuredClone(value);
    },
    save(next: AskingSelection | undefined) {
      value = structuredClone(next); known = true; dirty = true;
      const saved = structuredClone(value), current = ++revision, write = io.write;
      const work = tail.catch(() => {}).then(async () => { await write(saved); if (current === revision) dirty = false; });
      tail = work; return work;
    },
  };
}
const questions = new Map<string, { namespace: string; sourceUrl: string; buffer: ReturnType<typeof questionBuffer> }>();
export function documentQuestion(namespace: string, key: string, sourceUrl: string, io: QuestionIO) {
  const identity = JSON.stringify([namespace, key, sourceUrl]), existing = questions.get(identity);
  if (existing) { existing.buffer.bind(io); return existing.buffer; }
  const buffer = questionBuffer(io); questions.set(identity, { namespace, sourceUrl, buffer }); return buffer;
}
export function unsavedQuestions(namespace: string, sourceUrl?: string) {
  return [...questions.values()].filter(item => item.namespace === namespace && (sourceUrl === undefined || sourceUrl === item.sourceUrl) && item.buffer.unsaved())
    .map(item => ({ sourceUrl: item.sourceUrl, draft: item.buffer.get() ?? null, durable: false as const }));
}

/** Orphan keeps carry source identity even when their Thread was never saved.
 * Infer other mutations only from an unambiguous recorded association, never from the current page. */
export function sourceBoundJournal(state: JournalState, sourceUrl: string, draft?: MarginDraft) {
  const sources = new Map<string, Set<string>>();
  const associate = (id: string, url: string) => { const values = sources.get(id) ?? new Set<string>(); values.add(url); sources.set(id, values); };
  for (const thread of state.threads) associate(thread.id, thread.sourceUrl);
  // An exact retained editor mutation carries its original capture even when its thread is absent.
  if (draft?.mutation && draft.source) associate(draft.mutation.threadId, draft.source.url);
  for (const resolution of state.resolutions ?? []) if (resolution.deviceVersion?.id === resolution.change.threadId) {
    associate(resolution.change.threadId, resolution.deviceVersion.sourceUrl);
  }
  const changes = [...state.pending, ...state.conflicts.map(item => item.change),
    ...(state.resolutions ?? []).flatMap(item => item.replacement ? [item.change, item.replacement] : [item.change])];
  for (const change of changes) if (change.kind === 'keep') associate(change.threadId, change.capture.url);
  const belongs = (change: ReaderMutation) => sources.get(change.threadId)?.size === 1 && sources.get(change.threadId)!.has(sourceUrl);
  const resolutions = (state.resolutions ?? []).filter(item => belongs(item.change) && (!item.replacement || belongs(item.replacement)) && (!item.deviceVersion || item.deviceVersion.id === item.change.threadId && item.deviceVersion.sourceUrl === sourceUrl));
  return structuredClone({ threads: state.threads.filter(thread => thread.sourceUrl === sourceUrl),
    pending: state.pending.filter(belongs), conflicts: state.conflicts.filter(item => belongs(item.change)), resolutions });
}

/** Only used inside the trusted local page or extension-origin margin. */
export function localPersistence(name = 'marginalia-reader') {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reader');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function read<T>(key: string): Promise<T | undefined> {
    const db = await database;
    return new Promise((resolve, reject) => {
      const request = db.transaction('reader').objectStore('reader').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function values<T>(prefix: string): Promise<T[]> {
    const db = await database;
    return new Promise((resolve, reject) => {
      const request = db.transaction('reader').objectStore('reader').getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async function write(key: string, value: unknown, stillCurrent?: () => boolean, signal?: AbortSignal): Promise<void> {
    const snapshot = structuredClone(value);
    const db = await database;
    if (signal?.aborted || (stillCurrent && !stillCurrent())) return;
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction | undefined;
      let terminal = false;
      let transactionFailure: unknown;
      let signalListener: (() => void) | undefined;
      const cleanup = () => {
        if (signal && signalListener) { signal.removeEventListener('abort', signalListener); signalListener = undefined; }
      };
      const requestAbort = () => {
        const active = transaction;
        if (terminal || !active) return;
        try { active.abort(); }
        catch (error) {
          if (!(error instanceof DOMException && error.name === 'InvalidStateError')) transactionFailure ??= error;
        }
      };
      try {
        const active = db.transaction('reader', 'readwrite'); transaction = active;
        if (!signal) {
          active.oncomplete = () => resolve();
          active.onerror = () => reject(active.error);
          active.onabort = () => reject(active.error ?? new Error('Saving was interrupted.'));
          active.objectStore('reader').put(snapshot, key);
          return;
        }
        active.onerror = () => { transactionFailure ??= active.error; };
        active.oncomplete = () => { terminal = true; cleanup(); if (transactionFailure) reject(new Error('Saving failed.')); else resolve(); };
        active.onabort = () => { terminal = true; cleanup(); reject(transactionFailure || active.error ? new Error('Saving failed.') : new Error('Saving was interrupted.')); };
        signalListener = requestAbort; signal.addEventListener('abort', signalListener, { once: true });
        if (signal.aborted) { requestAbort(); return; }
        const request = active.objectStore('reader').put(snapshot, key);
        request.onsuccess = () => { if (signal.aborted || (stillCurrent && !stillCurrent())) requestAbort(); };
      } catch (error) {
        terminal = true; cleanup(); reject(error);
      }
    });
  }
  const journal: Persistence = { load: () => read('journal'), save: value => write('journal', value) };
  const suggestionKey = (scope: string, exposureId: string) => `suggestion-exposure:${scope}:${exposureId}`;
  const suggestionPrefix = (scope: string) => `suggestion-exposure:${scope}:`;
  const pendingKey = (key: string) => JSON.stringify([name, key]);
  const receiptKey = (key: string) => 'marginalia-suggestion-pending:' + pendingKey(key);
  const rememberExposure = (key: string, record: SuggestionExposureRecord) => {
    pendingExposures.set(pendingKey(key), structuredClone(record));
    try { sessionStorage.setItem(receiptKey(key), JSON.stringify(record)); } catch { /* Memory-only recovery remains available. */ }
  };
  const pendingExposure = (key: string): SuggestionExposureRecord | undefined => {
    const memory = pendingExposures.get(pendingKey(key));
    if (memory) return memory;
    try {
      const raw = sessionStorage.getItem(receiptKey(key));
      if (!raw || raw.length > 4096) return;
      const saved: unknown = JSON.parse(raw);
      if (validSuggestionExposure(saved) && key.endsWith(':' + saved.exposureId)) return saved;
    } catch { /* Malformed receipts cannot interrupt reading. */ }
  };
  async function persistExposure(key: string, record: SuggestionExposureRecord) {
    await write(key, record);
    if (record.resolvedAt) knownExposures.delete(pendingKey(key));
    if (JSON.stringify(pendingExposures.get(pendingKey(key))) === JSON.stringify(record)) pendingExposures.delete(pendingKey(key));
    try {
      if (sessionStorage.getItem(receiptKey(key)) === JSON.stringify(record)) sessionStorage.removeItem(receiptKey(key));
    } catch { /* A stale identical receipt is idempotent. */ }
  }
  async function exposurePage(scope: string, after?: string) {
    const db = await database, prefix = suggestionPrefix(scope);
    if (after !== undefined && !after.startsWith(prefix)) throw new Error('Invalid exposure page cursor.');
    return new Promise<{ key: string; value: unknown }[]>((resolve, reject) => {
      const store = db.transaction('reader').objectStore('reader');
      const range = IDBKeyRange.bound(after ?? prefix, prefix + '\uffff', after !== undefined);
      const keys = store.getAllKeys(range, SUGGESTION_PAGE_SIZE), rows = store.getAll(range, SUGGESTION_PAGE_SIZE);
      let keyData: IDBValidKey[] | undefined, rowData: unknown[] | undefined;
      const done = () => { if (keyData && rowData) resolve(keyData.map((key, index) => ({ key: String(key), value: rowData![index] }))); };
      keys.onsuccess = () => { keyData = keys.result; done(); }; rows.onsuccess = () => { rowData = rows.result; done(); };
      keys.onerror = () => reject(keys.error); rows.onerror = () => reject(rows.error);
    });
  }
  const suggestions = {
    async record(scope: string, record: SuggestionExposureRecord): Promise<void> {
      if (!validSuggestionExposure(record)) throw new Error('The suggestion exposure is invalid.');
      const key = suggestionKey(scope, record.exposureId);
      knownExposures.set(pendingKey(key), structuredClone(record));
      rememberExposure(key, record);
      await persistExposure(key, record);
    },
    /** Append only newly displayed positions; caller serializes reveals before resolution. */
    async reveal(scope: string, exposureId: string, shown: SuggestionExposureRecord['shown']): Promise<SuggestionExposureRecord> {
      const key = suggestionKey(scope, exposureId), current = pendingExposure(key) ?? knownExposures.get(pendingKey(key)) ?? await read<unknown>(key);
      if (!validSuggestionExposure(current) || current.exposureId !== exposureId) throw new Error('The saved suggestion exposure is invalid.');
      if (current.resolvedAt) return current;
      if (shown.length < current.shown.length || current.shown.some((entry, index) =>
        entry.intent !== shown[index]?.intent || entry.label !== shown[index]?.label || entry.position !== shown[index]?.position)) throw new Error('Shown suggestions keep their original positions.');
      const revealed = { ...current, shown: structuredClone(shown) };
      if (!validSuggestionExposure(revealed)) throw new Error('The revealed suggestions are invalid.');
      rememberExposure(key, revealed); knownExposures.set(pendingKey(key), revealed);
      await persistExposure(key, revealed);
      return revealed;
    },
    async resolve(scope: string, exposureId: string, resolution: SuggestionExposureResolution, choice: string | null, resolvedAt: string, latencyMs: number | null): Promise<SuggestionExposureRecord | undefined> {
      const key = suggestionKey(scope, exposureId), current = pendingExposure(key) ?? knownExposures.get(pendingKey(key)) ?? await read<unknown>(key);
      if (!validSuggestionExposure(current) || current.exposureId !== exposureId) throw new Error('The saved suggestion exposure is invalid.');
      if (current.resolvedAt) { if (pendingExposure(key)) await persistExposure(key, current); return current; }
      const resolved = { ...current, resolvedAt, choice, resolution, latencyMs };
      if (!validSuggestionExposure(resolved)) throw new Error('The suggestion resolution is invalid.');
      rememberExposure(key, resolved);
      knownExposures.set(pendingKey(key), resolved);
      await persistExposure(key, resolved);
      return resolved;
    },
    unsaved(scope: string) { return [...pendingExposures].filter(([key]) => { const [namespace, storageKey] = JSON.parse(key); return namespace === name && storageKey.startsWith(suggestionPrefix(scope)); }).map(([, record]) => structuredClone(record)); },
    async retry(scope: string) {
      for (const record of suggestions.unsaved(scope)) await persistExposure(suggestionKey(scope, record.exposureId), record);
    },
    async recover(scope: string, resolvedAt: string, after?: string) {
      const recovered: SuggestionExposureRecord[] = [];
      const page = await exposurePage(scope, after);
      let invalid = 0, failed = 0;
      for (const { key, value } of page) {
        if (!validSuggestionExposure(value) || key !== suggestionKey(scope, value.exposureId)) { invalid++; continue; }
        if (Date.parse(value.shownAt) >= Date.parse(resolvedAt)) continue;
        const pending = pendingExposure(key);
        if (value.resolvedAt && !pending) continue;
        const resolved = pending?.resolvedAt ? pending : { ...(pending ?? value), resolvedAt, choice: null, resolution: 'page-closed' as const, latencyMs: null };
        if (!validSuggestionExposure(resolved)) { invalid++; continue; }
        rememberExposure(key, resolved);
        try { await persistExposure(key, resolved); recovered.push(resolved); } catch { failed++; }
      }
      return { recovered, invalid, failed, next: page.length === SUGGESTION_PAGE_SIZE ? page.at(-1)!.key : undefined };
    },
    async list(scope: string, after?: string): Promise<SuggestionExposureRecord[]> {
      return (await exposurePage(scope, after)).filter(({ key, value }) => validSuggestionExposure(value) && key === suggestionKey(scope, value.exposureId)).map(({ value }) => value as SuggestionExposureRecord);
    },
  };
  const replyKey = (origin: string, threadId: string, replyId: string) => 'reply:' + JSON.stringify([origin, threadId, replyId]);
  const withReply = <T>(key: string, operation: () => Promise<T>) => replyLock(name + ':' + key, operation);
  const historyPrefix = (key: string) => 'reply-history:' + key + ':';
  async function history(key: string): Promise<ReplyHistory[]> {
    const db = await database, prefix = historyPrefix(key);
    return new Promise((resolve, reject) => {
      const request = db.transaction('reader').objectStore('reader').getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  /** Atomically migrate/append history beside the small, frequently written view.
   * Equal state content deduplicates; unique edits and rejected IDs are never pruned. */
  async function writeReply(key: string, record: CachedReply, stillCurrent?: () => boolean): Promise<void> {
    const snapshot = structuredClone(record);
    const items: ReplyHistory[] = [
      ...(snapshot.recovered ?? []).map(value => ({ kind: 'recovered' as const, value })),
      ...(snapshot.rejected ?? []).map(value => ({ kind: 'rejected' as const, value })),
    ];
    delete snapshot.recovered; delete snapshot.rejected;
    const entries = await Promise.all(items.map(async item => {
      const content = canonicalReplyData(item.kind === 'recovered' ? { kind: item.kind, state: item.value.state } : item);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)));
      return { key: historyPrefix(key) + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), item };
    }));
    const db = await database;
    if (stillCurrent && !stillCurrent()) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('reader', 'readwrite'), store = transaction.objectStore('reader');
      for (const entry of entries) store.put(entry.item, entry.key);
      store.put(snapshot, key);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving was interrupted.'));
    });
  }
  const replies = {
    refresh(origin: string, threadId: string, operation: () => Promise<void>): Promise<void> {
      // Include the read, not only the cache writes, in cross-document ordering.
      return withReply('reply-refresh:' + JSON.stringify([origin, threadId]), operation);
    },
    async list(threadId: string): Promise<CachedReply[]> {
      const keys = await read<string[]>('reply-index:' + threadId) ?? [];
      const records = await Promise.all(keys.map(key => withReply(key, async () => {
        const record = await read<CachedReply>(key);
        if (!record) return;
        for (const item of await history(key)) {
          if (item.kind === 'recovered') (record.recovered ??= []).push(item.value);
          else (record.rejected ??= []).push(item.value);
        }
        return record;
      })));
      return records.filter((record): record is CachedReply => !!record && record.version.threadId === threadId);
    },
    async cache(origin: string, threadId: string, source: SourceVersion, versions: ReplyVersion[], views: ReplyViewState[], generations?: Record<string, Record<string, SampleGenerationRecord>>) {
      const keys: string[] = [];
      for (const version of versions) {
        if (version.threadId !== threadId) throw new Error('Reply belongs to a different thread.');
        const remoteView = views.find(view => view.replyVersionId === version.id);
        if (!remoteView) throw new Error('The saved reply view is unavailable.');
        const key = replyKey(origin, threadId, version.id); keys.push(key);
        await withReply(key, async () => {
          const prior = await read<CachedReply>(key);
          if (prior && (prior.version.hash !== version.hash || prior.source.id !== source.id || prior.source.hash !== source.hash)) throw new Error('The saved reply identity changed. Cached work was preserved.');
          const record: CachedReply = prior ?? { origin, version, source, remoteView, local: { parameters: remoteView.parameters, view: remoteView.view }, localRevision: 1, dirty: false };
          // Lineage warnings are monotonic: an older response or helper cannot erase them.
          const corrections = new Map([...(record.version.corrections ?? []), ...(version.corrections ?? [])]
            .map(item => [JSON.stringify([item.ancestorId, item.correctionId]), item]));
          if (version.revision >= record.version.revision) {
            if (version.revision > record.version.revision && record.removal?.status === 'acknowledged' &&
              !!version.deletedAt !== record.removal.desiredRemoved) record.removal.status = 'conflict';
            record.version = { ...version, corrections: [...corrections.values()] };
          }
          else record.version = { ...record.version, corrections: [...corrections.values()] };
          if (remoteView.revision >= record.remoteView.revision) {
            // Do not silently replace a live editor's backing view during a read.
            // Adoption is the explicit useRemote operation; local CAS stays valid.
            if (!record.pending && remoteView.revision !== record.remoteView.revision && JSON.stringify(record.local) !== JSON.stringify({ parameters: remoteView.parameters, view: remoteView.view })) record.conflict = true;
            record.remoteView = remoteView;
          }
          if (generations?.[version.id]) record.sampleGenerationRecords = generations[version.id];
          await writeReply(key, record);
        });
      }
      await withReply('reply-index:' + threadId, async () => {
        const existing = await read<string[]>('reply-index:' + threadId) ?? [];
        // Removal comes only from versioned helper tombstones, never list absence.
        await write('reply-index:' + threadId, [...new Set([...existing, ...keys])]);
      });
    },
    async open(record: CachedReply) {
      const key = replyKey(record.origin, record.version.threadId, record.version.id);
      const current = await withReply(key, () => read<CachedReply>(key));
      if (!current) throw new Error('This saved reply is no longer available on this device.');
      let revision = current.localRevision;
      const recoveryId = crypto.randomUUID();
      return {
        record: current,
        save(state: ReplyState) {
          const snapshot = structuredClone(state);
          const recovery = { id: recoveryId, state: snapshot, savedAt: new Date().toISOString() };
          unsavedReplyViews.set(name + ':' + recoveryId, { namespace: name, record: current, recovery });
          const saved = () => { if (unsavedReplyViews.get(name + ':' + recoveryId)?.recovery === recovery) unsavedReplyViews.delete(name + ':' + recoveryId); };
          return withReply(key, async () => {
            const latest = await read<CachedReply>(key);
            if (!latest) throw new Error('This saved reply is unavailable.');
            if (latest.localRevision !== revision) {
              const recovered = latest.recovered ??= [];
              const index = recovered.findIndex(item => item.id === recoveryId);
              if (index < 0) recovered.push(recovery); else recovered[index] = recovery;
              await writeReply(key, latest);
              saved();
              const error = new Error('This view changed in another margin. Your inputs were kept in its recovery export.'); error.name = 'RecoveredViewConflict'; throw error;
            }
            latest.local = snapshot; latest.localRevision++; latest.dirty = true;
            await writeReply(key, latest); revision = latest.localRevision; saved();
          });
        },
      };
    },
    async sync(record: CachedReply, send: (change: ReplyViewChange) => Promise<ReplyViewState>) {
      const key = replyKey(record.origin, record.version.threadId, record.version.id);
      return withReply(key, async () => {
        const latest = await read<CachedReply>(key);
        if (!latest || !latest.dirty) return;
        if (latest.conflict) throw new Error('This reply view changed elsewhere. Export your local inputs or explicitly use the helper view before saving again.');
        // Keep the request identity through uncertain responses and reloads.
        latest.pending ??= { id: crypto.randomUUID(), replyVersionId: latest.version.id, expectedRevision: latest.remoteView.revision, ...structuredClone(latest.local) };
        await writeReply(key, latest);
        let remote: ReplyViewState;
        try { remote = await send(latest.pending); }
        catch (error) { if (error instanceof Error && error.name === 'Conflict') { latest.conflict = true; (latest.rejected ??= []).push(latest.pending); delete latest.pending; await writeReply(key, latest); } throw error; }
        if (remote.replyVersionId !== latest.version.id) throw new Error('The helper returned a different reply view.');
        const sent = latest.pending;
        delete latest.pending;
        // An idempotent receipt may describe an earlier successful save, while a
        // later authenticated refresh already observed another writer's revision.
        if (remote.revision < latest.remoteView.revision) {
          latest.dirty = true; latest.conflict = true;
          await writeReply(key, latest);
          throw new Error('Your earlier view reached the helper, but a newer version exists. Local inputs remain preserved.');
        }
        latest.remoteView = remote;
        latest.dirty = JSON.stringify(latest.local) !== JSON.stringify({ parameters: sent.parameters, view: sent.view });
        await writeReply(key, latest);
      });
    },
    async useRemote(record: CachedReply, liveState: ReplyState, fetchRemote: () => Promise<ReplyViewState>) {
      const live = structuredClone(liveState);
      const key = replyKey(record.origin, record.version.threadId, record.version.id);
      await withReply(key, async () => {
        const latest = await read<CachedReply>(key);
        if (latest?.pending) throw new Error('An earlier view save has an uncertain result. Use Save view to helper to finish that same request before restoring.');
        const remote = await fetchRemote();
        if (!latest || remote.replyVersionId !== latest.version.id) throw new Error('This saved reply is unavailable.');
        if (remote.revision < latest.remoteView.revision) throw new Error('The helper returned an older view. Local inputs were preserved; try loading the helper view again.');
        (latest.recovered ??= []).push({ state: latest.local, savedAt: new Date().toISOString() });
        latest.recovered.push({ state: live, savedAt: new Date().toISOString() });
        latest.remoteView = remote; latest.local = { parameters: remote.parameters, view: remote.view }; latest.localRevision++;
        latest.dirty = false; delete latest.pending; delete latest.conflict;
        await writeReply(key, latest);
      });
    },
    async setRemoved(record: CachedReply, removed: boolean): Promise<CachedReply> {
      const key = replyKey(record.origin, record.version.threadId, record.version.id);
      return withReply(key, async () => {
        const latest = await read<CachedReply>(key);
        if (!latest) throw new Error('This saved reply is unavailable.');
        if (replyIsRemoved(latest) === removed) return latest;
        const previous = latest.removal;
        if (previous?.status === 'pending') {
          // Keep the sent body intact until its receipt is recovered explicitly.
          previous.queuedRemoved = removed;
          await writeReply(key, latest);
          return latest;
        }
        // Undo of an unsent operation cancels that local intent. No helper revision
        // or operation identity was consumed, so there is no restore to upload.
        if (previous?.status === 'local' && previous.desiredRemoved !== removed) {
          delete latest.removal;
          await writeReply(key, latest);
          return latest;
        }
        if (previous) (latest.removalHistory ??= []).push(structuredClone(previous));
        latest.removal = {
          operationId: crypto.randomUUID(), replyVersionId: latest.version.id,
          desiredRemoved: removed, expectedRevision: latest.version.revision, status: 'local',
        };
        await writeReply(key, latest);
        return latest;
      });
    },
    async syncRemoval(record: CachedReply, send: (change: ReplyRemovalChange) => Promise<ReplyVersion>): Promise<CachedReply> {
      const key = replyKey(record.origin, record.version.threadId, record.version.id);
      return withReply(key, async () => {
        const latest = await read<CachedReply>(key);
        if (!latest?.removal || latest.removal.status === 'acknowledged') return latest ?? record;
        if (latest.removal.status === 'conflict') throw Object.assign(new Error('This reply changed elsewhere. Your choice is kept here.'), { name: 'Conflict' });
        while (latest.removal.status !== 'acknowledged') {
          latest.removal.status = 'pending';
          await writeReply(key, latest);
          const operation: ReplyRemovalRecord = structuredClone(latest.removal);
          let remote: ReplyVersion;
          try {
            remote = await send({ id: operation.operationId, threadId: latest.version.threadId,
              replyVersionId: operation.replyVersionId, removed: operation.desiredRemoved,
              expectedRevision: operation.expectedRevision });
          } catch (error) {
            if (error instanceof Error && (error.name === 'Conflict' || error.name === 'ConflictError')) {
              latest.removal.status = 'conflict';
              await writeReply(key, latest);
            }
            throw error;
          }
          if (remote.id !== latest.version.id || remote.threadId !== latest.version.threadId ||
            remote.revision <= operation.expectedRevision || !!remote.deletedAt !== operation.desiredRemoved) {
            throw new Error('The helper returned a different reply removal. Your choice is kept here.');
          }
          if (remote.revision < latest.version.revision) {
            latest.removal.status = 'conflict';
            await writeReply(key, latest);
            throw Object.assign(new Error('This reply changed elsewhere. Your choice is kept here.'), { name: 'Conflict' });
          }
          latest.version = remote;
          latest.removal.status = 'acknowledged';
          const queued: boolean | undefined = latest.removal.queuedRemoved;
          delete latest.removal.queuedRemoved;
          if (queued !== undefined && queued !== operation.desiredRemoved) {
            (latest.removalHistory ??= []).push(structuredClone(latest.removal));
            latest.removal = { operationId: crypto.randomUUID(), replyVersionId: remote.id,
              desiredRemoved: queued, expectedRevision: remote.revision, status: 'local' };
          }
          await writeReply(key, latest);
        }
        return latest;
      });
    },
    async report(record: CachedReply, parameters: Readonly<Record<string, number>>, report: HostCheckReport, isCurrent: () => boolean) {
      const key = replyKey(record.origin, record.version.threadId, record.version.id);
      const parameterKey = canonicalReplyData(parameters);
      await withReply(key, async () => { const latest = await read<CachedReply>(key); if (latest && isCurrent()) { (latest.reports ??= {})[parameterKey] = report; await writeReply(key, latest, isCurrent); } });
    },
    unsaved(threadId: string) { return [...unsavedReplyViews.values()].filter(item => item.namespace === name && item.record.version.threadId === threadId).map(item => structuredClone(item)); },
  };
  const library = {
    async restore(origin: string, thread: Thread, send: (change: ReaderMutation) => Promise<void>, list: () => Promise<Thread[]>): Promise<Thread> {
      const key = 'library-restore:' + JSON.stringify([origin, thread.id]);
      return withReply(key, async () => {
        let pending = await read<ReaderMutation>(key);
        if (!pending) {
          if (!thread.deletedAt) throw new Error('Only a removed thread can be restored here.');
          pending = { id: crypto.randomUUID(), kind: 'remove', threadId: thread.id, removed: false, expectedRevision: thread.revision };
          await write(key, pending); // Stable identity before the helper side effect.
        }
        if (pending.kind !== 'remove' || pending.removed || pending.threadId !== thread.id) throw new Error('The saved restore request does not match this thread.');
        try { await send(structuredClone(pending)); }
        catch (error) {
          if (error instanceof Error && error.name === 'Conflict') await write(key, undefined);
          throw error; // Transport uncertainty retains exactly this request.
        }
        const canonical = (await list()).find(candidate => candidate.id === thread.id);
        if (!canonical || canonical.deletedAt || !Number.isSafeInteger(canonical.revision) || canonical.revision <= pending.expectedRevision || canonical.sourceUrl !== thread.sourceUrl || canonical.sourceVersionId !== thread.sourceVersionId) {
          if (canonical && canonical.revision > pending.expectedRevision) await write(key, undefined); // Confirmed old restore was superseded; a new choice needs a fresh revision.
          throw new Error('The helper has not confirmed a current restored thread. Reload the library before choosing another action.');
        }
        await write(key, undefined);
        return canonical;
      });
    },
  };
  return { read, write, values, journal, suggestions, replies, library };
}

/** One installation-local display receipt, separate from permission and reviewed content. */
export const runtimeDisclosureReceipt = {
  read(): string | null { try { return localStorage.getItem('marginalia-runtime-disclosure-version'); } catch { return null; } },
  shown(version: string): void { try { localStorage.setItem('marginalia-runtime-disclosure-version', version); } catch { /* Display remains nonblocking when storage is unavailable. */ } },
};

export const INSTANT_ONBOARDING_RECEIPT_KEY = 'instant-help-onboarding:v1';
export type ReaderKeyValueStore = {
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: unknown): Promise<void>;
};

/** A display receipt in the reader's existing local store. It grants no send authority. */
export function instantOnboardingReceipt(store: ReaderKeyValueStore) {
  return {
    async dismissed(): Promise<boolean> {
      const value = await store.read<unknown>(INSTANT_ONBOARDING_RECEIPT_KEY);
      return !!value && typeof value === 'object' && !Array.isArray(value)
        && (value as { version?: unknown }).version === 1
        && typeof (value as { dismissedAt?: unknown }).dismissedAt === 'string'
        && Number.isFinite(Date.parse((value as { dismissedAt: string }).dismissedAt));
    },
    dismiss(): Promise<void> {
      return store.write(INSTANT_ONBOARDING_RECEIPT_KEY, { version: 1, dismissedAt: new Date().toISOString() });
    },
  };
}
