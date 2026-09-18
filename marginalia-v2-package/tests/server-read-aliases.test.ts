import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer } from '../daemon/server.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

const origin = 'chrome-extension://' + 'a'.repeat(32);
const otherOrigin = 'chrome-extension://' + 'b'.repeat(32);
async function fixture() {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
  helper.store.apply({ id: 'keep-1', kind: 'keep', threadId: 'thread-1', capture: { url: 'https://fixture.invalid/paper', title: 'Fixture', pageType: 'paper', text: 'A source passage.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' }, anchor: { exact: 'A source passage.', prefix: '', suffix: '', start: 0, end: 17 } });
  helper.store.commitReply({ id: 'reply-1', threadId: 'thread-1', reply: withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Fixture', summary: 'Fixture reply.', sourceBindings: [], parameters: [], assumptions: [], limitations: [], blocks: [{ id: 'text', type: 'text', md: 'Fixture only.' }], checks: [], staticFallback: 'Fixture only.' }) });
  const token = helper.pairing.exchange(helper.challenge, origin);
  const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (path: string, body = '{}', overrides: Record<string, string> = {}) => fetch(helper.origin + path, { method: 'POST', headers: { ...headers, ...overrides }, body });
  return { helper, token, headers, post };
}

test('read aliases share GET projections and preserve reply-view POST mutation', async () => {
  const { helper, headers, post } = await fixture();
  try {
    const mutation = await post('/api/reply-view', JSON.stringify({ id: 'view-1', threadId: 'thread-1', replyVersionId: 'reply-1', expectedRevision: helper.store.replyView('reply-1')!.revision, parameters: {}, view: {} }));
    assert.equal(mutation.status, 200);
    for (const path of ['threads?removed=true', 'replies?threadId=thread-1', 'reply-view?threadId=thread-1&replyVersionId=reply-1']) {
      const before = await fetch(helper.origin + '/api/' + path, { headers });
      const alias = await post('/api/read/' + path, '{ \n }');
      assert.equal(before.status, 200); assert.equal(alias.status, 200);
      assert.deepEqual(await alias.json(), await before.json());
    }
    assert.equal((await post('/api/read/replies?threadId=missing')).status, 404);
    assert.equal((await post('/api/read/reply-view?threadId=wrong&replyVersionId=reply-1')).status, 404);
    assert.equal((await post('/api/read/replies?threadId=bad%2Fid')).status, 400);
  } finally { await helper.close(); }
});

test('aliases require actual exact Origin and valid origin-bound bearer', async () => {
  const { helper, token, headers, post } = await fixture();
  try {
    for (const value of [otherOrigin, helper.origin]) assert.equal((await post('/api/read/threads', '{}', { Origin: value })).status, 401);
    for (const value of ['null', 'https://evil.example', origin + '/']) assert.equal((await post('/api/read/threads', '{}', { Origin: value })).status, 403);
    assert.equal((await fetch(helper.origin + '/api/read/threads', { method: 'POST', headers: { Authorization: headers.Authorization, 'Sec-Fetch-Site': 'same-origin' }, body: '{}' })).status, 401);
    assert.equal((await fetch(helper.origin + '/api/read/threads', { method: 'POST', headers: { Origin: origin }, body: '{}' })).status, 401);
    for (const value of ['', 'Basic abc', 'Bearer bad', 'Bearer ' + 'x'.repeat(43)]) assert.equal((await post('/api/read/threads', '{}', { Authorization: value })).status, 401);
    helper.pairing.revoke(token);
    assert.equal((await post('/api/read/threads')).status, 401);
  } finally { await helper.close(); }
});

test('aliases reject unknown operations, methods, malformed/nonempty/oversized bodies', async () => {
  const { helper, headers, post } = await fixture();
  try {
    for (const path of ['/api/read/change', '/api/read/threads/extra', '/api/read/unknown']) assert.equal((await post(path)).status, 404);
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await fetch(helper.origin + '/api/read/threads', { method, headers })).status, 405);
    for (const body of ['', 'null', '[]', 'false', '{', '{"unexpected":1}', ' '.repeat(1025) + '{}']) assert.equal((await post('/api/read/threads', body)).status, 400, body.slice(0, 30));
    assert.equal((await post('/api/reply-view', '{}')).status, 400);
  } finally { await helper.close(); }
});

test('revocation during the awaited alias body prevents read projection', async () => {
  const { helper, token, headers } = await fixture();
  try {
    let initialCheck!: () => void;
    const checked = new Promise<void>(resolve => { initialCheck = resolve; });
    const valid = helper.pairing.valid.bind(helper.pairing);
    helper.pairing.valid = (candidate, candidateOrigin) => { const result = valid(candidate, candidateOrigin); initialCheck(); return result; };
    const response = new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const req = request(helper.origin + '/api/read/threads', { method: 'POST', headers: { ...headers, 'Content-Length': '2' } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject); req.write('{');
      void checked.then(() => { helper.pairing.revoke(token); req.end('}'); });
    });
    const result = await response;
    assert.equal(result.status, 401); assert.equal(Object.hasOwn(JSON.parse(result.body), 'threads'), false);
  } finally { await helper.close(); }
});

test('GET authentication remains unchanged, without privileged-extension inference', async () => {
  const { helper, headers } = await fixture();
  try {
    assert.equal((await fetch(helper.origin + '/api/threads', { headers })).status, 200);
    for (const site of ['none', 'same-origin']) assert.equal((await fetch(helper.origin + '/api/threads', { headers: { Authorization: headers.Authorization, 'Sec-Fetch-Site': site } })).status, 401);
    const localToken = helper.pairing.exchange(helper.pairing.issue(), helper.origin);
    assert.equal((await fetch(helper.origin + '/api/threads', { headers: { Authorization: `Bearer ${localToken}`, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  } finally { await helper.close(); }
});
