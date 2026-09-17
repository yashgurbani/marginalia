import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ReaderStore } from '../daemon/store.ts';
import { JobStore, JobConflictError } from '../daemon/jobs/store.ts';
import type { FrozenJobContext, JobSnapshot, StartJobInput } from '../contracts/jobs.ts';

const policyKey = 'a'.repeat(64), digest = 'd'.repeat(64);
function fixture() {
  const reader = new ReaderStore(':memory:');
  reader.apply({ id: 'keep-handoff', kind: 'keep', threadId: 'thread-handoff',
    capture: { url: 'https://example.org/article', title: 'Article', pageType: 'article', text: 'Start here.',
      capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' },
    anchor: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5 } });
  const thread = reader.get('thread-handoff')!, source = reader.sourceVersion(thread.sourceVersionId)!;
  const outgoing: FrozenJobContext['outgoing'] = { schema: 'marginalia.job-packet.v1', intent: 'explore', question: 'Explain',
    source: { url: thread.sourceUrl, title: thread.sourceTitle, pageType: source.pageType, capturedAt: source.capturedAt,
      sourceHash: source.hash, sourceVersionId: source.id },
    selection: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5, originalEnd: 5, omittedCharacters: 0 },
    adjacentContext: { before: '', after: '', basis: 'bounded-character-context' }, availableCapabilities: [], omissions: [] };
  const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: source.id, sourceUrl: thread.sourceUrl,
    sourceTitle: thread.sourceTitle, sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt,
    sourceHash: source.hash, sourceText: source.text, passage: thread.anchor, question: 'Explain', intent: 'explore',
    preparedPayloadDigest: digest, modelSettingsRevision: 1, modelCompatibilityKey: 'test', outgoing };
  const input: StartJobInput = { id: 'handoff-job', idempotencyKey: 'handoff-key', threadId: thread.id,
    intent: 'explore', question: 'Explain', provider: 'app-server', model: 'test-model', mode: 'workspace-files',
    policyKey, grantId: 'grant', preparedPayloadDigest: digest };
  const store = new JobStore(reader);
  store.create(input, context, 'packet', 'request');
  const attempt = store.createAttempt(input.id);
  store.setDeadline(input.id, attempt.id, new Date(Date.now() + 60_000).toISOString());
  store.markPreparing(input.id, attempt.id);
  store.markWorkspacePrepared(input.id, attempt.id);
  const expected = store.get(input.id)!;
  return { reader, store, attemptId: attempt.id, expected };
}
function handoff(f: ReturnType<typeof fixture>, callback: (job: Readonly<JobSnapshot>) => unknown, database: unknown = f.store.db) {
  return f.store.withDispatchHandoff(f.expected, f.attemptId, {
    assertSharedDatabase: actual => { if (actual !== database) throw new JobConflictError('Different database connection.'); },
  }, callback);
}

test('callback writes roll back on throw and on a returned thenable', () => {
  const f = fixture();
  try {
    f.store.db.exec('CREATE TABLE handoff_probe(value TEXT)');
    assert.throws(() => handoff(f, () => { f.store.db.prepare('INSERT INTO handoff_probe VALUES(?)').run('throw'); throw new Error('no'); }), /no/);
    assert.throws(() => handoff(f, () => { f.store.db.prepare('INSERT INTO handoff_probe VALUES(?)').run('thenable'); return { then() {} }; }), /synchronous/);
    assert.equal((f.store.db.prepare('SELECT count(*) AS n FROM handoff_probe').get() as { n: number }).n, 0);
    assert.equal(f.store.get(f.expected.id)!.attempts[0].handoffMarked, false);
  } finally { f.reader.close(); }
});

test('different native connection is refused before a transaction starts', () => {
  const f = fixture(), other = new Database(':memory:');
  try {
    let called = false;
    assert.throws(() => handoff(f, () => { called = true; }, other), /Different database/);
    assert.equal(called, false);
    assert.equal(f.store.db.inTransaction, false);
  } finally { other.close(); f.reader.close(); }
});

for (const [name, mutate] of [
  ['attempt', (f: ReturnType<typeof fixture>) => f.store.db.prepare("UPDATE jobs SET latestAttemptId='other' WHERE id=?").run(f.expected.id)],
  ['revision', (f: ReturnType<typeof fixture>) => f.store.db.prepare('UPDATE job_attempts SET revision=revision+1 WHERE id=?').run(f.attemptId)],
  ['digest', (f: ReturnType<typeof fixture>) => f.store.db.prepare("UPDATE jobs SET preparedPayloadDigest='changed' WHERE id=?").run(f.expected.id)],
  ['manifest', (f: ReturnType<typeof fixture>) => f.store.db.prepare("UPDATE jobs SET context='{}' WHERE id=?").run(f.expected.id)],
  ['cancel', (f: ReturnType<typeof fixture>) => f.store.db.prepare('UPDATE jobs SET cancelRequested=1 WHERE id=?').run(f.expected.id)],
  ['deadline', (f: ReturnType<typeof fixture>) => f.store.db.prepare("UPDATE job_attempts SET deadlineAt='2000-01-01T00:00:00Z' WHERE id=?").run(f.attemptId)],
] as const) {
  test(`stale ${name} refuses finalization`, () => {
    const f = fixture();
    try {
      mutate(f);
      let called = false;
      assert.throws(() => handoff(f, () => { called = true; }), /changed/);
      assert.equal(called, false);
    } finally { f.reader.close(); }
  });
}

test('callback mutation of a handoff fence rolls back callback writes', () => {
  const f = fixture();
  try {
    assert.throws(() => handoff(f, () => {
      f.store.db.prepare('UPDATE job_attempts SET revision=revision+1 WHERE id=?').run(f.attemptId);
      f.store.db.prepare("UPDATE jobs SET preparedPayloadDigest='changed' WHERE id=?").run(f.expected.id);
    }), /changed/);
    const current = f.store.get(f.expected.id)!;
    assert.equal(current.preparedPayloadDigest, digest);
    assert.equal(current.attempts[0].revision, 0);
    assert.equal(current.attempts[0].handoffMarked, false);
  } finally { f.reader.close(); }
});
