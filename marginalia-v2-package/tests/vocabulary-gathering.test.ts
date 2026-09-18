import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ReaderStore, ConflictError } from '../daemon/store.ts';
import { LibrarySettingsService } from '../daemon/library.ts';
import { startServer } from '../daemon/server.ts';
import { HelperClient } from '../ui/helper.ts';

test('vocabulary gathering preference is durable, revision checked and fails closed when malformed', t => {
  const directory = mkdtempSync(join(tmpdir(), 'marginalia-p20-'));
  t.after(() => { store.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'marginalia-p20-')); rmSync(directory, { recursive: true, force: true }); });
  const path = join(directory, 'reader.db'); let store = new ReaderStore(path);
  let library = new LibrarySettingsService(store);
  assert.deepEqual(library.vocabularyGathering(), { enabled: true, revision: 0 });
  assert.deepEqual(library.saveVocabularyGathering({ enabled: false, expectedRevision: 0 }), { enabled: false, revision: 1 });
  assert.equal(library.canGatherVocabulary('entropy'), false);
  assert.throws(() => library.saveVocabularyGathering({ enabled: true, expectedRevision: 0 }), ConflictError);
  store.close(); store = new ReaderStore(path); library = new LibrarySettingsService(store);
  assert.deepEqual(library.vocabularyGathering(), { enabled: false, revision: 1 });
  library.saveVocabularyGathering({ enabled: true, expectedRevision: 1 }); assert.equal(library.canGatherVocabulary('entropy'), true);
  store.db.prepare('UPDATE settings SET value=? WHERE key=?').run('{"enabled":"yes","revision":2}', 'library.vocabulary-gathering.v1');
  assert.throws(() => library.canGatherVocabulary('entropy'), /need review/);
  store.db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify({ enabled: false, revision: Number.MAX_SAFE_INTEGER }), 'library.vocabulary-gathering.v1');
  assert.throws(() => library.saveVocabularyGathering({ enabled: true, expectedRevision: Number.MAX_SAFE_INTEGER }), /revision needs review/);
  assert.deepEqual(library.vocabularyGathering(), { enabled: false, revision: Number.MAX_SAFE_INTEGER });
});

test('gathering settings route requires pairing, checks revisions and creates no jobs or egress', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
  const origin = 'chrome-extension://' + 'a'.repeat(32);
  const path = '/api/settings/vocabulary-gathering';
  try {
    assert.equal((await fetch(helper.origin + path, { headers: { Origin: origin } })).status, 401);
    assert.equal((await fetch(helper.origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false, expectedRevision: 0 }) })).status, 401);
    const paired = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: helper.challenge }) });
    const credential = (await paired.json() as { token: string }).token;
    const headers = { Origin: origin, Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' };
    const counts = () => ['jobs', 'egress_events'].map(table => (helper.store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);
    const before = counts();
    assert.deepEqual(await (await fetch(helper.origin + path, { headers })).json(), { gathering: { enabled: true, revision: 0 } });
    const saved = await fetch(helper.origin + path, { method: 'POST', headers, body: JSON.stringify({ enabled: false, expectedRevision: 0 }) });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { gathering: { enabled: false, revision: 1 } });
    assert.equal((await fetch(helper.origin + path, { method: 'POST', headers, body: JSON.stringify({ enabled: true, expectedRevision: 0 }) })).status, 409);
    assert.deepEqual(helper.library.vocabularyGathering(), { enabled: false, revision: 1 });
    assert.deepEqual(counts(), before);
  } finally { await helper.close(); }
});

test('HelperClient gathering preference uses only the local settings route', async t => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ path: new URL(url).pathname, method: init.method!, body: init.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ gathering: { enabled: false, revision: 1 } });
  });
  const client = new HelperClient('http://127.0.0.1:43120'); client.token = 'x'.repeat(43);
  assert.deepEqual(await client.vocabularyGathering(), { enabled: false, revision: 1 });
  assert.deepEqual(await client.saveVocabularyGathering({ enabled: false, expectedRevision: 0 }), { enabled: false, revision: 1 });
  assert.deepEqual(calls, [
    { path: '/api/settings/vocabulary-gathering', method: 'GET', body: null },
    { path: '/api/settings/vocabulary-gathering', method: 'POST', body: { enabled: false, expectedRevision: 0 } },
  ]);
});

test('Skip suppression survives deletion, handles normalized case variants and leaves explicit Remember contract unchanged', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); const library = new LibrarySettingsService(store);
  const observation = { operationId: 'remember-entropy', term: 'Entropy', origin: 'stated' as const, observedAt: '2026-09-18T00:00:00Z', source: { kind: 'reader' as const } };
  library.recordVocabularyObservation(observation); assert.equal(library.vocabulary().length, 1);
  library.skipVocabulary('  Entropy  '); library.skipVocabulary('Entropy'); assert.equal(library.canGatherVocabulary('entropy'), false);
  library.deleteVocabulary('Entropy'); assert.equal(library.vocabulary().length, 0); assert.equal(library.canGatherVocabulary('ENTROPY'), false);
  assert.equal(library.canGatherVocabulary('enthalpy'), true);
  assert.deepEqual(library.recordVocabularyObservation(observation), { recorded: false, deleted: true });
});

test('gathering policy updates create no reader jobs or egress records and do not alter source history', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); const library = new LibrarySettingsService(store);
  const before = JSON.stringify(store.events());
  library.saveVocabularyGathering({ enabled: false, expectedRevision: 0 }); library.skipVocabulary('Entropy');
  assert.equal(JSON.stringify(store.events()), before);
  assert.equal((store.db.prepare('SELECT count(*) AS count FROM source_versions').get() as { count: number }).count, 0);
  assert.equal((store.db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('jobs','egress_events')").get() as { count: number }).count, 0);
});
