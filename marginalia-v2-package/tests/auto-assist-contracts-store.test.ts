import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import {
  AUTO_ASSIST_POSTURE_LIMITS, AUTO_DEFINITION_BATCH_SIZE, AUTO_DEFINITION_BUDGET_PERCENT,
  defaultAutoAssistSettings, type AutoAssistEvent,
} from '../contracts/auto-assist.ts';
import { AutoAssistStore } from '../daemon/auto-assist-store.ts';
import { LibrarySettingsService } from '../daemon/library.ts';
import { ReaderStore } from '../daemon/store.ts';

const at = '2026-09-18T12:00:00.000Z';
const event = (eventId = 'event-1'): AutoAssistEvent => ({
  eventId, candidateId: 'a'.repeat(64), pageKeyHash: 'b'.repeat(64),
  scorerMethod: 'frequency-page-v0', scorerVersion: 'frequency-page-v0.1',
  scoreBand: 2, rankInBand: 1, reasonBits: 5, posture: 'balanced', bandIndex: 3,
  event: 'shown', elapsedBucket: '2-10s', createdAt: at,
});

function disk(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'marginalia-auto-assist-'));
  t.after(() => { if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Unexpected test directory.'); rmSync(directory, { recursive: true, force: true }); });
  return join(directory, 'reader.sqlite');
}

test('auto assist defaults off with version 0 and the frozen posture and definition limits', () => {
  assert.deepEqual(defaultAutoAssistSettings(), {
    version: 1, revision: 0, enabled: false, updatedAt: null,
    method: 'frequency-page-v0', posture: 'balanced',
    autoDefinitions: { budgetPercent: 20, batchSize: 3 },
  });
  assert.equal(AUTO_DEFINITION_BUDGET_PERCENT, 20);
  assert.equal(AUTO_DEFINITION_BATCH_SIZE, 3);
  assert.deepEqual(AUTO_ASSIST_POSTURE_LIMITS, {
    flow: { underlinesPerBand: 1, pageCap: 12, readyBands: 1, assumesTerms: 3 },
    balanced: { underlinesPerBand: 2, pageCap: 20, readyBands: 2, assumesTerms: 4 },
    learning: { underlinesPerBand: 3, pageCap: 30, readyBands: 3, assumesTerms: 5 },
  });
});

test('auto assist settings are revisioned and version 0 cannot select the unimplemented causal member', () => {
  const reader = new ReaderStore(':memory:'), library = new LibrarySettingsService(reader);
  try {
    assert.deepEqual(library.autoAssist(), defaultAutoAssistSettings());
    const saved = library.saveAutoAssist({ ...library.autoAssist(), expectedRevision: 0, enabled: true, posture: 'learning' });
    assert.equal(saved.revision, 1); assert.equal(saved.enabled, true); assert.equal(saved.posture, 'learning');
    assert.deepEqual(library.autoAssist(), saved);
    assert.throws(() => library.saveAutoAssist({ ...saved, expectedRevision: 1, method: 'causal-lm-v1' } as never), /not available/);
  } finally { reader.close(); }
});

test('event storage is scalar and text-free, validates exact fields, and is append-only', () => {
  const reader = new ReaderStore(':memory:'), store = new AutoAssistStore(reader);
  try {
    const columns = (reader.db.prepare('PRAGMA table_info(auto_assist_events)').all() as { name: string }[]).map(column => column.name);
    assert.deepEqual(columns, ['eventId', 'candidateId', 'pageKeyHash', 'scorerMethod', 'scorerVersion', 'scoreBand', 'rankInBand', 'reasonBits', 'posture', 'bandIndex', 'event', 'elapsedBucket', 'createdAt']);
    for (const forbidden of ['text', 'term', 'quote', 'url', 'title', 'note', 'definition', 'prompt', 'payload']) assert.equal(columns.includes(forbidden), false);
    const shown = event();
    assert.deepEqual(store.record(shown), shown);
    assert.deepEqual(store.record(shown), shown);
    assert.deepEqual(store.list(shown.candidateId), [shown]);
    assert.throws(() => store.record({ ...shown, event: 'asked' }), /different content/);
    assert.throws(() => store.record({ ...shown, eventId: 'event-2', term: 'entropy' } as unknown as AutoAssistEvent), /fields/);
    assert.equal(reader.db.prepare('SELECT COUNT(*) FROM auto_assist_events').pluck().get(), 1);
  } finally { reader.close(); }
});

test('migration 18002 preserves instant rows and leaves deep Ask tables unchanged', t => {
  const filename = disk(t); let reader = new ReaderStore(filename);
  reader.db.exec(`
    CREATE TABLE jobs(id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE job_attempts(id TEXT PRIMARY KEY, jobId TEXT NOT NULL);
    CREATE TABLE consent_attempt_authorizations(id TEXT PRIMARY KEY, jobId TEXT NOT NULL);
    CREATE TABLE egress_events(id TEXT PRIMARY KEY, jobId TEXT NOT NULL);
    INSERT INTO jobs VALUES('deep-job','queued');
    INSERT INTO job_attempts VALUES('deep-attempt','deep-job');
    INSERT INTO consent_attempt_authorizations VALUES('deep-auth','deep-job');
    INSERT INTO egress_events VALUES('deep-egress','deep-job');
    CREATE TABLE instant_usage_v1(
      requestId TEXT PRIMARY KEY, pageKeyHash TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('prepare','selection')),
      periodStart TEXT NOT NULL, timezone TEXT NOT NULL, model TEXT NOT NULL,
      inputTokens INTEGER, cachedInputTokens INTEGER, outputTokens INTEGER, totalTokens INTEGER,
      reservedTokens INTEGER NOT NULL CHECK(reservedTokens>=0), state TEXT NOT NULL CHECK(state IN ('reserved','settled')),
      createdAt TEXT NOT NULL, settledAt TEXT,
      CHECK(inputTokens IS NULL OR inputTokens>=0), CHECK(outputTokens IS NULL OR outputTokens>=0),
      CHECK(totalTokens IS NULL OR totalTokens>=0),
      CHECK(cachedInputTokens IS NULL OR (inputTokens IS NOT NULL AND cachedInputTokens>=0 AND cachedInputTokens<=inputTokens))
    );
    INSERT INTO instant_usage_v1 SELECT * FROM instant_usage;
    DROP TABLE instant_usage;
    ALTER TABLE instant_usage_v1 RENAME TO instant_usage;
    DROP TABLE auto_assist_events;
    DELETE FROM migrations WHERE version=18002;
  `);
  reader.db.prepare(`INSERT INTO instant_usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'selection-before', 'c'.repeat(64), 'selection', '2026-09-18', 'UTC', 'gpt-5.6-luna',
    null, null, null, null, 1234, 'reserved', at, null,
  );
  const deepNames = ['jobs', 'job_attempts', 'consent_attempt_authorizations', 'egress_events'];
  const before = deepNames.map(name => reader.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name=?").get(name));
  reader.close();

  reader = new ReaderStore(filename);
  try {
    assert.equal(reader.db.prepare('SELECT 1 FROM migrations WHERE version=18002').pluck().get(), 1);
    assert.equal(reader.db.prepare("SELECT reservedTokens FROM instant_usage WHERE requestId='selection-before'").pluck().get(), 1234);
    assert.deepEqual(deepNames.map(name => reader.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name=?").get(name)), before);
    assert.deepEqual(reader.db.prepare('SELECT * FROM jobs').get(), { id: 'deep-job', state: 'queued' });
  } finally { reader.close(); }
});
