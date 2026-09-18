import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibrarySettingsService } from '../daemon/library.ts';
import { ReaderMigrationError, ReaderStore, UnsupportedReaderSchemaError } from '../daemon/store.ts';
import { startServer } from '../daemon/server.ts';
import type { VocabularyObservation } from '../contracts/library.ts';

import Database from 'better-sqlite3';
import { oldReaderPreflight } from './fixtures/reader-preflight-89a6335.ts';

const at = '2026-09-18T09:00:00.000Z';
const remember = (operationId: string, term = 'entropy', source: VocabularyObservation['source'] = { kind: 'reader' }): VocabularyObservation =>
  ({ operationId, term, origin: 'stated', observedAt: at, source });

function removeE33Schema(db: Database.Database) {
  db.exec(`
    DROP INDEX source_versions_material_identity;
    ALTER TABLE source_versions DROP COLUMN author;
    ALTER TABLE source_versions DROP COLUMN publicationDate;
    ALTER TABLE source_versions DROP COLUMN venue;
    CREATE UNIQUE INDEX source_versions_material_identity ON source_versions(
      sourceId,hash,extractionVersion,sections,metadataStatus,
      title IS NULL,COALESCE(title,''),pageType IS NULL,COALESCE(pageType,''));
    DELETE FROM migrations WHERE version=33001;
  `);
}

function noteFixture() {
  const reader = new ReaderStore(':memory:');
  reader.apply({ id: 'keep-note', kind: 'keep', threadId: 'thread-note', note: 'Entropy rises in this note.',
    capture: { url: 'https://example.test/paper', title: 'Paper', pageType: 'paper', text: 'Entropy rises.', capturedAt: at, extractionVersion: 'text-v1' },
    anchor: { exact: 'Entropy', prefix: '', suffix: ' rises.', start: 0, end: 7 } });
  return { reader, library: new LibrarySettingsService(reader), noteId: 'keep-note-note' };
}

test('origin references are validated and one term retains separate explicit origins', () => {
  const { reader, library, noteId } = noteFixture();
  try {
    assert.throws(() => library.recordVocabularyObservation(remember('wrong-revision', 'Entropy', { kind: 'note', noteId, revision: 2 })), /saved note version/);
    assert.throws(() => library.recordVocabularyObservation(remember('missing-definition', 'Entropy', { kind: 'definition', jobId: 'missing-job', replyVersionId: 'missing-reply' })), /definition result/);
    library.recordVocabularyObservation(remember('reader-origin', 'Entropy'));
    library.recordVocabularyObservation({ ...remember('note-origin', 'Entropy', { kind: 'note', noteId, revision: 1 }), observedAt: '2026-09-18T09:01:00.000Z' });
    const [entry] = library.vocabulary();
    assert.equal(entry.term, 'Entropy');
    assert.deepEqual(entry.origins?.map(origin => origin.source.kind), ['reader', 'note']);
    assert.deepEqual(entry.origins?.map(origin => origin.origin), ['stated', 'stated']);
  } finally { reader.close(); }
});

test('operation IDs are idempotent, deletion blocks old retries, and a new Remember action restores the term', () => {
  const reader = new ReaderStore(':memory:'), library = new LibrarySettingsService(reader);
  try {
    const first = remember('remember-once', '  cafe\u0301   noir  ');
    assert.equal(library.recordVocabularyObservation(first).recorded, true);
    assert.equal(library.recordVocabularyObservation(first).recorded, false);
    assert.throws(() => library.recordVocabularyObservation({ ...first, term: 'different' }), /different content/);
    assert.equal(library.vocabulary()[0].term, 'café noir');
    assert.equal(library.deleteVocabulary('café noir').deleted, true);
    assert.deepEqual(library.recordVocabularyObservation(first), { recorded: false, deleted: true });
    assert.equal(library.vocabulary().length, 0);
    assert.equal(library.recordVocabularyObservation(remember('remember-again', 'café noir')).recorded, true);
    assert.equal(library.vocabulary().length, 1);
  } finally { reader.close(); }
});

test('migration preserves compatible origins and labels unknown historical rows legacy without harvesting notes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e22-vocabulary-')), filename = join(directory, 'reader.sqlite');
  try {
    const old = new ReaderStore(filename);
    old.db.exec(`
      DELETE FROM migrations WHERE version=22001;
      DROP TABLE vocabulary_origins;
      DROP TABLE vocabulary_operations;
      DROP TABLE vocabulary;
      CREATE TABLE vocabulary(term TEXT PRIMARY KEY,origin TEXT NOT NULL,status TEXT NOT NULL,firstSeen TEXT NOT NULL,lastSeen TEXT NOT NULL);
      INSERT INTO vocabulary VALUES('known','stated','ignored','${at}','${at}');
      INSERT INTO vocabulary VALUES('looked-up-alias','lookup','active','${at}','${at}');
      INSERT INTO vocabulary VALUES('used-alias','note','active','${at}','${at}');
      INSERT INTO vocabulary VALUES('older','mystery','active','${at}','${at}');
    `);
    old.close();
    const migrated = new ReaderStore(filename);
    try {
      const entries = new LibrarySettingsService(migrated).vocabulary();
      assert.deepEqual(entries.map(entry => [entry.term, entry.origins?.[0].origin]), [['known', 'stated'], ['looked-up-alias', 'looked-up'], ['older', 'legacy'], ['used-alias', 'used']]);
      assert.equal(entries.find(entry => entry.term === 'known')?.status, 'ignored');
      assert.equal((migrated.db.prepare('SELECT COUNT(*) count FROM vocabulary').get() as { count: number }).count, 4);
      assert.equal((migrated.db.prepare('SELECT COUNT(*) count FROM note_versions').get() as { count: number }).count, 0);
    } finally { migrated.close(); }
    const backupDirectory = join(filename + '.backups', readdirSync(filename + '.backups')[0]);
    const backupPath = join(backupDirectory, 'reader.sqlite');
    // The pre-E22 snapshot already carries E33's 33001 marker, so the pinned
    // 89a6335 reader must reject it before writes even though the backup itself
    // remains readable and preserves the legacy vocabulary bytes.
    assert.throws(() => oldReaderPreflight(backupPath), { name: 'UnsupportedReaderSchema' });
    const backup = new Database(backupPath, { readonly: true });
    try { assert.equal((backup.prepare("SELECT status FROM vocabulary WHERE term='known'").get() as { status: string }).status, 'ignored'); }
    finally { backup.close(); }
    const reopened = new ReaderStore(filename);
    try {
      const entries = new LibrarySettingsService(reopened).vocabulary();
      assert.deepEqual(entries.filter(entry => entry.term.endsWith('alias')).map(entry => entry.origins?.[0].origin), ['looked-up', 'used']);
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the observe route is pairing-authenticated and returns the stated origin', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
  const origin = 'chrome-extension://' + 'a'.repeat(32);
  try {
    const observation = remember('route-remember', 'Entropy');
    assert.equal((await fetch(helper.origin + '/api/vocabulary/observe', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(observation) })).status, 401);
    const paired = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: helper.challenge }) });
    const token = (await paired.json() as { token: string }).token;
    const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const response = await fetch(helper.origin + '/api/vocabulary/observe', { method: 'POST', headers, body: JSON.stringify(observation) });
    assert.equal(response.status, 200);
    const payload = await response.json() as { entry: { origins: Array<{ origin: string }> } };
    assert.equal(payload.entry.origins[0].origin, 'stated');
  } finally { await helper.close(); }
});


test('versioned vocabulary rejects the actual old preflight before writes and reopens with its status and origins', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e22-versioned-')), filename = join(directory, 'reader.sqlite');
  try {
    const reader = new ReaderStore(filename), library = new LibrarySettingsService(reader);
    library.recordVocabularyObservation(remember('versioned-origin'));
    reader.db.prepare("UPDATE vocabulary SET status='ignored' WHERE termKey='entropy'").run();
    reader.db.pragma('journal_mode = DELETE'); reader.close();
    const before = readFileSync(filename), entries = readdirSync(directory);
    assert.throws(() => oldReaderPreflight(filename), { name: 'UnsupportedReaderSchema' });
    assert.deepEqual(readFileSync(filename), before); assert.deepEqual(readdirSync(directory), entries);
    const reopened = new ReaderStore(filename);
    try {
      assert.ok(reopened.db.prepare('SELECT 1 FROM migrations WHERE version=22001').get());
      assert.equal(new LibrarySettingsService(reopened).vocabulary()[0].status, 'ignored');
      assert.equal(new LibrarySettingsService(reopened).vocabulary()[0].origins?.[0].operationId, 'versioned-origin');
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('vocabulary upgrade retains a readable pre-upgrade backup and handles an unversioned E22 database without resetting data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e22-backup-')), filename = join(directory, 'reader.sqlite');
  try {
    const old = new ReaderStore(filename), library = new LibrarySettingsService(old);
    library.recordVocabularyObservation(remember('existing-e22'));
    old.db.prepare("UPDATE vocabulary SET status='hidden' WHERE termKey='entropy'").run();
    old.db.prepare('DELETE FROM migrations WHERE version=22001').run(); old.close();
    const before = new Database(filename, { readonly: true });
    const rows = before.prepare('SELECT * FROM vocabulary_origins').all(); before.close();
    const migrated = new ReaderStore(filename);
    try {
      assert.deepEqual(migrated.db.prepare('SELECT * FROM vocabulary_origins').all(), rows);
      assert.equal(new LibrarySettingsService(migrated).vocabulary()[0].status, 'hidden');
      assert.ok(migrated.db.prepare('SELECT 1 FROM migrations WHERE version=22001').get());
    } finally { migrated.close(); }
    assert.throws(() => oldReaderPreflight(filename), { name: 'UnsupportedReaderSchema' });
    const backups = readdirSync(filename + '.backups'); assert.equal(backups.length, 1);
    const backupDir = join(filename + '.backups', backups[0]);
    const snapshot = join(backupDir, 'reader.sqlite');
    const backup = new Database(snapshot, { readonly: true });
    try {
      assert.equal(backup.prepare('SELECT 1 FROM migrations WHERE version=22001').get(), undefined);
      assert.deepEqual(backup.prepare('SELECT * FROM vocabulary_origins').all(), rows);
    } finally { backup.close(); }
    const recoveredPath = join(directory, 'recovered.sqlite'); copyFileSync(snapshot, recoveredPath);
    const recovered = new ReaderStore(recoveredPath);
    try { assert.deepEqual(new LibrarySettingsService(recovered).vocabulary()[0].origins?.[0].operationId, 'existing-e22'); }
    finally { recovered.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('an E22-only database gains E33 metadata without resurrecting a deleted vocabulary operation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e22-to-e33-')), filename = join(directory, 'reader.sqlite');
  try {
    const original = new ReaderStore(filename), library = new LibrarySettingsService(original);
    const observation = remember('deleted-before-e33', 'Entropy');
    library.recordVocabularyObservation(observation);
    assert.equal(library.deleteVocabulary('Entropy').deleted, true);
    const receipt = original.db.prepare('SELECT * FROM vocabulary_operations WHERE operationId=?').get(observation.operationId);
    assert.ok((receipt as { deletedAt: string | null }).deletedAt);
    original.db.pragma('journal_mode = DELETE'); original.close();

    const e22 = new Database(filename);
    removeE33Schema(e22);
    assert.ok(e22.prepare('SELECT 1 FROM migrations WHERE version=22001').get());
    assert.equal(e22.prepare('SELECT 1 FROM migrations WHERE version=33001').get(), undefined);
    e22.close();

    const migrated = new ReaderStore(filename);
    try {
      assert.ok(migrated.db.prepare('SELECT 1 FROM migrations WHERE version=33001').get());
      assert.deepEqual(migrated.db.prepare('SELECT * FROM vocabulary_operations WHERE operationId=?').get(observation.operationId), receipt);
      assert.deepEqual(new LibrarySettingsService(migrated).recordVocabularyObservation(observation), { recorded: false, deleted: true });
      assert.deepEqual(new LibrarySettingsService(migrated).vocabulary(), []);
    } finally { migrated.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a late E22 normalization conflict rolls back the earlier E33 schema and both migration markers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e33-e22-rollback-')), filename = join(directory, 'reader.sqlite');
  try {
    const current = new ReaderStore(filename);
    current.db.pragma('journal_mode = DELETE'); current.close();
    const legacy = new Database(filename);
    removeE33Schema(legacy);
    legacy.exec(`
      DROP TABLE vocabulary_origins;
      DROP TABLE vocabulary_operations;
      DROP TABLE vocabulary;
      CREATE TABLE vocabulary(term TEXT PRIMARY KEY,origin TEXT NOT NULL,status TEXT NOT NULL,firstSeen TEXT NOT NULL,lastSeen TEXT NOT NULL);
      INSERT INTO vocabulary VALUES('café noir','stated','active','${at}','${at}');
      INSERT INTO vocabulary VALUES(' café   noir ','stated','ignored','${at}','${at}');
      DELETE FROM migrations WHERE version=22001;
    `);
    const beforeRows = legacy.prepare('SELECT * FROM vocabulary ORDER BY term').all();
    legacy.close();

    let failure: unknown;
    try { new ReaderStore(filename); } catch (error) { failure = error; }
    assert.ok(failure instanceof ReaderMigrationError);
    assert.match(String(failure.cause), /statuses conflict after normalization/);

    const rolledBack = new Database(filename, { readonly: true });
    try {
      const columns = (rolledBack.prepare('PRAGMA table_info(source_versions)').all() as { name: string }[]).map(column => column.name);
      assert.equal(columns.includes('author'), false);
      assert.equal(columns.includes('publicationDate'), false);
      assert.equal(columns.includes('venue'), false);
      assert.equal(rolledBack.prepare('SELECT 1 FROM migrations WHERE version=33001').get(), undefined);
      assert.equal(rolledBack.prepare('SELECT 1 FROM migrations WHERE version=22001').get(), undefined);
      assert.deepEqual(rolledBack.prepare('SELECT * FROM vocabulary ORDER BY term').all(), beforeRows);
      assert.equal(rolledBack.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('vocabulary_v2','vocabulary_origins','vocabulary_operations')").get(), undefined);
    } finally { rolledBack.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a vocabulary migration marker with the legacy table fails read-only preflight without silently resetting data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e22-mismatch-')), filename = join(directory, 'reader.sqlite');
  try {
    const reader = new ReaderStore(filename);
    reader.db.exec('DROP TABLE vocabulary_origins; DROP TABLE vocabulary_operations; DROP TABLE vocabulary; CREATE TABLE vocabulary(term TEXT PRIMARY KEY,origin TEXT,status TEXT,firstSeen TEXT,lastSeen TEXT)');
    reader.close(); const before = readFileSync(filename);
    assert.throws(() => new ReaderStore(filename), UnsupportedReaderSchemaError);
    assert.deepEqual(readFileSync(filename), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
