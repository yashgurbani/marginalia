import test from 'node:test';
import assert from 'node:assert/strict';
import type { SourceCapture, Thread } from '../contracts/reader.ts';
import { FakeForgetTransport } from '../ui/forget/transport.ts';
import { FakeRelatedTransport } from '../ui/related/transport.ts';
import { asHost, storage } from './t05-harness.ts';
import { button, deferred, dom, settle, until } from './t05-dom.ts';

const { mountMargin } = await import('../ui/margin.ts');

const capture: SourceCapture = {
  url: 'https://example.org/wire-two', title: 'Wire two source', pageType: 'article',
  text: 'Vorticity is stretched by the flow.', capturedAt: '2026-09-18T10:00:00.000Z',
  extractionVersion: 'wire-two-v1', sections: [{ title: 'Page', start: 0, end: 35 }],
};
const anchor = { kind: 'quote' as const, exact: capture.text, prefix: '', suffix: '', start: 0, end: capture.text.length };

test('a selection mounts quiet related library results below its actions', async t => {
  const d = dom(t), related = new FakeRelatedTransport(); storage(t);
  related.response = { results: [{
    kind: 'note', threadId: 'thread-related', anchorId: 'anchor-related', sourceVersionId: 'source-related',
    sourceTitle: 'Fluid mechanics notes', sourceUrl: 'https://example.org/fluid', anchor,
    sourceExcerpt: 'A source passage about vortex stretching.',
    note: { id: 'note-related', revision: 1, excerpt: 'My note about vortex stretching.' },
    matchedTerms: ['vorticity'], score: .75, reason: 'Shared terms.',
  }] };
  const api = await mountMargin(asHost(d.root), { capture, storageName: crypto.randomUUID(), allowHelper: false, related });
  api.select(anchor);
  await until(() => d.root.textContent.includes('Related in your library'));
  const card = d.root.querySelector('.m-selection')!, actions = card.querySelector('.m-selection-actions')!, slot = card.querySelector('.m-related-slot')!, shown = slot.querySelector('.m-related')!;
  assert.ok(card.children.indexOf(slot) > card.children.indexOf(actions));
  assert.equal(shown.querySelector('a')?.getAttribute('href'), '#thread=thread-related');
  assert.doesNotMatch(shown.textContent, /0\.75/);
  assert.deepEqual(related.requests, [{ passage: anchor, limit: 3 }]);
  api.destroy(); await api.drain();
});

test('an open saved thread mounts related library results below its reply area', async t => {
  const d = dom(t), related = new FakeRelatedTransport(); storage(t);
  const thread: Thread = {
    id: 'thread-open', anchorId: 'anchor-open', state: 'open', revision: 0,
    createdAt: '2026-09-18T10:00:00.000Z', updatedAt: '2026-09-18T10:00:00.000Z', deletedAt: null,
    sourceVersionId: 'source-open', sourceUrl: capture.url, sourceTitle: capture.title, anchor,
    notes: [], highlighted: false,
  };
  related.response = { results: [{
    kind: 'thread', threadId: 'thread-other', anchorId: 'anchor-other', sourceVersionId: 'source-other',
    sourceTitle: 'Saved fluid mechanics', sourceUrl: 'https://example.org/fluid', anchor,
    sourceExcerpt: 'A related saved passage.', note: null, matchedTerms: ['flow'], score: .4, reason: 'Shared terms.',
  }] };
  const api = await mountMargin(asHost(d.root), { capture, savedThread: thread, storageName: crypto.randomUUID(), allowHelper: false, related });
  await until(() => !!d.root.querySelector('.m-thread'));
  api.focusThread(thread.id);
  await until(() => !!d.root.querySelector('.m-thread .m-related'));
  const replyArea = d.root.querySelector('.m-thread .m-saved-replies')!, shown = replyArea.querySelector('.m-related')!;
  assert.ok(replyArea.contains(shown));
  assert.equal(shown.querySelector('a')?.getAttribute('href'), '#thread=thread-other');
  assert.deepEqual(related.requests, [{ passage: anchor, threadId: thread.id, sourceVersionId: thread.sourceVersionId, limit: 3 }]);
  api.destroy(); await api.drain();
});

test('forget this page is mounted in Settings and uses the prepared opaque pageId', async t => {
  const d = dom(t), forget = new FakeForgetTransport(); storage(t);
  forget.result = { forgotten: true, alreadyForgotten: false, providerHistory: 'retained' };
  let reads = 0;
  const api = await mountMargin(asHost(d.root), { capture, storageName: crypto.randomUUID(), allowHelper: false,
    forget: { transport: forget, getPageId: async () => { reads++; return 'prepared-page-id'; } } });
  await until(() => !!d.root.querySelector('.m-settings .m-forget'));
  assert.equal(d.root.querySelector('.m-scroll .m-forget'), null);
  button(d.root, 'Settings').click();
  button(d.root, 'Forget this page').click();
  assert.deepEqual(forget.forgotten, []);
  button(d.root, 'Forget this page').click();
  await until(() => forget.forgotten.length === 1);
  assert.equal(reads, 1);
  assert.deepEqual(forget.forgotten, ['prepared-page-id']);
  assert.match(d.root.querySelector('.m-forget')!.textContent, /provider history was retained/);
  api.destroy(); await api.drain();
});

test('question work announces preparation before slow ranking and saving', async t => {
  const d = dom(t), e = storage(t), ranking = deferred<void>(), saving = deferred<void>();
  let holdRanking = true, holdSaving = false;
  e.onRead(async key => { if (holdRanking && key.startsWith('suggestion-exposure:')) await ranking.promise; });
  e.onWrite(async key => { if (holdSaving && key.startsWith('question:')) await saving.promise; });
  const api = await mountMargin(asHost(d.root), { capture, storageName: crypto.randomUUID(), allowHelper: false,
    asking: () => ({ open() {}, setVisible() {}, destroy() {} }) });
  api.select(anchor); button(d.root, 'Ask').click();
  await until(() => d.root.querySelector('.m-question .m-meta')?.textContent === 'Preparing ideas.');
  holdRanking = false; ranking.resolve(); await api.drain();
  holdSaving = true; button(d.root, 'Define it here').click(); await settle();
  assert.equal(d.root.querySelector('.m-asking-draft .m-meta')?.textContent, 'Preparing request.');
  holdSaving = false; saving.resolve(); await api.drain();
  api.destroy(); await api.drain();
});

test('closing a question while its choice save is pending does not open stale review', async t => {
  const d = dom(t), e = storage(t), save = deferred<void>();
  let hold = false, opens = 0;
  e.onWrite(async key => { if (hold && key.startsWith('question:')) await save.promise; });
  const api = await mountMargin(asHost(d.root), { capture, storageName: crypto.randomUUID(), allowHelper: false,
    asking: () => ({ open() { opens++; }, setVisible() {}, destroy() {} }) });
  api.select(anchor); button(d.root, 'Ask').click(); await api.drain();
  hold = true; button(d.root, 'Define it here').click();
  d.root.querySelector('.m-question .m-asking-draft')!.fire('keydown', { key: 'Escape' });
  hold = false; save.resolve(); await api.drain();
  assert.equal(opens, 0); assert.equal(d.root.querySelector('.m-question')!.hidden, true);
  api.destroy(); await api.drain();
});

test('closing during a delayed question attachment switch does not reopen the draft', async t => {
  const d = dom(t), e = storage(t), save = deferred<void>();
  let hold = false;
  e.onWrite(async key => { if (hold && key.startsWith('question:')) await save.promise; });
  const replacement = { ...anchor, exact: 'Vorticity', end: 'Vorticity'.length, suffix: capture.text.slice('Vorticity'.length) };
  const api = await mountMargin(asHost(d.root), { capture, storageName: crypto.randomUUID(), allowHelper: false });
  api.select(anchor); button(d.root, 'Ask').click(); await api.drain();
  hold = true; api.select(replacement); button(d.root.querySelector('.m-selection')!, 'Switch').click();
  d.root.querySelector('.m-question .m-asking-draft')!.fire('keydown', { key: 'Escape' });
  hold = false; save.resolve(); await api.drain();
  assert.equal(d.root.querySelector('.m-question')!.hidden, true);
  assert.equal(d.root.querySelector('[aria-label="Your question"]'), null);
  api.destroy(); await api.drain();
});
