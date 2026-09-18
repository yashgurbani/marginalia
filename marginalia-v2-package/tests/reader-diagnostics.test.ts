import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../daemon/server.ts';
import { createDiagnostics, EXPECTED_CODEX_VERSION } from '../daemon/diagnostics.ts';
import { diagnosticsStorage } from '../daemon/routes/diagnostics.ts';
import { DIAGNOSTICS_SCHEMA, type DiagnosticsSnapshot } from '../contracts/diagnostics.ts';
import { diagnosticsSection, diagnosticLines, loadReaderDiagnostics } from '../ui/diagnostics.ts';
import { dom, deferred } from './t05-dom.ts';

const snapshot: DiagnosticsSnapshot = { schema: DIAGNOSTICS_SCHEMA, paired: true, dataDirectory: '/reader/data', helperVersion: '0.2.0',
  backup: { state: 'unknown' }, codex: { status: 'installed', login: 'signed-out', version: '1.2.3', expectedVersion: '1.2.3' } };
const origin = 'http://127.0.0.1:43120', token = 'a'.repeat(43);
const fixtureFetch = (calls: { url: string; init?: RequestInit }[], payload: unknown = snapshot): typeof fetch => async (url, init) => {
  calls.push({ url: String(url), init }); return Response.json(String(url).endsWith('/health') ? { status: 'ready' } : payload);
};

test('signed-out diagnostics render configured-home next step without credentials or raw fields', async t => {
  dom(t); const calls: { url: string; init?: RequestInit }[] = [];
  const value = await loadReaderDiagnostics({ origin, token, fetch: fixtureFetch(calls, { ...snapshot, token: 'SECRET', raw: 'CLI_SECRET' }) });
  const text = diagnosticsSection(value).textContent!;
  assert.match(text, /Signed out.*configured Codex executable and home/);
  assert.match(text, /Confirmed by the helper/); assert.match(text, /How things are/);
  assert.doesNotMatch(text, /SECRET|codex login/);
  assert.deepEqual(calls.map(c => [c.url, c.init?.method]), [[origin + '/health', 'GET'], [origin + '/api/diagnostics', 'GET']]);
  assert.equal(calls[0].init?.headers, undefined);
});
test('unreachable helper has one next step and does not claim pairing or Codex absence', async () => {
  let calls = 0;
  const result = await loadReaderDiagnostics({ origin, token, fetch: async () => { calls++; throw new Error('SECRET'); } });
  assert.equal(calls, 1); assert.equal(result.pairing, 'unknown');
  assert.match(diagnosticLines(result)[1].value, /start the local helper/);
  assert.doesNotMatch(JSON.stringify(diagnosticLines(result)), /SECRET|not installed|not found|No migration backup/);
});
test('unknown Codex and backup are distinct from absent backup and signed out', () => {
  const result = { origin, reachability: 'reachable' as const, pairing: 'paired' as const,
    snapshot: { ...snapshot, codex: { ...snapshot.codex, status: 'unavailable' as const, login: 'unknown' as const } } };
  assert.match(diagnosticLines(result).find(l => l.label === 'Codex sign-in')!.value, /could not be checked/);
  assert.match(diagnosticLines(result).at(-1)!.value, /Unknown/);
  result.snapshot.backup = { state: 'none' };
  assert.match(diagnosticLines(result).at(-1)!.value, /No migration backup/);
});
test('invalid addresses never receive credentials; extension uses only the explicit read alias', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  for (const bad of ['https://127.0.0.1', 'http://remote.example', 'http://user:pass@localhost', origin + '/elsewhere', origin + '?query=1']) {
    assert.equal((await loadReaderDiagnostics({ origin: bad, token, fetch: fixtureFetch(calls) })).reachability, 'invalid');
  }
  assert.equal(calls.length, 0);
  await loadReaderDiagnostics({ origin, token, extension: true, fetch: fixtureFetch(calls) });
  assert.equal(calls[1].url, origin + '/api/read/diagnostics'); assert.equal(calls[1].init?.method, 'POST');
  assert.equal(calls[1].init?.body, '{}'); assert.equal((calls[1].init?.headers as any).Origin, undefined);
  assert.equal(calls[1].init?.redirect, 'error');
});
test('expired pairing and malformed diagnostics never confirm a saved credential', async () => {
  for (const response of [new Response('{}', { status: 401 }), Response.json({ ...snapshot, schema: 'other' })]) {
    const result = await loadReaderDiagnostics({ origin, token, fetch: async url => String(url).endsWith('/health') ? Response.json({ status: 'ready' }) : response });
    assert.notEqual(result.pairing, 'paired'); assert.equal(result.snapshot, undefined);
  }
});
test('aborted stale response and bounded timeout do not accept private diagnostics', async () => {
  const abort = new AbortController(), pending = deferred<Response>();
  const result = loadReaderDiagnostics({ origin, token, signal: abort.signal,
    fetch: async url => String(url).endsWith('/health') ? Response.json({ status: 'ready' }) : pending.promise });
  await new Promise(resolve => setImmediate(resolve)); abort.abort(); pending.resolve(Response.json(snapshot));
  assert.equal((await result).snapshot, undefined);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const value = await loadReaderDiagnostics({ origin, token, timeoutMs: 10, fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }) });
    assert.equal(value.reachability, 'unreachable');
  } finally { clearTimeout(keepAlive); }
});
test('authenticated GET and extension read POST are cached, sanitized, and create zero jobs or egress', async () => {
  let probes = 0;
  const check = createDiagnostics({ executable: '/fixture/codex', codexHome: '/fixture/private' }, { platform: 'linux',
    execute: (_file, argv, _options, done) => { probes++; done(null, argv[0] === '--version' ? `codex-cli ${EXPECTED_CODEX_VERSION}` : 'Not logged in', 'SECRET'); } });
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: check });
  try {
    const extension = 'chrome-extension://' + 'a'.repeat(32);
    const localToken = helper.pairing.exchange(helper.pairing.issue(), helper.origin);
    const extensionToken = helper.pairing.exchange(helper.pairing.issue(), extension);
    const before = helper.store.db.prepare('SELECT total_changes() AS n').get();
    const get = await fetch(helper.origin + '/api/diagnostics', { headers: { Authorization: `Bearer ${localToken}`, 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(get.status, 200); assert.match(get.headers.get('cache-control')!, /no-store/);
    const data = await get.json() as DiagnosticsSnapshot;
    assert.equal(data.codex.login, 'signed-out'); assert.equal(data.helperVersion, '0.2.0'); assert.equal(data.backup.state, 'unknown');
    assert.doesNotMatch(JSON.stringify(data), /SECRET|fixture|token|sandbox/);
    const post = await fetch(helper.origin + '/api/read/diagnostics', { method: 'POST', headers: { Origin: extension, Authorization: `Bearer ${extensionToken}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(post.status, 200); assert.deepEqual(await post.json(), data); assert.equal(probes, 2);
    assert.deepEqual(helper.store.db.prepare('SELECT total_changes() AS n').get(), before);
    for (const table of ['jobs', 'job_attempts', 'egress_events']) assert.equal((helper.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    for (const headers of [{}, { Origin: extension, Authorization: `Bearer ${localToken}` }, { Authorization: `Bearer ${extensionToken}` }] as Record<string, string>[])
      assert.equal((await fetch(helper.origin + '/api/diagnostics', { headers })).status, 401);
    assert.equal((await fetch(helper.origin + '/api/diagnostics', { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${localToken}` } })).status, 403);
    assert.equal((await fetch(helper.origin + '/api/read/diagnostics', { method: 'POST', headers: { Origin: extension, Authorization: `Bearer ${extensionToken}` }, body: '{"mutate":true}' })).status, 400);
  } finally { await helper.close(); }
});
test('revocation during cached diagnostics read fences the response', async () => {
  const pending = deferred<unknown>(), started = deferred();
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => { started.resolve(); return pending.promise; } });
  try {
    const token = helper.pairing.exchange(helper.pairing.issue(), helper.origin);
    const result = fetch(helper.origin + '/api/diagnostics', { headers: { Origin: helper.origin, Authorization: `Bearer ${token}` } });
    await started.promise; helper.pairing.revoke(token); pending.resolve(snapshot.codex);
    assert.equal((await result).status, 401);
  } finally { await helper.close(); }
});
test('revocation between POST body chunks returns 401 without calling diagnostics', { timeout: 5000 }, async () => {
  let probes = 0;
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => { probes++; return snapshot.codex; } });
  const extension = 'chrome-extension://' + 'a'.repeat(32);
  const token = helper.pairing.exchange(helper.pairing.issue(), extension);
  const admitted = deferred();
  const valid = helper.pairing.valid.bind(helper.pairing);
  helper.pairing.valid = (candidate, origin) => {
    const accepted = valid(candidate, origin);
    if (candidate === token && accepted) admitted.resolve();
    return accepted;
  };
  const result = deferred<{ status: number | undefined; text: string }>();
  const req = request(helper.origin + '/api/read/diagnostics', { method: 'POST', headers: {
    Origin: extension, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': '2',
  } }, response => {
    let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
    response.on('end', () => result.resolve({ status: response.statusCode, text }));
    response.on('error', result.reject);
  });
  req.on('error', result.reject);
  try {
    req.write('{');
    // Observe successful initial authentication before revoking the credential.
    await admitted.promise;
    helper.pairing.revoke(token);
    req.end('}');
    const response = await result.promise;
    assert.equal(response.status, 401);
    assert.deepEqual(JSON.parse(response.text), { error: 'Pair with the local helper to read diagnostics.' });
    assert.equal(probes, 0, 'body completion must not start a diagnostics probe after revocation');
  } finally { req.destroy(); await helper.close(); }
});
test('data folder and backup observation distinguish none, present and unreadable metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e10-storage-')), database = join(root, 'reader.sqlite');
  writeFileSync(database, 'fixture');
  try {
    assert.deepEqual(await diagnosticsStorage(database), { dataDirectory: dirname(realpathSync(database)), backup: { state: 'none' } });
    const backups = database + '.backups'; mkdirSync(backups);
    const name = 'routine-123-' + 'a'.repeat(36); mkdirSync(join(backups, name));
    assert.deepEqual((await diagnosticsStorage(database)).backup, { state: 'present', path: join(realpathSync(root), 'reader.sqlite.backups', name) });
    assert.equal((await diagnosticsStorage(':memory:')).backup.state, 'unknown');
    assert.equal((await diagnosticsStorage(join(root, 'missing.sqlite'))).backup.state, 'unknown');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
