import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TestContext } from 'node:test';
import type { ApiRouteContext } from '../daemon/routes/types.ts';
import { createJournalSummaryRoute } from '../daemon/routes/journal-summary.ts';
import { createJournalSummaryService, type JournalSummary } from '../daemon/journal-synthesis.ts';
import { journalRecapFrom } from '../contracts/journal-recap.ts';
import { ReaderStore } from '../daemon/store.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

function keep(store: ReaderStore, id: string, at: string, text: string, note?: string) {
  store.apply({ id: `keep-${id}`, kind: 'keep', threadId: id, note,
    capture: { url: `https://example.test/${id}`, title: `Source ${id}`, pageType: 'article', text, capturedAt: at, extractionVersion: 'test' },
    anchor: { exact: text, prefix: '', suffix: '', start: 0, end: text.length } });
}

function fixture(store: ReaderStore, t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-18T10:00:00Z') });
  try {
    keep(store, 'fluid', '2026-09-18T09:00:00Z', 'Enstrophy follows turbulent flow.', 'Reader note about flow.');
    t.mock.timers.tick(60 * 60 * 1000);
    keep(store, 'stanza', '2026-09-18T10:00:00Z', 'A stanza has meter.', 'Reader note about meter.');
    store.apply({ id: 'highlight-fluid', kind: 'highlight', threadId: 'fluid', highlighted: true, expectedRevision: store.get('fluid')!.revision });
    store.commitReply({ id: 'reply-fluid', threadId: 'fluid', reply: withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'define', status: 'complete', title: 'A saved reply', summary: 'Provider prose must stay out of the local recap.', sourceBindings: [], parameters: [], assumptions: [], limitations: [], blocks: [{ id: 'text', type: 'text', md: 'Generated prose.' }], checks: [], staticFallback: 'Generated prose.' }) });
  } finally { t.mock.timers.reset(); }
}

test('service returns a deterministic local recap with counts, literal snippets, stable links and local topics', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); fixture(store, t);
  const service = createJournalSummaryService(store, () => ['flow', 'meter']);
  const first = service.summarize({ date: '2026-09-18', timeZone: 'UTC' });
  const second = service.summarize({ date: '2026-09-18', timeZone: 'UTC' });
  assert.deepEqual(first, second);
  assert.equal(first.schema, 'marginalia.journal-summary.v1'); assert.equal(first.kind, 'local-recap'); assert.equal(first.label, 'Local recap');
  assert.equal(first.coverage, 'saved-activity'); assert.equal(first.date, '2026-09-18'); assert.equal(first.timeZone, 'UTC');
  assert.deepEqual(first.counts, { items: 6, sources: 2, threads: 2, bookmarks: 0, passages: 2, highlights: 1, notes: 2, replies: 1 });
  assert.equal(first.snippets.some(snippet => snippet.kind === 'note' && snippet.text === 'Reader note about flow.'), true);
  assert.equal(first.snippets.some(snippet => snippet.kind === 'source' && snippet.text === 'Enstrophy follows turbulent flow.'), true);
  assert.equal(first.snippets.every(snippet => snippet.source.url.startsWith('https://example.test/')), true);
  assert.equal(first.snippets.find(snippet => snippet.threadId === 'fluid')?.threadLink, '/#thread=fluid');
  assert.equal(first.topics.some(topic => topic.label === 'flow'), true);
  assert.equal(first.description, 'This local recap only counts saved activity. It does not infer reading visits or provide generated knowledge.');
  assert.doesNotMatch(JSON.stringify(first), /Provider prose|Generated prose/);
});

test('recap links normalize the validated legacy route to the served root route', () => {
  const summary = {
    schema: 'marginalia.journal-summary.v1', kind: 'local-recap', label: 'Local recap', coverage: 'saved-activity',
    date: '2026-09-18', timeZone: 'UTC', description: 'Saved activity.',
    counts: { items: 1, sources: 1, threads: 1, bookmarks: 0, passages: 1, highlights: 0, notes: 0, replies: 0 },
    topics: [], snippets: [{ id: 'source:item', kind: 'source', text: 'A saved passage.', truncated: false,
      savedAt: '2026-09-18T10:00:00.000Z', threadId: 'thread-a', threadLink: '/#thread=thread-a',
      source: { id: 'source', hash: 'hash', title: 'Saved source', url: 'https://example.org/source' } }],
  } as const;
  assert.equal(journalRecapFrom({ summary }).snippets[0].threadLink, '/#thread=thread-a');
  assert.equal(journalRecapFrom({ summary: { ...summary, snippets: [{ ...summary.snippets[0], threadLink: '/library#thread=thread-a' }] } }).snippets[0].threadLink, '/#thread=thread-a');
  assert.throws(() => journalRecapFrom({ summary: { ...summary, snippets: [{ ...summary.snippets[0], threadLink: '/evil#thread=thread-a' }] } }), /invalid journal recap/);
});

test('service applies the requested local timezone, returns empty removed days, and refuses invalid dates', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close());
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-19T00:30:00Z') });
  try { keep(store, 'late', new Date().toISOString(), 'A passage near midnight.', 'A local note.'); } finally { t.mock.timers.reset(); }
  const service = createJournalSummaryService(store);
  assert.equal(service.summarize({ date: '2026-09-18', timeZone: 'America/Los_Angeles' }).counts.items, 2);
  assert.equal(service.summarize({ date: '2026-09-19', timeZone: 'UTC' }).counts.items, 2);
  store.apply({ id: 'remove-late', kind: 'remove', threadId: 'late', removed: true, expectedRevision: store.get('late')!.revision });
  const empty = service.summarize({ date: '2026-09-18', timeZone: 'America/Los_Angeles' });
  assert.equal(empty.counts.items, 0); assert.deepEqual(empty.snippets, []); assert.deepEqual(empty.topics, []);
  assert.throws(() => service.summarize({ date: '2026-02-30', timeZone: 'UTC' }), /valid journal day/);
  assert.throws(() => service.summarize({ date: '2026-09-18', timeZone: 'Invented\/Zone' }), /valid journal time zone/);
});

test('route exposes paired GET and read-alias projections without writing or provider access', async t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); fixture(store, t);
  const service = createJournalSummaryService(store), route = createJournalSummaryRoute(service);
  const calls: Array<{ status: number; body: unknown }> = [];
  const make = (path: string, method: string, paired = true, origin = 'chrome-extension://' + 'a'.repeat(32)): ApiRouteContext => ({
    request: { method } as IncomingMessage, response: {} as ServerResponse, url: new URL('http://127.0.0.1' + path), requestOrigin: origin,
    authOrigin: origin, token: 'token', principal: { surface: 'browser-owned-margin', pairingId: 'token', origin }, requireCurrentPairing: () => paired,
    send: (_response, status, body) => { calls.push({ status, body }); }, body: async () => ({}), emptyBody: async () => {},
  });
  const get = make('/api/library-journal-summary?date=2026-09-18&timeZone=UTC', 'GET');
  assert.equal(await route(get), true); assert.equal(calls[0].status, 200);
  const getBody = calls[0].body as { summary: JournalSummary }; assert.equal(getBody.summary.label, 'Local recap');
  calls.length = 0;
  const alias = make('/api/read/library-journal-summary?date=2026-09-18&timeZone=UTC', 'POST');
  assert.equal(await route(alias), true); assert.deepEqual(calls[0], { status: 200, body: { summary: getBody.summary } });
  calls.length = 0; assert.equal(await route(make('/api/library-journal-summary?date=2026-09-18&timeZone=UTC', 'GET', false)), true); assert.equal(calls[0].status, 401);
  calls.length = 0; assert.equal(await route(make('/api/library-journal-summary?date=2026-09-18&timeZone=UTC', 'POST')), true); assert.equal(calls[0].status, 405);
  assert.equal(await route(make('/api/other', 'GET')), false);
});
