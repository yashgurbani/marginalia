import test from 'node:test';
import assert from 'node:assert/strict';
import { ReaderStore, ConflictError } from '../daemon/store.ts';
import { importThread, planThreadImport, previewThreadImport, threadImportDigest } from '../daemon/library-import.ts';
import { createLibraryImportRoutes } from '../daemon/routes/library-import.ts';
import type { ApiRouteContext } from '../daemon/routes/types.ts';

function fixture() {
  const reader = new ReaderStore(':memory:');
  reader.apply({ id: 'keep', kind: 'keep', threadId: 'thread-one', capture: {
    url: 'https://example.com/reading', text: 'A source passage. Another section.', title: 'Reading', pageType: 'article',
    capturedAt: '2026-09-18T10:00:00.000Z', extractionVersion: 'test-v1', author: 'Reader', publicationDate: '2026-09-18', venue: 'Example',
    sections: [{ title: 'Opening', start: 0, end: 17 }, { title: 'Next', start: 18, end: 33 }],
  }, anchor: { kind: 'section', exact: 'source passage', prefix: 'A ', suffix: '.', start: 2, end: 16 } });
  reader.apply({ id: 'note-one', kind: 'note', threadId: 'thread-one', noteId: 'note-a', text: 'First thought', expectedRevision: 0 });
  reader.apply({ id: 'note-two', kind: 'note', threadId: 'thread-one', noteId: 'note-a', text: 'Revised thought', expectedRevision: 1 });
  reader.apply({ id: 'note-three', kind: 'note', threadId: 'thread-one', noteId: 'note-b', text: 'Second note', expectedRevision: 0 });
  reader.apply({ id: 'highlight', kind: 'highlight', threadId: 'thread-one', highlighted: true, expectedRevision: 4 });
  reader.apply({ id: 'park', kind: 'thread-state', threadId: 'thread-one', state: 'parked', expectedRevision: 5 });
  const exported = reader.exportThread('thread-one');
  reader.close();
  return exported;
}
function withReader(run: (reader: ReaderStore) => void) {
  const reader = new ReaderStore(':memory:');
  try { run(reader); } finally { reader.close(); }
}

test('preview then atomic import preserves source, anchor, notes, revisions, highlight and state', () => withReader(reader => {
  const exported = fixture(), before = reader.db.prepare('SELECT * FROM migrations').all();
  const allowedTables = new Set(['sources', 'source_versions', 'anchors', 'threads', 'notes', 'note_versions', 'highlights', 'mutation_receipts', 'events', 'sqlite_sequence']);
  const untouchedTables = (reader.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
    .filter(({ name }) => !allowedTables.has(name) && !name.startsWith('search'))
    .map(({ name }) => ({ name, rows: reader.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() }));
  const preview = previewThreadImport(reader, exported);
  assert.equal(reader.list().length, 0);
  assert.equal(preview.preview.noteCount, 2);
  assert.equal(preview.preview.state, 'parked');
  const result = importThread(reader, exported, preview.preview.digest);
  assert.equal(result.imported.threadId, exported.thread.id);
  const saved = reader.get(exported.thread.id)!;
  assert.deepEqual(saved.anchor, exported.thread.anchor);
  assert.equal(saved.highlighted, true); assert.equal(saved.state, 'parked');
  assert.deepEqual(reader.sourceVersion(saved.sourceVersionId), exported.source);
  assert.deepEqual(saved.notes.map(n => [n.id, n.text, n.revision]), exported.thread.notes.map(n => [n.id, n.text, n.revision]));
  assert.equal(reader.noteVersion({ noteId: 'note-a', revision: 1 })?.text, 'First thought');
  assert.deepEqual(reader.db.prepare('SELECT * FROM migrations').all(), before);
  assert.equal(reader.replies(saved.id).length, 0);
  for (const { name, rows } of untouchedTables) assert.deepEqual(reader.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(), rows, name);
}));

test('mutation IDs and plans are deterministic, ordinary receipt replay is idempotent', () => withReader(reader => {
  const exported = fixture(), plan = planThreadImport(exported);
  assert.deepEqual(plan, planThreadImport(exported));
  for (const mutation of plan.mutations) reader.apply(mutation);
  const before = reader.exportThread(plan.threadId);
  for (const mutation of plan.mutations) reader.apply(mutation);
  assert.deepEqual(reader.exportThread(plan.threadId), before);
}));

test('repeat import keeps newer notes and removed thread without replaying writes', () => withReader(reader => {
  const exported = fixture(), digest = threadImportDigest(planThreadImport(exported));
  importThread(reader, exported, digest);
  reader.apply({ id: 'later-note', kind: 'note', threadId: 'thread-one', noteId: 'note-a', text: 'Newer local edit', expectedRevision: 2 });
  reader.apply({ id: 'later-removal', kind: 'remove', threadId: 'thread-one', removed: true, expectedRevision: reader.get('thread-one')!.revision });
  const before = reader.exportThread('thread-one'), events = reader.events(0);
  importThread(reader, exported, digest);
  assert.deepEqual(reader.exportThread('thread-one'), before);
  assert.deepEqual(reader.events(0), events);
}));

test('existing same-ID thread conflicts, including removed work', () => withReader(reader => {
  const exported = fixture(), plan = planThreadImport(exported);
  reader.apply({ ...plan.mutations[0], id: 'unrelated-local-keep' });
  assert.throws(() => previewThreadImport(reader, exported), ConflictError);
  reader.apply({ id: 'remove-local', kind: 'remove', threadId: 'thread-one', removed: true, expectedRevision: 1 });
  assert.throws(() => importThread(reader, exported, threadImportDigest(plan)), ConflictError);
  assert.ok(reader.get('thread-one')!.deletedAt);
}));

test('removed notes and threads remain removed', () => withReader(reader => {
  const exported = fixture();
  exported.thread.deletedAt = '2026-09-18T12:00:00Z';
  exported.thread.notes[0].deletedAt = '2026-09-18T11:00:00Z';
  exported.thread.notes[0].revision++;
  const preview = previewThreadImport(reader, exported);
  assert.equal(preview.preview.removed, true);
  importThread(reader, exported, preview.preview.digest);
  assert.ok(reader.get('thread-one')!.deletedAt);
  assert.ok(reader.get('thread-one')!.notes.find(n => n.id === exported.thread.notes[0].id)!.deletedAt);
  assert.equal(reader.list().length, 0);
}));

test('preview confirmation rejects a changed plan', () => withReader(reader => {
  const exported = fixture(), preview = previewThreadImport(reader, exported);
  exported.thread.state = 'done';
  assert.throws(() => importThread(reader, exported, preview.preview.digest), ConflictError);
  assert.equal(reader.list().length, 0);
}));

test('unsupported schema, mismatched anchor and missing source metadata reject before writes', () => {
  const wrong = fixture(); wrong.schema = 'marginalia.thread.v2';
  assert.throws(() => planThreadImport(wrong), /version 1/);
  const anchor = fixture(); anchor.thread.anchor.exact = 'wrong passage!';
  assert.throws(() => planThreadImport(anchor), /passage/);
  const legacy = fixture(); legacy.source!.metadataStatus = 'legacy';
  assert.throws(() => planThreadImport(legacy), /complete original/);
  const missing = fixture(); missing.source!.capturedAt = null;
  assert.throws(() => planThreadImport(missing), /source capture/);
});

test('unsupported replies and executable history are omitted and disclosed before import', () => withReader(reader => {
  const exported = { ...fixture(), replies: [{ code: 'throw new Error("do not execute")', validation: { trusted: true } }],
    execution: { jobs: [{ secret: 'never echo imported provider record' }] } };
  const preview = previewThreadImport(reader, exported);
  assert.match(preview.warnings.join(' '), /Replies.*execution history are omitted/);
  assert.doesNotMatch(JSON.stringify(preview), /secret|trusted|do not execute/);
  importThread(reader, exported, preview.preview.digest);
  assert.equal(reader.replies('thread-one').length, 0);
}));

test('invalid later mutation cannot partially import; transaction rolls back storage failures', () => withReader(reader => {
  const exported = fixture();
  reader.db.exec("CREATE TRIGGER reject_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'test write failure'); END");
  assert.throws(() => importThread(reader, exported, threadImportDigest(planThreadImport(exported))), /test write failure/);
  assert.equal(reader.list(undefined, true).length, 0);
  assert.equal(reader.db.prepare('SELECT * FROM mutation_receipts').all().length, 0);
  assert.equal(reader.db.prepare('SELECT * FROM source_versions').all().length, 0);
}));

test('bounded byte, note and history validation; no fabricated gap revisions or renaming', () => {
  assert.throws(() => planThreadImport({ ...fixture(), extra: 'x'.repeat(2 * 1024 * 1024) }), /2 MB/);
  const many = fixture(); many.thread.notes = Array(101).fill(many.thread.notes[0]);
  assert.throws(() => planThreadImport(many), /100 notes/);
  const gap = fixture(); gap.thread.notes[0].revision += 2;
  assert.throws(() => planThreadImport(gap), /faithfully/);
  assert.throws(() => planThreadImport(fixture(), { threadId: 'renamed' }), /original thread/);
});

test('whole-page imports preserve kind without inventing a selection', () => withReader(reader => {
  const exported = fixture();
  exported.thread.anchor = { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 };
  assert.throws(() => planThreadImport(exported), /whole-page/);
  exported.thread.highlighted = false;
  importThread(reader, exported, threadImportDigest(planThreadImport(exported)));
  assert.deepEqual(reader.get('thread-one')!.anchor, exported.thread.anchor);
}));

test('duplicate and invalid late note history is rejected without writes', () => withReader(reader => {
  const exported = fixture();
  exported.thread.notes.push(structuredClone(exported.thread.notes[0]));
  assert.throws(() => previewThreadImport(reader, exported), /conflicting identifiers/);
  exported.thread.notes.pop();
  exported.thread.notes[1].text = 'x'.repeat(20001);
  const noteId = exported.thread.notes[1].id;
  for (const version of exported.noteVersions as { noteId: string; text: string }[]) if (version.noteId === noteId) version.text = exported.thread.notes[1].text;
  assert.throws(() => previewThreadImport(reader, exported), /Invalid note/);
  assert.equal(reader.list().length, 0);
}));

test('conflicting note identity cannot attach another thread note or leave partial work', () => withReader(reader => {
  const exported = fixture(), other = structuredClone(exported);
  other.thread.id = 'other-thread';
  other.thread.notes.forEach(note => { note.threadId = 'other-thread'; });
  importThread(reader, other, threadImportDigest(planThreadImport(other)));
  assert.throws(() => importThread(reader, exported, threadImportDigest(planThreadImport(exported))), /note identifier/);
  assert.equal(reader.get('thread-one'), undefined);
}));

test('route exposes preview and commit, rechecks pairing after body, and passes conflicts', async () => {
  const reader = new ReaderStore(':memory:');
  try {
    const route = createLibraryImportRoutes(reader), exported = fixture();
    let response: unknown, status = 0;
    const context = { request: { method: 'POST' }, response: {}, url: new URL('http://localhost/api/import/thread/preview'),
      body: async () => exported, requireCurrentPairing: () => true,
      send: (_response: unknown, code: number, data: unknown) => { response = data; status = code; },
    } as unknown as ApiRouteContext;
    assert.equal(await route(context), true); assert.equal(status, 200);
    const preview = response as ReturnType<typeof previewThreadImport>;
    context.url = new URL('http://localhost/api/import/thread?previewDigest=' + preview.preview.digest);
    await route(context); assert.equal(reader.list().length, 1);
    context.url.search = '';
    await assert.rejects(route(context), ConflictError);
    context.requireCurrentPairing = () => false;
    await route(context); assert.equal(status, 401);
    context.url.pathname = '/api/not-import'; assert.equal(await route(context), false);
  } finally { reader.close(); }
});
