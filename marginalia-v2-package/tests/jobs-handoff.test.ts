import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { ReaderStore } from '../daemon/store.ts';
import { JobStore, JobConflictError } from '../daemon/jobs/store.ts';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import type { FrozenJobContext, JobSnapshot, StartJobInput } from '../contracts/jobs.ts';

const policyKey = 'a'.repeat(64), digest = 'd'.repeat(64);
function fixture(prepared = true) {
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
  if (prepared) prepareAttempt(store, input.id, attempt.id);
  const expected = store.get(input.id)!;
  return { reader, store, attemptId: attempt.id, expected };
}
function prepareAttempt(store: JobStore, jobId: string, attemptId: string) {
  store.setDeadline(jobId, attemptId, new Date(Date.now() + 60_000).toISOString());
  store.markPreparing(jobId, attemptId);
  store.markWorkspacePrepared(jobId, attemptId);
}
function realFixture() {
  const f = fixture(false), consent = new ConsentSessionService({ db: f.store.db });
  const preview = consent.prepare({ requestId: f.expected.id, sourceUrl: f.expected.context.sourceUrl,
    scope: 'open-session', recipient: 'openai-codex', recipientLabel: 'OpenAI Codex', provider: f.expected.provider,
    policyKey: f.expected.policyKey, bindingDigest: f.expected.preparedPayloadDigest,
    outgoing: [{ label: 'Reviewed packet', text: 'Start here.', sha256: createHash('sha256').update('Start here.').digest('hex') }] });
  const grant = consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'this-time' },
    { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' });
  f.store.db.prepare('UPDATE jobs SET grantId=? WHERE id=?').run(grant.id, f.expected.id);
  return { ...f, consent, grant, current: () => f.store.get(f.expected.id)! };
}
function rows(f: ReturnType<typeof realFixture>) {
  const db = f.store.db;
  return {
    consumed: (db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(f.grant.id) as { consumedAttemptId: string | null }).consumedAttemptId,
    authorizations: (db.prepare('SELECT count(*) n FROM consent_attempt_authorizations').get() as { n: number }).n,
    egress: (db.prepare('SELECT count(*) n FROM egress_events').get() as { n: number }).n,
    handoff: f.current().attempts.find(a => a.id === f.attemptId)?.handoffMarked ?? false,
  };
}
function realHandoff(f: ReturnType<typeof realFixture>, expected: JobSnapshot, token: string, afterFinalize?: () => unknown) {
  return f.store.withDispatchHandoff(expected, expected.latestAttemptId!, f.consent, current => {
    const authorization = f.consent.finalizeDispatch(current, expected.latestAttemptId!, token);
    return afterFinalize ? afterFinalize() : authorization;
  });
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
  ['invalid deadline', (f: ReturnType<typeof fixture>) => f.store.db.prepare("UPDATE job_attempts SET deadlineAt='not-a-date' WHERE id=?").run(f.attemptId)],
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

test('real consent eligibility and mutable preparation make no grant, authorization or egress writes', async () => {
  const f = realFixture();
  try {
    const decision = await f.consent.revalidate(f.current(), 'dispatch');
    assert.match(decision.eligibilityFingerprint ?? '', /^[a-f0-9]{64}$/);
    assert.deepEqual(rows(f), { consumed: null, authorizations: 0, egress: 0, handoff: false });
    f.store.setDeadline(f.expected.id, f.attemptId, new Date(Date.now() + 60_000).toISOString());
    f.store.markPreparing(f.expected.id, f.attemptId);
    f.store.bindAuthorization(f.attemptId, 'f'.repeat(64));
    f.store.markWorkspacePrepared(f.expected.id, f.attemptId);
    const expected = f.current();
    assert.deepEqual(rows(f), { consumed: null, authorizations: 0, egress: 0, handoff: false });
    realHandoff(f, expected, decision.eligibilityFingerprint!);
    assert.deepEqual(rows(f), { consumed: f.attemptId, authorizations: 1, egress: 1, handoff: true });
    const checked = await f.consent.revalidate(f.current(), 'dispatch');
    assert.equal(checked.eligibilityFingerprint, undefined);
    assert.deepEqual(rows(f), { consumed: f.attemptId, authorizations: 1, egress: 1, handoff: true });
  } finally { f.reader.close(); }
});

test('real consent leaves once grant usable when preparation fails before handoff', async () => {
  const f = realFixture();
  try {
    const token = (await f.consent.revalidate(f.current(), 'dispatch')).eligibilityFingerprint!;
    assert.throws(() => { throw new Error('provider preparation failed'); }, /provider preparation failed/);
    assert.deepEqual(rows(f), { consumed: null, authorizations: 0, egress: 0, handoff: false });
    prepareAttempt(f.store, f.expected.id, f.attemptId);
    realHandoff(f, f.current(), token);
    assert.deepEqual(rows(f), { consumed: f.attemptId, authorizations: 1, egress: 1, handoff: true });
  } finally { f.reader.close(); }
});

for (const [name, callback] of [
  ['throw', (f: ReturnType<typeof realFixture>) => { throw new Error('after finalize'); }],
  ['thenable', (_f: ReturnType<typeof realFixture>) => ({ then() {} })],
  ['fence mutation', (f: ReturnType<typeof realFixture>) => f.store.db.prepare('UPDATE job_attempts SET revision=revision+1 WHERE id=?').run(f.attemptId)],
] as const) {
  test(`real consent ${name} rolls back grant, authorization, egress and handoff`, async () => {
    const f = realFixture();
    try {
      prepareAttempt(f.store, f.expected.id, f.attemptId);
      const expected = f.current(), token = (await f.consent.revalidate(expected, 'dispatch')).eligibilityFingerprint!;
      assert.throws(() => realHandoff(f, expected, token, () => callback(f)));
      assert.deepEqual(rows(f), { consumed: null, authorizations: 0, egress: 0, handoff: false });
      assert.equal(f.current().attempts[0].revision, 0);
      assert.equal((f.store.db.prepare("SELECT count(*) n FROM events WHERE kind IN ('egress-approved','egress-dispatched')").get() as { n: number }).n, 0);
    } finally { f.reader.close(); }
  });
}

test('two eligible attempts contend for one real grant; only current attempt finalizes', async () => {
  const f = realFixture();
  try {
    prepareAttempt(f.store, f.expected.id, f.attemptId);
    const first = f.current(), firstToken = (await f.consent.revalidate(first, 'dispatch')).eligibilityFingerprint!;
    const secondId = f.store.createAttempt(f.expected.id).id;
    prepareAttempt(f.store, f.expected.id, secondId);
    const second = f.current(), secondToken = (await f.consent.revalidate(second, 'dispatch')).eligibilityFingerprint!;
    assert.notEqual(firstToken, secondToken);
    assert.throws(() => realHandoff(f, first, firstToken), /changed/);
    assert.deepEqual(rows(f), { consumed: null, authorizations: 0, egress: 0, handoff: false });
    realHandoff(f, second, secondToken);
    assert.equal(rows(f).consumed, secondId);
    assert.equal(rows(f).authorizations, 1);
    assert.equal(rows(f).egress, 1);
    assert.throws(() => realHandoff(f, first, firstToken), /changed/);
  } finally { f.reader.close(); }
});

for (const change of ['revoke', 'exclude'] as const) {
  test(`real ${change} after eligibility refuses handoff without spending`, async () => {
    const f = realFixture();
    try {
      prepareAttempt(f.store, f.expected.id, f.attemptId);
      const expected = f.current(), token = (await f.consent.revalidate(expected, 'dispatch')).eligibilityFingerprint!;
      if (change === 'revoke') f.consent.revokeGrant(f.grant.id, f.grant.revision);
      else f.consent.setExclusion('https://example.org', true);
      assert.throws(() => realHandoff(f, expected, token));
      assert.deepEqual(rows(f), { consumed: null, authorizations: 0, egress: 0, handoff: false });
    } finally { f.reader.close(); }
  });
}
