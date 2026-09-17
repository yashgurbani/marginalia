import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startServer } from '../daemon/server.ts';
import { digest } from '../daemon/store.ts';

const root = '/api/helper-management';
const extension = 'chrome-extension://' + 'a'.repeat(32);
const firefox = 'moz-extension://12345678-1234-1234-1234-123456789abc';
const start = () => startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
const headers = (origin: string): Record<string, string> => ({ Origin: origin, 'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', 'Content-Type': 'application/json' });
function call(origin: string, path: string, body = '{}', changes: Record<string, string | undefined> = {}, method = 'POST') {
  const sent = { ...headers(origin), ...changes };
  for (const key of Object.keys(sent)) if (sent[key] === undefined) delete sent[key];
  return new Promise<{ status: number; data: any; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request(origin + path, { method, headers: sent }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, data: JSON.parse(text), headers: res.headers }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('trusted helper can bootstrap before pairing, renew a single-use code and list safe records', async () => {
  const helper = await start();
  try {
    assert.deepEqual((await call(helper.origin, root + '/browsers')).data, { browsers: [] });
    const first = await call(helper.origin, root + '/pairing-code');
    assert.equal(first.status, 200); assert.match(first.data.code, /^\d{6}$/);
    assert.deepEqual(Object.keys(first.data).sort(), ['code', 'expiresInSeconds', 'singleUse']);
    assert.equal(first.data.expiresInSeconds, 300); assert.equal(first.data.singleUse, true);
    assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(first.headers['access-control-allow-origin'], undefined);
    const next = await call(helper.origin, root + '/pairing-code', '{}', { 'Sec-Fetch-Mode': 'same-origin' });
    assert.notEqual(next.data.code, first.data.code);
    const exchange = (code: string) => call(helper.origin, '/pair', JSON.stringify({ challenge: code }), { Origin: extension });
    assert.equal((await exchange(first.data.code)).status, 403);
    const paired = await exchange(next.data.code); assert.equal(paired.status, 200);
    assert.equal((await exchange(next.data.code)).status, 403);
    const list = await call(helper.origin, root + '/browsers');
    assert.equal(list.data.browsers.length, 1);
    assert.deepEqual(Object.keys(list.data.browsers[0]).sort(), ['createdAt', 'id', 'origin', 'revoked']);
    assert.equal(list.data.browsers[0].origin, extension);
    assert.equal(JSON.stringify(list.data).includes(paired.data.token), false);
    assert.equal(JSON.stringify(list.data).includes(digest(paired.data.token)), false);
  } finally { await helper.close(); }
});

test('management rejects extension, cross-site, missing metadata, forms, preflights and rebinding', async () => {
  const helper = await start();
  try {
    const token = helper.pairing.exchange(helper.challenge, extension);
    const denied: Record<string, string | undefined>[] = [
      { Origin: extension }, { Origin: firefox }, { Origin: 'https://evil.example' }, { Origin: 'null' },
      { Origin: undefined }, { Origin: helper.origin + '/' },
      { Host: 'evil.example' }, { Host: new URL(helper.origin).host.replace('127.0.0.1', 'localhost') },
      { 'Sec-Fetch-Site': undefined }, { 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Site': 'same-site' },
      { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Mode': undefined }, { 'Sec-Fetch-Mode': 'navigate' },
      { 'Sec-Fetch-Mode': 'no-cors' }, { 'Sec-Fetch-Dest': undefined }, { 'Sec-Fetch-Dest': 'document' },
    ];
    for (const path of ['/pairing-code', '/browsers', '/revoke']) {
      for (const changed of denied) {
        const result = await call(helper.origin, root + path, '{}', { Authorization: `Bearer ${token}`, ...changed });
        assert.equal(result.status, 403, JSON.stringify(changed));
        assert.equal(result.headers['access-control-allow-origin'], undefined);
      }
      assert.equal((await call(helper.origin, root + path, '', {}, 'GET')).status, 405);
      const preflight = await call(helper.origin, root + path, '', { Origin: extension,
        'Access-Control-Request-Method': 'POST' }, 'OPTIONS');
      assert.equal(preflight.status, 403); assert.equal(preflight.headers['access-control-allow-methods'], undefined);
    }
    assert.equal((await call(helper.origin, root + '/pairing-code', '{}', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await call(helper.origin, root + '/pairing-code', 'code=123456', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal(helper.pairing.valid(token, extension), true);
  } finally { await helper.close(); }
});

test('management validates exact bounded bodies and returns fixed errors without side effects', async () => {
  const helper = await start();
  try {
    const challenge = helper.challenge;
    for (const body of ['', 'null', '[]', 'true', '{"secret":"sentinel"}', '{']) {
      const response = await call(helper.origin, root + '/pairing-code', body);
      assert.equal(response.status, 400); assert.equal(JSON.stringify(response.data).includes('sentinel'), false);
    }
    assert.equal((await call(helper.origin, root + '/pairing-code', ' '.repeat(1024) + '{}')).status, 413);
    assert.equal((await call(helper.origin, root + '/pairing-code', '{}', { 'Content-Encoding': 'gzip' })).status, 415);
    assert.equal((await call(helper.origin, root + '/pairing-code?token=sentinel')).status, 400);
    assert.equal((await call(helper.origin, root + '/unknown')).status, 404);
    const token = helper.pairing.exchange(challenge, extension);
    const id = helper.pairing.listPairedBrowsers()[0]!.id;
    for (const body of ['{}', '{"id":null}', '{"id":"sentinel"}', JSON.stringify({ id, extra: true })]) {
      assert.equal((await call(helper.origin, root + '/revoke', body)).status, 400);
    }
    assert.equal((await call(helper.origin, root + '/revoke', '{"id":"00000000-0000-4000-8000-000000000000"}')).status, 404);
    assert.equal(helper.pairing.valid(token, extension), true);
  } finally { await helper.close(); }
});

test('management revocation immediately closes only sockets with revoked bound tokens without polling', async t => {
  // Freeze the outbox interval: closure must come from the management dispatch.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const helper = await start();
  const clients: WebSocket[] = [];
  try {
    const tokens = [helper.pairing.exchange(helper.pairing.issue(100), extension, 101),
      helper.pairing.exchange(helper.pairing.issue(200), extension, 201)];
    const id = helper.pairing.listPairedBrowsers()[0]!.id;
    for (const token of [tokens[0], tokens[0], tokens[1]]) {
      const ws = new WebSocket(helper.origin.replace('http:', 'ws:') + '/events', { origin: extension });
      clients.push(ws); await once(ws, 'open');
      const replay = once(ws, 'message', { signal: AbortSignal.timeout(3000) });
      ws.send(JSON.stringify({ token, after: 0 })); await replay;
    }
    const closed = clients.slice(0, 2).map(ws => once(ws, 'close', { signal: AbortSignal.timeout(3000) }));
    assert.deepEqual((await call(helper.origin, root + '/revoke', JSON.stringify({ id }))).data, { result: 'revoked' });
    for (const result of await Promise.all(closed)) assert.equal(result[0], 1008);
    assert.equal(clients[2]!.readyState, WebSocket.OPEN);
    assert.equal(helper.pairing.valid(tokens[0], extension), false);
    assert.equal(helper.pairing.valid(tokens[1], extension), true);
    assert.deepEqual((await call(helper.origin, root + '/revoke', JSON.stringify({ id }))).data, { result: 'already-revoked' });
    const rows = (await call(helper.origin, root + '/browsers')).data.browsers;
    assert.deepEqual(rows.map((row: { revoked: boolean }) => row.revoked), [true, false]);
  } finally { for (const ws of clients) ws.terminate(); await helper.close(); t.mock.timers.reset(); }
});
