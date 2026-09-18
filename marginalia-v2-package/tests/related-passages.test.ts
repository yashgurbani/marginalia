import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ReaderStore } from '../daemon/store.ts';
import { createRelatedRoutes } from '../daemon/routes/related.ts';
import { findRelatedPassages, type RelatedPassageRequest } from '../daemon/transforms/explore/related.ts';
import type { ApiRouteContext } from '../daemon/routes/types.ts';

const selection = (exact: string): RelatedPassageRequest['passage'] => ({
  kind: 'quote', exact, prefix: '', suffix: '', start: 0, end: exact.length,
});

function keep(store: ReaderStore, id: string, text: string, anchor: string, note?: string) {
  const start = text.indexOf(anchor);
  assert.notEqual(start, -1);
  store.apply({ id: `keep-${id}`, kind: 'keep', threadId: id,
    capture: { url: `https://example.org/${id}`, title: `Saved ${id}`, pageType: 'article', text,
      capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' },
    anchor: { kind: 'quote', exact: anchor, prefix: '', suffix: '', start, end: start + anchor.length },
    ...(note === undefined ? {} : { note }) });
}

function context(store: ReaderStore, body: unknown, paired = true, method: string = 'POST') {
  let sent: { status: number; data: unknown } | undefined;
  const route = createRelatedRoutes(store);
  const value = {
    request: { method } as IncomingMessage,
    response: {} as ServerResponse,
    url: new URL('http://127.0.0.1/api/library-related'),
    requestOrigin: 'chrome-extension://' + 'a'.repeat(32),
    authOrigin: 'chrome-extension://' + 'a'.repeat(32),
    token: 'b'.repeat(43),
    principal: { siteOrigin: 'https://example.org', scope: 'local' } as never,
    requireCurrentPairing: () => paired,
    send: (_response: ServerResponse, status: number, data: unknown) => { sent = { status, data }; },
    body: async () => body,
    emptyBody: async () => {},
  } as unknown as ApiRouteContext;
  return { route, value, read: () => sent };
}

test('selected passages rank local note and thread matches with exact saved identity', () => {
  const store = new ReaderStore(':memory:');
  try {
    keep(store, 'current', 'The current passage discusses vortex stretching.', 'vortex stretching');
    keep(store, 'note-thread', 'A saved article introduces vortex stretching and rotation.', 'vortex stretching',
      'Remember that vortex stretching changes rotation.');
    keep(store, 'bare-thread', 'Another saved article returns to vortex stretching.', 'vortex stretching');
    keep(store, 'unrelated', 'A saved article about pasta and water.', 'pasta and water');
    keep(store, 'removed', 'A deleted note about vortex stretching.', 'vortex stretching', 'vortex stretching is gone');
    store.apply({ id: 'remove-thread', kind: 'remove', threadId: 'removed', expectedRevision: 1, removed: true });

    const results = findRelatedPassages(store, {
      passage: selection('vortex stretching'), threadId: 'current', limit: 8,
    });

    assert.deepEqual(results.map(result => [result.kind, result.threadId]), [
      ['note', 'note-thread'], ['thread', 'bare-thread'],
    ]);
    assert.ok(results[0].score >= results[1].score);
    assert.equal(results[0].note?.id, store.get('note-thread')!.notes[0].id);
    assert.equal(results[0].note?.revision, 1);
    assert.deepEqual(results.map(result => ({
      threadId: result.threadId,
      anchorId: result.anchorId,
      sourceVersionId: result.sourceVersionId,
      anchor: result.anchor,
    })), results.map(result => {
      const thread = store.get(result.threadId)!;
      return { threadId: thread.id, anchorId: thread.anchorId, sourceVersionId: thread.sourceVersionId, anchor: thread.anchor };
    }));
    assert.match(results[0].reason, /vortex|stretching/);
    assert.ok(results.every(result => result.matchedTerms.length > 0));
    assert.ok(results.every(result => !result.threadId.includes('removed')));
  } finally { store.close(); }
});

test('related route returns local results only after the current pairing is checked', async () => {
  const store = new ReaderStore(':memory:');
  try {
    keep(store, 'saved', 'A saved note about vortex stretching.', 'vortex stretching', 'Revisit vortex stretching.');
    const request: RelatedPassageRequest = { passage: selection('vortex stretching'), limit: 3 };
    const paired = context(store, request);
    assert.equal(await paired.route(paired.value), true);
    assert.equal(paired.read()?.status, 200);
    assert.equal((paired.read()?.data as { results: unknown[] }).results.length, 1);

    const unpaired = context(store, request, false);
    assert.equal(await unpaired.route(unpaired.value), true);
    assert.equal(unpaired.read()?.status, 401);
    assert.deepEqual(unpaired.read()?.data, { error: 'Pair with the local helper to read related passages.' });

    const existingGet = context(store, request, true, 'GET');
    assert.equal(await existingGet.route(existingGet.value), false, 'the existing reader GET route keeps ownership of thread lookup');
  } finally { store.close(); }
});

test('related route rejects a passage that cannot be an exact anchor', async () => {
  const store = new ReaderStore(':memory:');
  try {
    const bad = context(store, { passage: { kind: 'quote', exact: '', prefix: '', suffix: '', start: 0, end: 0 } });
    await assert.rejects(() => bad.route(bad.value), /Invalid related passage/);
  } finally { store.close(); }
});
