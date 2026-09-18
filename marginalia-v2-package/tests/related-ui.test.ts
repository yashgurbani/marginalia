import test from 'node:test';
import assert from 'node:assert/strict';
import { RelatedClient } from '../ui/related/client.ts';
import { mountRelated } from '../ui/related/related.ts';
import { FakeRelatedTransport } from '../ui/related/transport.ts';
import { dom } from './t05-dom.ts';

const anchor = { kind: 'quote' as const, exact: 'Vorticity is stretched by the flow.', prefix: '', suffix: '', start: 0, end: 35 };
const request = { passage: anchor, limit: 3 };
const result = (kind: 'note' | 'thread', threadId: string, note: { id: string; revision: number; excerpt: string } | null) => ({
  kind, threadId, anchorId: `anchor-${threadId}`, sourceVersionId: `source-${threadId}`,
  sourceTitle: kind === 'note' ? 'Fluid mechanics notes' : 'Turbulence reading', sourceUrl: 'https://example.org/fluid',
  anchor, sourceExcerpt: 'A source passage about vortex stretching.', note, matchedTerms: ['vorticity'], score: .75, reason: 'Shared terms.',
});

test('related library stays empty without matches and renders a quiet linked list with matches', async t => {
  const d = dom(t), fake = new FakeRelatedTransport(), mount = mountRelated(d.root as unknown as HTMLElement, fake);
  t.after(() => mount.destroy());
  await mount.show(request);
  assert.equal(d.root.textContent, '');
  assert.deepEqual(fake.requests, [request]);

  fake.response = { results: [
    result('note', 't1', { id: 'n1', revision: 1, excerpt: 'My note about vortex stretching.' }),
    result('thread', 't2', null),
  ] };
  await mount.show(request);
  assert.equal(d.root.querySelector('h3')?.textContent, 'Related in your library');
  assert.equal(d.root.querySelectorAll('li').length, 2);
  assert.equal(d.root.querySelector('li[data-kind="note"]')?.textContent, 'Fluid mechanics notesMy note about vortex stretching.');
  assert.equal(d.root.querySelector('a')?.getAttribute('href'), '#thread=t1');
  assert.doesNotMatch(d.root.textContent, /0\.75/);
});

test('related client sends the frozen request shape and rejects malformed results', async () => {
  const calls: Array<{ path: string; body: object }> = [];
  const results = [{ ...result('thread', 't1', null), kind: 'highlight' }];
  const client = new RelatedClient({ async request(path, body) { calls.push({ path, body }); return { results }; } });
  await assert.rejects(client.findRelated(request), /invalid related library item/);
  assert.deepEqual(calls, [{ path: '/api/library-related', body: request }]);
});
