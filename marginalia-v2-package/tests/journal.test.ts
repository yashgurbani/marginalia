import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReaderJournal, type JournalState } from '../ui/journal.ts';
import { ReaderStore } from '../daemon/store.ts';
import type { ReaderMutation } from '../contracts/reader.ts';

test('offline note and later edit survive reload and synchronize once in order', async () => {
  let saved: JournalState | undefined;
  const persistence = { load: async () => structuredClone(saved), save: async (value: JournalState) => { saved = structuredClone(value); } };
  let journal = new ReaderJournal(persistence); await journal.load();
  const keep: ReaderMutation = { id: 'keep1', kind: 'keep', threadId: 'thread1', capture: { url: 'https://example.org/', title: 'Example', pageType: 'article', text: 'A passage.', capturedAt: new Date().toISOString(), extractionVersion: 'v1' }, anchor: { exact: 'A passage.', prefix: '', suffix: '', start: 0, end: 10 }, note: 'An offline question.' };
  await journal.change(keep);
  journal = new ReaderJournal(persistence); await journal.load();
  await journal.change({ id: 'edit1', kind: 'note', threadId: 'thread1', noteId: 'keep1-note', expectedRevision: 1, text: 'A revised offline question.' });
  const store = new ReaderStore(':memory:');
  try {
    await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));
    assert.equal(journal.state.pending.length, 0);
    assert.equal(store.list()[0].notes[0].text, 'A revised offline question.');
    assert.equal(store.events().length, 2);
    await journal.sync(async change => { store.apply(change); }, async () => store.list(undefined, true));
    assert.equal(store.events().length, 2);
  } finally { store.close(); }
});

test('a failed durable save leaves the existing in-memory state unchanged', async () => {
  const journal = new ReaderJournal({ load: async () => undefined, save: async () => { throw new Error('Storage full'); } });
  await assert.rejects(journal.change({ id: 'keep2', kind: 'keep', threadId: 'thread2', capture: { url: 'https://example.org', title: 'Example', pageType: 'article', text: 'text', capturedAt: new Date().toISOString(), extractionVersion: 'v1' }, anchor: { exact: 'text', prefix: '', suffix: '', start: 0, end: 4 } }), /Storage full/);
  assert.equal(journal.state.threads.length, 0);
});
