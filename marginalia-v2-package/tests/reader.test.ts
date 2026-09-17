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
