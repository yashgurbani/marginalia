import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTANT_POLL_WINDOW_MS, panelInstantTransport } from '../extension/lib/panel-instant.ts';
import { instantTextToReply } from '../contracts/instant.ts';

const selection = { requestId: 'ui', pageKey: 'https://example.org/a', sourceUrl: 'https://example.org/a', sourceGeneration: 'capture', text: 'passage', action: 'define' as const };

test('a 75 second preparation can deliver the existing selection without another send', async () => {
  let elapsed = 0;
  const calls: string[] = [];
  const transport = panelInstantTransport(async action => {
    calls.push(action);
    if (elapsed < 75_000) return { url: selection.sourceUrl, state: 'outcome_unknown' };
    return { url: selection.sourceUrl, state: 'ready', pageId: 'page', selectionId: 'selection', selectionText: selection.text,
      event: { type: 'completed', pageId: 'page', selectionId: 'selection', sequence: 1, reply: instantTextToReply('A completed explanation.') } };
  }, async () => { elapsed += 250; });
  const events = [];
  for await (const event of transport.requestDefinition(selection)) events.push(event);
  assert.equal(elapsed, 75_000);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'reply');
  assert.deepEqual([...new Set(calls)], ['instant-status']);
});

test('terminal preparation failure ends promptly without a selection event', async () => {
  for (const state of ['failed', 'outcome_unknown']) {
    let reads = 0, pauses = 0;
    const transport = panelInstantTransport(async () => { reads++; return { url: selection.sourceUrl, state, pageId: 'prepared-page' }; }, async () => { pauses++; });
    const events = [];
    for await (const event of transport.requestDefinition(selection)) events.push(event);
    assert.equal(reads, 1, state);
    assert.equal(pauses, 0, state);
    assert.deepEqual(events, [], 'existing definition mount renders an empty terminal stream as unavailable');
  }
});

test('missing status is bounded by the new observation window', async () => {
  let elapsed = 0, reads = 0;
  const transport = panelInstantTransport(async action => { assert.equal(action, 'instant-status'); reads++; return null; }, async () => { elapsed += 250; });
  const events = [];
  for await (const event of transport.requestDefinition(selection)) events.push(event);
  assert.ok(INSTANT_POLL_WINDOW_MS > 120_000);
  assert.equal(elapsed, INSTANT_POLL_WINDOW_MS);
  assert.equal(reads, INSTANT_POLL_WINDOW_MS / 250);
  assert.deepEqual(events, []);
});

test('an unrelated page failure cannot end the current selection wait', async () => {
  let reads = 0;
  const transport = panelInstantTransport(async () => {
    if (++reads === 1) return { url: 'https://example.org/other', state: 'failed', pageId: 'other' };
    return { url: selection.sourceUrl, state: 'failed', pageId: 'current' };
  }, async () => {});
  for await (const _event of transport.requestDefinition(selection)) assert.fail('No reply expected');
  assert.equal(reads, 2);
});
