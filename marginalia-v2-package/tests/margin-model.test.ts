import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorAt, orderedThreads, outgoingPreview, pageDefinition } from '../ui/margin-model.ts';
import { wholePageAnchor, type SourceCapture, type Thread } from '../contracts/reader.ts';
import { ReaderJournal } from '../ui/journal.ts';

const capture: SourceCapture = { url: 'https://example.org/article', title: 'Reading', pageType: 'Article', text: 'A margin is space beside the text. A later passage.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'test' };
test('threads remain in source order across note and state updates; removed and other pages stay out', async () => {
  const journal = new ReaderJournal({ load: async () => undefined, save: async () => {} });
  await journal.change({ id: 'later', kind: 'keep', threadId: 'b', capture, anchor: anchorAt(capture.text, 35, 49) });
  await journal.change({ id: 'earlier', kind: 'keep', threadId: 'a', capture, anchor: anchorAt(capture.text, 0, 34), note: 'Mine' });
  await journal.change({ id: 'park', kind: 'thread-state', threadId: 'b', state: 'parked', expectedRevision: 1 });
  assert.deepEqual(orderedThreads(journal.state.threads, capture).map(t => t.id), ['a', 'b']);
  await journal.change({ id: 'remove', kind: 'remove', threadId: 'a', removed: true, expectedRevision: 1 });
  assert.deepEqual(orderedThreads([...journal.state.threads, { ...journal.state.threads[0], id: 'other', sourceUrl: 'https://other.test' } as Thread], capture).map(t => t.id), ['b']);
});
test('outgoing preview attaches only selected passage, exact note version and explicitly entered context', () => {
  const packet = outgoingPreview(capture, anchorAt(capture.text, 0, 8), 'Explain this', { text: 'My question?', revision: 2 });
  assert.equal(packet.passage, 'A margin');
  assert.deepEqual(packet.note, { text: 'My question?', revision: 2 });
  assert.equal(packet.context, '');
  assert.ok(!JSON.stringify(packet).includes('later passage'));
  assert.equal(outgoingPreview(capture, wholePageAnchor(), 'Reflect').passage, '');
});
test('local definition quotes literal page text and escapes selected regex characters', () => {
  assert.equal(pageDefinition('A margin', capture.text), 'A margin is space beside the text.');
  assert.equal(pageDefinition('later passage', capture.text), undefined);
  assert.equal(pageDefinition('[x]', '[x] means a chosen value.'), '[x] means a chosen value.');
});
