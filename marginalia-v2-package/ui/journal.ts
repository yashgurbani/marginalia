import type { ReaderMutation, Thread } from '../contracts/reader.ts';

export type JournalConflict = { change: ReaderMutation; message: string };
export type ConflictResolution = {
  change: ReaderMutation;
  message: string;
  resolvedAt: string;
  resolution: 'accepted-remote' | 'replaced';
  replacement?: ReaderMutation;
};
export type MutationReceipt = { id: string; fingerprint: string };
export type JournalState = {
  threads: Thread[];
  pending: ReaderMutation[];
  conflicts: JournalConflict[];
  /** Kept optional so journals written before conflict history remain readable. */
  resolutions?: ConflictResolution[];
  /** Durable canonical identity history prevents acknowledged changes being applied twice. */
  acknowledged?: MutationReceipt[];
};
/** Callers sharing storage across tabs must serialize complete journal operations with the same lock. */
export type Persistence = {
  load: () => Promise<JournalState | undefined>;
  save: (value: JournalState) => Promise<void>;
};

const emptyState = (): JournalState => ({ threads: [], pending: [], conflicts: [], resolutions: [], acknowledged: [] });

export class ReaderJournal {
  state: JournalState = emptyState();
  unsaved = false;
  persistenceError: Error | undefined;
  private persistence: Persistence;
  private operations: Promise<unknown> = Promise.resolve();
  private durableBaseline: string | undefined;

  constructor(persistence: Persistence) { this.persistence = persistence; }

  async load() {
    return this.enqueue(async () => {
      if (this.unsaved) return this.state;
      try {
        const loaded = await this.persistence.load();
        if (loaded) this.state = normalizeState(loaded);
        this.durableBaseline = durableFingerprint(loaded);
        this.persistenceError = undefined;
        return this.state;
      } catch (error) {
        this.persistenceError = asError(error);
        throw error;
      }
    });
  }

  async retryPersistence() {
    return this.enqueue(async () => {
      if (!this.unsaved) return this.state;
      await this.verifyDurableBaseline();
      if (this.unsaved) await this.persist(this.state);
      return this.state;
    });
  }

  async change(mutation: ReaderMutation) {
    const change = structuredClone(mutation);
    await this.enqueue(async () => {
      await this.ensureDurableStateInitialized();
      const known = findKnownFingerprint(this.state, change.id);
      if (known) {
        if (known !== mutationFingerprint(change)) throw new Error('This change identifier was already used for different content.');
        if (this.unsaved) {
          await this.verifyDurableBaseline();
          if (this.unsaved) await this.persist(this.state);
        }
        return;
      }

      const applyAndPersist = async () => {
        if (this.unsaved) await this.verifyDurableBaseline();
        const next = structuredClone(this.state);
        applyMutation(next, change);
        next.pending.push(change);
        await this.persist(next);
      };
      await applyAndPersist();
    });
  }

  async sync(send: (change: ReaderMutation) => Promise<void>, list: () => Promise<Thread[]>) {
    await this.enqueue(async () => {
      await this.ensureDurableStateInitialized();
      this.requireDurable();

      while (true) {
        const index = this.nextSendableIndex();
        if (index < 0) break;
        const change = this.state.pending[index];
        try {
          await send(structuredClone(change));
        } catch (error) {
          if (!isConflict(error)) throw error;
          const next = structuredClone(this.state);
          next.pending.splice(index, 1);
          addConflict(next, change, asError(error).message);
          await this.persist(next);
          continue;
        }

        const next = structuredClone(this.state);
        next.pending.splice(index, 1);
        addAcknowledgement(next, change);
        await this.persist(next);
      }

      const remote = structuredClone(await list());
      const next = structuredClone(this.state);
      next.threads = mergeRemoteThreads(next, remote);
      await this.persist(next);
    });
  }

  async resolveConflict(changeId: string, remoteThreads: Thread[], replacement?: ReaderMutation) {
    const remote = structuredClone(remoteThreads);
    const replacementChange = replacement === undefined ? undefined : structuredClone(replacement);
    await this.enqueue(async () => {
      await this.ensureDurableStateInitialized();
      this.requireDurable();
      const conflictIndex = this.state.conflicts.findIndex(({ change }) => change.id === changeId);
      if (conflictIndex < 0) throw new Error('The conflicting draft could not be found.');
      const conflict = this.state.conflicts[conflictIndex];

      if (replacementChange) {
        if (replacementChange.id === conflict.change.id) throw new Error('A replacement needs a new change identifier.');
        if (replacementChange.threadId !== conflict.change.threadId) throw new Error('A replacement must belong to the same thread.');
        if (findKnownFingerprint(this.state, replacementChange.id)) throw new Error('A replacement needs a new change identifier.');
      }

      const next = structuredClone(this.state);
      next.conflicts.splice(conflictIndex, 1);

      const dependent = next.pending.filter(change => change.threadId === conflict.change.threadId);
      next.pending = next.pending.filter(change => change.threadId !== conflict.change.threadId);
      for (const draft of dependent) {
        addConflict(next, draft, 'This draft depends on an edit that changed elsewhere. Review the saved version before replacing it.');
      }

      const protectedThreads = new Set([
        ...next.pending.map(change => change.threadId),
        ...next.conflicts.map(({ change }) => change.threadId),
      ]);
      protectedThreads.delete(conflict.change.threadId);
      next.threads = mergeRemoteThreads(next, remote, protectedThreads);

      if (replacementChange) {
        applyMutation(next, replacementChange);
        next.pending.push(replacementChange);
      }
      (next.resolutions ??= []).push({
        change: structuredClone(conflict.change),
        message: conflict.message,
        resolvedAt: new Date().toISOString(),
        resolution: replacementChange ? 'replaced' : 'accepted-remote',
        ...(replacementChange ? { replacement: structuredClone(replacementChange) } : {}),
      });
      await this.persist(next);
    });
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.operations.then(operation);
    this.operations = queued.catch(() => {});
    return queued;
  }

  private async persist(next: JournalState) {
    this.state = normalizeState(next);
    this.unsaved = true;
    this.persistenceError = undefined;
    try {
      await this.persistence.save(structuredClone(this.state));
      this.unsaved = false;
      this.durableBaseline = durableFingerprint(this.state);
    } catch (error) {
      this.persistenceError = asError(error);
      throw error;
    }
  }

  private requireDurable() {
    if (!this.unsaved) return;
    const error = new Error('Local changes are not durable yet. Retry persistence before synchronizing.');
    if (this.persistenceError) error.cause = this.persistenceError;
    throw error;
  }

  private async ensureDurableStateInitialized() {
    if (this.durableBaseline !== undefined) return;
    try {
      const loaded = await this.persistence.load();
      if (loaded) this.state = normalizeState(loaded);
      this.durableBaseline = durableFingerprint(loaded);
      this.persistenceError = undefined;
    } catch (error) {
      this.persistenceError = asError(error);
      throw error;
    }
  }

  private async verifyDurableBaseline() {
    try {
      const durable = await this.persistence.load();
      const current = durableFingerprint(durable);
      const desired = durableFingerprint(this.state);
      if (current === desired) {
        this.unsaved = false;
        this.persistenceError = undefined;
        this.durableBaseline = current;
        return;
      }
      if (this.durableBaseline !== undefined && current === this.durableBaseline) return;
      const error = new Error('Local storage changed elsewhere. Your unsaved draft was kept; reconcile it before retrying.');
      this.persistenceError = error;
      throw error;
    } catch (error) {
      this.persistenceError = asError(error);
      throw error;
    }
  }

  private nextSendableIndex() {
    const blockedThreads = new Set(this.state.conflicts.map(({ change }) => change.threadId));
    const explicitReplacements = new Set((this.state.resolutions ?? []).flatMap(resolution =>
      resolution.replacement ? [resolution.replacement.id] : []));
    return this.state.pending.findIndex(change => !blockedThreads.has(change.threadId) || explicitReplacements.has(change.id));
  }
}

function normalizeState(state: JournalState): JournalState {
  const cloned = structuredClone(state);
  cloned.threads ??= [];
  cloned.pending ??= [];
  cloned.conflicts ??= [];
  cloned.resolutions ??= [];
  cloned.acknowledged ??= [];

  const acknowledged = new Map<string, MutationReceipt>();
  for (const receipt of cloned.acknowledged) {
    const previous = acknowledged.get(receipt.id);
    if (previous && previous.fingerprint !== receipt.fingerprint) duplicateIdError();
    acknowledged.set(receipt.id, receipt);
  }
  cloned.acknowledged = [...acknowledged.values()];

  const conflicts = new Map<string, JournalConflict>();
  for (const conflict of cloned.conflicts) {
    const previous = conflicts.get(conflict.change.id);
    if (previous && !sameMutation(previous.change, conflict.change)) duplicateIdError();
    if (!previous) conflicts.set(conflict.change.id, conflict);
  }
  cloned.conflicts = [...conflicts.values()];

  const pending = new Map<string, ReaderMutation>();
  for (const change of cloned.pending) {
    const conflicting = conflicts.get(change.id);
    if (conflicting) {
      if (!sameMutation(conflicting.change, change)) duplicateIdError();
      continue;
    }
    const receipt = acknowledged.get(change.id);
    if (receipt) {
      if (receipt.fingerprint !== mutationFingerprint(change)) duplicateIdError();
      continue;
    }
    const previous = pending.get(change.id);
    if (previous && !sameMutation(previous, change)) duplicateIdError();
    if (!previous) pending.set(change.id, change);
  }
  cloned.pending = [...pending.values()];
  return cloned;
}

function applyMutation(state: JournalState, mutation: ReaderMutation) {
  const now = new Date().toISOString();
  if (mutation.kind === 'keep') {
    if (state.threads.some(thread => thread.id === mutation.threadId)) throw new Error('This passage was already saved.');
    state.threads.push({
      id: mutation.threadId,
      anchorId: mutation.threadId + '-anchor',
      sourceVersionId: '',
      sourceUrl: mutation.capture.url,
      sourceTitle: mutation.capture.title,
      state: 'open',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      anchor: structuredClone(mutation.anchor),
      highlighted: !('kind' in mutation.anchor && mutation.anchor.kind === 'whole-page'),
      notes: mutation.note ? [{ id: mutation.id + '-note', threadId: mutation.threadId, text: mutation.note, revision: 1, createdAt: now, deletedAt: null }] : [],
    });
    return;
  }

  const thread = state.threads.find(candidate => candidate.id === mutation.threadId);
  if (!thread) throw new Error('The saved passage could not be found.');
  if (mutation.kind === 'note') {
    if (thread.deletedAt) throw new Error('Restore the thread before editing it.');
    const note = thread.notes.find(candidate => candidate.id === mutation.noteId);
    if ((note?.revision ?? 0) !== mutation.expectedRevision) throw new Error('The note changed. Keep your draft and reopen the saved version.');
    if (note) {
      note.text = mutation.text;
      note.revision++;
    } else {
      thread.notes.push({ id: mutation.noteId, threadId: mutation.threadId, text: mutation.text, revision: 1, createdAt: now, deletedAt: null });
    }
  } else {
    if (thread.revision !== mutation.expectedRevision) throw new Error('This thread changed. Reopen it before applying the change.');
    if (mutation.kind === 'thread-state') thread.state = mutation.state;
    else thread.deletedAt = mutation.removed ? now : null;
  }
  thread.revision++;
  thread.updatedAt = now;
}

function mergeRemoteThreads(state: JournalState, remote: Thread[], protectedOverride?: Set<string>) {
  const protectedThreads = protectedOverride ?? new Set([
    ...state.pending.map(change => change.threadId),
    ...state.conflicts.map(({ change }) => change.threadId),
  ]);
  const local = new Map(state.threads.map(thread => [thread.id, thread]));
  const merged = remote.map(thread => protectedThreads.has(thread.id) && local.has(thread.id) ? local.get(thread.id)! : thread);
  const present = new Set(merged.map(thread => thread.id));
  for (const thread of state.threads) {
    if (protectedThreads.has(thread.id) && !present.has(thread.id)) merged.push(thread);
  }
  return structuredClone(merged);
}

function addConflict(state: JournalState, change: ReaderMutation, message: string) {
  const existing = state.conflicts.find(conflict => conflict.change.id === change.id);
  if (existing) {
    if (!sameMutation(existing.change, change)) throw new Error('This change identifier was already used for different content.');
    return;
  }
  state.conflicts.push({ change: structuredClone(change), message });
}

function findKnownFingerprint(state: JournalState, id: string): string | undefined {
  const pending = state.pending.find(change => change.id === id);
  if (pending) return mutationFingerprint(pending);
  const conflict = state.conflicts.find(item => item.change.id === id)?.change;
  if (conflict) return mutationFingerprint(conflict);
  for (const resolution of state.resolutions ?? []) {
    if (resolution.change.id === id) return mutationFingerprint(resolution.change);
    if (resolution.replacement?.id === id) return mutationFingerprint(resolution.replacement);
  }
  return state.acknowledged?.find(receipt => receipt.id === id)?.fingerprint;
}

function sameMutation(left: ReaderMutation, right: ReaderMutation) {
  return mutationFingerprint(left) === mutationFingerprint(right);
}

function mutationFingerprint(mutation: ReaderMutation) {
  return canonicalJson(JSON.parse(JSON.stringify(mutation)));
}

function durableFingerprint(state: JournalState | undefined) {
  return state === undefined ? 'missing' : `state:${canonicalJson(JSON.parse(JSON.stringify(state)))}`;
}

function addAcknowledgement(state: JournalState, change: ReaderMutation) {
  const fingerprint = mutationFingerprint(change);
  const previous = state.acknowledged?.find(receipt => receipt.id === change.id);
  if (previous) {
    if (previous.fingerprint !== fingerprint) duplicateIdError();
    return;
  }
  (state.acknowledged ??= []).push({ id: change.id, fingerprint });
}

function duplicateIdError(): never {
  throw new Error('This change identifier was already used for different content.');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isConflict(error: unknown) {
  return error instanceof Error && (error.name === 'Conflict' || error.name === 'ConflictError' || error.constructor.name === 'ConflictError');
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
