import test from 'node:test';
import assert from 'node:assert/strict';
import { HelperClient, HelperHttpError, HelperTransportError } from '../ui/helper.ts';
import { ReaderJournal, type JournalState } from '../ui/journal.ts';

test('network failure has actionable uncertain-result wording and does not leak the raw cause or retry', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch secret-token'); });
  const client = new HelperClient('http://localhost:3210'); client.token = 'secret-token';
  await assert.rejects(client.list(), error => {
    assert.ok(error instanceof HelperTransportError);
    assert.equal(error.kind, 'network');
    assert.equal(error.message, 'The local helper could not be reached. Check that it is running. The result of this request is unconfirmed.');
    assert.ok(!String(error.stack).includes('secret-token'));
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('timeout is distinguished without claiming a request was unsent or its data durable', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('Raw timeout details', 'TimeoutError'); });
  await assert.rejects(new HelperClient('http://localhost:3210').request('/api/change', { id: 'same-id' }), error => {
    assert.ok(error instanceof HelperTransportError); assert.equal(error.kind, 'timeout');
    assert.match(error.message, /did not reply in time/); assert.match(error.message, /result of this request is unconfirmed/);
    assert.doesNotMatch(error.message, /unsent|not sent|saved|notes remain|Raw timeout/);
    return true;
  });
});

test('unreadable or malformed success responses remain unknown, including interrupted response bodies', async t => {
  const replies = [
    new Response('not json', { status: 200 }),
    Response.json(null),
    Response.json([]),
    new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('body interrupted secret-token')); } })),
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async () => replies.shift()!);
  const client = new HelperClient('http://localhost:3210');
  for (let index = 0; index < 4; index++) await assert.rejects(client.list(), error => {
    assert.ok(error instanceof HelperTransportError); assert.equal(error.kind, 'response-unknown');
    assert.match(error.message, /reply could not be read/); assert.match(error.message, /unconfirmed/);
    assert.doesNotMatch(error.message, /secret-token|body interrupted/);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 4);
});

test('HTTP application errors stay distinct, and 409 retains the journal Conflict identity', async t => {
  const responses = [Response.json({ error: 'Pairing was revoked.' }, { status: 401 }), Response.json({ error: 'Changed elsewhere.' }, { status: 409 }), new Response('invalid body', { status: 409 })];
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
  const client = new HelperClient('http://localhost:3210');
  await assert.rejects(client.list(), error => {
    assert.ok(error instanceof HelperHttpError); assert.equal(error.status, 401);
    assert.equal(error.message, 'Pairing was revoked.'); assert.ok(!(error instanceof HelperTransportError)); return true;
  });
  for (const message of ['Changed elsewhere.', 'The local helper rejected this request (HTTP 409).']) {
    await assert.rejects(client.request('/api/reply-view', {}), error => {
      assert.ok(error instanceof HelperHttpError); assert.equal(error.status, 409);
      assert.equal(error.name, 'Conflict'); assert.equal(error.message, message); return true;
    });
  }
});

test('unknown helper outcome keeps the journal mutation intact for an explicit retry', async t => {
  let durable: JournalState | undefined;
  const journal = new ReaderJournal({ load: async () => structuredClone(durable), save: async value => { durable = structuredClone(value); } });
  await journal.change({ id: 'stable-mutation', kind: 'keep', threadId: 'thread', capture: {
    url: 'https://example.org/page', title: 'Page', pageType: 'article', text: 'Keep this.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1',
  }, anchor: { exact: 'Keep this.', prefix: '', suffix: '', start: 0, end: 10 } });
  const before = structuredClone(durable);
  const sent: unknown[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    sent.push(JSON.parse(options.body as string)); throw new TypeError('Failed to fetch');
  });
  const client = new HelperClient('http://localhost:3210');
  for (let attempt = 1; attempt <= 2; attempt++) {
    await assert.rejects(journal.sync(change => client.change(change), () => client.list()), HelperTransportError);
    assert.equal(fetch.mock.callCount(), attempt);
    assert.deepEqual(durable, before); assert.deepEqual(journal.state.pending, before!.pending);
    assert.equal(journal.unsaved, false);
  }
  assert.deepEqual(sent[0], sent[1]);
});
