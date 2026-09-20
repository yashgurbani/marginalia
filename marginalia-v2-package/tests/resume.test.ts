import assert from 'node:assert/strict';
import test from 'node:test';
import { wholePageAnchor, type QuoteAnchor } from '../contracts/reader.ts';
import { clearResumeMarker, readResumeMarker, resumeAnchor, resumeCleanupUrl, resumePageUrl, resumeThreadId, MAX_RESUME_MARKER_LENGTH, MAX_RESUME_URL_LENGTH } from '../contracts/resume.ts';

const sourceUrl = 'https://example.org/article?part=2';
const passage = (start: number, exact = 'saved passage'): QuoteAnchor => ({ exact, prefix: '', suffix: '', start, end: start + exact.length, kind: 'quote' });
const parked = (anchor: QuoteAnchor = passage(6)) => ({ id: 'thread-1', state: 'parked' as const, deletedAt: null, sourceUrl, anchor });

test('resume marker round-trips a bounded thread identity and clears without changing the source identity', () => {
  const marked = resumePageUrl(sourceUrl, 'thread-1');
  assert.equal(marked, `${sourceUrl}#marginalia-resume=v2:thread-1:`);
  assert.equal(resumeThreadId(marked), 'thread-1');
  assert.equal(clearResumeMarker(marked), sourceUrl);
});

test('v2 restores the complete original hash, including routers and marker-looking fragments', () => {
  for (const hash of ['', '#', '#section', '#part%20two%2fthree', '#/chapter/2?mode=read:wide', '#marginalia-resume=old', '#marginalia-resume=v2:old:%23router']) {
    const original = new URL(sourceUrl + hash);
    const marked = resumePageUrl(original.href, 'thread: /é');
    assert.equal(resumeThreadId(marked), 'thread: /é');
    assert.equal(new URL(clearResumeMarker(marked)).hash, original.hash);
    assert.equal(clearResumeMarker(marked), sourceUrl + original.hash);
  }
});

test('legacy canonical markers remain consumable without inventing their original fragment', () => {
  for (const id of ['old', 'v2:old', 'thread /é']) {
    const marked = `${sourceUrl}#marginalia-resume=${encodeURIComponent(id)}`;
    assert.equal(resumeThreadId(marked), id);
    assert.equal(clearResumeMarker(marked), sourceUrl);
  }
});

for (const originalHash of ['#/chapter/one\ntwo', '#part two', '#\u0000', '#café', '#part\rtwo', '#part\ttwo']) {
  test('v2 rejects an original hash that URL parsing would change: ' + JSON.stringify(originalHash), () => {
    const marked = `${sourceUrl}#marginalia-resume=v2:thread:${encodeURIComponent(originalHash)}`;
    assert.equal(readResumeMarker(marked), undefined);
    assert.equal(resumeThreadId(marked), undefined);
    assert.equal(clearResumeMarker(marked), marked);
    assert.equal(resumeCleanupUrl(marked, marked), undefined);
  });
}

test('source binding is canonical fragmentless HTTP(S) identity without credentials', () => {
  const marked = resumePageUrl(sourceUrl + '#original', 'thread');
  assert.equal(readResumeMarker(marked, 'https://EXAMPLE.org:443/article?part=2#other')?.sourceUrl, sourceUrl);
  for (const other of ['http://example.org/article?part=2', 'https://example.org/article?part=3', 'https://example.org/other?part=2', 'https://other.example/article?part=2', 'https://user@example.org/article?part=2', 'file:///article']) {
    assert.equal(resumeThreadId(marked, other), undefined);
    assert.equal(clearResumeMarker(marked, other), marked);
    assert.equal(resumeCleanupUrl(marked, marked, other), undefined);
  }
  for (const invalid of ['https://user:pass@example.org/article', 'file:///article', 'javascript:void(0)', 'not a URL']) {
    assert.equal(resumeThreadId(invalid + '#marginalia-resume=thread'), undefined);
    assert.throws(() => resumePageUrl(invalid, 'thread'));
  }
});

test('cleanup requires the same marker URL and valid source after an asynchronous response', () => {
  const marked = resumePageUrl(sourceUrl + '#/router', 'thread');
  assert.equal(resumeCleanupUrl(marked, marked, sourceUrl), sourceUrl + '#/router');
  for (const current of [sourceUrl, sourceUrl + '#new', marked.replace('part=2', 'part=3'), resumePageUrl(sourceUrl + '#different', 'thread'), resumePageUrl(sourceUrl + '#/router', 'other'), 'invalid']) {
    assert.equal(resumeCleanupUrl(current, marked, sourceUrl), undefined);
  }
  const malformed = sourceUrl + '#marginalia-resume=v2:thread:%';
  assert.equal(resumeCleanupUrl(malformed, malformed), undefined);
});

test('marker and public URL bounds include canonical expansion and accept their exact boundary', () => {
  const overhead = 'marginalia-resume=v2:t:%23'.length;
  const hash = '#' + 'x'.repeat(MAX_RESUME_MARKER_LENGTH - overhead);
  const marked = resumePageUrl(sourceUrl + hash, 't');
  assert.equal(new URL(marked).hash.length - 1, MAX_RESUME_MARKER_LENGTH);
  assert.equal(clearResumeMarker(marked), sourceUrl + hash);
  assert.throws(() => resumePageUrl(sourceUrl + hash + 'x', 't'), /too long/);
  assert.equal(resumeThreadId(marked + 'x'), undefined);
  assert.equal(resumeThreadId(resumePageUrl(sourceUrl, 't'.repeat(200))), 't'.repeat(200));
  const suffix = '#marginalia-resume=v2:t:';
  const longSource = 'https://example.org/' + 'x'.repeat(MAX_RESUME_URL_LENGTH - 'https://example.org/'.length - suffix.length);
  assert.equal(resumePageUrl(longSource, 't').length, MAX_RESUME_URL_LENGTH);
  assert.throws(() => resumePageUrl(longSource + 'x', 't'), /too long/);
  assert.equal(resumeThreadId(resumePageUrl(longSource, 't') + 'x'), undefined);
});

test('v2 rejects malformed, noncanonical, extra and over-limit fields', () => {
  for (const payload of ['v2::', 'v2:thread', 'v2:thread::', 'v2:thread:%', 'v2:thread:%23%ZZ', 'v2:thread:%23part%2ftwo', 'v2:thread:section', 'v2:thread:%23', 'v2:thread:%0A', 'v2:thread%2d1:', 'v3:thread:', `v2:${'x'.repeat(201)}:`, `v2:thread:%23${'x'.repeat(4096)}`]) {
    const marked = `${sourceUrl}#marginalia-resume=${payload}`;
    assert.equal(resumeThreadId(marked), undefined, payload.slice(0, 80));
    assert.equal(clearResumeMarker(marked), marked);
  }
  assert.throws(() => resumePageUrl(sourceUrl, '\ud800'), /identity/);
  assert.throws(() => resumePageUrl(sourceUrl + '#' + 'x'.repeat(4096), 'thread'), /too long/);
  assert.throws(() => resumePageUrl('https://example.org/' + 'x'.repeat(8192), 'thread'), /cannot be opened/);
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
