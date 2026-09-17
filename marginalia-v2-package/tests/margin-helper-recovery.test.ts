import test from 'node:test';
import assert from 'node:assert/strict';
import { HelperClient, HelperTransportError, HelperHttpError, pairingCode, forgetPairingIfCurrent } from '../ui/helper.ts';
import { deferred } from './t05-dom.ts';

test('authenticated reads retain exact POST aliases and queries without synthetic Origin', async t => {
  const calls: any[] = []; t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => { calls.push({ url, options }); return Response.json({ threads: [], replies: [], views: [], source: {}, view: {} }); });
  const client = new HelperClient('http://localhost:43120'); client.token = 'paired'; await client.list(); await client.replies('a &?'); await client.replyView('a', 'b/+');
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/api/read/threads', '/api/read/replies', '/api/read/reply-view']);
  assert.match(calls[1].url, /a%20%26%3F/); for (const { options } of calls) { assert.equal(options.method, 'POST'); assert.equal(options.body, '{}'); assert.deepEqual(options.headers, { 'content-type': 'application/json', authorization: 'Bearer paired' }); }
  await assert.rejects(client.read('/api/jobs'), /no supported transport/); assert.equal(calls.length, 3);
});
test('neutral errors distinguish network, timeout, malformed success and HTTP conflict without raw credential details', async t => {
  const responses: any[] = [new TypeError('secret token leaked by fetch'), new DOMException('raw secret', 'TimeoutError'), new Response('bad-json'), Response.json({ error: 'Changed elsewhere' }, { status: 409 })];
  t.mock.method(globalThis, 'fetch', async () => { const next = responses.shift(); if (next instanceof Error) throw next; return next; });
  const client = new HelperClient('http://localhost:43120');
  for (const kind of ['network', 'timeout', 'response-unknown']) await assert.rejects(client.list(), error => { assert.ok(error instanceof HelperTransportError); assert.equal(error.kind, kind); assert.match(error.message, /unconfirmed/); assert.doesNotMatch(error.message, /secret/); return true; });
  await assert.rejects(client.list(), error => { assert.ok(error instanceof HelperHttpError); assert.equal(error.name, 'Conflict'); return true; });
});
test('offline Disconnect removes local credentials before remote revoke; storage failure never reports disconnected', async t => {
  const client = new HelperClient('http://localhost:43120'); client.token = 'old'; let cleared = false, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; assert.equal(cleared, true); assert.equal(client.token, ''); throw new TypeError('offline'); });
  assert.equal(await client.disconnect(async () => { cleared = true; }), 'unconfirmed'); assert.equal(calls, 1);
  client.token = 'not-cleared'; await assert.rejects(client.disconnect(async () => { throw new Error('quota'); }), /quota/); assert.equal(client.token, 'not-cleared'); assert.equal(calls, 1);
});
test('old Disconnect fences late requests and never erases a newer pairing that wins durable storage', async t => {
  const client = new HelperClient('http://localhost:43120'); client.token = 'old'; const response = deferred<Response>(), deletion = deferred();
  let stored: { origin: string; token: string } | undefined = { origin: client.origin, token: client.token };
  t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/api/revoke') ? Response.json({ revoked: true }) : response.promise);
  const pending = client.list(), reject = assert.rejects(pending, /connection changed/);
  const token = client.token; const disconnect = client.disconnect(async () => { await deletion.promise; assert.equal(await forgetPairingIfCurrent({ async read<T>() { return stored as T; }, async write(_key, value) { stored = value as typeof stored; } }, client.origin, token), false); });
  await assert.rejects(client.list(), /connection changed/); client.token = 'new'; stored = { origin: client.origin, token: client.token }; deletion.resolve(); response.resolve(Response.json({ threads: [] }));
  await reject; assert.equal(await disconnect, 'replaced'); assert.equal(client.token, 'new'); assert.equal(stored!.token, 'new');
});
test('six-digit text pairing preserves zeroes and a late pair response cannot undo Disconnect', async t => {
  assert.equal(pairingCode('001 234'), '001234'); assert.throws(() => pairingCode('1234'));
  const client = new HelperClient('http://localhost:43120'), response = deferred<Response>(); let body: any;
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => { body = JSON.parse(String(options.body)); return response.promise; });
  const pair = client.pair('001 234'), reject = assert.rejects(pair, /connection changed/); await client.disconnect(async () => {}); response.resolve(Response.json({ token: 'a'.repeat(43) })); await reject;
  assert.equal(body.challenge, '001234'); assert.equal(client.token, '');
});
