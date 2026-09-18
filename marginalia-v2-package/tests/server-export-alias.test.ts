import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer } from '../daemon/server.ts';

const origin = 'chrome-extension://' + 'a'.repeat(32);
async function fixture() {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
  helper.store.apply({ id: 'keep-export', kind: 'keep', threadId: 'thread-export', capture: { url: 'https://fixture.invalid/paper', title: 'Fixture', pageType: 'paper', text: 'A source passage.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' }, anchor: { exact: 'A source passage.', prefix: '', suffix: '', start: 0, end: 17 } });
  const token = helper.pairing.exchange(helper.challenge, origin);
  const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const path = '/api/read/export?thread=thread-export';
  const post = (body = '{}', extra: Record<string, string> = {}) => fetch(helper.origin + path, { method: 'POST', headers: { ...headers, ...extra }, body });
  return { helper, token, headers, path, post };
}

test('extension POST export matches the saved GET projection without weakening origin authentication', async () => {
  const { helper, headers, post } = await fixture();
  try {
    const legacy = await fetch(helper.origin + '/api/export?thread=thread-export', { headers });
    const result = await post(); assert.equal(legacy.status, 200); assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), await legacy.json());
    const originless = await fetch(helper.origin + '/api/export?thread=thread-export', { headers: { Authorization: headers.Authorization } });
    assert.equal(originless.status, 401);
    const localToken = helper.pairing.exchange(helper.pairing.issue(), helper.origin);
    assert.equal((await fetch(helper.origin + '/api/export?thread=thread-export', { headers: { Authorization: `Bearer ${localToken}`, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  } finally { await helper.close(); }
});

test('POST export retains exact-origin, bearer, empty-object and method checks', async () => {
  const { helper, token, headers, path, post } = await fixture();
  try {
    assert.equal((await post('{}', { Origin: 'chrome-extension://' + 'b'.repeat(32) })).status, 401);
    assert.equal((await post('{}', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(helper.origin + path, { method: 'POST', headers: { Authorization: headers.Authorization, 'Sec-Fetch-Site': 'same-origin' }, body: '{}' })).status, 401);
    assert.equal((await post('{}', { Authorization: 'Bearer invalid' })).status, 401);
    for (const body of ['null', '[]', '{"thread":"thread-export"}', '']) assert.equal((await post(body)).status, 400);
    assert.equal((await fetch(helper.origin + path, { method: 'GET', headers })).status, 405);
    helper.pairing.revoke(token); assert.equal((await post()).status, 401);
  } finally { await helper.close(); }
});

test('revocation while reading the export body fences the saved bundle', async () => {
  const { helper, token, headers, path } = await fixture();
  try {
    let checked!: () => void; const firstCheck = new Promise<void>(resolve => { checked = resolve; });
    const valid = helper.pairing.valid.bind(helper.pairing);
    helper.pairing.valid = (candidate, candidateOrigin) => { const result = valid(candidate, candidateOrigin); checked(); return result; };
    const result = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const req = request(helper.origin + path, { method: 'POST', headers: { ...headers, 'Content-Length': '2' } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject); req.write('{'); void firstCheck.then(() => { helper.pairing.revoke(token); req.end('}'); });
    });
    assert.equal(result.status, 401); assert.equal(Object.hasOwn(JSON.parse(result.body), 'thread'), false);
  } finally { await helper.close(); }
});
