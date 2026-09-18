import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../daemon/server.ts';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ReaderMutation } from '../contracts/reader.ts';
import type { CandidateReply } from '../contracts/reply.ts';

const diagnostics = () => ({ status: 'unavailable', login: 'unknown', sandbox: 'unverified' });
const extensionOrigin = 'chrome-extension://' + 'a'.repeat(32);
const keep: ReaderMutation = { id: 'keep-1', kind: 'keep', threadId: 'thread-1', capture: { url: 'https://example.org/paper', title: 'Test', pageType: 'paper', text: 'A source passage.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' }, anchor: { exact: 'A source passage.', prefix: '', suffix: '', start: 0, end: 17 } };
async function pair(helper: Awaited<ReturnType<typeof startServer>>, origin = extensionOrigin) {
  const response = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ challenge: helper.pairing.issue() }) });
  assert.equal(response.status, 200);
  return (await response.json() as { token: string }).token;
}
async function connect(helper: { origin: string }, origin = extensionOrigin) {
  const ws = new WebSocket(helper.origin.replace('http:', 'ws:') + '/events', { origin });
  await once(ws, 'open');
  return ws;
}
function receive(ws: WebSocket) {
  return once(ws, 'message', { signal: AbortSignal.timeout(3000) }).then(([bytes]) => JSON.parse(bytes.toString()) as { type: string; events: { seq: number; kind: string }[] });
}

test('static assets send a locked-down content security policy', async () => {
  const webRoot = mkdtempSync(join(tmpdir(), 'marginalia-web-'));
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Marginalia</title>');
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics, webRoot });
  try {
    const response = await fetch(helper.origin + '/');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-security-policy'), "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  } finally { await helper.close(); rmSync(webRoot, { recursive: true, force: true }); }
});

test('helper rejects hostile origins, pairs once, binds tokens to origin and supports revocation', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  const origin = 'chrome-extension://' + 'a'.repeat(32);
  try {
    const health = await fetch(helper.origin + '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ready', storage: 'ready' });
    assert.equal((await fetch(helper.origin + '/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(helper.origin + '/health', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal((await fetch(helper.origin + '/api/threads', { headers: { Origin: origin } })).status, 401);
    const pair = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: helper.challenge }) });
    assert.equal(pair.status, 200);
    const { token } = await pair.json() as { token: string };
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    const headers = { Origin: origin, Authorization: `Bearer ${token}` };
    assert.equal((await fetch(helper.origin + '/api/threads', { headers })).status, 200);
    assert.equal((await fetch(helper.origin + '/api/threads', { headers: { ...headers, Origin: helper.origin } })).status, 401);
    assert.equal((await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ challenge: helper.challenge }) })).status, 403);
    await fetch(helper.origin + '/api/revoke', { method: 'POST', headers });
    assert.equal((await fetch(helper.origin + '/api/threads', { headers })).status, 401);
  } finally { await helper.close(); }
});

test('five bad pairing attempts exhaust the challenge', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    for (let i = 0; i < 5; i++) assert.throws(() => helper.pairing.exchange('not-a-code', helper.origin));
    assert.throws(() => helper.pairing.exchange(helper.challenge, helper.origin), /expired/);
  } finally { await helper.close(); }
});

test('diagnostics rejection does not break liveness or pairing', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: async () => { throw new Error('probe failed'); } });
  try {
    assert.deepEqual(await (await fetch(helper.origin + '/health')).json(), { status: 'ready', storage: 'ready' });
    const response = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: extensionOrigin },
      body: JSON.stringify({ challenge: helper.challenge }) });
    assert.equal(response.status, 200);
    const payload = await response.json() as { token: string; codex: { status: string; login: string } };
    assert.equal(payload.codex.status, 'unavailable');
    assert.equal(payload.codex.login, 'unknown');
    assert.ok(payload.token);
  } finally { await helper.close(); }
});

test('reply-check accepts only exact finite parameters within the declared range', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    helper.store.apply(keep);
    const reply: CandidateReply = { schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete',
      title: 'Example', summary: 'A saved reply.', sourceBindings: [],
      parameters: [{ name: 'x', label: 'Value', default: 1, min: 0, max: 2, unit: '' }],
      assumptions: [], limitations: [], blocks: [{ id: 'text', type: 'text', md: 'A source passage.' }],
      checks: [], staticFallback: 'A saved reply.' };
    helper.store.commitReply({ id: 'checked-reply', threadId: keep.threadId, reply });
    const token = await pair(helper);
    const headers = { Origin: extensionOrigin, Authorization: `Bearer ${token}` };
    const input = (parameters: unknown) => JSON.stringify({ threadId: keep.threadId, replyVersionId: 'checked-reply', parameters });
    const check = (body: string) => fetch(helper.origin + '/api/reply-check', { method: 'POST', headers, body });
    assert.equal((await check(input({ x: 1 }))).status, 200);
    for (const parameters of [{ x: '1' }, { x: null }, { x: -1 }, { x: 3 }, { x: 1, extra: 2 }, {}]) {
      assert.equal((await check(input(parameters))).status, 400);
    }
    assert.equal((await check(input({ x: 1 }).replace('"x":1', '"x":1e400'))).status, 400);
  } finally { await helper.close(); }
});

test('same-origin browser GET authentication requires Fetch Metadata plus an origin-bound token', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    const token = await pair(helper, helper.origin);
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(helper.origin + '/api/threads', { headers: auth })).status, 401);
    assert.equal((await fetch(helper.origin + '/api/threads', { headers: { ...auth, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
    for (const site of ['cross-site', 'same-site', 'none']) assert.equal((await fetch(helper.origin + '/api/threads', { headers: { ...auth, 'Sec-Fetch-Site': site } })).status, 401);
    assert.equal((await fetch(helper.origin + '/api/revoke', { method: 'POST', headers: { ...auth, 'Sec-Fetch-Site': 'same-origin' } })).status, 401);
    const extensionToken = await pair(helper);
    assert.equal((await fetch(helper.origin + '/api/threads', { headers: { Authorization: `Bearer ${extensionToken}`, 'Sec-Fetch-Site': 'same-origin' } })).status, 401);
    assert.equal((await fetch(helper.origin + '/api/threads', { headers: { Authorization: token, Origin: helper.origin } })).status, 401);
    assert.equal((await fetch(helper.origin + '/pair', { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' }, body: '{}' })).status, 403);
  } finally { await helper.close(); }
});

test('WebSocket authenticates before replay, delivers live changes, resumes after reconnect and closes on revoke', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    const token = await pair(helper);
    const headers = { Origin: extensionOrigin, Authorization: `Bearer ${token}` };
    const ws = await connect(helper);
    const replay = receive(ws); ws.send(JSON.stringify({ token, after: 0 }));
    assert.deepEqual((await replay).events, []);
    const live = receive(ws);
    assert.equal((await fetch(helper.origin + '/api/change', { method: 'POST', headers, body: JSON.stringify(keep) })).status, 200);
    const first = await live;
    assert.deepEqual(first.events.map(event => event.seq), [1]);
    ws.terminate(); await once(ws, 'close');
    // Another writer uses the committed outbox, not the HTTP route.
    helper.store.apply({ id: 'park-1', kind: 'thread-state', threadId: keep.threadId, expectedRevision: 1, state: 'parked' });
    const resumed = await connect(helper);
    const catchup = receive(resumed); resumed.send(JSON.stringify({ token, after: 1 }));
    assert.deepEqual((await catchup).events.map(event => event.seq), [2]);
    const closed = once(resumed, 'close');
    assert.equal((await fetch(helper.origin + '/api/revoke', { method: 'POST', headers })).status, 200);
    assert.equal((await closed)[0], 1008);
    const revoked = await connect(helper);
    const rejected = once(revoked, 'close'); revoked.send(JSON.stringify({ token, after: 0 }));
    assert.equal((await rejected)[0], 1008);
  } finally { await helper.close(); }
});

test('change route removes and restores one note', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    const token = await pair(helper), headers = { Origin: extensionOrigin, Authorization: `Bearer ${token}` };
    const seeded = { ...keep, note: 'A removable note.' };
    assert.equal((await fetch(helper.origin + '/api/change', { method: 'POST', headers, body: JSON.stringify(seeded) })).status, 200);
    const note = helper.store.get(keep.threadId)!.notes[0];
    const remove = await fetch(helper.origin + '/api/change', { method: 'POST', headers, body: JSON.stringify({ id: 'remove-note', kind: 'note-remove', threadId: keep.threadId, noteId: note.id, expectedRevision: 1, removed: true }) });
    assert.deepEqual(await remove.json(), { threadId: keep.threadId, revision: 2 });
    assert.ok(helper.store.get(keep.threadId)!.notes[0].deletedAt);
    const restore = await fetch(helper.origin + '/api/change', { method: 'POST', headers, body: JSON.stringify({ id: 'restore-note', kind: 'note-remove', threadId: keep.threadId, noteId: note.id, expectedRevision: 2, removed: false }) });
    assert.deepEqual(await restore.json(), { threadId: keep.threadId, revision: 3 });
    assert.equal(helper.store.get(keep.threadId)!.notes[0].deletedAt, null);
  } finally { await helper.close(); }
});

test('WebSocket rejects hostile hosts/origins, missing origins, malformed credentials and future cursors', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: extensionOrigin, Host: 'evil.example' }, {}]) {
      const ws = new WebSocket(helper.origin.replace('http:', 'ws:') + '/events', { headers });
      const [error] = await once(ws, 'error'); assert.ok(error);
    }
    const token = await pair(helper);
    for (const message of [{ token: {} }, { token, after: -1 }, { token, after: 1 }, null]) {
      const ws = await connect(helper);
      const closed = once(ws, 'close'); ws.send(JSON.stringify(message));
      assert.equal((await closed)[0], 1008);
    }
    const wrongOrigin = await connect(helper, helper.origin);
    const closed = once(wrongOrigin, 'close'); wrongOrigin.send(JSON.stringify({ token }));
    assert.equal((await closed)[0], 1008);
  } finally { await helper.close(); }
});

test('durable tokens and replay survive helper restart; revoked tokens remain revoked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-helper-'));
  const database = join(dir, 'reader.sqlite');
  let helper = await startServer({ database, port: 0, diagnostics });
  try {
    const token = await pair(helper);
    helper.store.apply(keep);
    await helper.close(); helper = await startServer({ database, port: 0, diagnostics });
    const ws = await connect(helper);
    const replay = receive(ws); ws.send(JSON.stringify({ token, after: 0 }));
    assert.deepEqual((await replay).events.map(event => event.seq), [1]);
    helper.pairing.revoke(token);
    const closed = once(ws, 'close'); assert.equal((await closed)[0], 1008);
    await helper.close(); helper = await startServer({ database, port: 0, diagnostics });
    assert.equal((await fetch(helper.origin + '/api/threads', { headers: { Origin: extensionOrigin, Authorization: `Bearer ${token}` } })).status, 401);
  } finally { await helper.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('WebSocket drains more than one replay batch in order without a second client request', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    const token = await pair(helper);
    const insert = helper.store.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)');
    helper.store.db.transaction(() => { for (let i = 0; i < 1002; i++) insert.run('test', '{}', new Date().toISOString()); })();
    const ws = await connect(helper);
    const batches: number[][] = [];
    const complete = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Replay did not drain')), 3000);
      ws.on('message', bytes => {
        batches.push(JSON.parse(bytes.toString()).events.map((event: { seq: number }) => event.seq));
        if (batches.flat().length === 1002) { clearTimeout(timer); resolve(); }
      });
    });
    ws.send(JSON.stringify({ token, after: 0 })); await complete;
    assert.deepEqual(batches.map(batch => batch.length), [1000, 2]);
    assert.deepEqual(batches.flat(), Array.from({ length: 1002 }, (_, i) => i + 1));
  } finally { await helper.close(); }
});

test('an unauthenticated WebSocket receives no events and is closed after the auth deadline', { timeout: 8000 }, async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    const ws = await connect(helper);
    let received = false; ws.on('message', () => { received = true; });
    helper.store.apply(keep);
    assert.equal((await once(ws, 'close'))[0], 1008);
    assert.equal(received, false);
  } finally { await helper.close(); }
});
