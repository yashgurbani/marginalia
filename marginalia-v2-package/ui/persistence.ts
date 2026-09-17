import type { Persistence } from './journal.ts';
import type { ReplyVersion, ReplyViewState, SourceVersion } from '../contracts/reader.ts';
import type { HostCheckReport } from '../contracts/host-checks.ts';
import type { SampleGenerationRecord } from '../contracts/sample-provenance.ts';
import { canonicalReplyData } from '../contracts/reply.ts';

export type ReplyState = Pick<ReplyViewState, 'parameters' | 'view'>;
export type ReplyViewChange = ReplyState & { id: string; replyVersionId: string; expectedRevision: number };
type RecoveredView = { id?: string; state: ReplyState; savedAt: string };
type ReplyHistory = { kind: 'recovered'; value: RecoveredView } | { kind: 'rejected'; value: ReplyViewChange };
export type CachedReply = {
  origin: string; version: ReplyVersion; source: SourceVersion;
  remoteView: ReplyViewState; local: ReplyState; localRevision: number; dirty: boolean;
  pending?: ReplyViewChange; conflict?: boolean; report?: HostCheckReport;
  reports?: Record<string, HostCheckReport>;
  sampleGenerationRecords?: Record<string, SampleGenerationRecord>;
  recovered?: RecoveredView[];
  rejected?: ReplyViewChange[];
};
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
  async function write(key: string, value: unknown, stillCurrent?: () => boolean): Promise<void> {
    const snapshot = structuredClone(value);
    const db = await database;
    if (stillCurrent && !stillCurrent()) return;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('reader', 'readwrite');
      transaction.objectStore('reader').put(snapshot, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving was interrupted.'));
    });
  }
  const journal: Persistence = { load: () => read('journal'), save: value => write('journal', value) };
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
          if (version.revision >= record.version.revision) record.version = version;
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
    async report(record: CachedReply, parameters: Readonly<Record<string, number>>, report: HostCheckReport, isCurrent: () => boolean) {
      const key = replyKey(record.origin, record.version.threadId, record.version.id);
      const parameterKey = canonicalReplyData(parameters);
      await withReply(key, async () => { const latest = await read<CachedReply>(key); if (latest && isCurrent()) { (latest.reports ??= {})[parameterKey] = report; await writeReply(key, latest, isCurrent); } });
    },
    unsaved(threadId: string) { return [...unsavedReplyViews.values()].filter(item => item.namespace === name && item.record.version.threadId === threadId).map(item => structuredClone(item)); },
  };
  return { read, write, journal, replies };
}
