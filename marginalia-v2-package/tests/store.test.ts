import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ReaderStore, ConflictError } from '../daemon/store.ts';
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
    assert.equal(store.replies(keep.threadId).length, 1);
    store.close(); store = new ReaderStore(filename);
    assert.equal(store.replies(keep.threadId, true).length, 2);
    assert.deepEqual(store.replyView(input.id), view);
    assert.equal(store.reply(input.id)!.answeredNote!.revision, 1);
    store.setReplyRemoved({ id: 'undo-reply', replyVersionId: input.id, removed: false, expectedRevision: 2 });
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
    assert.equal((store.db.prepare('SELECT count(*) AS n FROM migrations').get() as { n: number }).n, 2);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
