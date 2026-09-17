import test from 'node:test';
import assert from 'node:assert/strict';
import { HelperClient } from '../ui/helper.ts';

test('offline Disconnect forgets durable pairing before attempting remote revocation', async t => {
  const client = new HelperClient('http://127.0.0.1:43120'); client.token = 'old-pairing';
  let saved: string | undefined = client.token;
  let observed: unknown;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    observed = { saved, token: client.token, authorization: (options.headers as Record<string, string>).authorization };
    throw new TypeError('offline');
  });
  assert.equal(await client.disconnect(async () => { saved = undefined; }), 'unconfirmed');
  assert.equal(client.token, '');
  assert.equal(saved, undefined);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(observed, { saved: undefined, token: '', authorization: 'Bearer old-pairing' });
});

test('Disconnect does not claim local removal or revoke when saving that removal fails', async t => {
  const client = new HelperClient('http://127.0.0.1:43120'); client.token = 'old-pairing';
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ revoked: true }));
  await assert.rejects(client.disconnect(async () => { throw new Error('Storage unavailable'); }), /Storage unavailable/);
  assert.equal(client.token, 'old-pairing');
  assert.equal(fetch.mock.callCount(), 0);
});

test('a completed old revocation cannot erase a newly paired connection', async t => {
  const client = new HelperClient('http://127.0.0.1:43120'); client.token = 'old-pairing';
  t.mock.method(globalThis, 'fetch', async () => {
    client.token = 'new-pairing';
    return Response.json({ revoked: true });
  });
  assert.equal(await client.disconnect(async () => {}), 'replaced');
  assert.equal(client.token, 'new-pairing');
});
