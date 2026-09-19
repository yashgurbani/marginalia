import test from 'node:test';
import assert from 'node:assert/strict';
import { storage, asHost } from './t05-harness.ts';
import { dom } from './t05-dom.ts';
import type { JournalState } from '../ui/journal.ts';
import type { QuoteAnchor, SourceCapture } from '../contracts/reader.ts';
const { mountMargin } = await import('../ui/margin.ts');
const { localPersistence, documentJournal } = await import('../ui/persistence.ts');

const capture: SourceCapture = { url: 'https://example.org/grouping', title: 'Repeated passage source', pageType: 'article', text: 'First passage. Second passage. Third passage.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'test' };
function env(t: import('node:test').TestContext) { return { ...dom(t), ...storage(t), namespace: crypto.randomUUID() }; }
const anchor = (start: number, end: number): QuoteAnchor => ({ kind: 'quote', start, end, exact: capture.text.slice(start, end), prefix: capture.text.slice(Math.max(0, start - 40), start), suffix: capture.text.slice(end, end + 40) });

/** Two saved threads on one page, then a chosen source version per thread. */
async function seed(namespace: string, entries: { threadId: string; anchor: QuoteAnchor; note: string; sourceVersionId: string }[]) {
  const persistence = localPersistence(namespace), journal = documentJournal(namespace, persistence.journal);
  for (const entry of entries) await journal.change({ id: 'keep-' + entry.threadId, kind: 'keep', threadId: entry.threadId, capture, anchor: entry.anchor, note: entry.note });
  const state = structuredClone(journal.state) as JournalState;
  // Creation times are pinned in seed order, so the lead never depends on the clock or on ID order.
  entries.forEach((entry, index) => Object.assign(state.threads.find(thread => thread.id === entry.threadId)!, { sourceVersionId: entry.sourceVersionId, createdAt: `2026-09-17T00:00:0${index}Z` }));
  await persistence.write('journal', state);
  return state;
}
const mount = (root: ReturnType<typeof dom>['root'], namespace: string) =>
  mountMargin(asHost(root), { capture, storageName: namespace, allowHelper: false, readPosition: async () => undefined });
const threadNode = (root: ReturnType<typeof dom>['root'], id: string) =>
  root.querySelectorAll('[data-thread]').find(node => node.dataset.thread === id);

test('a repeated passage folds later threads into the lead card without losing either thread', async t => {
  const e = env(t);
  await seed(e.namespace, [
    { threadId: 'lead', anchor: anchor(0, 14), note: 'The first reading', sourceVersionId: 'version-one' },
    { threadId: 'follower', anchor: anchor(0, 14), note: 'The second reading', sourceVersionId: 'version-one' },
  ]);
  const api = await mount(e.root, e.namespace); await api.drain();

  const lead = threadNode(e.root, 'lead')!, follower = threadNode(e.root, 'follower')!;
  const repeats = lead.querySelector('.m-thread-repeats')!;
  assert.equal(follower.parentElement, repeats, 'the later thread sits inside the lead expander');
  assert.equal(repeats.hidden, false);
  assert.equal(repeats.querySelector('summary')!.textContent, '1 more note');
  assert.equal(e.root.querySelectorAll('[data-thread]').length, 2);
  assert.deepEqual(e.root.querySelectorAll('[data-thread]').map(node => node.dataset.thread).sort(), ['follower', 'lead']);
  assert.match(lead.textContent, /The first reading/);
  assert.match(follower.textContent, /The second reading/);
  api.destroy(); await api.drain();
});

test('identical anchors on different source versions stay separate cards', async t => {
  const e = env(t);
  await seed(e.namespace, [
    { threadId: 'older', anchor: anchor(0, 14), note: 'Read on the older capture', sourceVersionId: 'version-one' },
    { threadId: 'newer', anchor: anchor(0, 14), note: 'Read on the newer capture', sourceVersionId: 'version-two' },
  ]);
  const api = await mount(e.root, e.namespace); await api.drain();

  const older = threadNode(e.root, 'older')!, newer = threadNode(e.root, 'newer')!;
  assert.equal(older.contains(newer), false, 'a different source version is never folded away');
  assert.equal(newer.contains(older), false);
  assert.equal(older.parentElement, newer.parentElement, 'both remain top-level cards in the same list');
  for (const repeats of e.root.querySelectorAll('.m-thread-repeats')) assert.equal(repeats.hidden, true);
  api.destroy(); await api.drain();
});

test('the same quoted words at different offsets stay separate cards', async t => {
  const e = env(t);
  const first = anchor(6, 13), second = anchor(22, 29);
  assert.equal(first.exact, second.exact); assert.notEqual(first.start, second.start);
  await seed(e.namespace, [
    { threadId: 'early', anchor: first, note: 'Note on the first sentence', sourceVersionId: 'version-one' },
    { threadId: 'late', anchor: second, note: 'Note on the second sentence', sourceVersionId: 'version-one' },
  ]);
  const api = await mount(e.root, e.namespace); await api.drain();

  const early = threadNode(e.root, 'early')!, late = threadNode(e.root, 'late')!;
  assert.equal(early.contains(late), false, 'a different position is a different passage');
  assert.equal(early.parentElement, late.parentElement);
  for (const repeats of e.root.querySelectorAll('.m-thread-repeats')) assert.equal(repeats.hidden, true);
  api.destroy(); await api.drain();
});

test('opening a folded thread opens its expander and focuses its source passage', async t => {
  const e = env(t);
  await seed(e.namespace, [
    { threadId: 'lead', anchor: anchor(0, 14), note: 'The first reading', sourceVersionId: 'version-one' },
    { threadId: 'follower', anchor: anchor(0, 14), note: 'The second reading', sourceVersionId: 'version-one' },
  ]);
  const api = await mount(e.root, e.namespace); await api.drain();

  await api.openThread('follower'); await api.drain();
  const follower = threadNode(e.root, 'follower')!;
  const enclosing = follower.parentElement!.closest('.m-thread-repeats')!;
  assert.equal(enclosing.open, true);
  assert.equal(e.document.activeElement, follower.querySelector('.m-source-action'));
  api.destroy(); await api.drain();
});

test('a record with no source version never groups, and never takes a follower', async t => {
  const e = env(t);
  await seed(e.namespace, [
    { threadId: 'unsynced', anchor: anchor(0, 14), note: 'Saved before any source version', sourceVersionId: '' },
    { threadId: 'second-unsynced', anchor: anchor(0, 14), note: 'Also saved before any source version', sourceVersionId: '' },
    { threadId: 'versioned', anchor: anchor(0, 14), note: 'Saved on a recorded capture', sourceVersionId: 'version-one' },
  ]);
  const api = await mount(e.root, e.namespace); await api.drain();

  const unsynced = threadNode(e.root, 'unsynced')!, second = threadNode(e.root, 'second-unsynced')!, versioned = threadNode(e.root, 'versioned')!;
  assert.equal(unsynced.contains(second), false, 'an absent source version is not proof of sameness');
  assert.equal(unsynced.contains(versioned), false);
  assert.equal(versioned.contains(unsynced), false);
  assert.equal(unsynced.parentElement, second.parentElement, 'all three remain top-level cards');
  assert.equal(unsynced.parentElement, versioned.parentElement);
  for (const repeats of e.root.querySelectorAll('.m-thread-repeats')) assert.equal(repeats.hidden, true);
  assert.equal(e.root.querySelectorAll('[data-thread]').length, 3);
  api.destroy(); await api.drain();
});

test('focusing a folded thread reveals it, and a re-render keeps its expander open', async t => {
  const e = env(t);
  await seed(e.namespace, [
    { threadId: 'lead', anchor: anchor(0, 14), note: 'The first reading', sourceVersionId: 'version-one' },
    { threadId: 'follower', anchor: anchor(0, 14), note: 'The second reading', sourceVersionId: 'version-one' },
  ]);
  const api = await mount(e.root, e.namespace); await api.drain();
  const enclosing = threadNode(e.root, 'lead')!.querySelector('.m-thread-repeats')!;
  assert.equal(enclosing.open, false);

  api.focusThread('follower'); await api.drain();
  const follower = threadNode(e.root, 'follower')!;
  assert.equal(follower.parentElement!.closest('.m-thread-repeats'), enclosing);
  assert.equal(enclosing.open, true, 'focusing a follower opens its group ancestor');

  // A later explicit focus re-renders and regroups both cards; the open expander stays open.
  api.focusThread('lead'); await api.drain();
  assert.equal(threadNode(e.root, 'follower')!.parentElement!.closest('.m-thread-repeats')!.open, true);
  api.destroy(); await api.drain();
});

test('display grouping leaves the stored journal untouched', async t => {
  const e = env(t);
  await seed(e.namespace, [
    { threadId: 'lead', anchor: anchor(0, 14), note: 'The first reading', sourceVersionId: 'version-one' },
    { threadId: 'follower', anchor: anchor(0, 14), note: 'The second reading', sourceVersionId: 'version-one' },
  ]);
  const api = await mount(e.root, e.namespace); await api.drain();
  await api.openThread('follower'); await api.drain();

  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.deepEqual(state.threads.map(thread => thread.id), ['lead', 'follower']);
  assert.deepEqual(state.threads.map(thread => thread.notes.filter(note => !note.deletedAt).map(note => note.text)), [['The first reading'], ['The second reading']]);
  assert.equal(state.threads.every(thread => thread.deletedAt === null), true);
  api.destroy(); await api.drain();
});
