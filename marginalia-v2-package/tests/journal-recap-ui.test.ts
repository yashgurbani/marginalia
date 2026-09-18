import test from 'node:test';
import assert from 'node:assert/strict';
import type { JournalRecap } from '../contracts/journal-recap.ts';
import { JournalRecapClient } from '../ui/journal-recap/client.ts';
import { mountJournalRecap } from '../ui/journal-recap/recap.ts';
import { FakeJournalRecapTransport } from '../ui/journal-recap/transport.ts';
import { dom, type TestElement } from './t05-dom.ts';

const recap = (): JournalRecap => ({
  schema: 'marginalia.journal-summary.v1', kind: 'local-recap', label: 'Local recap', coverage: 'saved-activity',
  date: '2026-09-18', timeZone: 'Europe/Berlin', description: 'Local saved activity.',
  counts: { items: 2, sources: 1, threads: 1, bookmarks: 0, passages: 1, highlights: 0, notes: 1, replies: 0 },
  topics: [{ id: 'saved-activity:unassigned', label: 'Thermodynamics', basis: 'saved-activity',
    counts: { items: 2, sources: 1, threads: 1 }, sourceIds: ['source-one'], threadIds: ['thread-one'], terms: [], truncated: false }],
  snippets: [{ id: 'source:item-one', kind: 'source', text: 'Heat raises pressure.', truncated: false,
    savedAt: '2026-09-18T10:00:00.000Z', threadId: 'thread-one', threadLink: '/#thread=thread-one',
    source: { id: 'source-one', hash: 'hash-one', title: 'A local source', url: 'https://example.com/source' } }],
});

test('journal recap renders one quiet local day with topics, snippets, and saved-thread links', async t => {
  const d = dom(t), fake = new FakeJournalRecapTransport(recap());
  const mount = mountJournalRecap(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  await mount.show('2026-09-18', 'Europe/Berlin');
  assert.match(d.root.textContent, /Daily recap/);
  assert.match(d.root.textContent, /2 saved items from 1 source on 2026-09-18\./);
  assert.match(d.root.textContent, /computed locally from saved activity/);
  assert.match(d.root.textContent, /Thermodynamics/); assert.match(d.root.textContent, /Heat raises pressure\./);
  const link = d.root.querySelector('a'); assert.ok(link);
  assert.equal((link as unknown as HTMLAnchorElement).href, '/#thread=thread-one');
  assert.deepEqual(fake.requests, [{ date: '2026-09-18', timeZone: 'Europe/Berlin' }]);
});

test('journal recap renders nothing when the local summary is empty', async t => {
  const d = dom(t), empty = recap();
  empty.counts = { items: 0, sources: 0, threads: 0, bookmarks: 0, passages: 0, highlights: 0, notes: 0, replies: 0 };
  empty.topics = []; empty.snippets = [];
  const mount = mountJournalRecap(d.root as unknown as HTMLElement, new FakeJournalRecapTransport(empty)); t.after(() => mount.destroy());
  await mount.show('2026-09-18', 'Europe/Berlin'); assert.equal(d.root.textContent, '');
});

test('journal recap client encodes the day and IANA time zone and rejects malformed summaries', async () => {
  const paths: string[] = [], expected = recap();
  const client = new JournalRecapClient({ async request(path) { paths.push(path); return { summary: expected }; } });
  assert.deepEqual(await client.getRecap('2026-09-18', 'America/Argentina/Buenos_Aires'), expected);
  assert.deepEqual(paths, ['/api/library-journal-summary?date=2026-09-18&timeZone=America%2FArgentina%2FBuenos_Aires']);
  const invalid = new JournalRecapClient({ async request() { return { summary: { ...expected, label: 'Generated summary' } }; } });
  await assert.rejects(invalid.getRecap('2026-09-18', 'Europe/Berlin'), /invalid journal recap/);
});

test('journal recap client normalizes a validated legacy link before the renderer assigns href', async t => {
  const d = dom(t), expected = recap();
  expected.snippets[0].threadLink = '/library#thread=thread-one';
  const client = new JournalRecapClient({ async request() { return { summary: expected }; } });
  const mount = mountJournalRecap(d.root as unknown as HTMLElement, client); t.after(() => mount.destroy());
  await mount.show('2026-09-18', 'Europe/Berlin');
  const link = d.root.querySelector('a'); assert.ok(link);
  assert.equal((link as unknown as HTMLAnchorElement).href, '/#thread=thread-one');
});
