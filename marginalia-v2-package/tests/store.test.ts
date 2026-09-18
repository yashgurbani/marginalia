import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ReaderStore, ConflictError, digest } from '../daemon/store.ts';
import { attachQuote, wholePageAnchor, type ReaderMutation } from '../contracts/reader.ts';
import { growthReply, growthSourceText, growthDefaultParameters } from '../fixtures/growth-reply.ts';
import { hostReportMatches } from '../contracts/host-checks.ts';

const keep: ReaderMutation = { id: 'keep-1', kind: 'keep', threadId: 'thread-1', capture: { url: 'https://example.org/paper', title: 'Test source', pageType: 'paper', text: 'Before. A source passage. After.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' }, anchor: { exact: 'A source passage.', prefix: 'Before. ', suffix: ' After.', start: 8, end: 25 }, note: 'What does this mean?' };

test('reader work survives reopening; replay is idempotent; conflicting revisions preserve both saved and draft text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-store-'));
  let store = new ReaderStore(join(dir, 'reader.sqlite'));
  try {
    assert.deepEqual(store.apply(keep), store.apply(keep));
    assert.throws(() => store.apply({ ...keep, id: 'different-keep' }), ConflictError);
    const note = store.get('thread-1')!.notes[0];
    store.close(); store = new ReaderStore(join(dir, 'reader.sqlite'));
    assert.equal(store.list().length, 1);
    assert.equal(store.get('thread-1')!.notes[0].text, keep.note);
    store.apply({ id: 'edit-1', kind: 'note', threadId: 'thread-1', noteId: note.id, expectedRevision: 1, text: 'My revised question.' });
    assert.throws(() => store.apply({ id: 'edit-2', kind: 'note', threadId: 'thread-1', noteId: note.id, expectedRevision: 1, text: 'An offline draft.' }), ConflictError);
    assert.equal(store.get('thread-1')!.notes[0].text, 'My revised question.');
    assert.equal(store.exportThread('thread-1').noteVersions.length, 2);
    assert.equal(store.events().length, 2);
    store.reattach(keep.threadId, 'A replaced page.', 'erasure-target');
    store.apply({ id: 'remove-1', kind: 'remove', threadId: 'thread-1', expectedRevision: 2, removed: true });
    assert.equal(store.list().length, 0);
    assert.deepEqual(store.db.prepare('SELECT entityId FROM search ORDER BY entityId').all(), []);
    store.apply({ id: 'restore-1', kind: 'remove', threadId: 'thread-1', expectedRevision: 3, removed: false });
    assert.equal(store.list().length, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM search').pluck().get(), 3);
    assert.throws(() => store.apply({ ...keep, note: 'Different data under the same ID.' }), ConflictError);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('thread removal erases every documented FTS copy but retains version records for restore and export', () => {
  const store = new ReaderStore(':memory:');
  try {
    store.apply({ ...keep, capture: { ...keep.capture, text: growthSourceText }, anchor: wholePageAnchor() });
    const noteId = keep.id + '-note';
    store.apply({ id: 'retention-note-edit', kind: 'note', threadId: keep.threadId, noteId, expectedRevision: 1, text: 'A second retained note version.' });
    store.reattach(keep.threadId, growthSourceText + '\nA later capture.', 'retention-attachment');
    store.commitReply({ id: 'retention-reply', threadId: keep.threadId, reply: growthReply, answeredNote: { noteId, revision: 1 } });
    assert.deepEqual(store.db.prepare('SELECT kind,COUNT(*) AS n FROM search GROUP BY kind ORDER BY kind').all(), [
      { kind: 'note', n: 1 }, { kind: 'reply', n: 1 }, { kind: 'source', n: 2 },
    ]);

    store.apply({ id: 'retention-remove', kind: 'remove', threadId: keep.threadId, expectedRevision: 2, removed: true });
    assert.deepEqual(store.db.prepare('SELECT kind,entityId FROM search').all(), [], 'source, note, and reply FTS copies are erased');
    assert.equal(store.db.prepare('SELECT COUNT(*) FROM source_versions').pluck().get(), 2, 'source versions remain for history and restore');
    assert.equal(store.db.prepare('SELECT COUNT(*) FROM note_versions').pluck().get(), 2, 'note versions remain for history and export');
    assert.equal(store.db.prepare('SELECT COUNT(*) FROM reply_versions').pluck().get(), 1, 'reply versions remain for history and export');
    assert.equal(store.exportThread(keep.threadId).noteVersions.length, 2);
    assert.equal(store.exportThread(keep.threadId).replies.length, 1);

    store.apply({ id: 'retention-restore', kind: 'remove', threadId: keep.threadId, expectedRevision: 3, removed: false });
    assert.deepEqual(store.db.prepare('SELECT kind,COUNT(*) AS n FROM search GROUP BY kind ORDER BY kind').all(), [
      { kind: 'note', n: 1 }, { kind: 'reply', n: 1 }, { kind: 'source', n: 2 },
    ]);
  } finally { store.close(); }
});

test('active thread listing pushes filters into SQL and uses its covering index', () => {
  const store = new ReaderStore(':memory:');
  try {
    store.apply(keep);
    assert.deepEqual(store.list(keep.capture.url).map(thread => thread.id), [keep.threadId]);
    assert.deepEqual(store.list('https://elsewhere.example/'), []);
    const plan = store.db.prepare(`EXPLAIN QUERY PLAN SELECT t.id FROM threads t JOIN anchors a ON a.id=t.anchorId
      JOIN source_versions v ON v.id=a.sourceVersionId JOIN sources s ON s.id=v.sourceId
      WHERE t.deletedAt IS NULL ORDER BY t.createdAt,t.id`).all() as { detail: string }[];
    assert.ok(plan.some(row => /SEARCH t USING (?:COVERING )?INDEX threads_list/.test(row.detail)), JSON.stringify(plan));
    assert.ok(plan.every(row => !/^SCAN t(?:$|\s)/.test(row.detail)), JSON.stringify(plan));
  } finally { store.close(); }
});

test('removing and restoring one note tombstones only that note and advances note and thread revisions', () => {
  const store = new ReaderStore(':memory:');
  try {
    store.apply(keep);
    store.apply({ id: 'note-2-write', kind: 'note', threadId: keep.threadId, noteId: 'note-2', expectedRevision: 0, text: 'Keep this note.' });
    const before = store.get(keep.threadId)!;
    const target = before.notes.find(note => note.id !== 'note-2')!;
    store.apply({ id: 'note-1-remove', kind: 'note-remove', threadId: keep.threadId, noteId: target.id, expectedRevision: target.revision, removed: true });
    assert.equal(store.db.prepare("SELECT 1 FROM search WHERE entityId=? AND kind='note'").get(target.id), undefined);
    const removed = store.get(keep.threadId)!;
    assert.equal(removed.revision, before.revision + 1);
    assert.equal(removed.notes.find(note => note.id === target.id)!.revision, target.revision + 1);
    assert.ok(removed.notes.find(note => note.id === target.id)!.deletedAt);
    assert.deepEqual(removed.notes.find(note => note.id === 'note-2'), before.notes.find(note => note.id === 'note-2'));
    store.apply({ id: 'note-1-restore', kind: 'note-remove', threadId: keep.threadId, noteId: target.id, expectedRevision: target.revision + 1, removed: false });
    const restored = store.get(keep.threadId)!;
    assert.equal(restored.revision, removed.revision + 1);
    assert.equal(restored.notes.find(note => note.id === target.id)!.revision, target.revision + 2);
    assert.equal(restored.notes.find(note => note.id === target.id)!.deletedAt, null);
    assert.deepEqual(restored.notes.find(note => note.id === 'note-2'), before.notes.find(note => note.id === 'note-2'));
  } finally { store.close(); }
});

test('reattachment preserves exact, moved, ambiguous and missing states without fuzzy guessing', () => {
  const a = keep.anchor;
  assert.equal(attachQuote(a, keep.capture.text).state, 'exact');
  assert.equal(attachQuote(a, 'New introduction. ' + keep.capture.text).state, 'moved');
  assert.equal(attachQuote(a, keep.capture.text + ' ' + keep.capture.text).state, 'unsure');
  assert.equal(attachQuote(a, 'Before. A changed passage. After.').state, 'lost');
});

test('target captures and per-tab attachment records survive SQLite reopen without changing original evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-attachment-'));
  const filename = join(dir, 'reader.sqlite');
  let store = new ReaderStore(filename);
  try {
    store.apply(keep);
    const original = store.exportThread(keep.threadId);
    const moved = { ...keep.capture, text: 'New introduction. ' + keep.capture.text, title: 'Revised title', capturedAt: '2026-09-18T00:00:00Z' };
    assert.equal(store.reattach(keep.threadId, moved.text, 'tab-one', moved).state, 'moved');
    store.reattach(keep.threadId, moved.text, 'tab-one', moved);
    store.reattach(keep.threadId, moved.text, 'tab-two', moved);
    const missing = 'A completely changed page.';
    assert.equal(store.reattach(keep.threadId, missing, 'legacy-tab').state, 'lost');
    const repeated = { ...moved, text: keep.capture.text + ' ' + keep.capture.text };
    assert.equal(store.reattach(keep.threadId, repeated.text, 'tab-three', repeated).state, 'unsure');
    assert.throws(() => store.reattach(keep.threadId, moved.text, 'wrong', { ...moved, url: 'https://other.example/' }), /does not match/);
    const cursor = (store.events().at(-1) as { seq: number }).seq;
    store.close(); store = new ReaderStore(filename);
    const exported = store.exportThread(keep.threadId);
    assert.deepEqual(exported.source, original.source);
    assert.deepEqual(exported.thread.anchor, original.thread.anchor);
    assert.equal(exported.thread.sourceTitle, keep.capture.title);
    assert.equal(exported.attachments.length, 4);
    assert.equal(exported.targetVersions.length, 3);
    const target = exported.targetVersions.find(v => v.text === moved.text)!;
    assert.equal(target.title, moved.title);
    assert.equal(target.capturedAt, moved.capturedAt);
    const legacy = exported.targetVersions.find(v => v.text === missing)!;
    assert.equal(legacy.metadataStatus, 'unavailable');
    assert.equal(legacy.capturedAt, null);
    assert.equal(legacy.extractionVersion, null);
    assert.equal(legacy.title, null);
    assert.ok(exported.attachments.every(a => a.targetAvailable));
    assert.deepEqual(store.events(cursor), []);
    assert.throws(() => store.db.prepare('UPDATE source_versions SET text=? WHERE id=?').run('edited', original.source!.id), /immutable/);
    assert.throws(() => store.db.prepare('UPDATE anchors SET json=? WHERE id=?').run('{}', original.thread.anchorId), /immutable/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('per-page reading position round-trips as a quote anchor across SQLite reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-position-'));
  const file = join(dir, 'reader.sqlite');
  const position = { exact: 'source passage.', prefix: 'Before. A ', suffix: ' After.', start: 10, end: 25 };
  try {
    const first = new ReaderStore(file);
    first.saveReaderPosition(keep.capture, position);
    assert.deepEqual(first.readerPosition(keep.capture.url), position);
    first.close();
    const reopened = new ReaderStore(file);
    assert.deepEqual(reopened.readerPosition(keep.capture.url), position);
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('whole-page notes are explicit, unhighlighted and reject malformed empty quote anchors', () => {
  const store = new ReaderStore(':memory:');
  try {
    store.apply({ ...keep, anchor: wholePageAnchor() });
    assert.equal(store.get(keep.threadId)!.highlighted, false);
    assert.deepEqual(store.reattach(keep.threadId, 'changed', 'tab'), { state: 'exact', candidates: [] });
    for (const anchor of [{ ...wholePageAnchor(), kind: 'quote' as const }, { ...wholePageAnchor(), exact: 'text' }]) {
      assert.throws(() => store.apply({ ...keep, id: 'bad', threadId: 'bad', anchor }), /Invalid passage/);
    }
    assert.equal(store.list().length, 1);
  } finally { store.close(); }
});

test('immutable validated reply versions quote the answered note and persist independent current parameters/view with undo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-replies-'));
  const filename = join(dir, 'reader.sqlite');
  let store = new ReaderStore(filename);
  try {
    store.apply({ ...keep, capture: { ...keep.capture, text: growthSourceText }, anchor: wholePageAnchor() });
    const input = { id: 'reply-one', threadId: keep.threadId, reply: growthReply, answeredNote: { noteId: keep.id + '-note', revision: 1 } };
    const committed = store.commitReply(input);
    assert.deepEqual(store.commitReply(input), committed);
    store.apply({ id: 'edit-note', kind: 'note', threadId: keep.threadId, noteId: input.answeredNote.noteId, expectedRevision: 1, text: 'The later question.' });
    assert.equal(store.reply(input.id)!.answeredNote!.text, keep.note);
    const viewChange = { id: 'view-one', replyVersionId: input.id, expectedRevision: 1, parameters: { ...growthDefaultParameters, f: 0.2 }, view: { expanded: 'growth-plot', range: [0, 8] } };
    const view = store.saveReplyView(viewChange);
    assert.deepEqual(store.saveReplyView(viewChange), view);
    assert.throws(() => store.saveReplyView({ ...viewChange, id: 'stale-view' }), ConflictError);
    assert.throws(() => store.saveReplyView({ ...viewChange, id: 'bad-view', expectedRevision: 2, parameters: { ...viewChange.parameters, f: Infinity } }), /Invalid current/);
    assert.deepEqual(store.reply(input.id)!.reply, growthReply);
    assert.equal(hostReportMatches(growthReply, view.parameters, committed.validation), false, 'default report must not attest to changed controls');
    const revised = structuredClone(growthReply);
    revised.assumptions[0].text = 'A deliberately revised model assumption.';
    store.commitReply({ id: 'reply-two', threadId: keep.threadId, reply: revised, parentId: input.id, supersedes: input.id });
    assert.throws(() => store.commitReply({ ...input, reply: revised }), ConflictError);
    assert.throws(() => store.commitReply({ ...input, id: 'invalid-reply', reply: { ...growthReply, blocks: [{ type: 'text', id: 'bad', md: '<script>bad()</script>' }] } }), /raw HTML/);
    const remove = { id: 'remove-reply', replyVersionId: input.id, removed: true, expectedRevision: 1 };
    store.setReplyRemoved(remove); store.setReplyRemoved(remove);
    assert.equal(store.db.prepare("SELECT 1 FROM search WHERE entityId=? AND kind='reply'").get(input.id), undefined);
    assert.equal(store.replies(keep.threadId).length, 1);
    store.close(); store = new ReaderStore(filename);
    assert.equal(store.replies(keep.threadId, true).length, 2);
    assert.deepEqual(store.replyView(input.id), view);
    assert.equal(store.reply(input.id)!.answeredNote!.revision, 1);
    store.setReplyRemoved({ id: 'undo-reply', replyVersionId: input.id, removed: false, expectedRevision: 2 });
    assert.ok(store.db.prepare("SELECT 1 FROM search WHERE entityId=? AND kind='reply'").get(input.id));
    assert.equal(store.replies(keep.threadId).length, 2);
    assert.equal(store.exportThread(keep.threadId).replyViews.length, 2);
    assert.throws(() => store.db.prepare('UPDATE reply_versions SET json=? WHERE id=?').run('{}', input.id), /immutable/);
    assert.throws(() => store.db.prepare('UPDATE note_versions SET text=? WHERE noteId=?').run('changed', input.answeredNote.noteId), /immutable/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('outbox and mutation receipt commit atomically with notes, and retries accept reordered JSON keys', () => {
  const store = new ReaderStore(':memory:');
  try {
    store.apply(keep);
    const reordered = { note: keep.note, anchor: keep.anchor, capture: keep.capture, threadId: keep.threadId, kind: 'keep' as const, id: keep.id };
    assert.deepEqual(store.apply(reordered), { threadId: keep.threadId, revision: 1 });
    store.db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
    const edit = { id: 'edit', kind: 'note' as const, threadId: keep.threadId, noteId: keep.id + '-note', text: 'Changed', expectedRevision: 1 };
    assert.throws(() => store.apply(edit), /disk failure/);
    assert.equal(store.get(keep.threadId)!.notes[0].revision, 1);
    assert.equal(store.exportThread(keep.threadId).noteVersions.length, 1);
    assert.equal(store.db.prepare('SELECT 1 FROM mutation_receipts WHERE id=?').get(edit.id), undefined);
    store.db.exec('DROP TRIGGER fail_event');
    store.apply(edit);
    assert.equal(store.events().length, 2);
  } finally { store.close(); }
});

test('v1 database migration preserves original captures and labels unrecoverable hash-only attachment history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-migration-'));
  const filename = join(dir, 'reader.sqlite');
  const old = new Database(filename);
  old.exec(`
    CREATE TABLE migrations(version INTEGER PRIMARY KEY);
    INSERT INTO migrations VALUES(1);
    CREATE TABLE sources(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,title TEXT NOT NULL,pageType TEXT NOT NULL);
    CREATE TABLE source_versions(id TEXT PRIMARY KEY,sourceId TEXT NOT NULL REFERENCES sources(id),hash TEXT NOT NULL,text TEXT NOT NULL,capturedAt TEXT NOT NULL,extractionVersion TEXT NOT NULL,UNIQUE(sourceId,hash,extractionVersion));
    CREATE TABLE anchors(id TEXT PRIMARY KEY,sourceVersionId TEXT NOT NULL REFERENCES source_versions(id),json TEXT NOT NULL);
    CREATE TABLE attachments(id TEXT PRIMARY KEY,anchorId TEXT NOT NULL REFERENCES anchors(id),targetVersionId TEXT NOT NULL,tabCapture TEXT NOT NULL,state TEXT NOT NULL,candidates TEXT NOT NULL);
    CREATE TABLE threads(id TEXT PRIMARY KEY,anchorId TEXT NOT NULL REFERENCES anchors(id),state TEXT NOT NULL DEFAULT 'open',revision INTEGER NOT NULL DEFAULT 1,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,deletedAt TEXT);
    INSERT INTO sources VALUES('s','https://example.org/paper','Old title','paper');
    INSERT INTO source_versions VALUES('v','s','hash','original','2026-09-17T00:00:00Z','v1');
    INSERT INTO anchors VALUES('a','v','{"exact":"original","prefix":"","suffix":"","start":0,"end":8}');
    INSERT INTO threads(id,anchorId,createdAt,updatedAt) VALUES('t','a','2026-09-17','2026-09-17');
    INSERT INTO attachments VALUES('old-attachment','a','unrecoverable-hash','old-tab','moved','[{"start":4,"end":12}]');
  `);
  old.close();
  let store = new ReaderStore(filename);
  try {
    assert.equal(store.sourceVersion('v')!.metadataStatus, 'legacy');
    assert.equal(store.sourceVersion('v')!.text, 'original');
    assert.equal(store.attachments('t')[0].targetAvailable, false);
    assert.equal(store.attachments('t')[0].recordedAt, null);
    assert.deepEqual(store.exportThread('t').targetVersions, []);
    store.close(); store = new ReaderStore(filename);
    assert.equal(store.list().length, 1);
    assert.deepEqual(store.db.prepare('SELECT version FROM migrations ORDER BY version').all().map(row => (row as { version: number }).version), [1, 2, 4, 7001, 7002, 7004]);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});


test('T07 F2 material metadata and section maps have independent immutable identities, not capture timestamps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-metadata-'));
  const filename = join(dir, 'reader.sqlite');
  let store = new ReaderStore(filename);
  try {
    const save = (id: string, capture: typeof keep.capture) => {
      store.apply({ ...keep, id, threadId: id, capture });
      return store.sourceVersion(store.get(id)!.sourceVersionId)!;
    };
    const original = save('original', keep.capture);
    const later = save('later', { ...keep.capture, capturedAt: '2026-09-18T00:00:00Z' });
    assert.deepEqual(later, original, 'capture time alone reuses the first immutable record');
    const title = save('title', { ...keep.capture, title: 'New title' });
    const type = save('type', { ...keep.capture, pageType: 'article' });
    const sections = [{ title: 'First', start: 0, end: keep.capture.text.length }];
    const sectioned = save('sectioned', { ...keep.capture, sections });
    const sectionTitle = save('section-title', { ...keep.capture, sections, title: 'New title' });
    assert.equal(new Set([original, title, type, sectioned, sectionTitle].map(v => v.id)).size, 5);
    assert.equal(save('same-material', { ...keep.capture, title: 'New title' }).id, title.id);
    assert.deepEqual(store.sourceVersion(original.id), original);
    assert.throws(() => store.db.prepare(`INSERT INTO source_versions SELECT 'duplicate',sourceId,hash,text,capturedAt,extractionVersion,title,pageType,metadataStatus,sections FROM source_versions WHERE id=?`).run(original.id), /UNIQUE/);
    assert.throws(() => store.db.prepare('UPDATE source_versions SET title=? WHERE id=?').run('Rewritten', original.id), /immutable/);
    store.close(); store = new ReaderStore(filename);
    assert.deepEqual(store.sourceVersion(original.id), original);
    assert.equal(store.get('title')!.sourceTitle, 'New title');
    assert.deepEqual(store.sourceVersion(sectionTitle.id)!.sections, sections);
    assert.deepEqual(store.db.pragma('foreign_key_check'), []);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('T07 F2 v4 upgrade preserves old IDs, legacy/unavailable metadata and foreign-key references', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-v4-'));
  const filename = join(dir, 'reader.sqlite');
  const old = new Database(filename);
  const sourceId = digest(keep.capture.url), textHash = digest(keep.capture.text);
  // The v4 schema and IDs are fixtures, not produced by the new migration.
  old.exec(`
    CREATE TABLE migrations(version INTEGER PRIMARY KEY);
    INSERT INTO migrations VALUES(1),(2),(3),(4),(13);
    CREATE TABLE sources(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,title TEXT NOT NULL,pageType TEXT NOT NULL);
    CREATE TABLE source_versions(id TEXT PRIMARY KEY,sourceId TEXT NOT NULL REFERENCES sources(id),hash TEXT NOT NULL,text TEXT NOT NULL,capturedAt TEXT NOT NULL,extractionVersion TEXT NOT NULL,title TEXT,pageType TEXT,metadataStatus TEXT NOT NULL DEFAULT 'legacy',sections TEXT NOT NULL DEFAULT '',UNIQUE(sourceId,hash,extractionVersion,sections));
    CREATE TABLE anchors(id TEXT PRIMARY KEY,sourceVersionId TEXT NOT NULL REFERENCES source_versions(id),json TEXT NOT NULL);
    CREATE TABLE attachments(id TEXT PRIMARY KEY,anchorId TEXT NOT NULL REFERENCES anchors(id),targetVersionId TEXT NOT NULL,tabCapture TEXT NOT NULL,state TEXT NOT NULL,candidates TEXT NOT NULL,recordedAt TEXT);
    CREATE TABLE threads(id TEXT PRIMARY KEY,anchorId TEXT NOT NULL REFERENCES anchors(id),state TEXT NOT NULL DEFAULT 'open',revision INTEGER NOT NULL DEFAULT 1,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,deletedAt TEXT);
    CREATE TRIGGER source_version_immutable BEFORE UPDATE ON source_versions BEGIN SELECT RAISE(ABORT,'Source versions are immutable'); END;
  `);
  old.prepare('INSERT INTO sources VALUES(?,?,?,?)').run(sourceId, keep.capture.url, keep.capture.title, keep.capture.pageType);
  const insert = old.prepare('INSERT INTO source_versions VALUES(?,?,?,?,?,?,?,?,?,?)');
  insert.run('legacy-id', sourceId, textHash, keep.capture.text, keep.capture.capturedAt, keep.capture.extractionVersion, null, null, 'legacy', '');
  insert.run('provided-old-id', sourceId, textHash, keep.capture.text, keep.capture.capturedAt, 'provided-v4', keep.capture.title, keep.capture.pageType, 'provided', '');
  insert.run('unavailable-id', sourceId, textHash, keep.capture.text, '', '', null, null, 'unavailable', '');
  old.prepare('INSERT INTO anchors VALUES(?,?,?)').run('anchor-old', 'legacy-id', JSON.stringify(keep.anchor));
  old.prepare('INSERT INTO threads(id,anchorId,createdAt,updatedAt) VALUES(?,?,?,?)').run('thread-old', 'anchor-old', keep.capture.capturedAt, keep.capture.capturedAt);
  old.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)').run('attachment-old', 'anchor-old', 'unavailable-id', 'old-tab', 'exact', '[]', null);
  const rows = old.prepare('SELECT * FROM source_versions ORDER BY id').all();
  old.close();
  let store = new ReaderStore(filename);
  try {
    assert.deepEqual(store.db.prepare('SELECT * FROM source_versions ORDER BY id').all(), rows);
    assert.equal(store.get('thread-old')!.sourceVersionId, 'legacy-id');
    assert.equal(store.attachments('thread-old')[0].targetVersionId, 'unavailable-id');
    assert.equal(store.attachments('thread-old')[0].targetAvailable, true);
    store.apply({ ...keep, capture: { ...keep.capture, extractionVersion: 'provided-v4' } });
    assert.equal(store.get(keep.threadId)!.sourceVersionId, 'provided-old-id');
    store.apply({ ...keep, id: 'upgrade-facts', threadId: 'upgrade-facts' });
    assert.notEqual(store.get('upgrade-facts')!.sourceVersionId, 'legacy-id');
    assert.equal(store.sourceVersion('legacy-id')!.metadataStatus, 'legacy');
    assert.equal(store.sourceVersion('legacy-id')!.title, null);
    // Null and empty metadata remain distinct; SQL and application identity agree.
    store.db.prepare(`INSERT INTO source_versions SELECT 'empty-title',sourceId,hash,text,capturedAt,extractionVersion,'',pageType,metadataStatus,sections FROM source_versions WHERE id='legacy-id'`).run();
    assert.throws(() => store.db.prepare(`INSERT INTO source_versions SELECT 'duplicate-null',sourceId,hash,text,capturedAt,extractionVersion,title,pageType,metadataStatus,sections FROM source_versions WHERE id='legacy-id'`).run(), /UNIQUE/);
    assert.throws(() => store.db.prepare("UPDATE source_versions SET title='changed' WHERE id='legacy-id'").run(), /immutable/);
    store.close(); store = new ReaderStore(filename);
    assert.deepEqual(store.db.pragma('foreign_key_check'), []);
    assert.deepEqual(store.db.prepare('SELECT version FROM migrations ORDER BY version').all().map(row => (row as { version: number }).version), [1, 2, 3, 4, 13, 7001, 7002, 7004]);
    assert.equal(store.sourceVersion('unavailable-id')!.capturedAt, null);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('T07 F7 ReaderStore rejects shared bound violations before any durable mutation', () => {
  const store = new ReaderStore(':memory:');
  try {
    store.apply(keep);
    const before = store.exportThread(keep.threadId), events = store.events();
    const invalid = [
      { id: 'long-note', kind: 'note', threadId: keep.threadId, noteId: keep.id + '-note', expectedRevision: 1, text: 'x'.repeat(20001) },
      { ...keep, id: 'invalid-section', threadId: 'new-thread', capture: { ...keep.capture, sections: [{ title: 'Bad', start: 0, end: 1000 }] } },
      { ...keep, id: 'x'.repeat(101), threadId: 'new-thread' },
    ];
    for (const change of invalid) assert.throws(() => store.apply(change as ReaderMutation), { name: 'InvalidReaderMutation' });
    assert.deepEqual(store.exportThread(keep.threadId), before);
    assert.deepEqual(store.events(), events);
    assert.equal(store.list().length, 1);
  } finally { store.close(); }
});

// Same-database tables only: no provider, consent service or retrieval execution is involved.
function addHistoryTables(store: ReaderStore) {
  store.db.exec(`
    CREATE TABLE jobs(id TEXT PRIMARY KEY,threadId TEXT NOT NULL REFERENCES threads(id),idempotencyKey TEXT NOT NULL,packetDigest TEXT NOT NULL,requestDigest TEXT NOT NULL,preparedPayloadDigest TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,mode TEXT NOT NULL,policyKey TEXT NOT NULL,grantId TEXT NOT NULL,state TEXT NOT NULL,cancelRequested INTEGER NOT NULL,latestAttemptId TEXT,replyVersionId TEXT,reason TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,context TEXT NOT NULL,capabilities TEXT NOT NULL,provisional TEXT);
    CREATE TABLE job_attempts(id TEXT PRIMARY KEY,jobId TEXT NOT NULL REFERENCES jobs(id),number INTEGER NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,dispatchClaimed INTEGER NOT NULL,handoffMarked INTEGER NOT NULL,workspacePrepared INTEGER NOT NULL,predecessorAttemptId TEXT,authorizationFingerprint TEXT,startedAt TEXT,deadlineAt TEXT,endedAt TEXT,reason TEXT,providerHandle TEXT);
    CREATE TABLE consent_attempt_authorizations(id TEXT PRIMARY KEY,jobId TEXT NOT NULL,attemptId TEXT NOT NULL,grantId TEXT NOT NULL,grantRevision INTEGER NOT NULL,sitePermissionEpoch INTEGER NOT NULL,site TEXT NOT NULL,scope TEXT NOT NULL,recipient TEXT NOT NULL,provider TEXT NOT NULL,policyKey TEXT NOT NULL,bindingDigest TEXT NOT NULL,permissionFingerprint TEXT NOT NULL,egressEventId TEXT NOT NULL,createdAt TEXT NOT NULL,dispatchedAt TEXT,acceptedAt TEXT,outcome TEXT);
    CREATE TABLE egress_events(id TEXT PRIMARY KEY,jobId TEXT NOT NULL,attemptId TEXT NOT NULL,grantId TEXT NOT NULL,grantRevision INTEGER NOT NULL,recipient TEXT NOT NULL,scope TEXT NOT NULL,provider TEXT NOT NULL,policyKey TEXT NOT NULL,contextHashes TEXT NOT NULL,permissionFingerprint TEXT NOT NULL,approvedAt TEXT NOT NULL,dispatchedAt TEXT,outcome TEXT,fetched TEXT NOT NULL,complete INTEGER NOT NULL,updatedAt TEXT NOT NULL);
  `);
}

test('T07 F8 export is thread-scoped, separates observed output from host facts and excludes account data', () => {
  const store = new ReaderStore(':memory:');
  try {
    store.apply(keep);
    store.apply({ ...keep, id: 'other-keep', threadId: 'other-thread' });
    const before = store.exportThread(keep.threadId);
    assert.deepEqual(before.execution.missingTables, ['jobs', 'job_attempts', 'consent_attempt_authorizations', 'egress_events']);
    assert.deepEqual(before.execution.jobs, []);
    addHistoryTables(store);
    const now = keep.capture.capturedAt, hash = 'a'.repeat(64);
    const fetched = [{ requestedUrl: 'https://user:SECRET_PASSWORD@public.example/item', finalUrl: 'https://public.example/item', status: 200, contentType: 'text/plain', sha256: hash, bytes: 12, fetchedAt: now, outcome: 'fetched', redirects: [{ url: 'https://public.example/start', status: 302, location: 'https://public.example/item', headers: 'SECRET_REDIRECT_HEADER' }], headers: 'SECRET_HEADERS', body: 'SECRET_BODY' }];
    for (const [jobId, threadId] of [['mine', keep.threadId], ['other-job', 'other-thread']]) {
      const context = { threadId, sourceVersionId: before.source!.id, sourceUrl: keep.capture.url, question: 'My saved question', intent: 'define', passage: keep.anchor, sourceText: 'SECRET_RAW_CONTEXT', credentials: 'SECRET_CONTEXT_CREDENTIAL', outgoing: { schema: 'marginalia.job-packet.v1', intent: 'define', question: 'My saved question', source: { url: keep.capture.url, title: 'Test source', sourceVersionId: before.source!.id }, selection: { exact: keep.anchor.exact, start: keep.anchor.start, end: keep.anchor.end }, adjacentContext: { before: 'Before. ', after: ' After.', basis: 'bounded-character-context' }, availableCapabilities: [], omissions: ['No library matches'], token: 'SECRET_PACKET_TOKEN' } };
      store.db.prepare(`INSERT INTO jobs(
        id,threadId,idempotencyKey,packetDigest,requestDigest,preparedPayloadDigest,provider,model,mode,policyKey,grantId,state,
        cancelRequested,latestAttemptId,replyVersionId,reason,createdAt,updatedAt,context,capabilities,provisional
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(jobId, threadId, jobId, hash, hash, hash, 'app-server', 'model', 'structured-final', hash, 'shared-grant', 'outcome_unknown', 1, jobId + '-attempt', null, 'disconnected', now, now, JSON.stringify(context), '[]', 'SECRET_PROVISIONAL');
      store.db.prepare(`INSERT INTO job_attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(jobId + '-attempt', jobId, 1, 'outcome_unknown', 4, 1, 1, 1, null, hash, now, now, now, 'disconnected', JSON.stringify({ threadId: jobId + '-provider', turnId: 'turn', state: 'completed', revision: 4, tombstone: false, output: 'SECRET_UNVALIDATED_OUTPUT', workspace: 'SECRET_ACCOUNT_PATH', credential: 'SECRET_PROVIDER_CREDENTIAL' }));
      store.db.prepare(`INSERT INTO consent_attempt_authorizations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(jobId + '-auth', jobId, jobId + '-attempt', 'shared-grant', 2, 3, 'https://example.org', 'cloud-inference', 'openai-codex', 'app-server', hash, hash, hash, jobId + '-egress', now, now, null, 'outcome_unknown');
      store.db.prepare(`INSERT INTO egress_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(jobId + '-egress', jobId, jobId + '-attempt', 'shared-grant', 2, 'openai-codex', 'cloud-inference', 'app-server', hash, JSON.stringify([hash]), hash, now, now, 'outcome_unknown', JSON.stringify(fetched), 0, now);
    }
    store.db.prepare('INSERT INTO settings VALUES(?,?)').run('account', 'SECRET_SETTINGS');
    store.db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?)').run('unrelated-grant', 'https://other.example', 'cloud-inference', 'SECRET_RECIPIENT', 'allow-site', now, null);
    const changes = store.db.prepare('SELECT total_changes() AS n').get();
    const exported = store.exportThread(keep.threadId), history = exported.execution;
    assert.deepEqual(store.db.prepare('SELECT total_changes() AS n').get(), changes, 'export is read-only');
    assert.equal(exported.schema, before.schema);
    assert.deepEqual(exported.source, before.source);
    assert.equal(history.authority, 'host-recorded');
    assert.deepEqual(history.missingTables, []);
    assert.deepEqual(history.jobs.map(row => row.id), ['mine']);
    assert.deepEqual(history.attempts.map(row => row.id), ['mine-attempt']);
    assert.deepEqual(history.authorizations.map(row => row.id), ['mine-auth']);
    assert.deepEqual(history.egress.map(row => row.id), ['mine-egress']);
    assert.equal(history.jobs[0].state, 'outcome_unknown');
    assert.equal(history.jobs[0].request.question, 'My saved question');
    assert.equal(history.attempts[0].providerObservation!.state, 'completed', 'provider observation is not promoted to host success');
    assert.equal(history.authorizations[0].grantRevision, 2);
    assert.equal(history.authorizations[0].sitePermissionEpoch, 3);
    assert.equal(history.egress[0].retrievalComplete, false, 'missing confinement evidence stays incomplete');
    assert.deepEqual(history.egress[0].contextHashes, [hash]);
    assert.equal(history.egress[0].fetched[0].requestedUrl, 'https://public.example/item');
    assert.deepEqual(history.egress[0].fetched[0].redactedUrls, ['requestedUrl']);
    assert.deepEqual(history.egress[0].fetched[0].redirects, [{ url: 'https://public.example/start', status: 302, location: 'https://public.example/item' }]);
    const text = JSON.stringify(exported);
    assert.ok(!text.includes('SECRET_'));
    assert.ok(!text.includes('other-job') && !text.includes('unrelated-grant'));
    store.apply({ id: 'remove-exported', kind: 'remove', threadId: keep.threadId, expectedRevision: 1, removed: true });
    assert.deepEqual(store.exportThread(keep.threadId).execution, history, 'removal retains execution history');
  } finally { store.close(); }
});
