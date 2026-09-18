import test from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryAnswer, LibraryAnswerReason } from '../contracts/library-answer.ts';
import { LibraryAnswerClient } from '../ui/answer/client.ts';
import { mountLibraryAnswer } from '../ui/answer/answer.ts';
import { FakeLibraryAnswerTransport } from '../ui/answer/transport.ts';
import { dom } from './t05-dom.ts';

function answered(): LibraryAnswer {
  const excerpt = '<img src=x onerror=alert(1)> Heat and pressure.';
  return { schema: 'marginalia.collection-answer.v1', query: 'heat pressure', mode: 'extractive-local', status: 'answered',
    answer: 'Extractive saved-passage answer. Saved excerpts matching this question:', citations: [{
      threadId: 'thread-one', sourceVersionId: 'source-one', sourceHash: 'hash-one', sourceUrl: 'https://example.com/source',
      sourceTitle: '<b>A source</b>', anchor: { kind: 'quote', exact: 'Heat and pressure.', prefix: '', suffix: '', start: 0, end: 18 },
      excerpt, matchTerms: ['heat', 'pressure'], kind: 'source', excerptStart: 0, excerptEnd: excerpt.length,
      reason: 'All question words found in this saved source passage.',
    }] };
}
function abstained(reason: LibraryAnswerReason, citations: LibraryAnswer['citations'] = []): LibraryAnswer {
  return { schema: 'marginalia.collection-answer.v1', query: 'heat pressure', mode: 'extractive-local', status: 'abstained',
    answer: null, citations, reason };
}

test('saved-passage answer uses a fixed heading and text-only excerpts with cited saved-thread links', async t => {
  const d = dom(t), fake = new FakeLibraryAnswerTransport(answered());
  const mount = mountLibraryAnswer(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  await mount.ask('heat pressure', ['thread-one']);
  assert.equal(d.root.querySelector('h3')?.textContent, 'Saved-passage answer');
  assert.match(d.root.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(d.root.querySelector('img'), null); assert.equal(d.root.querySelector('b'), null);
  assert.doesNotMatch(d.root.textContent, /sources agree/i);
  const link = d.root.querySelector('a'); assert.ok(link); assert.equal(link.textContent, '<b>A source</b>');
  assert.equal((link as unknown as HTMLAnchorElement).href, '/library#thread=thread-one');
  assert.deepEqual(fake.requests, [{ query: 'heat pressure', threadIds: ['thread-one'] }]);
});

test('saved-passage answer gives a clear plain line for every abstention', async t => {
  const d = dom(t), fake = new FakeLibraryAnswerTransport(abstained('no-exact-saved-support'));
  const mount = mountLibraryAnswer(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  const cases: [LibraryAnswerReason, string][] = [
    ['no-exact-saved-support', 'No exact saved excerpt was found.'],
    ['ambiguous-support', 'The saved excerpts differ, so no answer is shown.'],
    ['invalid-query', 'This question could not be searched in saved work.'],
  ];
  for (const [reason, line] of cases) {
    fake.response = abstained(reason); await mount.ask('heat pressure');
    assert.equal(d.root.textContent, `Saved-passage answer${line}`);
  }
});

test('ambiguous saved-passage answer keeps its supporting citations and thread navigation', async t => {
  const citation = answered().citations[0];
  const d = dom(t), fake = new FakeLibraryAnswerTransport(abstained('ambiguous-support', [citation]));
  const mount = mountLibraryAnswer(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  await mount.ask('heat pressure');
  assert.match(d.root.textContent, /The saved excerpts differ, so no answer is shown\./);
  assert.match(d.root.textContent, /<img src=x onerror=alert\(1\)> Heat and pressure\./);
  const link = d.root.querySelector('a'); assert.ok(link);
  assert.equal((link as unknown as HTMLAnchorElement).href, '/library#thread=thread-one');
  assert.equal(link.textContent, '<b>A source</b>');
});

test('saved-passage client repeats thread filters and rejects unsafe response URLs', async () => {
  const paths: string[] = [], response = answered();
  const client = new LibraryAnswerClient({ async request(path) { paths.push(path); return { answer: response }; } });
  assert.deepEqual(await client.answer('heat pressure?', ['thread-one', 'thread-two']), response);
  assert.deepEqual(paths, ['/api/library-answer?q=heat+pressure%3F&thread=thread-one&thread=thread-two']);
  const invalid = answered(); invalid.citations[0].sourceUrl = 'javascript:alert(1)';
  await assert.rejects(new LibraryAnswerClient({ async request() { return { answer: invalid }; } }).answer('heat'), /invalid saved-passage answer/);
});
