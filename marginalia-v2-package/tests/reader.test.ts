import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachQuote, wholePageAnchor } from '../contracts/reader.ts';

test('whole-page intent contains no fabricated quote or text range', () => {
  const anchor = wholePageAnchor();
  assert.deepEqual(anchor, { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 });
  assert.deepEqual(attachQuote(anchor, 'Entirely replaced page'), { state: 'exact', candidates: [] });
  assert.deepEqual(attachQuote({ ...anchor, kind: 'quote' }, 'text'), { state: 'lost', candidates: [] });
});

test('repeated quotes use complete context, never nearest original position', () => {
  const anchor = { exact: 'same', prefix: 'before ', suffix: ' after', start: 7, end: 11 };
  assert.deepEqual(attachQuote(anchor, 'same. before same after'), { state: 'moved', candidates: [{ start: 13, end: 17 }] });
  assert.equal(attachQuote({ ...anchor, prefix: '', suffix: '' }, 'before same after same').state, 'unsure');
  assert.equal(attachQuote(anchor, 'before same after before same after').state, 'unsure');
  assert.equal(attachQuote(anchor, 'before some after').state, 'lost');
  const many = attachQuote({ ...anchor, exact: 'a', prefix: '', suffix: '' }, 'a'.repeat(1000));
  assert.equal(many.state, 'unsure');
  assert.equal(many.candidates.length, 100);
});

test('T07 F7 shared validation enforces source, section, anchor, identity and mutation bounds', async () => {
  const { validateReaderMutation: validate, InvalidReaderMutationError } = await import('../contracts/reader.ts');
  const valid = {
    id: 'keep', threadId: 'thread', kind: 'keep' as const,
    capture: { url: 'https://example.org/', title: 'Title', pageType: 'article', text: 'Some text', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'v1' },
    anchor: { exact: 'Some', prefix: '', suffix: ' text', start: 0, end: 4 }, note: '',
  };
  const invalid: unknown[] = [
    { ...valid, id: 'x'.repeat(101) }, { ...valid, threadId: 'bad/id' },
    ...[
      { url: 'not a URL' }, { url: 'https://user:password@example.org/' }, { url: 'file:///private' }, { url: 'https://example.org/' + 'x'.repeat(8000) },
      { title: 'x'.repeat(1001) }, { pageType: 'x'.repeat(101) }, { text: 'x'.repeat(1000001) },
      { capturedAt: 'not a date' }, { extractionVersion: '' }, { extractionVersion: 'x'.repeat(101) },
      { sections: Array.from({ length: 2001 }, () => ({ title: 'A', start: 0, end: 1 })) },
      ...[
        [{ title: '', start: 0, end: 1 }], [{ title: 'x'.repeat(1001), start: 0, end: 1 }],
        [{ title: 'A', start: -1, end: 1 }], [{ title: 'A', start: 0, end: 0 }],
        [{ title: 'A', start: 0.5, end: 1 }], [{ title: 'A', start: 0, end: 10 }],
        [{ title: 'A', start: 0, end: 5 }, { title: 'B', start: 4, end: 6 }],
      ].map(sections => ({ sections })),
    ].map(capture => ({ ...valid, capture: { ...valid.capture, ...capture } })),
    ...[
      { exact: 'Else' }, { prefix: 'x'.repeat(257) }, { suffix: 'x'.repeat(257) },
      { start: -1 }, { end: 10 }, { end: 3 }, { kind: 'whole-page' },
      { exact: 'x'.repeat(16001), start: 0, end: 16001 },
    ].map(anchor => ({ ...valid, anchor: { ...valid.anchor, ...anchor } })),
    { ...valid, note: 'x'.repeat(20001) },
    { id: 'edit', threadId: 'thread', kind: 'note', noteId: 'note', expectedRevision: 0, text: 'x'.repeat(20001) },
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(expectedRevision => ({ id: 'edit', threadId: 'thread', kind: 'note', noteId: 'note', text: '', expectedRevision })),
    { id: 'state', threadId: 'thread', kind: 'thread-state', expectedRevision: 1, state: 'unknown' },
    { id: 'remove', threadId: 'thread', kind: 'remove', expectedRevision: 1, removed: 'yes' },
  ];
  for (const mutation of invalid) assert.throws(() => validate(mutation), InvalidReaderMutationError);
  assert.doesNotThrow(() => validate(valid));
  assert.doesNotThrow(() => validate({ ...valid, anchor: wholePageAnchor() }));
  assert.doesNotThrow(() => validate({ ...valid, capture: { ...valid.capture, sections: [{ title: 'First', start: 0, end: 4 }, { title: 'Second', start: 5, end: 9 }] } }));
  assert.doesNotThrow(() => validate({ id: 'x'.repeat(100), threadId: 'thread', kind: 'note', noteId: 'n', text: 'x'.repeat(20000), expectedRevision: Number.MAX_SAFE_INTEGER }));
  assert.doesNotThrow(() => validate({ id: 'state', threadId: 'thread', kind: 'thread-state', expectedRevision: 0, state: 'open' }));
});
