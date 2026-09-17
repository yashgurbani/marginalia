import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderJournal, type JournalState, type Persistence } from '../ui/journal.ts';
import type { ReaderMutation } from '../contracts/reader.ts';

const capturedAt = '2026-09-17T08:00:00.000Z';

function keep(id: string, threadId: string, note = 'An offline question.'): Extract<ReaderMutation, { kind: 'keep' }> {
  return {
    id,
    kind: 'keep',
    threadId,
    capture: {
      url: `https://example.org/${threadId}`,
      title: `Example ${threadId}`,
      pageType: 'article',
      text: 'A passage.',
      capturedAt,
      extractionVersion: 'v1',
    },
    anchor: { exact: 'A passage.', prefix: '', suffix: '', start: 0, end: 10 },
    note,
  };
}

function memoryPersistence() {
  let saved: JournalState | undefined;
  const persistence: Persistence = {
    load: async () => structuredClone(saved),
    save: async value => { saved = structuredClone(value); },
  };
  return { persistence, read: () => structuredClone(saved) };
}

function jsonPersistence(filename: string): Persistence {
  return {
    load: async () => {
      try { return JSON.parse(await readFile(filename, 'utf8')) as JournalState; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    save: async value => { await writeFile(filename, JSON.stringify(value), 'utf8'); },
  };
}

test('disk journal and SQLite store survive reconstruction and daemon restart', async () => {
  const { ReaderStore } = await import('../daemon/store.ts');
  const directory = await mkdtemp(join(tmpdir(), 'marginalia-journal-'));
  const journalFile = join(directory, 'journal.json');
  const databaseFile = join(directory, 'reader.sqlite');
  try {
    let journal = new ReaderJournal(jsonPersistence(journalFile));
    await journal.load();
    await journal.change(keep('keep1', 'thread1'));

    journal = new ReaderJournal(jsonPersistence(journalFile));
    await journal.load();
    await journal.change({ id: 'edit1', kind: 'note', threadId: 'thread1', noteId: 'keep1-note', expectedRevision: 1, text: 'A revised offline question.' });

    let store = new ReaderStore(databaseFile);
    await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));
    store.close();

    store = new ReaderStore(databaseFile);
    try {
      journal = new ReaderJournal(jsonPersistence(journalFile));
      await journal.load();
      assert.equal(journal.state.pending.length, 0);
      assert.equal(store.list()[0].notes[0].text, 'A revised offline question.');
      assert.equal(store.events().length, 2);
      await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));
      assert.equal(store.events().length, 2);
      await journal.change(keep('keep1', 'thread1'));
      assert.equal(journal.state.pending.length, 0, 'an acknowledged retry is not applied twice');
      await assert.rejects(journal.change({ ...keep('keep1', 'thread1'), note: 'Reused with different content' }), /identifier was already used/);
    } finally { store.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed persistence keeps the optimistic mutation and never dispatches it before retry', async () => {
  let saved: JournalState | undefined;
  let fail = true;
  let loads = 0;
  let sends = 0;
  const persistence: Persistence = {
    load: async () => { loads++; return structuredClone(saved); },
    save: async value => {
      if (fail) { fail = false; throw new Error('Storage full'); }
      saved = structuredClone(value);
    },
  };
  const journal = new ReaderJournal(persistence);
  const mutation = keep('keep2', 'thread2');

  await assert.rejects(journal.change(mutation), /Storage full/);
  assert.equal(journal.state.threads.length, 1);
  assert.equal(journal.state.pending.length, 1);
  assert.equal(journal.unsaved, true);
  assert.match(journal.persistenceError?.message ?? '', /Storage full/);
  await journal.load();
  assert.equal(loads, 1, 'load must not replace unsaved in-memory work');
  await assert.rejects(journal.sync(async () => { sends++; }, async () => []), /not durable/);
  assert.equal(sends, 0);

  await journal.change(structuredClone(mutation));
  assert.equal(journal.unsaved, false);
  assert.equal(journal.state.threads.length, 1);
  assert.equal(journal.state.pending.length, 1);
  assert.equal(saved?.pending.length, 1);

  assert.equal(mutation.kind, 'keep');
  await assert.rejects(journal.change({ ...mutation, note: 'Different content' }), /identifier was already used/);
  assert.equal(journal.state.threads.length, 1);
});

test('an unsaved retry fails closed when another journal changed the durable base', async () => {
  let saved: JournalState | undefined;
  let failFirstAWrite = true;
  const sharedLoad = async () => structuredClone(saved);
  const journalA = new ReaderJournal({
    load: sharedLoad,
    save: async value => {
      if (failFirstAWrite) { failFirstAWrite = false; throw new Error('A storage failure'); }
      saved = structuredClone(value);
    },
  });
  const journalB = new ReaderJournal({
    load: sharedLoad,
    save: async value => { saved = structuredClone(value); },
  });
  await journalA.load();
  await journalB.load();

  await assert.rejects(journalA.change(keep('keep-a-failed', 'thread-a-failed')), /A storage failure/);
  await journalB.change(keep('keep-b-durable', 'thread-b-durable'));
  const durableAfterB = structuredClone(saved);

  await journalA.load();
  assert.deepEqual(journalA.state.pending.map(change => change.id), ['keep-a-failed'], 'an incoming load must preserve the unsaved draft');
  await assert.rejects(journalA.retryPersistence(), /Local storage changed elsewhere/);
  await assert.rejects(journalA.change(keep('keep-a-second', 'thread-a-second')), /Local storage changed elsewhere/);
  assert.deepEqual(saved, durableAfterB, 'the stale journal must not overwrite the other tab');
  assert.deepEqual(journalA.state.pending.map(change => change.id), ['keep-a-failed']);
  assert.deepEqual(journalA.state.threads.map(thread => thread.id), ['thread-a-failed']);
  assert.equal(journalA.unsaved, true);
  assert.match(journalA.persistenceError?.message ?? '', /changed elsewhere/);
});

test('a failed acknowledgement save is retried explicitly without resending the mutation', async () => {
  let saved: JournalState | undefined;
  let saves = 0;
  let sends = 0;
  const persistence: Persistence = {
    load: async () => structuredClone(saved),
    save: async value => {
      saves++;
      if (saves === 2) throw new Error('Disk unavailable');
      saved = structuredClone(value);
    },
  };
  const journal = new ReaderJournal(persistence);
  await journal.change(keep('keep3', 'thread3'));
  await assert.rejects(journal.sync(async () => { sends++; }, async () => journal.state.threads), /Disk unavailable/);
  assert.equal(sends, 1);
  assert.equal(journal.unsaved, true);
  assert.equal(journal.state.pending.length, 0, 'the unsaved state retains the acknowledged outbox removal');
  assert.equal(saved?.pending.length, 1, 'the durable state still contains the outbox entry');

  await journal.retryPersistence();
  await journal.sync(async () => { sends++; }, async () => structuredClone(journal.state.threads));
  assert.equal(sends, 1);
  assert.equal(journal.unsaved, false);
  assert.equal(saved?.pending.length, 0);
});

test('lost acknowledgements replay safely after journal reconstruction', async () => {
  const { ReaderStore } = await import('../daemon/store.ts');
  const directory = await mkdtemp(join(tmpdir(), 'marginalia-lost-ack-'));
  const journalFile = join(directory, 'journal.json');
  const databaseFile = join(directory, 'reader.sqlite');
  try {
    let journal = new ReaderJournal(jsonPersistence(journalFile));
    await journal.change(keep('keep4', 'thread4'));
    let store = new ReaderStore(databaseFile);
    await assert.rejects(journal.sync(async change => {
      store.apply(change);
      throw new Error('Connection lost before acknowledgement');
    }, async () => store.list(undefined, true)), /Connection lost/);
    assert.equal(journal.state.pending.length, 1);
    assert.equal(store.events().length, 1);
    store.close();

    journal = new ReaderJournal(jsonPersistence(journalFile));
    await journal.load();
    store = new ReaderStore(databaseFile);
    try {
      await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));
      assert.equal(journal.state.pending.length, 0);
      assert.equal(store.events().length, 1, 'the receipt prevents duplicate application');
    } finally { store.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('queued edits serialize and clone caller-owned mutations', async () => {
  let activeSaves = 0;
  let maximumActiveSaves = 0;
  const persistence: Persistence = {
    load: async () => undefined,
    save: async () => {
      activeSaves++;
      maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeSaves--;
    },
  };
  const journal = new ReaderJournal(persistence);
  const first = keep('keep5', 'thread5');
  const edit: ReaderMutation = { id: 'edit5', kind: 'note', threadId: 'thread5', noteId: 'keep5-note', expectedRevision: 1, text: 'Original queued text' };
  const firstChange = journal.change(first);
  const secondChange = journal.change(edit);
  if (edit.kind === 'note') edit.text = 'Caller mutation after enqueue';
  if (first.kind === 'keep') first.capture.title = 'Caller mutation after enqueue';
  await Promise.all([firstChange, secondChange]);

  assert.equal(maximumActiveSaves, 1);
  assert.equal(journal.state.threads[0].sourceTitle, 'Example thread5');
  assert.equal(journal.state.threads[0].notes[0].text, 'Original queued text');
  assert.equal(journal.state.pending.length, 2);
});

test('mutation identity follows canonical JSON transport semantics', async () => {
  const memory = memoryPersistence();
  const journal = new ReaderJournal(memory.persistence);
  const original = keep('canonical', 'canonical-thread');
  delete original.note;
  await journal.change(original);
  const reordered: ReaderMutation = {
    threadId: original.threadId,
    id: original.id,
    anchor: { suffix: '', end: 10, exact: 'A passage.', start: 0, prefix: '' },
    capture: {
      extractionVersion: 'v1',
      capturedAt,
      text: 'A passage.',
      pageType: 'article',
      title: 'Example canonical-thread',
      url: 'https://example.org/canonical-thread',
    },
    note: undefined,
    kind: 'keep',
  };
  await journal.change(reordered);
  assert.equal(journal.state.threads.length, 1);
  assert.equal(journal.state.pending.length, 1);
});

test('whole-page notes are not highlighted and deleted threads refuse local note edits', async () => {
  const memory = memoryPersistence();
  const journal = new ReaderJournal(memory.persistence);
  const wholePage = keep('whole-page', 'whole-thread');
  assert.equal(wholePage.kind, 'keep');
  wholePage.anchor = { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 };
  await journal.change(wholePage);
  assert.equal(journal.state.threads[0].highlighted, false);
  await journal.change({ id: 'remove-whole', kind: 'remove', threadId: 'whole-thread', expectedRevision: 1, removed: true });
  await assert.rejects(journal.change({ id: 'edit-removed', kind: 'note', threadId: 'whole-thread', noteId: 'whole-page-note', expectedRevision: 1, text: 'Should stay blocked' }), /removed/);
});

test('legacy duplicate conflict rows and their pending copy normalize to one resolvable draft', async () => {
  const draft: ReaderMutation = { id: 'legacy-edit', kind: 'note', threadId: 'legacy-thread', noteId: 'legacy-note', expectedRevision: 1, text: 'Preserved legacy draft' };
  let saved: JournalState | undefined = {
    threads: [],
    pending: [structuredClone(draft)],
    conflicts: [
      { change: structuredClone(draft), message: 'First conflict' },
      { change: structuredClone(draft), message: 'Duplicate conflict' },
    ],
  };
  const journal = new ReaderJournal({
    load: async () => structuredClone(saved),
    save: async value => { saved = structuredClone(value); },
  });

  await journal.load();
  assert.equal(journal.state.conflicts.length, 1);
  assert.equal(journal.state.pending.length, 0);
  await journal.resolveConflict('legacy-edit', []);
  assert.equal(journal.state.conflicts.length, 0);
  assert.equal(journal.state.resolutions?.length, 1);
  assert.equal(journal.state.resolutions?.[0].change.kind, 'note');
  assert.equal(saved?.conflicts.length, 0);
});

test('conflicts preserve drafts, block only their thread, reconstruct once, and resolve explicitly', async () => {
  const { ReaderStore } = await import('../daemon/store.ts');
  const memory = memoryPersistence();
  let journal = new ReaderJournal(memory.persistence);
  const store = new ReaderStore(':memory:');
  try {
    await journal.change(keep('keep-a', 'thread-a'));
    await journal.change(keep('keep-b', 'thread-b'));
    await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));

    store.apply({ id: 'remote-a', kind: 'note', threadId: 'thread-a', noteId: 'keep-a-note', expectedRevision: 1, text: 'Remote text' });
    await journal.change({ id: 'local-a', kind: 'note', threadId: 'thread-a', noteId: 'keep-a-note', expectedRevision: 1, text: 'Local draft' });
    await journal.change({ id: 'dependent-a', kind: 'thread-state', threadId: 'thread-a', expectedRevision: 2, state: 'parked' });
    await journal.change({ id: 'local-b', kind: 'thread-state', threadId: 'thread-b', expectedRevision: 1, state: 'done' });

    await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));
    assert.deepEqual(journal.state.conflicts.map(item => item.change.id), ['local-a']);
    assert.deepEqual(journal.state.pending.map(change => change.id), ['dependent-a']);
    assert.equal(journal.state.threads.find(thread => thread.id === 'thread-a')?.notes[0].text, 'Local draft');
    assert.equal(store.get('thread-a')?.notes[0].text, 'Remote text');
    assert.equal(store.get('thread-b')?.state, 'done', 'an unrelated thread continues synchronizing');

    await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));
    assert.equal(journal.state.conflicts.length, 1, 'repeated synchronization does not duplicate a conflict');

    journal = new ReaderJournal(memory.persistence);
    await journal.load();
    assert.equal(journal.state.conflicts.length, 1, 'the conflict survives reconstruction');
    await journal.resolveConflict('local-a', store.list(undefined, true), {
      id: 'replacement-a',
      kind: 'note',
      threadId: 'thread-a',
      noteId: 'keep-a-note',
      expectedRevision: 2,
      text: 'Explicit replacement',
    });
    assert.deepEqual(journal.state.conflicts.map(item => item.change.id), ['dependent-a']);
    assert.deepEqual(journal.state.pending.map(change => change.id), ['replacement-a']);
    assert.equal(journal.state.resolutions?.[0].change.id, 'local-a');
    assert.equal(journal.state.resolutions?.[0].replacement?.id, 'replacement-a');

    await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));
    assert.equal(store.get('thread-a')?.notes[0].text, 'Explicit replacement');
    assert.deepEqual(journal.state.conflicts.map(item => item.change.id), ['dependent-a']);

    await journal.resolveConflict('dependent-a', store.list(undefined, true), {
      id: 'replacement-state-a',
      kind: 'thread-state',
      threadId: 'thread-a',
      expectedRevision: 3,
      state: 'parked',
    });
    await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));
    assert.equal(store.get('thread-a')?.state, 'parked');
    assert.equal(journal.state.conflicts.length, 0);
    assert.deepEqual(journal.state.resolutions?.map(item => item.change.id), ['local-a', 'dependent-a']);
    assert.equal(journal.state.resolutions?.[0].change.kind, 'note', 'resolution history retains the original draft');
  } finally { store.close(); }
});

function sharedJournal() {
  let saved: JournalState | undefined;
  let failNext = false;
  const persistence: Persistence = {
    load: async () => structuredClone(saved),
    save: async state => {
      if (failNext) { failNext = false; throw new Error('Storage full'); }
      saved = structuredClone(state);
    },
  };
  return { persistence, fail: () => { failNext = true; }, read: () => structuredClone(saved), write: (state: JournalState) => { saved = structuredClone(state); } };
}

test('T07 F1 reconciliation preserves matching durable pending work through conflict acceptance and reload', async () => {
  const shared = sharedJournal(), a = new ReaderJournal(shared.persistence);
  await a.change(keep('durable', 'durable-thread'));
  shared.fail();
  const unsaved = keep('unsaved', 'unsaved-thread');
  await assert.rejects(a.change(unsaved), /Storage full/);
  const b = new ReaderJournal(shared.persistence);
  await b.change(keep('other-tab', 'other-thread'));
  await a.reconcilePersistence();
  assert.deepEqual(a.state.pending.map(change => change.id), ['durable', 'other-tab']);
  assert.deepEqual(a.state.conflicts.map(item => item.change), [unsaved]);
  await a.acceptCurrentConflict(unsaved.id);
  const reopened = new ReaderJournal(shared.persistence);
  await reopened.load();
  const sent: string[] = [];
  await reopened.sync(async change => { sent.push(change.id); }, async () => reopened.state.threads);
  assert.deepEqual(sent, ['durable', 'other-tab']);
  assert.deepEqual(reopened.state.resolutions?.[0].change, unsaved);
  assert.equal(reopened.state.pending.length, 0);
});

test('T07 F1 failed-ack overlap stays a conflict without blocking unrelated durable intent', async () => {
  const shared = sharedJournal(), a = new ReaderJournal(shared.persistence);
  await a.change(keep('accepted', 'accepted-thread'));
  await a.change(keep('pending', 'pending-thread'));
  shared.fail();
  await assert.rejects(a.sync(async () => {}, async () => a.state.threads), /Storage full/);
  const b = new ReaderJournal(shared.persistence);
  await b.change(keep('other', 'other-thread'));
  await a.reconcilePersistence();
  assert.deepEqual(a.state.conflicts.map(item => item.change.id), ['accepted']);
  assert.deepEqual(a.state.pending.map(change => change.id), ['pending', 'other']);
  const sent: string[] = [];
  await a.sync(async change => { sent.push(change.id); }, async () => a.state.threads);
  assert.deepEqual(sent, ['pending', 'other']);
  assert.equal(shared.read()?.conflicts[0].change.id, 'accepted');
});

test('T07 F1 reconciliation does not resurrect acknowledged or resolved identities', async () => {
  for (const disposition of ['acknowledged', 'resolved']) {
    const shared = sharedJournal(), a = new ReaderJournal(shared.persistence);
    await a.change(keep('known', 'known-thread'));
    shared.fail();
    await assert.rejects(a.change(keep('new', 'new-thread')), /Storage full/);
    const b = new ReaderJournal(shared.persistence);
    await b.sync(async () => {
      if (disposition === 'resolved') throw Object.assign(new Error('Changed elsewhere'), { name: 'Conflict' });
    }, async () => b.state.threads);
    if (disposition === 'resolved') await b.resolveConflict('known', []);
    await a.reconcilePersistence();
    assert.deepEqual(a.state.conflicts.map(item => item.change.id), ['new']);
    assert.equal(a.state.pending.length, 0);
  }
});

test('T07 F1 different content under the same durable ID fails without overwriting either side', async () => {
  const shared = sharedJournal(), a = new ReaderJournal(shared.persistence);
  await a.change(keep('known', 'known-thread'));
  shared.fail();
  await assert.rejects(a.change(keep('new', 'new-thread')), /Storage full/);
  const changed = shared.read()!;
  changed.pending[0] = keep('known', 'known-thread', 'Different content');
  shared.write(changed);
  const local = structuredClone(a.state);
  await assert.rejects(a.reconcilePersistence(), /identifier was already used/);
  assert.deepEqual(a.state, local);
  assert.deepEqual(shared.read(), changed);
  assert.equal(a.unsaved, true);
});

test('T07 F7 new invalid edits and invalid conflict replacements never enter optimistic state', async () => {
  const shared = sharedJournal(), journal = new ReaderJournal(shared.persistence);
  await journal.change(keep('base', 'thread'));
  const before = structuredClone(journal.state);
  const invalid: ReaderMutation = { id: 'bad', threadId: 'thread', kind: 'note', noteId: 'base-note', expectedRevision: 1, text: 'x'.repeat(20001) };
  await assert.rejects(journal.change(invalid), { name: 'InvalidReaderMutation' });
  assert.deepEqual(journal.state, before);
  const stale: ReaderMutation = { ...invalid, id: 'stale', text: 'Retain this', expectedRevision: 0 };
  await assert.rejects(journal.change(stale), /draft was kept/);
  const conflicted = structuredClone(journal.state);
  await assert.rejects(journal.resolveConflict('stale', before.threads, invalid), { name: 'InvalidReaderMutation' });
  assert.deepEqual(journal.state, conflicted);
  assert.equal(journal.state.conflicts[0].disposition, undefined, 'a stale revision is not invalid content');
});

async function legacyInvalidJournal() {
  const shared = sharedJournal(), seed = new ReaderJournal(shared.persistence);
  await seed.change(keep('bad-base', 'bad-thread'));
  await seed.change(keep('good-base', 'good-thread'));
  await seed.sync(async () => {}, async () => seed.state.threads);
  const remote = structuredClone(seed.state.threads);
  const invalid: ReaderMutation = { id: 'bad-edit', threadId: 'bad-thread', kind: 'note', noteId: 'bad-base-note', expectedRevision: 1, text: 'x'.repeat(20001) };
  const saved = shared.read()!;
  saved.threads[0].notes[0].text = invalid.text;
  saved.pending = [invalid,
    { id: 'dependent', threadId: 'bad-thread', kind: 'thread-state', expectedRevision: 2, state: 'parked' },
    { id: 'good-edit', threadId: 'good-thread', kind: 'note', noteId: 'good-base-note', expectedRevision: 1, text: 'Valid edit' }];
  shared.write(saved);
  return { shared, remote, invalid, journal: new ReaderJournal(shared.persistence) };
}

test('T07 F7 legacy invalid mutations remain visible, block only their thread, and support explicit correction', async () => {
  const { shared, remote, invalid, journal } = await legacyInvalidJournal();
  const sent: string[] = [];
  await journal.sync(async change => { sent.push(change.id); }, async () => remote);
  assert.deepEqual(sent, ['good-edit']);
  assert.deepEqual(journal.state.pending.map(change => change.id), ['dependent']);
  const reopened = new ReaderJournal(shared.persistence);
  await reopened.load();
  assert.deepEqual(reopened.state.conflicts[0].change, invalid);
  assert.equal(reopened.state.conflicts[0].disposition, 'invalid-change');
  assert.match(reopened.state.conflicts[0].message, /cannot be uploaded.*draft is kept/);
  await reopened.resolveConflict(invalid.id, remote, { ...invalid, id: 'corrected', text: 'A corrected question' });
  await reopened.sync(async change => { sent.push(change.id); }, async () => remote);
  assert.deepEqual(sent, ['good-edit', 'corrected']);
  assert.deepEqual(reopened.state.resolutions?.at(-1)?.change, invalid);
  assert.equal(reopened.state.resolutions?.at(-1)?.disposition, 'invalid-change');
  assert.deepEqual(reopened.state.conflicts.map(item => item.change.id), ['dependent']);
});

test('T07 F7 a failed rejection save blocks sending and reconciliation retains the invalid draft', async () => {
  const { shared, remote, invalid, journal } = await legacyInvalidJournal();
  shared.fail();
  const sent: string[] = [];
  await assert.rejects(journal.sync(async change => { sent.push(change.id); }, async () => remote), /Storage full/);
  assert.deepEqual(sent, [] as string[]);
  assert.equal(journal.unsaved, true);
  assert.deepEqual(journal.state.conflicts[0].change, invalid);
  const other = new ReaderJournal(shared.persistence);
  await other.change(keep('other-tab', 'other-thread'));
  await journal.reconcilePersistence();
  assert.equal(journal.state.conflicts[0].disposition, 'invalid-change');
  await journal.sync(async change => { sent.push(change.id); }, async () => remote);
  assert.deepEqual(sent, ['good-edit', 'other-tab']);
  assert.deepEqual(shared.read()?.conflicts[0].change, invalid);
});

test('T07 F7 only explicit permanent rejections are retained; ambiguous HTTP and transport failures stay pending', async () => {
  const { InvalidReaderMutationError } = await import('../contracts/reader.ts');
  const permanent = new ReaderJournal(memoryPersistence().persistence);
  await permanent.change(keep('reject', 'reject-thread'));
  await permanent.change(keep('next', 'next-thread'));
  const sent: string[] = [];
  await permanent.sync(async change => {
    if (change.id === 'reject') throw new InvalidReaderMutationError('Invalid note.');
    sent.push(change.id);
  }, async () => permanent.state.threads);
  assert.deepEqual(sent, ['next']);
  assert.equal(permanent.state.conflicts[0].disposition, 'invalid-change');
  for (const error of [new Error('400: The request could not be saved'), new TypeError('Failed to fetch'), Object.assign(new Error('Socket closed'), { code: 'ECONNRESET' })]) {
    const journal = new ReaderJournal(memoryPersistence().persistence);
    await journal.change(keep('first', 'first-thread'));
    await journal.change(keep('second', 'second-thread'));
    await assert.rejects(journal.sync(async () => { throw error; }, async () => []), value => value === error);
    assert.deepEqual(journal.state.pending.map(change => change.id), ['first', 'second']);
    assert.equal(journal.state.conflicts.length, 0);
  }
});
