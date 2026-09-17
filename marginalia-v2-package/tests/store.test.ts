import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderStore, ConflictError } from '../daemon/store.ts';
import { attachQuote, type ReaderMutation } from '../contracts/reader.ts';

const keep: ReaderMutation = { id: 'keep-1', kind: 'keep', threadId: 'thread-1', capture: { url: 'https://example.org/paper', title: 'Test source', pageType: 'paper', text: 'Before. A source passage. After.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' }, anchor: { exact: 'A source passage.', prefix: 'Before. ', suffix: ' After.', start: 8, end: 25 }, note: 'What does this mean?' };

test('reader work survives reopening; replay is idempotent; conflicting revisions preserve both saved and draft text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-store-'));
  let store = new ReaderStore(join(dir, 'reader.sqlite'));
  try {
    assert.deepEqual(store.apply(keep), store.apply(keep));
    const note = store.get('thread-1')!.notes[0];
    store.close(); store = new ReaderStore(join(dir, 'reader.sqlite'));
    assert.equal(store.list().length, 1);
    assert.equal(store.get('thread-1')!.notes[0].text, keep.note);
    store.apply({ id: 'edit-1', kind: 'note', threadId: 'thread-1', noteId: note.id, expectedRevision: 1, text: 'My revised question.' });
    assert.throws(() => store.apply({ id: 'edit-2', kind: 'note', threadId: 'thread-1', noteId: note.id, expectedRevision: 1, text: 'An offline draft.' }), ConflictError);
    assert.equal(store.get('thread-1')!.notes[0].text, 'My revised question.');
    assert.equal(store.exportThread('thread-1').noteVersions.length, 2);
    assert.equal(store.events().length, 2);
    store.apply({ id: 'remove-1', kind: 'remove', threadId: 'thread-1', expectedRevision: 2, removed: true });
    assert.equal(store.list().length, 0);
    store.apply({ id: 'restore-1', kind: 'remove', threadId: 'thread-1', expectedRevision: 3, removed: false });
    assert.equal(store.list().length, 1);
    assert.throws(() => store.apply({ ...keep, note: 'Different data under the same ID.' }), ConflictError);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('reattachment preserves exact, moved, ambiguous and missing states without fuzzy guessing', () => {
  const a = keep.anchor;
  assert.equal(attachQuote(a, keep.capture.text).state, 'exact');
  assert.equal(attachQuote(a, 'New introduction. ' + keep.capture.text).state, 'moved');
  assert.equal(attachQuote(a, keep.capture.text + ' ' + keep.capture.text).state, 'unsure');
  assert.equal(attachQuote(a, 'Before. A changed passage. After.').state, 'lost');
});
