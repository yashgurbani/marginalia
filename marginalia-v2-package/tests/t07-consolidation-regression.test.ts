import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReaderJournal, type JournalState, type Persistence } from '../ui/journal.ts';
import type { ReaderMutation, Thread } from '../contracts/reader.ts';

const capturedAt = '2026-09-17T08:00:00.000Z';

function keep(id: string, threadId: string): Extract<ReaderMutation, { kind: 'keep' }> {
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
    note: `Question for ${threadId}`,
  };
}

function noteEdit(id: string, threadId: string, noteId: string, text: string): Extract<ReaderMutation, { kind: 'note' }> {
  return { id, kind: 'note', threadId, noteId, expectedRevision: 1, text };
}

function sharedPersistence() {
  let saved: JournalState | undefined;
  let failNextSave = false;
  const persistence: Persistence = {
    load: async () => structuredClone(saved),
    save: async value => {
      if (failNextSave) {
        failNextSave = false;
        throw new Error('Storage full');
      }
      saved = structuredClone(value);
    },
  };
  return {
    persistence,
    failNextSave: () => { failNextSave = true; },
  };
}

function helperThread(threadId: string): Thread {
  const now = '2026-09-17T08:30:00.000Z';
  return {
    id: threadId,
    anchorId: `${threadId}-anchor`,
    state: 'open',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    sourceVersionId: `${threadId}-source`,
    sourceUrl: `https://example.org/${threadId}`,
    sourceTitle: `Example ${threadId}`,
    anchor: { exact: 'A passage.', prefix: '', suffix: '', start: 0, end: 10 },
    notes: [{ id: `${threadId}-note`, threadId, text: 'Helper version', revision: 1, createdAt: now, deletedAt: null }],
    highlighted: true,
  };
}

test('direct keep-device resolves a reconciled conflict without accepting the helper version', async () => {
  const shared = sharedPersistence();
  const seed = new ReaderJournal(shared.persistence);
  await seed.change(keep('base', 'thread'));
  await seed.sync(async () => {}, async () => structuredClone(seed.state.threads));

  const local = new ReaderJournal(shared.persistence);
  await local.load();
  const draft = noteEdit('local-draft', 'thread', 'base-note', 'Local draft');
  shared.failNextSave();
  await assert.rejects(local.change(draft), /Storage full/);

  const other = new ReaderJournal(shared.persistence);
  await other.load();
  await other.change(noteEdit('remote-edit', 'thread', 'base-note', 'Remote edit'));
  await other.sync(async () => {}, async () => structuredClone(other.state.threads));

  await local.reconcilePersistence();
  assert.deepEqual(local.state.conflicts.map(conflict => conflict.change.id), ['local-draft']);
  assert.equal(local.state.threads[0].notes[0].text, 'Remote edit');

  await local.keepDeviceVersion(draft.id);
  assert.equal(local.state.conflicts.length, 0);
  assert.equal(local.state.resolutions?.at(-1)?.resolution, 'kept-device');
  assert.equal(local.state.resolutions?.at(-1)?.change.id, 'local-draft');
  assert.equal(local.state.resolutions?.at(-1)?.deviceVersion?.notes[0].text, 'Remote edit');
  assert.equal(local.state.pending.length, 0);

  const helper = helperThread('thread');
  const reopened = new ReaderJournal(shared.persistence);
  await reopened.load();
  let sent = 0;
  await reopened.sync(async () => { sent++; }, async () => [helper]);
  assert.equal(sent, 0);
  assert.equal(reopened.state.threads[0].notes[0].text, 'Remote edit');
  assert.equal(reopened.state.resolutions?.at(-1)?.resolution, 'kept-device');
});

test('missing-target keep-device preserves null absence through failed save, reload, and helper listing', async () => {
  const shared = sharedPersistence();
  const journal = new ReaderJournal(shared.persistence);
  const missing = noteEdit('missing-draft', 'missing-thread', 'missing-note', 'Keep this local draft');

  await assert.rejects(journal.change(missing), /draft was kept/);
  shared.failNextSave();
  await assert.rejects(journal.keepDeviceVersion(missing.id), /Storage full/);
  assert.equal(journal.unsaved, true);
  assert.match(journal.persistenceError?.message ?? '', /Storage full/);
  assert.equal(journal.state.conflicts.length, 0);
  assert.equal(journal.state.resolutions?.at(-1)?.resolution, 'kept-device');
  assert.equal(journal.state.resolutions?.at(-1)?.deviceVersion, null);

  await journal.load();
  assert.equal(journal.unsaved, true, 'load must retain the unsaved absence choice');
  assert.equal(journal.state.resolutions?.at(-1)?.deviceVersion, null);
  let listed = 0;
  await assert.rejects(journal.sync(async () => assert.fail('No upload was chosen'), async () => {
    listed++;
    return [helperThread('missing-thread')];
  }), /not durable/);
  assert.equal(listed, 0);

  await journal.retryPersistence();
  const reopened = new ReaderJournal(shared.persistence);
  await reopened.load();
  await reopened.sync(async () => assert.fail('No upload was chosen'), async () => [helperThread('missing-thread')]);
  assert.equal(reopened.state.threads.length, 0, 'helper listing must not resurrect deliberate absence');
  assert.equal(reopened.state.resolutions?.at(-1)?.resolution, 'kept-device');
  assert.equal(reopened.state.resolutions?.at(-1)?.deviceVersion, null);
});
