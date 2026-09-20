import test from 'node:test';
import assert from 'node:assert/strict';
import { storage, asHost } from './t05-harness.ts';
import { dom, button, replaceGlobals } from './t05-dom.ts';
import { ReaderJournal, type JournalState } from '../ui/journal.ts';
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

for (const rejectWrites of [false, true]) test(`switching note targets preserves typing during the navigation write${rejectWrites ? ' when storage fails' : ''}`, { timeout: 8000 }, async t => {
  let cleanup = async () => {}; t.after(() => cleanup());
  const { deferred } = await import('./t05-dom.ts');
  const { unsavedDrafts } = await import('../ui/persistence.ts');
  const e = env(t), requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected request'); } });
  const journal = documentJournal(e.namespace, localPersistence(e.namespace).journal);
  await journal.load();
  await journal.change({ id: 'keep-a', kind: 'keep', threadId: 'thread-a', capture, anchor: anchor(), note: 'First note' });
  await journal.change({ id: 'keep-b', kind: 'keep', threadId: 'thread-b', capture, anchor: anchor(15, 30), note: 'Second note' });
  let api = await mount(e.root, e.namespace); await api.drain();
  cleanup = async () => { e.onWrite(async () => {}); api.destroy(); await api.drain(); };
  e.root.querySelectorAll('.m-note').find(node => node.textContent === 'First note')!.click(); await api.drain();
  const field = e.root.querySelector('[aria-label="Your note"]')!;
  field.value = 'First saved edit'; field.fire('input'); await api.drain();
  const entered = deferred<void>(), release = deferred<void>(); let once = true;
  e.onWrite(async (key) => {
    if (once && key.startsWith('draft:')) { once = false; entered.resolve(); await release.promise; }
    if (rejectWrites && (key.startsWith('draft:') || key === 'journal')) throw new Error('Navigation storage failure');
  });
  e.root.querySelectorAll('.m-note').find(node => node.textContent === 'Second note')!.click(); await entered.promise;
  assert.equal(field.readOnly, false);
  const latest = 'Latest edit during navigation\nKept exactly.';
  field.value = latest; field.fire('input'); release.resolve(); await api.drain();
  const saved = e.data(e.namespace).get('journal') as JournalState;
  const retained = drafts(e, 'draft:').find(value => value?.text === latest) ?? unsavedDrafts(e.namespace).find(value => value.draft?.text === latest)?.draft;
  assert.ok(saved.threads.some(thread => thread.notes.some(note => note.text === latest)) || retained, 'newer input must remain saved or recoverable');
  assert.equal(field.value, latest);
  assert.equal(saved.threads.find(thread => thread.id === 'thread-a')!.notes[0].text, 'First saved edit');
  if (rejectWrites) { assert.equal(retained?.threadId, 'thread-b'); assert.equal(retained?.noteId, 'keep-b-note'); }
  else assert.equal(saved.threads.find(thread => thread.id === 'thread-b')!.notes[0].text, latest);
  e.onWrite(async () => {}); api.destroy(); await api.drain();
  api = await mount(e.root, e.namespace); await api.drain();
  assert.equal(e.root.querySelector('[aria-label="Your note"]')!.value, latest);
  assert.equal(journal.state.threads.length, 2); assert.deepEqual(requests, []);
});

test('the selection card rests on four controls and keeps Read later in the footer', async t => {
  const e = env(t);
  const api = await mount(e.root, e.namespace); await api.drain();
  api.select(anchor()); await api.drain();
  const card = e.root.querySelector('.m-selection')!;
  assert.deepEqual(card.querySelector('.m-selection-actions')!.children.map(node => node.textContent), ['Keep', 'Note', 'Ask', 'Simulate it']);
  assert.equal(card.querySelector('.m-selection-more'), null, 'the More disclosure is gone');
  assert.equal(card.querySelectorAll('button').some(node => node.textContent === 'Read later'), false, 'Read later is a page action');
  assert.equal(e.root.querySelector('.m-footer-row')!.children[0].textContent, 'Connections');
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
  assert.equal(e.root.querySelector('.m-selection')!.textContent.includes('Open the browser margin to continue this request'), true);
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
  assert.equal(e.root.textContent.includes('Open the browser margin to continue this request'), true);
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
    if (path === '/api/read/jobs') return Response.json({ configured: true, available: true, unverified: [], disclosureVersion: null });
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
  return { e, api, opened, requests, form, input: form.querySelector('textarea')! };
}

test('a restored simulation submitted unchanged reaches review as a simulation', async t => {
  const { api, opened, requests, form } = await resumeRetainedSimulation(t);
  form.fire('submit'); await api.drain();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].intent, 'simulate', 'the action the request was saved with survives the pause');
  assert.equal(requests.some(path => path.startsWith('/api/jobs') || path === '/api/consent/decision'), false, 'review is reached, nothing is sent');
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
  assert.equal(requests.some(path => path.startsWith('/api/jobs') || path === '/api/consent/decision'), false);
  api.destroy(); await api.drain();
});

test('edited words submitted plainly are a plain question again', async t => {
  const { api, opened, requests, form, input } = await resumeRetainedSimulation(t);
  input.value = 'What did the second passage change?'; input.fire('input'); await api.drain();
  form.fire('submit'); await api.drain();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].question, 'What did the second passage change?');
  assert.equal(opened[0].intent, 'unsure', 'the words are no longer the simulation that was saved');
  assert.equal(requests.some(path => path.startsWith('/api/jobs') || path === '/api/consent/decision'), false);
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

test('rapid Keep clicks reserve one thread before the next click can run', async t => {
  const e = env(t), api = await mount(e.root, e.namespace); await api.drain();
  t.after(async () => { api.destroy(); await api.drain(); });
  api.select(anchor()); await api.drain();
  const keep = button(e.root.querySelector('.m-selection')!, 'Keep');
  keep.click(); const pending = keep.disabled; keep.click(); await api.drain();
  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.length, 1);
  assert.equal(state.pending.filter(change => change.kind === 'keep').length, 1);
  assert.equal(pending, true, 'disabled synchronously, before storage completes');
});

test('two mounted margins share the Keep reservation; sequential Keep and mutation replay retain it', async t => {
  const e = env(t), root2 = e.document.createElement('div'); e.document.body.append(root2);
  const first = await mount(e.root, e.namespace), second = await mount(root2, e.namespace);
  t.after(async () => { first.destroy(); second.destroy(); await Promise.all([first.drain(), second.drain()]); });
  await Promise.all([first.drain(), second.drain()]);
  first.select(anchor()); second.select(anchor());
  button(e.root.querySelector('.m-selection')!, 'Keep').click();
  button(root2.querySelector('.m-selection')!, 'Keep').click();
  await Promise.all([first.drain(), second.drain()]);
  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.length, 1);
  first.select(anchor()); button(e.root.querySelector('.m-selection')!, 'Keep').click(); await first.drain();
  const journal = documentJournal(e.namespace, localPersistence(e.namespace).journal);
  await navigator.locks.request(e.namespace, async () => { await journal.load(); await journal.change(state.pending[0]); });
  assert.equal(journal.state.threads.length, 1);
  assert.equal(journal.state.pending.length, 1);
});

async function clickKeep(api: Awaited<ReturnType<typeof mount>>, root: ReturnType<typeof dom>['root'], value = anchor()) {
  api.select(value); button(root.querySelector('.m-selection')!, 'Keep').click(); await api.drain();
}

test('Keep reloads a separate tab journal before lookup and ID reservation', async t => {
  const e = env(t), api = await mount(e.root, e.namespace); await api.drain();
  t.after(async () => { api.destroy(); await api.drain(); });
  const other = new ReaderJournal(localPersistence(e.namespace).journal);
  const mutation = { id: crypto.randomUUID(), kind: 'keep' as const, threadId: crypto.randomUUID(), capture, anchor: anchor() };
  // Queue the other tab first while this mounted margin still has an empty journal.
  // This journal is independent of documentJournal and emits no broadcast refresh.
  const remote = navigator.locks.request(e.namespace, async () => { await other.load(); await other.change(mutation); });
  await clickKeep(api, e.root); await remote;
  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.length, 1);
  assert.equal(state.threads[0].id, mutation.threadId);
  assert.deepEqual(state.pending, [mutation]);
});

test('acknowledged Keep retains its capture identity across a remount', async t => {
  const e = env(t), first = await mount(e.root, e.namespace); await first.drain();
  await clickKeep(first, e.root);
  const journal = documentJournal(e.namespace, localPersistence(e.namespace).journal);
  const remote = journal.state.threads.map(thread => ({ ...thread, sourceVersionId: 'verified-source' }));
  await navigator.locks.request(e.namespace, () => journal.sync(async () => {}, async () => remote));
  first.destroy(); await first.drain();
  const before = structuredClone(e.data(e.namespace).get('journal'));
  const second = await mount(e.root, e.namespace); await second.drain();
  t.after(async () => { second.destroy(); await second.drain(); });
  await clickKeep(second, e.root);
  assert.deepEqual(e.data(e.namespace).get('journal'), before);
});

test('Keep preserves distinct offsets and every part of the saved anchor', async t => {
  const e = env(t), text = 'Same. Same.', current = { ...capture, text };
  const api = await mountMargin(asHost(e.root), { capture: current, storageName: e.namespace, allowHelper: false }); await api.drain();
  t.after(async () => { api.destroy(); await api.drain(); });
  const first: QuoteAnchor = { kind: 'quote', start: 0, end: 5, exact: 'Same.', prefix: '', suffix: '' };
  const values = [first, { ...first, start: 6, end: 11 }, { ...first, suffix: ' Same.' }, { ...first, kind: 'section' as const }];
  for (const value of values) await clickKeep(api, e.root, value);
  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.length, values.length);
  assert.deepEqual(state.threads.map(thread => thread.anchor), values);
});

test('Keep separates source text, extraction, metadata, sections and URL versions with the same quote', async t => {
  const e = env(t);
  const versions: SourceCapture[] = [capture, { ...capture, text: capture.text + ' Added.' },
    { ...capture, extractionVersion: 'test-v2' }, { ...capture, title: 'Changed title' },
    { ...capture, author: 'Another author' }, { ...capture, sections: [{ title: 'Opening', start: 0, end: capture.text.length }] },
    { ...capture, url: 'https://example.org/another-source' }];
  for (const current of versions) {
    const api = await mountMargin(asHost(e.root), { capture: current, storageName: e.namespace, allowHelper: false }); await api.drain();
    await clickKeep(api, e.root); api.destroy(); await api.drain();
  }
  assert.equal((e.data(e.namespace).get('journal') as JournalState).threads.length, versions.length);
  const api = await mountMargin(asHost(e.root), { capture: { ...capture, capturedAt: '2026-09-20T00:00:00Z' }, storageName: e.namespace, allowHelper: false }); await api.drain();
  await clickKeep(api, e.root); api.destroy(); await api.drain();
  assert.equal((e.data(e.namespace).get('journal') as JournalState).threads.length, versions.length, 'capture time alone is not a new version');
});

test('intentional standalone notes remain separate and Keep never rewrites stored lookalikes', async t => {
  const e = env(t), api = await mount(e.root, e.namespace); await api.drain();
  t.after(async () => { api.destroy(); await api.drain(); });
  for (let i = 0; i < 2; i++) {
    api.select(anchor()); button(e.root.querySelector('.m-selection')!, 'Note').click(); await api.drain();
    const input = e.root.querySelector('.m-compose')!.querySelector('textarea')!;
    input.value = 'Deliberately repeated note'; input.fire('input');
    button(e.root.querySelector('.m-compose')!, 'Save note').click(); await api.drain();
  }
  const before = structuredClone(e.data(e.namespace).get('journal') as JournalState);
  assert.equal(before.threads.length, 2);
  assert.notEqual(before.threads[0].id, before.threads[1].id);
  await clickKeep(api, e.root);
  assert.deepEqual(e.data(e.namespace).get('journal'), before);
});

test('an unknown original capture stays separate even with identical quote and empty version', async t => {
  const e = env(t), seed = new ReaderJournal(localPersistence(e.namespace).journal);
  await seed.load(); await seed.change({ id: crypto.randomUUID(), kind: 'keep', threadId: crypto.randomUUID(), capture, anchor: anchor() });
  const legacy = structuredClone(seed.state); legacy.pending = []; legacy.acknowledged = [];
  e.data(e.namespace).set('journal', legacy);
  const api = await mount(e.root, e.namespace); await api.drain();
  t.after(async () => { api.destroy(); await api.drain(); });
  await clickKeep(api, e.root);
  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.length, 2);
  assert.deepEqual(state.threads[0], legacy.threads[0]);
});

test('failed persistence releases the button and retry preserves the original Keep mutation', async t => {
  const e = env(t), api = await mount(e.root, e.namespace); await api.drain();
  t.after(async () => { api.destroy(); await api.drain(); });
  e.onWrite(async key => { if (key === 'journal') throw new Error('disk full'); });
  api.select(anchor()); const control = button(e.root.querySelector('.m-selection')!, 'Keep');
  control.click(); await api.drain();
  assert.equal(control.disabled, false);
  const journal = documentJournal(e.namespace, localPersistence(e.namespace).journal);
  assert.equal(journal.unsaved, true);
  const mutation = structuredClone(journal.state.pending[0]);
  control.click(); await api.drain();
  assert.deepEqual(journal.state.pending, [mutation], 'another click cannot allocate while saving is unresolved');
  e.onWrite(async () => {});
  await navigator.locks.request(e.namespace, () => journal.retryPersistence());
  await clickKeep(api, e.root);
  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.length, 1);
  assert.deepEqual(state.pending, [mutation]);
});

for (const action of ['ask', 'simulate'] as const) test(`two unpaired ${action} submissions preserve one durable request without creating a thread`, async t => {
  const e = env(t), requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(String(url)); throw new Error('Unexpected outbound request'); } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: true, readPosition: async () => undefined });
  await api.drain();
  assert.equal(await api.selectionAction(action, anchor()), false);
  const form = e.root.querySelector('.m-asking-draft')!;
  if (action === 'ask') { const input = form.querySelector('textarea')!; input.value = 'Why does this passage matter?'; input.fire('input'); await api.drain(); }
  for (let i = 0; i < 2; i++) { form.fire('submit'); await api.drain(); }
  const retained = drafts(e, 'question:draft:');
  const state = e.data(e.namespace).get('journal') as JournalState | undefined;
  api.destroy(); await api.drain();
  assert.equal(retained.length, 1);
  assert.equal(retained[0].question, action === 'ask' ? 'Why does this passage matter?' : 'Simulate this passage.');
  assert.equal(retained[0].intent, action === 'ask' ? 'unsure' : 'simulate');
  assert.deepEqual(retained[0].anchor, anchor());
  assert.deepEqual(retained[0].capture, capture);
  assert.deepEqual(requests, []);
  assert.equal(state?.threads.length ?? 0, 0, 'blocked review must not create an empty thread');
  assert.equal(state?.pending.length ?? 0, 0);
  assert.equal(retained[0].keepMutation, undefined);
  assert.equal(retained[0].threadId, undefined);
});

// Copy only durable storage into a new namespace. This bypasses documentQuestion,
// journal and helper caches, so remount cannot pass on memory-only draft state.
function reloadStorage(e: ReturnType<typeof env>) {
  const saved = structuredClone([...e.data(e.namespace)]);
  e.namespace = crypto.randomUUID();
  for (const [key, value] of saved) e.data(e.namespace).set(key, value);
}

async function realReview(t: import('node:test').TestContext, e: ReturnType<typeof env>) {
  const peerModule = await import('../ui/asking/index.ts');
  const { createT08Mount } = await import('../ui/asking-host.ts');
  const { mountConsentSheet } = await import('../ui/consent.ts');
  replaceGlobals(t, { cancelAnimationFrame: clearImmediate });
  const journal = documentJournal(e.namespace, localPersistence(e.namespace).journal);
  const requests: string[] = [], prepared: any[] = [];
  let binding: any, flow: ReturnType<typeof peerModule.createAskingFlow> | undefined;
  const source = { id: 'verified-source', sourceId: 'source', hash: 'a'.repeat(64), text: capture.text, title: capture.title,
    pageType: capture.pageType, capturedAt: capture.capturedAt, extractionVersion: capture.extractionVersion, metadataStatus: 'provided' };
  replaceGlobals(t, { fetch: async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname; requests.push(path);
    if (path === '/health') return Response.json({ status: 'ready' });
    if (path === '/pair') return Response.json({ token: 'p'.repeat(43) });
    if (path === '/api/change') return Response.json({});
    if (path === '/api/read/threads') return Response.json({ threads: journal.state.threads.map(thread => ({ ...thread, sourceVersionId: source.id })) });
    if (path === '/api/read/export') return Response.json({ thread: journal.state.threads[0], source, replies: [], replyViews: [] });
    if (path === '/api/read/jobs') return Response.json({ configured: true, available: true, unverified: [], disclosureVersion: null });
    if (path !== '/api/jobs/prepare') throw new Error('Unexpected controlled transport: ' + path);
    const body = JSON.parse(String(init?.body)); prepared.push(body);
    const capabilities = body.intent === 'simulate' ? ['samples', 'solver'] : [];
    const packet = { schema: 'marginalia.job-packet.v1', intent: body.intent, question: body.question,
      source: { url: binding.sourceUrl, title: binding.sourceTitle, pageType: binding.sourcePageType, capturedAt: binding.sourceCapturedAt,
        sourceHash: binding.sourceHash, sourceVersionId: binding.sourceVersionId },
      selection: { ...binding.anchor, originalEnd: binding.anchor.end, omittedCharacters: 0 },
      adjacentContext: { before: '', after: '', basis: 'bounded-character-context' }, availableCapabilities: capabilities, omissions: [] };
    return Response.json({ unverified: [], disclosureVersion: null,
      job: { ...body, provider: 'app-server', model: 'host-selected', mode: 'structured-final', policyKey: 'b'.repeat(64), preparedPayloadDigest: 'c'.repeat(64), capabilities },
      preview: { id: 'preview-' + body.id, revision: 1, requestId: body.id, site: new URL(capture.url).origin,
        scope: 'cloud-inference', scopeLabel: 'Host scope', recipient: 'openai-codex', recipientLabel: 'OpenAI Codex',
        provider: 'app-server', policyKey: 'b'.repeat(64), outgoing: [
          { label: 'Bounded reading packet', text: JSON.stringify(packet), sha256: 'a'.repeat(64) },
          { label: 'Adapter prompt', text: 'Exact controlled prompt', sha256: 'b'.repeat(64) }],
        payloadDigest: 'a'.repeat(64), bindingDigest: 'c'.repeat(64), expiresAt: '2026-09-17T00:10:00Z', state: 'ready' } });
  } });
  const peer = { ...peerModule,
    createAskingFlow(options: any) { binding = options.binding; return flow = peerModule.createAskingFlow({ ...options, now: () => Date.parse(capture.capturedAt) }); },
    // t05-harness substitutes the host's consent import. Explicitly restore the
    // production consent renderer here, so reaching review is not just a spy call.
    mountAskingCard(host: HTMLElement, options: any) { return peerModule.mountAskingCard(host, { ...options, mountConsent: mountConsentSheet }); },
  };
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: true, readPosition: async () => undefined,
    asking: createT08Mount(async () => peer as any) });
  t.after(async () => { api.destroy(); await api.drain(); });
  await api.drain();
  return { api, requests, prepared, journal, getFlow: () => flow };
}

for (const action of ['ask', 'simulate'] as const) test(`durable blocked ${action} survives reload, pairing sends nothing, one Continue reaches real review once`, async t => {
  const e = env(t), first = await mount(e.root, e.namespace); await first.drain();
  await first.selectionAction(action, anchor()); await first.drain();
  const form = e.root.querySelector('.m-asking-draft')!;
  if (action === 'ask') { const input = form.querySelector('textarea')!; input.value = 'Why does this passage matter?'; input.fire('input'); await first.drain(); }
  form.fire('submit'); await first.drain(); form.fire('submit'); await first.drain();
  const saved = structuredClone(drafts(e, 'question:draft:')[0]);
  first.destroy(); await first.drain(); reloadStorage(e);
  const { api, requests, prepared, journal, getFlow } = await realReview(t, e);
  assert.deepEqual(drafts(e, 'question:draft:')[0], saved);
  assert.equal(journal.state.threads.length, 0);
  button(e.root, 'Settings').click(); await api.drain();
  const code = e.root.querySelector('[aria-label="Pairing code"]')!; code.value = '123456'; code.fire('input');
  button(e.root, 'Pair').click(); await api.drain();
  assert.equal(prepared.length, 0, 'successful pairing never prepares or resumes a model request');
  assert.equal(getFlow(), undefined);
  assert.equal(journal.state.threads.length, 0);
  assert.equal((e.data(e.namespace).get('pairing') as any).token, 'p'.repeat(43));
  assert.equal(e.root.querySelector('.m-question')!.hidden, false, 'pairing returns to the retained draft');
  const continued = button(e.root, action === 'simulate' ? 'Continue simulation' : 'Continue Ask');
  continued.click(); continued.click(); await api.drain();
  assert.equal(prepared.length, 1);
  assert.equal(getFlow()!.getState().phase, 'consent');
  assert.equal(e.root.querySelectorAll('.m-consent').length, 1);
  assert.equal(prepared[0].question, saved.question); assert.equal(prepared[0].intent, saved.intent);
  assert.deepEqual(drafts(e, 'question:draft:')[0].anchor, saved.anchor);
  assert.deepEqual(drafts(e, 'question:draft:')[0].capture, saved.capture);
  assert.equal(journal.state.threads.length, 1);
  assert.equal(requests.some(path => path === '/api/jobs' || path === '/api/consent/decision' || /\/(retry|followups)$/.test(path)), false);
});


for (const action of ['ask', 'simulate'] as const) test(`a paired reload continues the exact ${action} draft in one action without pairing replay`, async t => {
  const e = env(t), first = await mount(e.root, e.namespace); await first.drain();
  await first.selectionAction(action, anchor()); await first.drain();
  const form = e.root.querySelector('.m-asking-draft')!;
  if (action === 'ask') { const input = form.querySelector('textarea')!; input.value = 'Explain the first passage'; input.fire('input'); await first.drain(); }
  form.fire('submit'); await first.drain();
  const saved = structuredClone(drafts(e, 'question:draft:')[0]);
  first.destroy(); await first.drain(); pair(e); reloadStorage(e);
  const { api, requests, prepared, getFlow } = await realReview(t, e);
  assert.equal(prepared.length, 0); assert.equal(getFlow(), undefined);
  const continued = button(e.root, action === 'simulate' ? 'Continue simulation' : 'Continue Ask');
  continued.click(); continued.click(); await api.drain();
  assert.equal(prepared.length, 1); assert.equal(getFlow()!.getState().phase, 'consent');
  assert.equal(prepared[0].intent, saved.intent); assert.equal(prepared[0].question, saved.question);
  assert.equal(requests.includes('/pair'), false);
  assert.equal(requests.includes('/api/jobs'), false); assert.equal(requests.includes('/api/consent/decision'), false);
});

test('editing a blocked simulation persists plain-question intent across a storage-only reload', async t => {
  const e = env(t), first = await mount(e.root, e.namespace); await first.drain();
  await first.selectionAction('simulate', anchor()); await first.drain();
  const input = e.root.querySelector('.m-asking-draft')!.querySelector('textarea')!;
  input.value = 'Explain this passage instead'; input.fire('input'); await first.drain();
  assert.equal(drafts(e, 'question:draft:')[0].intent, 'unsure');
  input.value = 'Simulate this passage.'; input.fire('input'); await first.drain();
  assert.equal(drafts(e, 'question:draft:')[0].intent, 'simulate');
  input.value = 'Explain this passage instead'; input.fire('input'); await first.drain();
  first.destroy(); await first.drain(); pair(e); reloadStorage(e);
  const { api, prepared } = await realReview(t, e);
  button(e.root, 'Continue Ask').click(); await api.drain();
  assert.equal(prepared.length, 1); assert.equal(prepared[0].intent, 'unsure');
  assert.equal(prepared[0].question, 'Explain this passage instead');
});

test('failed question persistence never creates a thread and an explicit retry keeps the question', async t => {
  const e = env(t), api = await mount(e.root, e.namespace); await api.drain();
  t.after(async () => { api.destroy(); await api.drain(); });
  await api.selectionAction('ask', anchor()); await api.drain();
  const form = e.root.querySelector('.m-asking-draft')!, input = form.querySelector('textarea')!;
  e.onWrite(async key => { if (key.startsWith('question:draft:')) throw new Error('Controlled write failure'); });
  input.value = 'Retain my unsaved question'; input.fire('input'); await api.drain();
  form.fire('submit'); await api.drain();
  assert.equal((e.data(e.namespace).get('journal') as JournalState | undefined)?.threads.length ?? 0, 0);
  assert.equal(input.value, 'Retain my unsaved question');
  assert.notEqual(drafts(e, 'question:draft:')[0].question, input.value, 'failed save is not passed off as durable');
  e.onWrite(async () => {}); form.fire('submit'); await api.drain();
  assert.equal(drafts(e, 'question:draft:')[0].question, input.value);
  assert.equal((e.data(e.namespace).get('journal') as JournalState | undefined)?.threads.length ?? 0, 0);
});

test('failed pairing persistence leaves the draft unpaired and opens no review', async t => {
  const e = env(t), { api, prepared, getFlow, journal } = await realReview(t, e);
  await api.selectionAction('simulate', anchor()); await api.drain();
  e.onWrite(async key => { if (key === 'pairing') throw new Error('Controlled pairing save failure'); });
  button(e.root, 'Settings').click(); await api.drain();
  const code = e.root.querySelector('[aria-label="Pairing code"]')!; code.value = '123456'; code.fire('input');
  button(e.root, 'Pair').click(); await api.drain();
  assert.equal(e.data(e.namespace).get('pairing'), undefined); assert.throws(() => api.connection());
  assert.equal(prepared.length, 0); assert.equal(getFlow(), undefined); assert.equal(journal.state.threads.length, 0);
  assert.equal(drafts(e, 'question:draft:')[0].intent, 'simulate');
  assert.match(e.root.textContent, /new pairing was not saved/);
});

test('a stale Continue rechecks revoked pairing before creating a thread', async t => {
  const e = env(t), first = await mount(e.root, e.namespace); await first.drain();
  await first.selectionAction('simulate', anchor()); await first.drain(); first.destroy(); await first.drain();
  pair(e); reloadStorage(e);
  const { api, prepared, journal } = await realReview(t, e);
  const continued = button(e.root, 'Continue simulation');
  api.connection().token = '';
  continued.click(); await api.drain();
  assert.equal(journal.state.threads.length, 0); assert.equal(prepared.length, 0);
  assert.equal(drafts(e, 'question:draft:')[0].keepMutation, undefined);
});

test('closing the source while a question reservation is saving creates no thread or review', async t => {
  const { deferred, until } = await import('./t05-dom.ts');
  const e = env(t), first = await mount(e.root, e.namespace); await first.drain();
  await first.selectionAction('simulate', anchor()); await first.drain(); first.destroy(); await first.drain();
  pair(e); reloadStorage(e);
  const { api, prepared, journal } = await realReview(t, e);
  const held = deferred(); let waiting = false;
  e.onWrite(async (key, value: any) => { if (key.startsWith('question:draft:') && value?.keepMutation) { waiting = true; await held.promise; } });
  button(e.root, 'Continue simulation').click(); await until(() => waiting);
  api.destroy(); held.resolve(); await api.drain();
  assert.equal(journal.state.threads.length, 0); assert.equal(prepared.length, 0);
  assert.equal(drafts(e, 'question:draft:')[0].question, 'Simulate this passage.');
});

for (const failure of ['unavailable', 'unconfigured', 'rejected', 'offline', 'invalid'] as const) test(`two ${failure} availability checks preserve one draft with zero threads`, async t => {
  const e = env(t); pair(e);
  const requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => {
    const path = new URL(url).pathname; requests.push(path);
    assert.equal(path, '/api/read/jobs');
    if (failure === 'offline') throw new Error('Controlled offline helper');
    if (failure === 'rejected') return Response.json({ error: 'Pairing was revoked' }, { status: 401 });
    if (failure === 'invalid') return Response.json({ available: true });
    return Response.json({ configured: failure !== 'unconfigured', available: false, unverified: [], disclosureVersion: null });
  } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: true, readPosition: async () => undefined });
  t.after(async () => { api.destroy(); await api.drain(); }); await api.drain();
  await api.selectionAction('ask', anchor()); await api.drain();
  const form = e.root.querySelector('.m-asking-draft')!, input = form.querySelector('textarea')!;
  input.value = 'Retain this until the helper is ready'; input.fire('input'); await api.drain();
  for (let i = 0; i < 2; i++) { form.fire('submit'); await api.drain(); }
  assert.deepEqual(requests, ['/api/read/jobs', '/api/read/jobs']);
  const saved = drafts(e, 'question:draft:');
  assert.equal(saved.length, 1); assert.equal(saved[0].question, input.value); assert.equal(saved[0].intent, 'unsure');
  assert.equal(saved[0].keepMutation, undefined); assert.equal(saved[0].threadId, undefined);
  assert.equal((e.data(e.namespace).get('journal') as JournalState | undefined)?.threads.length ?? 0, 0);
});

for (const invalidation of ['closed', 'revoked', 'cancelled'] as const) test(`a ${invalidation} source while availability is pending creates no thread`, async t => {
  const { deferred, until } = await import('./t05-dom.ts');
  const e = env(t); pair(e);
  const held = deferred<Response>(); const requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(new URL(url).pathname); return held.promise; } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: true, readPosition: async () => undefined });
  t.after(async () => { api.destroy(); await api.drain(); }); await api.drain();
  await api.selectionAction('ask', anchor()); await api.drain();
  const form = e.root.querySelector('.m-asking-draft')!, input = form.querySelector('textarea')!;
  input.value = 'Keep this question'; input.fire('input'); await api.drain(); form.fire('submit');
  await until(() => requests.length > 0);
  if (invalidation === 'closed') api.destroy();
  else if (invalidation === 'revoked') api.connection().token = '';
  else e.root.querySelector('.m-question')!.fire('keydown', { key: 'Escape' });
  held.resolve(Response.json({ configured: true, available: true, unverified: [], disclosureVersion: null })); await api.drain();
  assert.deepEqual(requests, ['/api/read/jobs']);
  assert.equal((e.data(e.namespace).get('journal') as JournalState | undefined)?.threads.length ?? 0, 0);
  const saved = drafts(e, 'question:draft:')[0]; assert.equal(saved.question, input.value); assert.equal(saved.keepMutation, undefined);
});


test('editing while availability is pending keeps the new words and creates no thread', async t => {
  const { deferred, until } = await import('./t05-dom.ts');
  const e = env(t); pair(e);
  const held = deferred<Response>(); let reads = 0;
  replaceGlobals(t, { fetch: async () => { reads++; return held.promise; } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: true, readPosition: async () => undefined });
  t.after(async () => { api.destroy(); await api.drain(); }); await api.drain();
  await api.selectionAction('ask', anchor()); await api.drain();
  const form = e.root.querySelector('.m-asking-draft')!, input = form.querySelector('textarea')!;
  input.value = 'The earlier question'; input.fire('input'); await api.drain(); form.fire('submit');
  await until(() => reads > 0); input.value = 'Keep these newer words'; input.fire('input');
  held.resolve(Response.json({ configured: true, available: true, unverified: [], disclosureVersion: null })); await api.drain();
  assert.equal(reads, 1); assert.equal(drafts(e, 'question:draft:')[0].question, 'Keep these newer words');
  assert.equal((e.data(e.namespace).get('journal') as JournalState | undefined)?.threads.length ?? 0, 0);
  assert.match(form.textContent, /request context changed/);
});

test('editing during context synchronization preserves the newer durable draft and opens no stale review', async t => {
  const { deferred, until } = await import('./t05-dom.ts');
  const e = env(t); pair(e);
  const held = deferred<Response>(); let syncing = false, opens = 0;
  const journal = documentJournal(e.namespace, localPersistence(e.namespace).journal);
  replaceGlobals(t, { fetch: async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/api/read/jobs') return Response.json({ configured: true, available: true, unverified: [], disclosureVersion: null });
    if (path === '/api/change') { syncing = true; return held.promise; }
    if (path === '/api/read/threads') return Response.json({ threads: journal.state.threads.map(thread => ({ ...thread, sourceVersionId: 'verified-source' })) });
    throw new Error('Unexpected route: ' + path);
  } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: true, readPosition: async () => undefined,
    asking: () => ({ open() { opens++; }, setVisible() {}, destroy() {} }) });
  t.after(async () => { api.destroy(); await api.drain(); }); await api.drain();
  await api.selectionAction('ask', anchor()); await api.drain();
  const form = e.root.querySelector('.m-asking-draft')!, input = form.querySelector('textarea')!;
  input.value = 'Earlier question'; input.fire('input'); await api.drain(); form.fire('submit');
  await until(() => syncing); input.value = 'These newer words must survive'; input.fire('input');
  held.resolve(Response.json({})); await api.drain();
  assert.equal(opens, 0); assert.equal(drafts(e, 'question:draft:')[0].question, 'These newer words must survive');
  assert.equal(journal.state.threads.length, 1, 'context creation had already been admitted, but no stale question reaches review');
});

test('C5 page repair invokes the existing trusted transition once without helper calls or replay', async t => {
  const e = env(t); const calls: string[] = []; let transitions = 0;
  replaceGlobals(t, { fetch: async (url: string) => { calls.push(url); throw new Error('offline'); } });
  const controls = e.document.createElement('section'), trusted = e.document.createElement('button');
  trusted.id = 'trusted-open'; trusted.addEventListener('click', () => { transitions++; }); controls.append(trusted);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, settingsContent: asHost(controls), readPosition: async () => undefined });
  t.after(() => api.destroy());
  await api.selectionAction('simulate', anchor()); await api.drain();
  const card = e.root.querySelector('.m-asking-draft')!;
  assert.equal(e.root.querySelector('.m-blocked')!.hidden, true);
  assert.equal(card.querySelectorAll('.m-asking-repair').length, 1);
  button(card, 'Open browser margin').click();
  assert.equal(transitions, 1, 'transition stays synchronous in the initiating click');
  await api.drain(); assert.deepEqual(calls, []);
  assert.equal(drafts(e, 'question:draft:')[0].intent, 'simulate');
  assert.equal((e.data(e.namespace).get('journal') as JournalState | undefined)?.threads.length ?? 0, 0);
});

test('C5 unpaired repair focuses the exact code input without issuing or exchanging a code', async t => {
  const e = env(t); const calls: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { calls.push(url); throw new Error('offline'); } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: 'http://127.0.0.1:43120', readPosition: async () => undefined });
  t.after(() => api.destroy()); api.select(anchor()); await api.drain();
  button(e.root.querySelector('.m-selection')!, 'Pair helper').click();
  assert.equal(e.document.activeElement.getAttribute('aria-label'), 'Pairing code');
  const link = e.root.querySelectorAll('a').find(node => node.textContent === 'Open helper settings')!;
  assert.equal((link as any).href, 'http://127.0.0.1:43120/#pair-helper');
  await api.drain(); assert.deepEqual(calls, []);
});

test('C5 local site repair focuses the current-site control without changing its preference', async t => {
  const e = env(t); await localPersistence(e.namespace).write('denied:' + new URL(capture.url).origin, true);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, readPosition: async () => undefined });
  t.after(() => api.destroy()); api.select(anchor()); await api.drain();
  button(e.root.querySelector('.m-selection')!, 'Review site setting').click();
  assert.equal(e.document.activeElement.textContent, 'Allow question previews here');
  assert.equal(await localPersistence(e.namespace).read('denied:' + new URL(capture.url).origin), true);
});

test('C5 helper-page fragment focuses manual issuance without generating a code', async t => {
  const e = env(t); e.document.location.hash = '#pair-helper'; const calls: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { calls.push(url); return Response.json({ browsers: [] }); } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperManagement: true, readPosition: async () => undefined });
  t.after(() => api.destroy()); await api.drain();
  assert.equal(e.document.activeElement.textContent, 'Show pairing code');
  assert.equal(calls.some(url => url.includes('pairing-code')), false);
});

for (const [error, sentence, target] of [
  ['Pairing expired. Request a new code from the local helper.', 'Get a fresh code from the helper to continue.', 'settings:helper-page'],
  ['Pairing code did not match.', 'Enter the code shown in the helper settings.', 'settings:pairing-code'],
] as const) test('C5 pairing repair uses the observed protocol refusal: ' + target, async t => {
  const e = env(t); const calls: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { calls.push(url); return url.endsWith('/pair') ? Response.json({ error }, { status: 403 }) : Response.json({ status: 'ready' }); } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: 'http://127.0.0.1:43120', readPosition: async () => undefined });
  t.after(() => api.destroy()); api.select(anchor()); await api.drain(); button(e.root, 'Pair helper').click();
  const code = e.root.querySelector('[aria-label="Pairing code"]')!; code.value = '000000'; code.fire('input');
  button(e.root, 'Pair').click(); await api.drain();
  assert.equal(e.root.querySelector('.m-pairing-repair')!.textContent, sentence);
  assert.equal(e.document.activeElement.dataset.focusKey, target);
  assert.equal(calls.filter(url => url.endsWith('/pair')).length, 1);
  assert.equal(calls.some(url => url.includes('pairing-code') || url.includes('/jobs')), false);
  assert.throws(() => api.connection(), /Pair in the browser-owned margin/);
  assert.equal(await localPersistence(e.namespace).read('pairing'), undefined);
});

test('C5 trusted transition waits for the exact draft to be saved and exposes local repair after failure', async t => {
  const e = env(t); let transitions = 0;
  const controls = e.document.createElement('section'), trusted = e.document.createElement('button'); trusted.id = 'trusted-open';
  trusted.addEventListener('click', () => { transitions++; }); controls.append(trusted);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, settingsContent: asHost(controls), readPosition: async () => undefined });
  t.after(() => api.destroy()); await api.selectionAction('simulate', anchor()); await api.drain();
  const form = e.root.querySelector('.m-asking-draft')!, input = form.querySelector('textarea')!;
  e.onWrite(async key => { if (key.startsWith('question:draft:')) throw new Error('Controlled draft save failure'); });
  input.value = 'Keep these latest words'; input.fire('input'); await api.drain();
  button(form, 'Open browser margin').click();
  assert.equal(transitions, 0); assert.equal(e.document.activeElement.textContent, 'Retry saving');
  assert.match(form.textContent, /Save this passage and question to continue/);
  e.onWrite(async () => {}); button(e.root, 'Retry saving').click(); await api.drain();
  assert.equal(drafts(e, 'question:draft:')[0].question, 'Keep these latest words');
  assert.equal(transitions, 0, 'saving itself never replays the transition or request');
  button(e.root.querySelector('.m-asking-draft')!, 'Open browser margin').click();
  assert.equal(transitions, 1, 'a new explicit click can transition after durable saving');
  api.destroy(); await api.drain();
});


test('C5 queued sync repair focuses the available control without syncing or replaying', async t => {
  let cleanup: (() => Promise<void>) | undefined; t.after(async () => { await cleanup?.(); });
  const e = env(t); pair(e); const h = await realReview(t, e);
  cleanup = async () => { h.api.destroy(); await h.api.drain(); };
  await h.api.selectionAction('simulate', anchor()); await h.api.drain();
  const flow = h.getFlow()!; assert.equal(flow.getState().phase, 'consent');
  const thread = h.journal.state.threads[0];
  await h.journal.change({ id: crypto.randomUUID(), kind: 'thread-state', threadId: thread.id, state: 'parked', expectedRevision: thread.revision });
  assert.equal(h.journal.unsaved, false); assert.equal(h.journal.state.pending.length, 1);
  flow.editQuestion(); await flow.ask('simulate', 'Simulate this passage.'); await h.api.drain();
  assert.equal(flow.getState().blocker, 'unsaved-context');
  const before = h.requests.slice(), prepared = h.prepared.length;
  button(e.root, 'Review saving').click(); await h.api.drain();
  assert.ok(e.root.querySelector('[data-focus-key="settings:save-queued-changes"]'));
  assert.equal(e.root.querySelector('[data-focus-key="settings:retry-saving"]'), null);
  assert.equal(e.document.activeElement.textContent, 'Save queued changes');
  assert.deepEqual(h.requests, before); assert.equal(h.prepared.length, prepared);
  assert.equal(h.journal.state.pending.length, 1, 'focus leaves the queued mutation pending');
  h.api.destroy(); await h.api.drain();
});

for (const [failure, expected] of [
  ['Controlled local save failure', 'Retry saving'],
  ['Local storage changed elsewhere. Controlled conflict.', 'Recover unsaved changes'],
] as const) test('C5 saving repair prioritizes ' + expected + ' over queued synchronization', async t => {
  let cleanup: (() => Promise<void>) | undefined; t.after(async () => { await cleanup?.(); });
  const e = env(t); pair(e); const h = await realReview(t, e);
  cleanup = async () => { h.api.destroy(); await h.api.drain(); };
  await h.api.selectionAction('simulate', anchor()); await h.api.drain();
  const flow = h.getFlow()!, thread = h.journal.state.threads[0];
  e.onWrite(async key => { if (key === 'journal') throw new Error(failure); });
  await assert.rejects(h.journal.change({ id: crypto.randomUUID(), kind: 'thread-state', threadId: thread.id, state: 'parked', expectedRevision: thread.revision }));
  assert.equal(h.journal.unsaved, true);
  button(e.root, 'Settings').click(); await h.api.drain();
  button(e.root, 'Retry saving').click(); await h.api.drain();
  flow.editQuestion(); await flow.ask('simulate', 'Simulate this passage.'); await h.api.drain();
  assert.equal(flow.getState().blocker, 'unsaved-context');
  const before = h.requests.slice(), prepared = h.prepared.length;
  button(e.root, 'Review saving').click(); await h.api.drain();
  assert.equal(e.document.activeElement.textContent, expected);
  assert.ok(e.root.querySelector('[data-focus-key="settings:save-queued-changes"]'));
  assert.deepEqual(h.requests, before); assert.equal(h.prepared.length, prepared);
  assert.equal(h.journal.unsaved, true); assert.equal(h.journal.state.pending.length, 1);
  h.api.destroy(); await h.api.drain();
});


test('real host reports retained-question storage failure and Back keeps the exact draft until retry', async t => {
  let cleanup = async () => {}; t.after(() => cleanup());
  const { unsavedQuestions } = await import('../ui/persistence.ts');
  const e = env(t); pair(e); const h = await realReview(t, e);
  cleanup = async () => { e.onWrite(async () => {}); h.api.destroy(); await h.api.drain(); };
  await h.api.selectionAction('simulate', anchor()); await h.api.drain();
  const frame = e.root.querySelector('.m-reply-frame')!;
  const field = frame.querySelectorAll('textarea').find(node => node.id.endsWith('-review-question'))!;
  assert.ok(field); const prepared = h.prepared.length;
  e.onWrite(async key => { if (key.startsWith('question:draft:')) throw new Error('Retained question storage failure'); });
  field.value = 'Keep this exact edited question'; field.fire('input'); await h.api.drain();
  assert.match(e.root.textContent, /Retained question storage failure/);
  button(frame, 'Back').click(); await h.api.drain();
  assert.equal(frame.hidden, false); assert.equal(field.value, 'Keep this exact edited question');
  const recovered = unsavedQuestions(e.namespace).find(entry => entry.draft?.question === field.value);
  assert.ok(recovered); assert.equal(recovered.durable, false);
  assert.equal(recovered.draft!.threadId, h.journal.state.threads[0].id);
  e.onWrite(async () => {}); button(frame, 'Back').click(); await h.api.drain();
  assert.equal(frame.hidden, true);
  assert.equal(drafts(e, 'question:draft:')[0].question, field.value);
  assert.equal(h.prepared.length, prepared); assert.equal(h.requests.includes('/api/jobs'), false);
});
