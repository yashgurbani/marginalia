import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../daemon/server.ts';
import { request } from 'node:http';

test('helper rejects hostile origins, pairs once, binds tokens to origin and supports revocation', async () => {
  const helper = await startServer({ database: ':memory:', port: 0 });
  const origin = 'chrome-extension://' + 'a'.repeat(32);
  try {
    assert.equal((await fetch(helper.origin + '/health')).status, 200);
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
  const helper = await startServer({ database: ':memory:', port: 0 });
  try {
    for (let i = 0; i < 5; i++) assert.throws(() => helper.pairing.exchange('not-a-code', helper.origin));
    assert.throws(() => helper.pairing.exchange(helper.challenge, helper.origin), /expired/);
  } finally { await helper.close(); }
});
