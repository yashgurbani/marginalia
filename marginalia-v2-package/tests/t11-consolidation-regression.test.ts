import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibrarySettingsService } from '../daemon/library.ts';
import { ReaderStore } from '../daemon/store.ts';
import type { ReaderMutation, SourceCapture } from '../contracts/reader.ts';

const capturedAt = '2026-09-17T00:00:00.000Z';
type KeepMutation = Extract<ReaderMutation, { kind: 'keep' }>;
type ThreadExport = {
  schema: string;
  thread: { id: string; sourceTitle: string; deletedAt: string | null; anchor: { exact: string }; notes: Array<{ text: string }> };
  source: { text: string } | undefined;
  noteVersions: Array<{ text: string }>;
  attachments: Array<{ state: string; targetAvailable: boolean }>;
  targetVersions: Array<{ text: string }>;
  replies: unknown[];
  replyViews: unknown[];
};

function simpleKeep(name: string): KeepMutation {
  const capture: SourceCapture = {
    url: `https://library.example/${name}`,
    title: `Source ${name}`,
    pageType: 'article',
    text: `A saved passage for ${name}.`,
    capturedAt,
    extractionVersion: 'test-v1',
  };
  return {
    id: `keep-${name}`,
    kind: 'keep',
    threadId: `thread-${name}`,
    capture,
    anchor: { exact: capture.text, prefix: '', suffix: '', start: 0, end: capture.text.length },
  };
}

function retentionKeep(): KeepMutation {
  const exact = 'A passage kept for later reading.';
  const capture: SourceCapture = {
    url: 'https://library.example/retention',
    title: 'Retention source',
    pageType: 'paper',
    text: `Before. ${exact} After.`,
    capturedAt,
    extractionVersion: 'test-v1',
  };
  return {
    id: 'keep-retention',
    kind: 'keep',
    threadId: 'thread-retention',
    capture,
    anchor: { exact, prefix: 'Before. ', suffix: ' After.', start: 8, end: 8 + exact.length },
    note: 'Initial reader note.',
  };
}

function movedRetentionCapture(original: SourceCapture): SourceCapture {
  return {
    ...original,
    text: `Intro. ${original.text}`,
    title: 'Retention source, moved capture',
    capturedAt: '2026-09-18T00:00:00.000Z',
  };
}

test('library listing exposes every thread state and omits only tombstones when requested', () => {
  const store = new ReaderStore(':memory:');
  try {
    const states = ['open', 'parked', 'done', 'archived'] as const;
    for (const state of states) {
      const mutation = simpleKeep(state);
      store.apply(mutation);
      if (state !== 'open') {
        store.apply({ id: `state-${state}`, kind: 'thread-state', threadId: mutation.threadId, state, expectedRevision: 1 });
      }
    }
    const removed = simpleKeep('removed');
    store.apply(removed);
    store.apply({ id: 'remove-removed', kind: 'remove', threadId: removed.threadId, removed: true, expectedRevision: 1 });

    const library = new LibrarySettingsService(store);
    const all = library.listThreads();
    assert.deepEqual(
      all.map(thread => ({ id: thread.id, state: thread.state, removed: thread.deletedAt !== null })).sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'thread-archived', state: 'archived', removed: false },
        { id: 'thread-done', state: 'done', removed: false },
        { id: 'thread-open', state: 'open', removed: false },
        { id: 'thread-parked', state: 'parked', removed: false },
        { id: 'thread-removed', state: 'open', removed: true },
      ],
    );

    assert.deepEqual(library.listThreads(false).map(thread => thread.id).sort(), [
      'thread-archived',
      'thread-done',
      'thread-open',
      'thread-parked',
    ]);
    assert.equal(library.listThreads(false).some(thread => thread.deletedAt !== null), false);
  } finally {
    store.close();
  }
});

test('library export passes through the complete reader-owned thread payload', () => {
  const store = new ReaderStore(':memory:');
  try {
    const keep = retentionKeep();
    store.apply(keep);
    const created = store.get(keep.threadId)!;
    const note = created.notes[0];
    store.apply({ id: 'edit-retention-note', kind: 'note', threadId: keep.threadId, noteId: note.id, expectedRevision: 1, text: 'Revised reader note.' });
    const moved = movedRetentionCapture(keep.capture);
    assert.equal(store.reattach(keep.threadId, moved.text, 'export-tab', moved).state, 'moved');
    const eventsBeforeExport = store.events().length;

    const library = new LibrarySettingsService(store);
    const exported = library.exportThread(keep.threadId) as ThreadExport;
    assert.equal(exported.schema, 'marginalia.thread.v1');
    assert.equal(exported.thread.id, keep.threadId);
    assert.equal(exported.thread.sourceTitle, keep.capture.title);
    assert.equal(exported.thread.anchor.exact, keep.anchor.exact);
    assert.equal(exported.source?.text, keep.capture.text);
    assert.deepEqual(exported.noteVersions.map(version => version.text), ['Initial reader note.', 'Revised reader note.']);
    assert.equal(exported.thread.notes[0].text, 'Revised reader note.');
    assert.equal(exported.attachments.length, 1);
    assert.equal(exported.attachments[0].state, 'moved');
    assert.equal(exported.targetVersions.length, 1);
    assert.equal(exported.targetVersions[0].text, moved.text);
    assert.deepEqual(exported.replies, []);
    assert.deepEqual(exported.replyViews, []);
    assert.equal(store.events().length, eventsBeforeExport, 'export does not append a reader event');
  } finally {
    store.close();
  }
});

test('removed reader data remains available after SQLite reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'marginalia-t11-retention-'));
  const filename = join(directory, 'reader.sqlite');
  let store = new ReaderStore(filename);
  try {
    const keep = retentionKeep();
    store.apply(keep);
    const created = store.get(keep.threadId)!;
    assert.equal(created.highlighted, false, 'Keep is underline-only until the reader explicitly highlights it');
    store.apply({ id: 'highlight-retained-passage', kind: 'highlight', threadId: keep.threadId, highlighted: true, expectedRevision: created.revision });
    assert.equal(store.get(keep.threadId)!.highlighted, true, 'explicit Highlight adds the tint state');
    const sourceBeforeRemoval = store.sourceVersion(created.sourceVersionId)!;
    const noteId = created.notes[0].id;
    store.apply({ id: 'edit-retained-note', kind: 'note', threadId: keep.threadId, noteId, expectedRevision: 1, text: 'Revised retained note.' });
    const moved = movedRetentionCapture(keep.capture);
    assert.equal(store.reattach(keep.threadId, moved.text, 'retention-tab', moved).state, 'moved');
    const beforeRemoval = store.get(keep.threadId)!;
    store.apply({ id: 'remove-retained-thread', kind: 'remove', threadId: keep.threadId, removed: true, expectedRevision: beforeRemoval.revision });

    assert.equal(store.list().length, 0);
    assert.deepEqual(store.list(undefined, true).map(thread => thread.id), [keep.threadId]);
    assert.equal(store.get(keep.threadId)!.deletedAt !== null, true);

    store.close();
    store = new ReaderStore(filename);
    const removed = store.get(keep.threadId)!;
    assert.equal(removed.deletedAt !== null, true);
    assert.equal(removed.anchor.exact, keep.anchor.exact);
    assert.equal(removed.notes[0].text, 'Revised retained note.');
    assert.equal(removed.highlighted, true);
    assert.deepEqual(store.sourceVersion(removed.sourceVersionId), sourceBeforeRemoval);
    assert.equal(store.noteVersion({ noteId, revision: 1 })!.text, 'Initial reader note.');
    assert.equal(store.noteVersion({ noteId, revision: 2 })!.text, 'Revised retained note.');
    assert.equal(store.attachments(keep.threadId)[0].state, 'moved');
    assert.equal(store.attachments(keep.threadId)[0].targetAvailable, true);

    const exported = store.exportThread(keep.threadId) as ThreadExport;
    assert.equal(exported.thread.deletedAt !== null, true);
    assert.deepEqual(exported.noteVersions.map(version => version.text), ['Initial reader note.', 'Revised retained note.']);
    assert.equal(exported.source?.text, sourceBeforeRemoval.text);
    assert.equal(exported.targetVersions[0].text, moved.text);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
