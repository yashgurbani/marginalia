import test from 'node:test';
import assert from 'node:assert/strict';
import { HelperClient } from '../ui/helper.ts';

test('known helper reads use explicit POST aliases with original query and browser-owned Origin', async t => {
  const calls: { url: string; options: RequestInit }[] = [];
  const responses = [{ threads: [{ id: 'thread' }] }, { replies: [], source: { id: 'source' }, views: [] }, { view: { revision: 4 } }];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return Response.json(responses.shift());
  });
  const client = new HelperClient('http://127.0.0.1:3210'); client.token = 'paired-token';
  assert.deepEqual(await client.list(), [{ id: 'thread' }]);
  assert.deepEqual(await client.replies('thread &?'), { replies: [], source: { id: 'source' }, views: [] });
  assert.deepEqual(await client.replyView('thread &?', 'reply/+'), { revision: 4 });
  assert.deepEqual(calls.map(call => call.url), [
    client.origin + '/api/read/threads?removed=true',
    client.origin + '/api/read/replies?threadId=thread%20%26%3F',
    client.origin + '/api/read/reply-view?threadId=thread+%26%3F&replyVersionId=reply%2F%2B',
  ]);
  for (const { options } of calls) {
    assert.equal(options.method, 'POST'); assert.equal(options.body, '{}');
    assert.deepEqual(options.headers, { 'content-type': 'application/json', authorization: 'Bearer paired-token' });
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('read allowlist rejects mutations and unreviewed routes before network dispatch', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const client = new HelperClient('http://localhost:3210');
  for (const path of ['/api/change', '/api/jobs', '/api/settings', '/api/library', '/api/read/threads', '/api/threads/extra', 'https://example.org/api/threads']) {
    await assert.rejects(client.read(path), /no supported transport/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('reply-view mutation keeps its original endpoint and payload; read errors remain observable', async t => {
  const calls: { url: string; options: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json({ view: { revision: 5 } }) : Response.json({ error: 'Wrong origin' }, { status: 401 });
  });
  const client = new HelperClient('http://localhost:3210'); client.token = 'paired-token';
  const change = { id: 'mutation', replyVersionId: 'reply', expectedRevision: 4, parameters: { x: 1 }, view: {} };
  assert.deepEqual(await client.saveReplyView('thread', change), { revision: 5 });
  assert.equal(calls[0].url, client.origin + '/api/reply-view');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body as string), { threadId: 'thread', ...change });
  await assert.rejects(client.list(), /Wrong origin/);
});


test('saved-work export uses the authenticated browser-Origin POST alias and retains rejection', async t => {
  const calls: { url: string; options: RequestInit }[] = [];
  const bundle = { thread: { id: 'thread /&?' }, source: { id: 'source' }, replies: [], replyViews: [] };
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json(bundle) : Response.json({ error: 'Pairing revoked' }, { status: 401 });
  });
  const client = new HelperClient('http://127.0.0.1:3210'); client.token = 'paired-token';
  assert.deepEqual(await client.exportThread('thread /&?'), bundle);
  assert.equal(calls[0].url, client.origin + '/api/read/export?thread=thread%20%2F%26%3F');
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.body, '{}');
  assert.deepEqual(calls[0].options.headers, { 'content-type': 'application/json', authorization: 'Bearer paired-token' });
  assert.equal(calls[0].options.credentials, 'omit');
  await assert.rejects(client.exportThread('thread /&?'), /Pairing revoked/);
  assert.equal(calls.length, 2); // No unauthenticated fallback or automatic retry.
});


test('job availability, listing and inspect use Origin-bearing reads while mutations retain exact routes', async t => {
  const calls: { url: string; options: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => { calls.push({ url, options }); return Response.json({ jobs: [] }); });
  const client = new HelperClient('http://127.0.0.1:3210'); client.token = 'paired-token';
  const signal = new AbortController().signal;
  for (const path of ['/api/jobs', '/api/jobs?thread=a%20%26b', '/api/jobs/job-1']) await client.request(path, undefined, signal);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname + new URL(call.url).search), ['/api/read/jobs', '/api/read/jobs?thread=a%20%26b', '/api/read/jobs/job-1']);
  for (const { options } of calls) {
    assert.equal(options.method, 'POST'); assert.equal(options.body, '{}');
    assert.deepEqual(options.headers, { 'content-type': 'application/json', authorization: 'Bearer paired-token' });
    assert.ok(options.signal instanceof AbortSignal);
  }
  await client.request('/api/jobs', { id: 'job-1' });
  await client.request('/api/jobs/job-1/cancel', {});
  await client.request('/api/jobs/prepare', { id: 'preview-1' });
  assert.deepEqual(calls.slice(3).map(call => new URL(call.url).pathname), ['/api/jobs', '/api/jobs/job-1/cancel', '/api/jobs/prepare']);
  assert.equal(calls[3].options.body, '{"id":"job-1"}');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(client.request('/api/jobs', undefined, cancelled.signal), /connection changed/);
  assert.equal(calls.length, 6);
});


test('solver recovery preserves request identity and abort fencing through its read-only alias', async t => {
  const calls: { url: string; options: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => { calls.push({ url, options }); return Response.json({ outcome: { state: 'unknown' } }); });
  const client = new HelperClient('http://127.0.0.1:3210'); client.token = 'paired-token';
  const controller = new AbortController();
  assert.deepEqual(await client.solverResult('request /&?', controller.signal), { state: 'unknown' });
  assert.equal(calls[0].url, client.origin + '/api/read/solver/result?requestId=request%20%2F%26%3F');
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.body, '{}');
  assert.deepEqual(calls[0].options.headers, { 'content-type': 'application/json', authorization: 'Bearer paired-token' });
  controller.abort(); assert.ok(calls[0].options.signal?.aborted);
  await assert.rejects(client.solverResult('request', controller.signal), /connection changed/);
  assert.equal(calls.length, 1);
  await client.request('/api/solver/recompute', { requestId: 'new' });
  await client.request('/api/solver/result', { explicit: true });
  assert.equal(new URL(calls[1].url).pathname, '/api/solver/recompute');
  assert.equal(new URL(calls[2].url).pathname, '/api/solver/result');
});
