import { validateReaderMutation, type ReaderMutation, type Thread } from '../contracts/reader.ts';

export type JournalConflict = { change: ReaderMutation; message: string; disposition?: 'invalid-change' };
export type ConflictResolution = {
  change: ReaderMutation;
  message: string;
  resolvedAt: string;
  resolution: 'accepted-remote' | 'replaced' | 'kept-device' | 'device-choice-recovered';
  /** Snapshot selected locally, not a helper acknowledgement or an upload. Null preserves absence. */
  deviceVersion?: Thread | null;
  /** Explicitly superseded choices; references make history independent of merge order. */
  releasesDeviceChoices?: string[];
  replacement?: ReaderMutation;
  disposition?: 'invalid-change';
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

  /** Caller must hold the same cross-tab lock used for load, change and sync. */
  async reconcilePersistence(): Promise<JournalState> {
    return this.enqueue(async () => {
      if (!this.unsaved) throw new Error('There are no unsaved local changes to reconcile.');

      const local = structuredClone(this.state);
      const baseline = this.durableBaseline;
      let durable: JournalState | undefined;
      try {
        durable = await this.persistence.load();
      } catch (error) {
        this.persistenceError = asError(error);
        throw error;
      }
      if (!durable) {
        const error = new Error('The durable journal is missing. Your unsaved changes were kept in memory.');
        this.persistenceError = error;
        throw error;
      }

      const durableFingerprintNow = durableFingerprint(durable);
      if (baseline === undefined) {
        const error = new Error('The previous durable journal is unknown. Load it before reconciling unsaved changes.');
        this.persistenceError = error;
        throw error;
      }
      if (durableFingerprintNow === baseline) {
        const error = new Error('Local storage has not changed elsewhere. Retry persistence instead.');
        this.persistenceError = error;
        throw error;
      }

      let reconciled: JournalState;
      try {
        reconciled = reconcileStates(normalizeState(durable), normalizeState(local));
      } catch (error) {
        this.persistenceError = asError(error);
        throw error;
      }

      try {
        await this.persistence.save(structuredClone(reconciled));
      } catch (error) {
        this.persistenceError = asError(error);
        throw error;
      }
      this.state = reconciled;
      this.unsaved = false;
      this.persistenceError = undefined;
      this.durableBaseline = durableFingerprint(reconciled);
      return this.state;
    });
  }

  async change(mutation: ReaderMutation) {
    const change = structuredClone(mutation);
    await this.enqueue(async () => {
      await this.ensureDurableStateInitialized();
      validateReaderMutation(change);
      const existingConflict = this.state.conflicts.find(({ change: existing }) => existing.id === change.id);
      if (existingConflict) {
        if (!sameMutation(existingConflict.change, change)) duplicateIdError();
        if (this.unsaved) {
          await this.verifyDurableBaseline();
          if (this.unsaved) await this.persist(this.state);
        }
        throw new Error(existingConflict.message);
      }
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
        try {
          applyMutation(next, change);
        } catch (error) {
          if (!(error instanceof RecoverableMutationConflict)) throw error;
          addConflict(next, change, error.message);
          await this.persist(next);
          throw error;
        }
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
          // Recheck old durable entries before transport. A known content rejection is
          // retained visibly; network/auth/storage failures stay pending and are retried.
          validateReaderMutation(change);
          await send(structuredClone(change));
        } catch (error) {
          const invalid = isInvalidChange(error);
          if (!invalid && !isConflict(error)) throw error;
          const next = structuredClone(this.state);
          next.pending.splice(index, 1);
          if (invalid) addInvalidConflict(next, change, asError(error).message);
          else addConflict(next, change, asError(error).message);
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

  /** Compatibility alias for Keep device version, never acceptance of the helper version. */
  async acceptCurrentConflict(changeId: string): Promise<void> {
    return this.keepDeviceVersion(changeId);
  }

  /**
   * Keep the current device thread across helper lists and reloads, without inventing an
   * upload or changing pending work. Caller holds the shared cross-tab lock. A later
   * explicit resolveConflict against helper state releases this local-only choice.
   */
  async keepDeviceVersion(changeId: string): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDurableStateInitialized();
      this.requireDurable();
      const conflictIndex = this.state.conflicts.findIndex(({ change }) => change.id === changeId);
      if (conflictIndex < 0) throw new Error('The conflicting draft could not be found.');

      const next = structuredClone(this.state);
      const [conflict] = next.conflicts.splice(conflictIndex, 1);
      (next.resolutions ??= []).push({
        change: structuredClone(conflict.change),
        message: conflict.message,
        resolvedAt: new Date().toISOString(),
        resolution: 'kept-device',
        deviceVersion: structuredClone(next.threads.find(thread => thread.id === conflict.change.threadId) ?? null),
        releasesDeviceChoices: deviceChoices(next).filter(choice => choice.change.threadId === conflict.change.threadId).map(choice => choice.change.id),
        ...(conflict.disposition ? { disposition: conflict.disposition } : {}),
      });
      await this.persist(next);
    });
  }

  /** Explicit helper-state/replacement selection; releases local-only protection for this thread. */
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
        validateReaderMutation(replacementChange);
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

      const releasedChoices = deviceChoices(next).filter(choice => choice.change.threadId === conflict.change.threadId).map(choice => choice.change.id);
      const protectedThreads = new Set([
        ...deviceChoices(next).map(choice => choice.change.threadId),
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
        ...(releasedChoices.length ? { releasesDeviceChoices: releasedChoices } : {}),
        ...(conflict.disposition ? { disposition: conflict.disposition } : {}),
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
    else if (conflict.disposition) previous.disposition = conflict.disposition;
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

function reconcileStates(durable: JournalState, local: JournalState): JournalState {
  const durableIdentities = mutationIdentities(durable);
  const localIdentities = mutationIdentities(local);
  for (const [id, fingerprint] of localIdentities) {
    const durableFingerprintForId = durableIdentities.get(id);
    if (durableFingerprintForId !== undefined && durableFingerprintForId !== fingerprint) duplicateIdError();
  }

  const reconciled = structuredClone(durable);
  const localAcknowledged = new Map((local.acknowledged ?? []).map(receipt => [receipt.id, receipt]));
  for (const change of [...reconciled.pending]) {
    const receipt = localAcknowledged.get(change.id);
    if (!receipt) continue;
    if (receipt.fingerprint !== mutationFingerprint(change)) duplicateIdError();
    addConflict(reconciled, change, 'The server accepted this change, but its acknowledgement was not saved locally. Review the current saved version before resolving it.');
  }

  for (const draft of local.pending) {
    // Matching durable intent is not newly recovered work. This also avoids resurrecting
    // an acknowledgement/resolution. The failed-ack overlap above remains conservative.
    if (durableIdentities.has(draft.id)) continue;
    try {
      validateReaderMutation(draft);
      addConflict(reconciled, draft, 'Local storage changed before this draft was saved. Review the current saved version before replacing it.');
    } catch (error) {
      if (!isInvalidChange(error)) throw error;
      addInvalidConflict(reconciled, draft, asError(error).message);
    }
  }
  for (const conflict of local.conflicts) mergeConflict(reconciled, conflict);

  const resolutionFingerprints = new Set((reconciled.resolutions ?? []).map(resolution => canonicalJson(resolution)));
  for (const resolution of local.resolutions ?? []) {
    const fingerprint = canonicalJson(resolution);
    if (!resolutionFingerprints.has(fingerprint)) {
      if (resolution.resolution === 'kept-device' || resolution.releasesDeviceChoices?.length) {
        // A choice whose save failed is not allowed to overwrite another tab's newer
        // device state. Retain the snapshot and reopen just that decision for review.
        const { releasesDeviceChoices: _release, ...recovered } = structuredClone(resolution);
        (reconciled.resolutions ??= []).push({ ...recovered, resolution: 'device-choice-recovered' });
        addConflict(reconciled, resolution.change,
          'Your device-version decision was not saved before local storage changed elsewhere. The chosen version is kept in recovery history. Review the device version before choosing again.', resolution.disposition);
      } else (reconciled.resolutions ??= []).push(structuredClone(resolution));
      resolutionFingerprints.add(fingerprint);
    }
  }

  const acknowledged = new Map((reconciled.acknowledged ?? []).map(receipt => [receipt.id, receipt]));
  for (const receipt of local.acknowledged ?? []) {
    const previous = acknowledged.get(receipt.id);
    if (previous && previous.fingerprint !== receipt.fingerprint) duplicateIdError();
    if (!previous) acknowledged.set(receipt.id, structuredClone(receipt));
  }
  reconciled.acknowledged = [...acknowledged.values()];
  return normalizeState(reconciled);
}

function mergeConflict(state: JournalState, conflict: JournalConflict) {
  const existing = state.conflicts.find(item => item.change.id === conflict.change.id);
  if (!existing) {
    addConflict(state, conflict.change, conflict.message, conflict.disposition);
    return;
  }
  if (!sameMutation(existing.change, conflict.change)) duplicateIdError();
  if (conflict.disposition) existing.disposition = conflict.disposition;
  if (existing.message !== conflict.message && !existing.message.includes(conflict.message)) {
    existing.message = `${existing.message}\n\nRecovered local conflict: ${conflict.message}`;
  }
}

function mutationIdentities(state: JournalState) {
  const identities = new Map<string, string>();
  const add = (id: string, fingerprint: string) => {
    const previous = identities.get(id);
    if (previous !== undefined && previous !== fingerprint) duplicateIdError();
    identities.set(id, fingerprint);
  };
  for (const change of state.pending) add(change.id, mutationFingerprint(change));
  for (const conflict of state.conflicts) add(conflict.change.id, mutationFingerprint(conflict.change));
  for (const resolution of state.resolutions ?? []) {
    add(resolution.change.id, mutationFingerprint(resolution.change));
    if (resolution.replacement) add(resolution.replacement.id, mutationFingerprint(resolution.replacement));
  }
  for (const receipt of state.acknowledged ?? []) add(receipt.id, receipt.fingerprint);
  return identities;
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
  if (!thread) throw new RecoverableMutationConflict('The saved passage changed or was removed. Your draft was kept for review.');
  if (mutation.kind === 'note') {
    if (thread.deletedAt) throw new RecoverableMutationConflict('The saved passage was removed. Your note draft was kept for review.');
    const note = thread.notes.find(candidate => candidate.id === mutation.noteId);
    if (note?.deletedAt) throw new RecoverableMutationConflict('The note was removed. Your draft was kept for review.');
    if ((note?.revision ?? 0) !== mutation.expectedRevision) throw new RecoverableMutationConflict('The note changed. Your draft was kept for review.');
    if (note) {
      note.text = mutation.text;
      note.revision++;
    } else {
      thread.notes.push({ id: mutation.noteId, threadId: mutation.threadId, text: mutation.text, revision: 1, createdAt: now, deletedAt: null });
    }
  } else {
    if (thread.deletedAt && (mutation.kind === 'thread-state' || mutation.removed)) throw new RecoverableMutationConflict('The saved passage was removed. Your change was kept for review.');
    if (thread.revision !== mutation.expectedRevision) throw new RecoverableMutationConflict('This thread changed. Your change was kept for review.');
    if (mutation.kind === 'thread-state') thread.state = mutation.state;
    else thread.deletedAt = mutation.removed ? now : null;
  }
  thread.revision++;
  thread.updatedAt = now;
}

class RecoverableMutationConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoverableMutationConflict';
  }
}

function deviceChoices(state: JournalState): ConflictResolution[] {
  const released = new Set((state.resolutions ?? []).flatMap(resolution => resolution.releasesDeviceChoices ?? []));
  return (state.resolutions ?? []).filter(resolution => resolution.resolution === 'kept-device' && !released.has(resolution.change.id));
}

function mergeRemoteThreads(state: JournalState, remote: Thread[], protectedOverride?: Set<string>) {
  const choices = deviceChoices(state);
  const protectedThreads = protectedOverride ?? new Set([
    ...state.pending.map(change => change.threadId),
    ...state.conflicts.map(({ change }) => change.threadId),
    ...choices.map(choice => choice.change.threadId),
  ]);
  const local = new Map(state.threads.map(thread => [thread.id, thread]));
  const keptAbsent = new Set<string>();
  for (const choice of choices) {
    if (!protectedThreads.has(choice.change.threadId) || local.has(choice.change.threadId)) continue;
    if (choice.deviceVersion) local.set(choice.change.threadId, choice.deviceVersion);
    else keptAbsent.add(choice.change.threadId);
  }
  const merged = remote.filter(thread => !keptAbsent.has(thread.id))
    .map(thread => protectedThreads.has(thread.id) && local.has(thread.id) ? local.get(thread.id)! : thread);
  const present = new Set(merged.map(thread => thread.id));
  for (const thread of local.values()) {
    if (protectedThreads.has(thread.id) && !present.has(thread.id)) merged.push(thread);
  }
  return structuredClone(merged);
}

function addConflict(state: JournalState, change: ReaderMutation, message: string, disposition?: 'invalid-change') {
  const existing = state.conflicts.find(conflict => conflict.change.id === change.id);
  if (existing) {
    if (!sameMutation(existing.change, change)) throw new Error('This change identifier was already used for different content.');
    if (disposition) existing.disposition = disposition;
    return;
  }
  state.conflicts.push({ change: structuredClone(change), message, ...(disposition ? { disposition } : {}) });
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

function addInvalidConflict(state: JournalState, change: ReaderMutation, reason: string) {
  addConflict(state, change, `This saved change cannot be uploaded: ${reason} Your draft is kept for review.`, 'invalid-change');
}
function isInvalidChange(error: unknown) {
  return error instanceof Error && (error.name === 'InvalidReaderMutation' ||
    (error as Error & { code?: string }).code === 'INVALID_READER_MUTATION');
}
