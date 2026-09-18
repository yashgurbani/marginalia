import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startServer } from '../daemon/server.ts';
import type { RpcTransport } from '../daemon/providers/stdio.ts';

const extensionOrigin = 'chrome-extension://' + 'a'.repeat(32);
const diagnostics = () => ({ status: 'unavailable', login: 'unknown', sandbox: 'unverified' });
async function pair(helper: Awaited<ReturnType<typeof startServer>>) {
  const response = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: extensionOrigin },
    body: JSON.stringify({ challenge: helper.challenge }) });
  assert.equal(response.status, 200);
  const { token } = await response.json() as { token: string };
  return { Origin: extensionOrigin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
const text = 'A gradient measures how a quantity changes across space.';
const page = { browserInstanceId: 'integration-browser', tabId: '1', documentId: 'document-1',
  url: 'https://example.org/article', sourceHash: createHash('sha256').update(text).digest('hex'), text };

test('prepared definitions authenticate, reuse cache, dismiss and forget through mounted routes', async () => {
  let turns = 0;
  const listeners = new Set<(method: string, params: unknown) => void>();
  const rpc: RpcTransport = {
    request: async method => method === 'thread/start' ? { thread: { id: 'prepared-thread' } } : {},
    notify() {}, onNotification(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onDisconnect() { return () => {}; }, close() {},
    prepareRequest() {
      const id = ++turns;
      return { id, generation: 'test', sha256: 'test', async send(finalize) {
        finalize?.();
        queueMicrotask(() => {
          const answer = id === 1 ? 'Ready' : JSON.stringify({ items: [{ candidateId: 'gradient-1', text: 'Change across space.' }] });
          for (const listener of listeners) {
            listener('thread/tokenUsage/updated', { threadId: 'prepared-thread', turnId: `turn-${id}`, tokenUsage: { last: { inputTokens: 40, cachedInputTokens: 10, outputTokens: 10, totalTokens: 50 } } });
            listener('item/completed', { threadId: 'prepared-thread', turnId: `turn-${id}`, item: { id: `message-${id}`, type: 'agentMessage', phase: 'final_answer', text: answer } });
            listener('turn/completed', { threadId: 'prepared-thread', turn: { id: `turn-${id}`, status: 'completed' } });
          }
        });
        return { turn: { id: `turn-${id}`, status: 'inProgress' } };
      } };
    },
  };
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics, instant: { connect: async () => rpc, turnTimeoutMs: 1000 } });
  try {
    const path = '/api/instant/definitions/prepare';
    assert.equal((await fetch(helper.origin + path, { method: 'POST', body: '{}' })).status, 401);
    const headers = await pair(helper);
    const post = async (path: string, value: unknown) => fetch(helper.origin + path, { method: 'POST', headers, body: JSON.stringify(value) });
    const settings = await (await fetch(helper.origin + '/api/settings/auto-assist', { headers })).json();
    assert.equal((await post('/api/settings/auto-assist', { ...settings.autoAssist, expectedRevision: settings.autoAssist.revision, enabled: true })).status, 200);
    const ready = await (await post('/api/instant/prepare', page)).json();
    assert.equal(ready.state, 'ready');
    const terms = [{ candidateId: 'gradient-1', term: 'gradient', normalizedTerm: 'gradient', start: 2, end: 10, contextHash: 'a'.repeat(64) }];
    assert.deepEqual(await (await post(path, { pageId: 'not-owned', terms })).json(), { state: 'stale', definitions: [] });
    const first = await (await post(path, { pageId: ready.pageId, terms })).json();
    assert.equal(first.state, 'ready'); assert.equal(first.definitions[0].text, 'Change across space.');
    assert.equal(turns, 2);
    assert.deepEqual(await (await post(path, { pageId: ready.pageId, terms })).json(), first);
    assert.equal(turns, 2);
    assert.deepEqual(await (await post('/api/instant/definitions/dismiss', { pageId: ready.pageId, normalizedTerm: '  GrAdiEnt ' })).json(), { dismissed: true });
    assert.equal((await (await post(path, { pageId: ready.pageId, terms })).json()).state, 'ready');
    assert.equal(turns, 3);
    assert.equal((await (await post('/api/instant/forget', { pageId: ready.pageId })).json()).forgotten, true);
    assert.deepEqual(await (await post(path, { pageId: ready.pageId, terms })).json(), { state: 'stale', definitions: [] });
    assert.equal(turns, 3);
  } finally { await helper.close(); }
});

test('instant settings mount behind pairing and stay usable without a provider', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    assert.equal((await fetch(helper.origin + '/api/instant/settings', { headers: { Origin: extensionOrigin } })).status, 401);
    const headers = await pair(helper);
    const response = await fetch(helper.origin + '/api/instant/settings', { headers });
    assert.equal(response.status, 200);
    const settings = await response.json();
    assert.equal(settings.enabled, true);
    const saved = await fetch(helper.origin + '/api/instant/settings', { method: 'POST', headers,
      body: JSON.stringify({ ...settings, expectedRevision: settings.revision, enabled: false }) });
    assert.equal(saved.status, 200);
    const prepared = await fetch(helper.origin + '/api/instant/prepare', { method: 'POST', headers, body: JSON.stringify(page) });
    assert.equal(prepared.status, 200);
    assert.equal((await prepared.json()).state, 'off');
  } finally { await helper.close(); }
});

test('server mounts instant preparation and selection lazily and closes its provider', async () => {
  let connections = 0, closed = 0, turns = 0;
  const deletedThreads: unknown[] = [];
  const listeners = new Set<(method: string, params: unknown) => void>();
  const rpc: RpcTransport = {
    request: async (method, params) => {
      if (method === 'thread/delete') deletedThreads.push(params);
      return method === 'thread/start' ? { thread: { id: 'thread-1' } } : {};
    },
    notify() {}, onNotification(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onDisconnect() { return () => {}; }, close() { closed++; },
    prepareRequest() {
      const id = ++turns;
      return { id, generation: 'test', sha256: 'test', async send(finalize) {
        finalize?.();
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener('item/agentMessage/delta', { threadId: 'thread-1', turnId: `turn-${id}`, delta: id === 1 ? 'Ready' : 'A gradient describes change across space.' });
            listener('item/completed', { threadId: 'thread-1', turnId: `turn-${id}`, item: { id: `message-${id}`, type: 'agentMessage', phase: 'final_answer', text: id === 1 ? 'Ready' : 'A gradient describes change across space.' } });
            listener('turn/completed', { threadId: 'thread-1', turn: { id: `turn-${id}`, status: 'completed' } });
          }
        });
        return { turn: { id: `turn-${id}`, status: 'inProgress' } };
      } };
    },
  };
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics,
    instant: { connect: async () => { connections++; return rpc; }, turnTimeoutMs: 1000 } });
  try {
    assert.equal(connections, 0);
    const headers = await pair(helper);
    await fetch(helper.origin + '/api/instant/settings', { headers });
    assert.equal(connections, 0);
    const prepared = await fetch(helper.origin + '/api/instant/prepare', { method: 'POST', headers, body: JSON.stringify(page) });
    const result = await prepared.json();
    assert.equal(result.state, 'ready');
    const selection = await fetch(helper.origin + '/api/instant/select', { method: 'POST', headers,
      body: JSON.stringify({ pageId: result.pageId, selectionId: 'selection-1', text: 'gradient' }) });
    assert.equal(selection.status, 200);
    assert.match(selection.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.match(await selection.text(), /event: completed/);
    assert.equal(connections, 1);
    assert.equal(turns, 2);
    const released = await fetch(helper.origin + '/api/instant/release', { method: 'POST', headers, body: JSON.stringify({ pageId: result.pageId }) });
    assert.deepEqual(await released.json(), { released: true });
    const forgotten = await fetch(helper.origin + '/api/instant/forget', { method: 'POST', headers, body: JSON.stringify({ pageId: result.pageId }) });
    assert.equal(forgotten.status, 200);
    assert.deepEqual(await forgotten.json(), { forgotten: true, alreadyForgotten: false, providerHistory: 'deleted' });
    assert.deepEqual(deletedThreads, [{ threadId: 'thread-1' }]);
    const repeated = await fetch(helper.origin + '/api/instant/forget', { method: 'POST', headers, body: JSON.stringify({ pageId: result.pageId }) });
    assert.equal((await repeated.json()).alreadyForgotten, true);
    assert.equal(deletedThreads.length, 1);
  } finally { await helper.close(); }
  assert.equal(closed, 1);
});

test('auto assist settings require pairing, default off, and reject stale saves', async () => {
  let connections = 0;
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics,
    instant: { connect: async () => { connections++; throw new Error('No provider expected'); } } });
  try {
    const path = '/api/settings/auto-assist';
    assert.equal((await fetch(helper.origin + path)).status, 401);
    const headers = await pair(helper);
    const initial = await fetch(helper.origin + path, { headers });
    assert.equal(initial.status, 200);
    const { autoAssist } = await initial.json();
    assert.equal(autoAssist.enabled, false);
    const change = { ...autoAssist, expectedRevision: autoAssist.revision, enabled: true, posture: 'learning' };
    const saved = await fetch(helper.origin + path, { method: 'POST', headers, body: JSON.stringify(change) });
    assert.equal(saved.status, 200);
    const value = await saved.json();
    assert.equal(value.autoAssist.enabled, true);
    assert.equal(value.autoAssist.posture, 'learning');
    assert.equal(value.autoAssist.revision, autoAssist.revision + 1);
    assert.equal((await fetch(helper.origin + path, { method: 'POST', headers, body: JSON.stringify(change) })).status, 409);
    assert.equal(connections, 0);
  } finally { await helper.close(); }
});

test('related POST is mounted without replacing the existing related GET', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics });
  try {
    const headers = await pair(helper);
    helper.store.apply({ id: 'keep-related', kind: 'keep', threadId: 'saved-related',
      capture: { url: 'https://example.org/related', title: 'Saved gradient', pageType: 'article', text,
        capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' },
      anchor: { exact: text, prefix: '', suffix: '', start: 0, end: text.length }, note: 'Revisit gradient across space.' });
    const post = await fetch(helper.origin + '/api/library-related', { method: 'POST', headers,
      body: JSON.stringify({ passage: { exact: 'gradient', prefix: '', suffix: '', start: 0, end: 8 } }) });
    assert.equal(post.status, 200);
    assert.equal((await post.json()).results[0].threadId, 'saved-related');
    const get = await fetch(helper.origin + '/api/library-related?thread=saved-related', { headers });
    assert.equal(get.status, 200);
    assert.ok(Array.isArray((await get.json()).results));
  } finally { await helper.close(); }
});
