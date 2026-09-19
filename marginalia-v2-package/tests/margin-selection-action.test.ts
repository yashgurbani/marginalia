import test from 'node:test';
import assert from 'node:assert/strict';
import { storage, asHost } from './t05-harness.ts';
import { dom, button, replaceGlobals } from './t05-dom.ts';
import type { JournalState } from '../ui/journal.ts';
import type { QuoteAnchor, SourceCapture } from '../contracts/reader.ts';
import type { AskingSelection } from '../ui/asking-host.ts';
const { mountMargin } = await import('../ui/margin.ts');
const { documentJournal, localPersistence } = await import('../ui/persistence.ts');

const capture: SourceCapture = { url: 'https://example.org/selection-action', title: 'A page with two passages', pageType: 'article', text: 'First passage. Second passage. Third passage.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'test' };
function env(t: import('node:test').TestContext) { return { ...dom(t), ...storage(t), namespace: crypto.randomUUID() }; }
const anchor = (start = 0, end = 14): QuoteAnchor => ({ kind: 'quote', start, end, exact: capture.text.slice(start, end), prefix: capture.text.slice(Math.max(0, start - 40), start), suffix: capture.text.slice(end, end + 40) });
const mount = (root: ReturnType<typeof dom>['root'], namespace: string) =>
  mountMargin(asHost(root), { capture, storageName: namespace, allowHelper: false, readPosition: async () => undefined });
const drafts = (e: ReturnType<typeof env>, prefix: string) => [...e.data(e.namespace)].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value as any);

test('the selection card rests on four controls and keeps Read later in the footer', async t => {
  const e = env(t);
  const api = await mount(e.root, e.namespace); await api.drain();
  api.select(anchor()); await api.drain();
  const card = e.root.querySelector('.m-selection')!;
  assert.deepEqual(card.querySelector('.m-selection-actions')!.children.map(node => node.textContent), ['Keep', 'Note', 'Ask', 'Simulate it']);
  assert.equal(card.querySelector('.m-selection-more'), null, 'the More disclosure is gone');
  assert.equal(card.querySelectorAll('button').some(node => node.textContent === 'Read later'), false, 'Read later is a page action');
  assert.equal(e.root.querySelector('.m-footer-row')!.children[0].textContent, 'Read later');
  api.destroy(); await api.drain();
});

test('each selection action lands in the same state as a click on its button', async t => {
  for (const action of ['note', 'ask'] as const) {
    const e = env(t);
    const clicked = await mount(e.root, e.namespace); await clicked.drain();
    clicked.select(anchor()); await clicked.drain();
    button(e.root.querySelector('.m-selection')!, action === 'note' ? 'Note' : 'Ask').click(); await clicked.drain();
    const byClick = { compose: !e.root.querySelector('.m-compose')!.hidden, question: !e.root.querySelector('.m-question')!.hidden, drafts: drafts(e, action === 'note' ? 'draft' : 'question:draft:').length };
    clicked.destroy(); await clicked.drain();

    const other = env(t);
    const called = await mount(other.root, other.namespace); await called.drain();
    // Asking is blocked without pairing, so ask resolves false while still
    // running the same handler and leaving the same local draft behind.
    assert.equal(await called.selectionAction(action, anchor()), action === 'note');
    await called.drain();
    assert.deepEqual({ compose: !other.root.querySelector('.m-compose')!.hidden, question: !other.root.querySelector('.m-question')!.hidden, drafts: drafts(other, action === 'note' ? 'draft' : 'question:draft:').length }, byClick);
    called.destroy(); await called.drain();
  }
});

test('a simulate action saves the same simulate draft a click saves, and an unplaceable passage resolves false', async t => {
  const e = env(t);
  const api = await mount(e.root, e.namespace); await api.drain();
  assert.equal(await api.selectionAction('simulate', { ...anchor(), exact: 'A passage this page never held', start: 400, end: 430 }), false);
  assert.equal(drafts(e, 'question:draft:').length, 0);

  assert.equal(await api.selectionAction('simulate', anchor()), false, 'asking is blocked without pairing');
  await api.drain();
  assert.equal(e.root.querySelector('.m-selection')!.textContent.includes('Pair this browser in Settings to ask'), true);
  api.destroy(); await api.drain();
});

test('a blocked simulate keeps the simulation in the retained draft and sends nothing', async t => {
  const e = env(t); const requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected outbound request'); } });
  const api = await mount(e.root, e.namespace); await api.drain();

  api.select(anchor()); await api.drain();
  button(e.root.querySelector('.m-selection')!, 'Simulate it').click(); await api.drain();
  const [saved] = drafts(e, 'question:draft:');
  assert.equal(saved.intent, 'simulate', 'the blocked start still records what was asked for');
  assert.notEqual(saved.question, '');
  assert.deepEqual(saved.anchor, anchor());
  assert.equal(e.root.textContent.includes('Pair this browser in Settings to ask'), true);
  assert.deepEqual(requests, []);
  const state = e.data(e.namespace).get('journal') as JournalState | undefined;
  assert.equal(state?.threads.length ?? 0, 0, 'no passage is saved and no request is prepared');
  api.destroy(); await api.drain();
});

test('a blocked simulate through the API records the same simulation and resolves false', async t => {
  const e = env(t); const requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected outbound request'); } });
  const api = await mount(e.root, e.namespace); await api.drain();

  assert.equal(await api.selectionAction('simulate', anchor()), false);
  await api.drain();
  const [saved] = drafts(e, 'question:draft:');
  assert.equal(saved.intent, 'simulate');
  assert.notEqual(saved.question, '');
  assert.deepEqual(requests, []);
  api.destroy(); await api.drain();
});

test('a retained question blocks a later simulate, which resolves false and changes nothing', async t => {
  const e = env(t);
  const api = await mount(e.root, e.namespace); await api.drain();
  api.select(anchor()); await api.drain();
  button(e.root.querySelector('.m-selection')!, 'Ask').click(); await api.drain();
  const before = structuredClone(drafts(e, 'question:draft:'));
  assert.equal(before.length, 1); assert.equal(before[0].intent, undefined);

  assert.equal(await api.selectionAction('simulate', anchor()), false);
  await api.drain();
  assert.deepEqual(drafts(e, 'question:draft:'), before, 'the retained question is left exactly as it was');
  assert.equal(e.root.textContent.includes('A question is already retained on this page.'), true, 'one plain sentence says why nothing changed');
  api.destroy(); await api.drain();
});

/** A reader who pairs later comes back to a retained request. These mount that second
 * visit with a review boundary of our own, so the action carried into review is visible
 * without anything being sent. */
const pair = (e: ReturnType<typeof env>) => e.data(e.namespace).set('pairing', { origin: 'http://localhost:43120', token: 'x'.repeat(43) });
async function remountPaired(t: import('node:test').TestContext, e: ReturnType<typeof env>, opened: AskingSelection[], requests: string[]) {
  const journal = documentJournal(e.namespace, localPersistence(e.namespace).journal);
  replaceGlobals(t, { fetch: async (url: string) => {
    const path = new URL(url).pathname; requests.push(path);
    if (path === '/api/change') return Response.json({});
    if (path === '/api/read/threads') return Response.json({ threads: journal.state.threads.map(thread => ({ ...thread, sourceVersionId: 'verified-source' })) });
    throw new Error('Unexpected request ' + path);
  } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: true, readPosition: async () => undefined,
    asking: () => ({ async open(selection) { opened.push(structuredClone(selection)); }, setVisible() {}, destroy() {} }) });
  await api.drain();
  return api;
}
/** Leave a blocked simulation behind, pair, and reopen it. */
async function resumeRetainedSimulation(t: import('node:test').TestContext) {
  const e = env(t), opened: AskingSelection[] = [], requests: string[] = [];
  const first = await mount(e.root, e.namespace); await first.drain();
  assert.equal(await first.selectionAction('simulate', anchor()), false);
  assert.equal(drafts(e, 'question:draft:')[0].intent, 'simulate');
  first.destroy(); await first.drain();
  pair(e);
  const api = await remountPaired(t, e, opened, requests);
  button(e.root, 'Return to retained question').click(); await api.drain();
  assert.equal(opened.length, 0, 'reopening a retained request sends nothing and opens no review');
  const form = e.root.querySelector('.m-asking-draft')!;
  return { e, api, opened, requests, form, input: form.querySelector('input')! };
}

test('a restored simulation submitted unchanged reaches review as a simulation', async t => {
  const { api, opened, requests, form } = await resumeRetainedSimulation(t);
  form.fire('submit'); await api.drain();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].intent, 'simulate', 'the action the request was saved with survives the pause');
  assert.equal(requests.some(path => path.includes('/jobs')), false, 'review is reached, nothing is sent');
  api.destroy(); await api.drain();
});

test('a deliberate action chosen after a restore carries its own intent', async t => {
  const { api, opened, requests, form } = await resumeRetainedSimulation(t);
  const offered = form.querySelectorAll('button').find(node => node.dataset.intent && node.dataset.intent !== 'simulate');
  assert.ok(offered, 'the restored request still offers other actions');
  const chosen = offered.dataset.intent;
  offered.click(); await api.drain();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].intent, chosen, 'choosing an action deliberately decides the action');
  assert.equal(requests.some(path => path.includes('/jobs')), false);
  api.destroy(); await api.drain();
});

test('edited words submitted plainly are a plain question again', async t => {
  const { api, opened, requests, form, input } = await resumeRetainedSimulation(t);
  input.value = 'What did the second passage change?'; input.fire('input'); await api.drain();
  form.fire('submit'); await api.drain();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].question, 'What did the second passage change?');
  assert.equal(opened[0].intent, 'unsure', 'the words are no longer the simulation that was saved');
  assert.equal(requests.some(path => path.includes('/jobs')), false);
  api.destroy(); await api.drain();
});

test('read later saves the page once however many times it runs', async t => {
  const e = env(t);
  const api = await mount(e.root, e.namespace); await api.drain();
  assert.equal(await api.readLater(), true);
  assert.equal(await api.readLater(), true);
  await api.drain();
  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.length, 1);
  assert.equal(state.threads[0].anchor.kind, 'whole-page');
  assert.equal(state.threads[0].state, 'parked');
  api.destroy(); await api.drain();
});
