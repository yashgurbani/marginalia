import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessShelf, prepareOpen, EXPLORE_MAX_ITEMS, type ExploreContext } from '../daemon/transforms/explore/shelf.ts';
import type { CandidateReply, ShelfBlock } from '../contracts/reply.ts';

/** All data here is a labelled unit fixture. It is not a real acceptance journey. */
const CONTEXT: ExploreContext = {
  sessionScope: 'open-session',
  returnTo: { sourceVersionId: 'sv-1', anchor: { exact: 'viscosity', prefix: 'the ', suffix: ' term' } },
};

function item(over: Partial<ShelfBlock['items'][number]>): ShelfBlock['items'][number] {
  return { id: 'i1', title: 'A reading', reason: 'Explains the mechanism.', url: 'https://example.org/a', ...over };
}

function reply(items: ShelfBlock['items']): CandidateReply {
  const block: ShelfBlock = { id: 's1', type: 'shelf', items };
  return {
    schema: 'marginalia.reply.v1', intent: 'explore', status: 'complete',
    title: 'Fixture explore reply', summary: 'Fixture only.',
    sourceBindings: [], parameters: [], assumptions: [], limitations: [],
    blocks: [block], checks: [], staticFallback: 'Fixture.',
  };
}

test('a three-item shelf is ready, fully parked and marked model-suggested', () => {
  const result = assessShelf(reply([
    item({ id: 'i1', url: 'https://example.org/a' }),
    item({ id: 'i2', url: 'https://example.org/b' }),
    item({ id: 'i3', url: 'https://example.org/c' }),
  ]), CONTEXT);
  assert.equal(result.verdict, 'ready');
  assert.equal(result.itemCount, 3);
  assert.equal(result.parked, true);
  assert.ok(result.items.every((i) => i.parked === true && i.provenance === 'model-suggested'));
});

test('a two-item shelf reports its thinness honestly and still parks the items', () => {
  const result = assessShelf(reply([
    item({ id: 'i1', url: 'https://example.org/a' }),
    item({ id: 'i2', url: 'https://example.org/b' }),
  ]), CONTEXT);
  assert.equal(result.verdict, 'insufficient');
  assert.equal(result.itemCount, 2);
  assert.match(result.reason, /fewer than/);
});

test('an empty shelf invents nothing', () => {
  const result = assessShelf(reply([]), CONTEXT);
  assert.equal(result.verdict, 'insufficient');
  assert.equal(result.itemCount, 0);
  assert.match(result.reason, /invented/);
});

test('an item with no reason to open is dropped', () => {
  const result = assessShelf(reply([
    item({ id: 'i1', url: 'https://example.org/a' }),
    item({ id: 'i2', url: 'https://example.org/b', reason: '   ' }),
    item({ id: 'i3', url: 'https://example.org/c' }),
    item({ id: 'i4', url: 'https://example.org/d' }),
  ]), CONTEXT);
  assert.equal(result.itemCount, 3);
  assert.equal(result.droppedCount, 1);
  assert.ok(result.issues.some((i) => i.includes('i2') && i.includes('reason')));
});

test('a duplicate destination is dropped once', () => {
  const result = assessShelf(reply([
    item({ id: 'i1', url: 'https://example.org/a' }),
    item({ id: 'i2', url: 'https://example.org/a' }),
    item({ id: 'i3', url: 'https://example.org/c' }),
    item({ id: 'i4', url: 'https://example.org/d' }),
  ]), CONTEXT);
  assert.equal(result.itemCount, 3);
  assert.ok(result.issues.some((i) => i.includes('duplicate')));
});

test('a non-public destination is dropped at the shelf', () => {
  const result = assessShelf(reply([
    item({ id: 'i1', url: 'https://example.org/a' }),
    item({ id: 'i2', url: 'https://127.0.0.1/secret' }),
    item({ id: 'i3', url: 'https://example.org/c' }),
    item({ id: 'i4', url: 'https://example.org/d' }),
  ]), CONTEXT);
  assert.equal(result.itemCount, 3);
  assert.ok(result.issues.some((i) => i.includes('i2') && i.includes('policy')));
});

test('more than five suggested items are truncated to the shelf cap', () => {
  const many = Array.from({ length: 7 }, (_, n) => item({ id: `i${n}`, url: `https://example.org/${n}` }));
  const result = assessShelf(reply(many), CONTEXT);
  assert.equal(result.itemCount, EXPLORE_MAX_ITEMS);
  assert.equal(result.verdict, 'ready');
  assert.ok(result.issues.some((i) => i.includes('exceeds')));
});

test('assessing a shelf performs no async work and stays parked', () => {
  const result = assessShelf(reply([item({})]), CONTEXT);
  assert.equal(result instanceof Promise, false);
  assert.equal(result.parked, true);
});

test('opening a parked item yields a validated navigation with the return context', () => {
  const result = assessShelf(reply([item({ id: 'i1', url: 'https://example.org/a', timecodeSeconds: 42 })]), CONTEXT);
  const open = prepareOpen(result, 'i1', CONTEXT.returnTo);
  assert.equal(open.ok, true);
  if (open.ok) {
    assert.equal(open.open.url, 'https://example.org/a');
    assert.equal(open.open.timecodeSeconds, 42);
    assert.deepEqual(open.open.returnTo, CONTEXT.returnTo);
  }
});

test('opening an unknown item id fails without side effects', () => {
  const result = assessShelf(reply([item({ id: 'i1' })]), CONTEXT);
  const open = prepareOpen(result, 'missing', CONTEXT.returnTo);
  assert.equal(open.ok, false);
});

test('section fragments and public IPv6 survive shelf and open navigation', () => {
  const urls = ['https://example.org/article#section-2', 'https://[2001:4860:4860::8888]/paper#methods'];
  const result = assessShelf(reply(urls.map((url, n) => item({ id: `i${n}`, url }))), CONTEXT);
  assert.equal(result.itemCount, 2);
  for (let n = 0; n < urls.length; n++) {
    const open = prepareOpen(result, `i${n}`, CONTEXT.returnTo);
    assert.equal(open.ok, true);
    if (open.ok) assert.equal(open.open.url, urls[n]);
  }
});

test('private IPv6 and mapped private IPv4 are dropped', () => {
  const result = assessShelf(reply([
    item({ id: 'a', url: 'https://[::1]/' }),
    item({ id: 'b', url: 'https://[fc00::1]/' }),
    item({ id: 'c', url: 'https://[::ffff:127.0.0.1]/' }),
  ]), CONTEXT);
  assert.equal(result.itemCount, 0);
});

test('a serialized thin shelf can be reopened and opened', () => {
  const assessed = assessShelf(reply([
    item({ id: 'i1', url: 'https://example.org/a#details' }),
    item({ id: 'i2', url: 'https://example.org/b' }),
  ]), CONTEXT);
  const reopened = JSON.parse(JSON.stringify(assessed)) as typeof assessed;
  const open = prepareOpen(reopened, 'i1');
  assert.equal(open.ok, true);
  if (open.ok) {
    assert.equal(open.open.url, 'https://example.org/a#details');
    assert.deepEqual(open.open.returnTo, CONTEXT.returnTo);
  }
});

test('opening an older saved shelf preserves its original return context while reading elsewhere', () => {
  const saved = JSON.parse(JSON.stringify(
    assessShelf(reply([item({ id: 'i1' })]), CONTEXT),
  )) as ReturnType<typeof assessShelf>;
  const currentReading = {
    sourceVersionId: 'sv-current',
    anchor: { exact: 'current passage', prefix: '', suffix: '' },
  };
  const open = prepareOpen(saved, 'i1', currentReading);
  assert.equal(open.ok, true);
  if (open.ok) assert.deepEqual(open.open.returnTo, CONTEXT.returnTo);
});

test('a reopened shelf still needs valid parked item, URL and return data', () => {
  const serialized = JSON.stringify(assessShelf(reply([item({ id: 'i1' })]), CONTEXT));
  const invalidItem = JSON.parse(serialized) as ReturnType<typeof assessShelf>;
  Object.assign(invalidItem.items[0]!, { parked: false });
  const invalidUrl = JSON.parse(serialized) as ReturnType<typeof assessShelf>;
  invalidUrl.items[0]!.url = 'https://127.0.0.1/private';
  const invalidReturn = JSON.parse(serialized) as ReturnType<typeof assessShelf>;
  invalidReturn.returnTo.sourceVersionId = '';
  assert.deepEqual([
    prepareOpen(invalidItem, 'i1').ok,
    prepareOpen(invalidUrl, 'i1').ok,
    prepareOpen(invalidReturn, 'i1').ok,
  ], [false, false, false]);
});

test('a shelf built in a closed session is still valid because it never fetches', () => {
  const result = assessShelf(reply([
    item({ id: 'i1', url: 'https://example.org/a' }),
    item({ id: 'i2', url: 'https://example.org/b' }),
    item({ id: 'i3', url: 'https://example.org/c' }),
  ]), { ...CONTEXT, sessionScope: 'cloud-inference' });
  assert.equal(result.verdict, 'ready');
  assert.equal(result.parked, true);
});
