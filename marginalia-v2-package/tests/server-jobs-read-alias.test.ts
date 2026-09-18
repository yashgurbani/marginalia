import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer } from '../daemon/server.ts';

const origin = 'chrome-extension://' + 'a'.repeat(32);
async function fixture() {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
  const token = helper.pairing.exchange(helper.challenge, origin);
  const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const path = '/api/read/jobs?thread=thread-jobs';
  const post = (body = '{}', extra: Record<string, string> = {}) => fetch(helper.origin + path, { method: 'POST', headers: { ...headers, ...extra }, body });
  return { helper, token, headers, path, post };
}

test('extension POST jobs matches the saved GET projection without weakening origin authentication', async () => {
  const { helper, headers, post } = await fixture();
  try {
    const snapshot = { id: 'job-read', threadId: 'thread-jobs', state: 'succeeded' } as import('../contracts/jobs.ts').JobSnapshot;
    helper.jobs.get = id => id === snapshot.id ? snapshot : undefined;
    const legacy = await fetch(helper.origin + '/api/jobs?thread=thread-jobs', { headers });
    const result = await post(); assert.equal(legacy.status, 200); assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), await legacy.json());
    for (const id of ['job-read', 'missing']) {
      const prior = await fetch(helper.origin + '/api/jobs/' + id, { headers });
      const alias = await fetch(helper.origin + '/api/read/jobs/' + id, { method: 'POST', headers, body: '{}' });
      assert.equal(alias.status, prior.status); assert.deepEqual(await alias.json(), await prior.json());
    }
    const originless = await fetch(helper.origin + '/api/jobs?thread=thread-jobs', { headers: { Authorization: headers.Authorization } });
    assert.equal(originless.status, 401);
    const localToken = helper.pairing.exchange(helper.pairing.issue(), helper.origin);
    assert.equal((await fetch(helper.origin + '/api/jobs?thread=thread-jobs', { headers: { Authorization: `Bearer ${localToken}`, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  } finally { await helper.close(); }
});

test('POST jobs retains exact-origin, bearer, empty-object and method checks', async () => {
  const { helper, token, headers, path, post } = await fixture();
  try {
    assert.equal((await post('{}', { Origin: 'chrome-extension://' + 'b'.repeat(32) })).status, 401);
    assert.equal((await post('{}', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(helper.origin + path, { method: 'POST', headers: { Authorization: headers.Authorization, 'Sec-Fetch-Site': 'same-origin' }, body: '{}' })).status, 401);
    assert.equal((await post('{}', { Authorization: 'Bearer invalid' })).status, 401);
    for (const body of ['null', '[]', '{"thread":"thread-jobs"}', '', '{']) assert.equal((await post(body)).status, 400);
    assert.equal((await fetch(helper.origin + path, { method: 'GET', headers })).status, 405);
    for (const suffix of ['', '/job-read']) {
      const target = helper.origin + '/api/read/jobs' + suffix;
      assert.equal((await fetch(target, { method: 'POST', headers: { ...headers, Origin: 'chrome-extension://' + 'b'.repeat(32) }, body: '{}' })).status, 401);
      assert.equal((await fetch(target, { method: 'POST', headers, body: '{"unexpected":true}' })).status, 400);
      assert.equal((await fetch(target, { method: 'GET', headers })).status, 405);
    }
    assert.equal((await fetch(helper.origin + '/api/read/jobs/job-read/cancel', { method: 'POST', headers, body: '{}' })).status, 404);
    helper.pairing.revoke(token); assert.equal((await post()).status, 401);
  } finally { await helper.close(); }
});

for (const suffix of ['', '/job-read']) test('revocation while reading the jobs body fences saved work ' + suffix, async () => {
  const { helper, token, headers, path } = await fixture();
  try {
    let checked!: () => void; const firstCheck = new Promise<void>(resolve => { checked = resolve; });
    const valid = helper.pairing.valid.bind(helper.pairing);
    helper.pairing.valid = (candidate, candidateOrigin) => { const result = valid(candidate, candidateOrigin); checked(); return result; };
    const result = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const req = request(helper.origin + '/api/read/jobs' + suffix, { method: 'POST', headers: { ...headers, 'Content-Length': '2' } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject); req.write('{'); void firstCheck.then(() => { helper.pairing.revoke(token); req.end('}'); });
    });
    assert.equal(result.status, 401); assert.equal(Object.hasOwn(JSON.parse(result.body), 'jobs'), false);
  } finally { await helper.close(); }
});
