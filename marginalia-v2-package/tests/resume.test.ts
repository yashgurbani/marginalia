import assert from 'node:assert/strict';
import test from 'node:test';
import { wholePageAnchor, type QuoteAnchor } from '../contracts/reader.ts';
import { clearResumeMarker, resumeAnchor, resumePageUrl, resumeThreadId } from '../contracts/resume.ts';

const sourceUrl = 'https://example.org/article?part=2';
const passage = (start: number, exact = 'saved passage'): QuoteAnchor => ({ exact, prefix: '', suffix: '', start, end: start + exact.length, kind: 'quote' });
const parked = (anchor: QuoteAnchor = passage(6)) => ({ id: 'thread-1', state: 'parked' as const, deletedAt: null, sourceUrl, anchor });

test('resume marker round-trips a bounded thread identity and clears without changing the source identity', () => {
  const marked = resumePageUrl(sourceUrl, 'thread-1');
  assert.equal(marked, `${sourceUrl}#marginalia-resume=thread-1`);
  assert.equal(resumeThreadId(marked), 'thread-1');
  assert.equal(clearResumeMarker(marked), sourceUrl);
});

test('resume marker rejects credentials, invalid identities, malformed encodings and extra fragment fields', () => {
  assert.throws(() => resumePageUrl('https://user:pass@example.org/article', 'thread-1'), /cannot be opened/);
  assert.throws(() => resumePageUrl('file:///tmp/article', 'thread-1'), /cannot be opened/);
  assert.throws(() => resumePageUrl(sourceUrl, ''), /identity/);
  assert.throws(() => resumePageUrl(sourceUrl, 'x'.repeat(201)), /identity/);
  assert.equal(resumeThreadId(`${sourceUrl}#marginalia-resume=thread-1&extra=1`), undefined);
  assert.equal(resumeThreadId(`${sourceUrl}#marginalia-resume=%`), undefined);
  assert.equal(resumeThreadId(`${sourceUrl}#marginalia-resume=thread%2d1`), undefined);
});

test('resume anchor requires a live parked non-deleted thread bound to the current source', () => {
  const thread = parked();
  assert.deepEqual(resumeAnchor(thread, sourceUrl, 'prefix saved passage suffix'), thread.anchor);
  assert.equal(resumeAnchor({ ...thread, state: 'open' }, sourceUrl, 'prefix saved passage suffix'), undefined);
  assert.equal(resumeAnchor({ ...thread, deletedAt: '2026-09-18T00:00:00Z' }, sourceUrl, 'prefix saved passage suffix'), undefined);
  assert.equal(resumeAnchor(thread, 'https://example.org/other', 'prefix saved passage suffix'), undefined);
});

test('resume anchor accepts one moved literal passage but rejects lost or ambiguous passages', () => {
  const thread = parked(passage(0, 'saved'));
  assert.deepEqual(resumeAnchor(thread, sourceUrl, 'prefix saved suffix'), thread.anchor);
  assert.equal(resumeAnchor(thread, sourceUrl, 'saved and saved'), undefined);
  assert.equal(resumeAnchor(thread, sourceUrl, 'the passage is gone'), undefined);
});

test('whole-page resume requires the matching local checkpoint and its current attachment', () => {
  const thread = parked(wholePageAnchor());
  const checkpoint = { threadId: thread.id, anchor: passage(7, 'reading position') };
  assert.deepEqual(resumeAnchor(thread, sourceUrl, 'prefix reading position suffix', checkpoint), checkpoint.anchor);
  assert.equal(resumeAnchor(thread, sourceUrl, 'prefix reading position suffix'), undefined);
  assert.equal(resumeAnchor(thread, sourceUrl, 'prefix reading position suffix', { ...checkpoint, threadId: 'other' }), undefined);
  assert.equal(resumeAnchor(thread, sourceUrl, 'reading position and reading position', checkpoint), undefined);
});
