import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaries, storage, asHost } from './t05-harness.ts';
import { dom, button, until, settle, deferred, replaceGlobals } from './t05-dom.ts';
import { ReaderJournal, type JournalState } from '../ui/journal.ts';
import type { SourceCapture, Thread } from '../contracts/reader.ts';
const { mountMargin, sectionMapState, marginItemSize } = await import('../ui/margin.ts');
const { localPersistence, documentJournal } = await import('../ui/persistence.ts');
const capture: SourceCapture = { url: 'https://example.org/a', title: 'Original source', pageType: 'article', text: 'First passage. Second passage. Third passage.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'test', sections: [{ title: 'First', start: 0, end: 15 }, { title: 'Second', start: 15, end: 31 }, { title: 'Third', start: 31, end: 45 }] };
function env(t: import('node:test').TestContext) { return { ...dom(t), ...storage(t), namespace: crypto.randomUUID() }; }
const anchor = (start = 0, end = 14) => ({ start, end, exact: capture.text.slice(start, end), prefix: capture.text.slice(Math.max(0, start - 40), start), suffix: capture.text.slice(end, end + 40) });
async function threadFixture(namespace: string, remote = false) {
  const persistence = localPersistence(namespace), journal = documentJournal(namespace, persistence.journal);
  await journal.change({ id: 'keep', kind: 'keep', threadId: 'thread', capture, anchor: anchor(), note: 'Original reader note' });
  if (remote) { const threads = structuredClone(journal.state.threads); threads[0].sourceVersionId = 'source'; await journal.sync(async () => {}, async () => threads); }
  return { journal, persistence, thread: structuredClone(journal.state.threads[0]) };
}
function cached(thread: Thread, intent = 'define', replyId = 'reply') {
  return { source: { id: 'source', sourceId: 'page', hash: 'source-hash', text: capture.text, title: capture.title, capturedAt: capture.capturedAt, extractionVersion: capture.extractionVersion, pageType: capture.pageType, metadataStatus: 'provided' },
    version: { id: replyId, threadId: thread.id, parentId: null, supersedes: null, hash: `reply-hash-${replyId}`, reply: { schema: 't05.fixture', intent }, validation: {}, answeredNote: null, revision: 1, createdAt: capture.capturedAt, deletedAt: null },
    view: { replyVersionId: replyId, parameters: { x: 1 }, view: {}, revision: 1, updatedAt: capture.capturedAt } } as any;
}

for (const outcome of ['succeeded', 'cancelled', 'failed', 'outcome_unknown', 'cancelled-after-handoff']) {
  test(`activity record reads stored ${outcome} work without writes`, async t => {
    const e = env(t); await threadFixture(e.namespace, true);
    e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
    let hostContext: any, selection: any;
    const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: (_root, context) => {
      hostContext = context;
      return { open(value) { selection = value; }, setVisible() {}, destroy() {} };
    } });
    button(e.root, 'Ask about this note').click(); button(e.root, 'Review with local helper').click(); await api.drain();
    hostContext.retainedQuestion({ ...selection, resumeJobId: 'stored-job' }); await api.drain();
    hostContext.onState({ phase: outcome === 'succeeded' ? 'committed' : outcome === 'outcome_unknown' ? 'unknown' : 'cancelled' });
    assert.equal(e.root.querySelector('.m-activity')!.hidden, false);
    const noSend = outcome === 'cancelled' || outcome === 'failed';
    const job = {
      id: 'stored-job', provider: 'app-server', model: 'recorded-model',
      state: outcome === 'cancelled-after-handoff' ? 'cancelled' : outcome,
      createdAt: '2026-09-18T09:00:00Z', updatedAt: '2026-09-18T09:01:00Z', preparedPayloadDigest: 'a'.repeat(64),
      attempts: [{ number: 1, handoffMarked: !noSend, dispatchClaimed: !noSend, ...(!noSend ? { startedAt: '2026-09-18T09:00:01Z' } : {}) }],
      context: { outgoing: { question: 'The frozen question <script>', selection: { exact: 'Reviewed passage' }, availableCapabilities: ['samples', 'solver'] } },
    };
    const requests: { path: string; method: string; body: unknown }[] = [];
    replaceGlobals(t, { fetch: async (url: string, init: RequestInit) => {
      requests.push({ path: new URL(url).pathname, method: init.method!, body: init.body }); return Response.json(job);
    } });
    const writes: string[] = []; e.onWrite(async key => { writes.push(key); });
    const dot = e.root.querySelector('.m-activity')!; dot.click();
    const sheet = e.root.querySelector('[aria-label="What was sent"]')!;
    await until(() => sheet.textContent.includes('recorded-model'));
    assert.equal(sheet.hidden, false);
    for (const text of ['What was sent', 'app-server', 'recorded-model', job.createdAt, job.updatedAt, 'samples, solver', job.preparedPayloadDigest, 'full reviewed text is no longer stored', 'The frozen question <script>', 'Reviewed passage']) assert.ok(sheet.textContent.includes(text), text);
    assert.equal(sheet.querySelectorAll('textarea,input,select,script').length, 0);
    assert.equal(sheet.textContent.includes('Nothing left this machine'), noSend);
    if (!noSend) assert.match(sheet.textContent, /2026-09-18T09:00:01Z/);
    if (outcome === 'succeeded') assert.match(sheet.textContent, /Ready/);
    if (outcome === 'outcome_unknown') assert.match(sheet.textContent, /Outcome unconfirmed/);
    assert.deepEqual(requests, [{ path: '/api/jobs/stored-job', method: 'GET', body: undefined }]);
    assert.deepEqual(writes, []);
    sheet.fire('keydown', { key: 'Escape' }); assert.equal(sheet.hidden, true); assert.equal(e.document.activeElement, dot);
    dot.click(); await until(() => sheet.textContent.includes('recorded-model'));
    button(sheet, 'Close').click(); assert.equal(sheet.hidden, true); assert.deepEqual(writes, []);
    api.destroy(); await api.drain();
  });
}
test('reading-position editor is connected, anchored and single-map across save failure, collapse and suspend', async t => {
  const e = env(t); const api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false });
  button(e.root, 'Settings').click(); assert.equal(e.root.querySelectorAll('button').some(node => node.textContent === 'Retry saving'), false, 'clean hydrated settings do not claim recovery is needed'); button(e.root, 'Close settings').click();
  api.setReadingPosition(21); const write = button(e.root, 'Write here\u2026'); write.focus();
  const field = e.root.querySelector('[aria-label="Your note"]')!; field.value = 'Frozen text?'; field.fire('input'); field.setSelectionRange(2, 5); field.scrollTop = 13;
  const compose = e.root.querySelector('.m-compose')!, before = e.root.querySelectorAll('.m-section-marker');
  assert.ok(compose.parentElement!.children.indexOf(compose) > compose.parentElement!.children.indexOf(before[1]));
  e.onWrite(async key => { if (key === 'journal') throw new Error('quota'); }); button(e.root, 'Save note').click(); await api.drain();
  assert.equal(e.root.querySelector('[aria-label="Your note"]'), field); assert.equal(e.document.activeElement, field); assert.deepEqual([field.selectionStart, field.selectionEnd, field.scrollTop], [2, 5, 13]);
  const stored = [...e.data(e.namespace)].find(([key]) => key.startsWith('draft:'))![1] as any;
  assert.equal(stored.position, 21); assert.equal(stored.anchor.start, 15); assert.equal(stored.text, 'Frozen text?');
  const map = e.root.querySelector('.m-map')!; assert.equal(e.root.querySelectorAll('.m-map').length, 1);
  button(e.root, 'Collapse').click(); assert.equal(map.parentElement!.className, 'm-rail'); button(e.root, 'Open margin').click(); assert.equal(e.root.querySelector('.m-map'), map);
  api.suspend(); api.setReadingPosition(34); api.resume(); assert.equal((e.data(e.namespace).get([...e.data(e.namespace).keys()].find(k => k.startsWith('draft:'))!) as any).position, 21);
  e.onWrite(async () => {}); button(e.root, 'Settings').click(); button(e.root, 'Retry saving').click(); await api.drain(); assert.equal((e.data(e.namespace).get('journal') as JournalState).threads[0].notes[0].text, 'Frozen text?');
  api.destroy(); await api.drain();
});

test('stored reading anchor restores quietly and an unresolved anchor keeps the current section fallback', async t => {
  const e = env(t), restored = anchor(21, 30), navigated: unknown[] = [], writes: unknown[] = [];
  let api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false,
    positionDebounceMs: 10, readPosition: async () => restored, writePosition: async value => { writes.push(value); }, onSource: value => { navigated.push(value); } });
  assert.equal(e.root.querySelector('.m-reading')!.textContent.includes('Second'), true);
  assert.deepEqual(navigated, [restored]);
  assert.deepEqual(writes, [], 'restoring never writes the value back');
  api.setReadingPosition(15); await new Promise(resolve => setTimeout(resolve, 20)); await api.drain();
  assert.deepEqual(writes, [], 'the host section fallback cannot overwrite a precise restored anchor');
  api.destroy(); await api.drain();

  const missing = { exact: 'not on this page', prefix: '', suffix: '', start: 0, end: 16 };
  api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false,
    readPosition: async () => missing, onSource: value => { navigated.push(value); } });
  assert.equal(e.root.querySelector('.m-reading')!.textContent.includes('First'), true);
  assert.deepEqual(navigated, [restored]);
  api.destroy(); await api.drain();
});

test('reading-position writes are trailing-edge debounced, coalesced, and absent on load', async t => {
  const e = env(t), writes: any[] = [];
  const api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false,
    positionDebounceMs: 10, readPosition: async () => undefined, writePosition: async value => { writes.push(value); } });
  assert.deepEqual(writes, []);
  api.setReadingPosition(17); api.setReadingPosition(21); api.setReadingPosition(25);
  assert.deepEqual(writes, []);
  await new Promise(resolve => setTimeout(resolve, 25)); await api.drain();
  assert.equal(writes.length, 1);
  const written = writes.at(0) as any;
  assert.equal(written.start, 25);
  assert.equal(written.exact, capture.text.slice(25, written.end));
  api.destroy(); await api.drain();
});
test('startup restoration cannot overwrite an interim recovery editor and failed draft survives remount', async t => {
  const e = env(t); let blocked = false; const gate = deferred();
  e.onRead(async key => { if (key === 'journal' && !blocked) { blocked = true; await gate.promise; } });
  const mounting = mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false });
  await until(() => blocked); assert.equal(button(e.root, 'Write here\u2026').disabled, true); // It cannot create a draft before hydration.
  button(e.root, 'Write here\u2026').click(); assert.equal(e.root.querySelector('.m-note-editor')!.hidden, true);
  gate.resolve(); const api = await mounting; e.onWrite(async key => { if (key.startsWith('draft:')) throw new Error('quota'); });
  button(e.root, 'Write here\u2026').click(); const field = e.root.querySelector('[aria-label="Your note"]')!; field.value = 'Only in this document'; field.fire('input'); await api.drain(); api.destroy(); await api.drain();
  const replacement = await mountMargin(asHost(e.root), { capture: { ...capture, text: 'A changed page', sections: undefined }, storageName: e.namespace, allowHelper: false });
  assert.equal(e.root.querySelector('[aria-label="Your note"]')!.value, field.value); assert.match(e.root.textContent, /original captured passage/);
  e.onWrite(async () => {}); button(e.root, 'Save note').click(); await replacement.drain();
  const state = e.data(e.namespace).get('journal') as JournalState; assert.equal(state.pending[0].kind === 'keep' && state.pending[0].capture.text, capture.text);
  replacement.destroy(); await replacement.drain();
});
test('equal-revision metadata refresh preserves focused reply controls and resolves current thread identity', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace), reply = cached(seeded.thread);
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, reply.source, [reply.version], [reply.view]);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: e.document.location.origin });
  await until(() => !!e.root.querySelector('[aria-label="Controlled reply input"]'));
  const field = e.root.querySelector('[aria-label="Controlled reply input"]')!; field.focus();
  const state = e.data(e.namespace).get('journal') as JournalState; state.threads[0].sourceVersionId = 'source'; state.threads[0].notes[0].text = 'Canonical same-revision content';
  e.data(e.namespace).set('journal', structuredClone(state)); const channel = new e.Channel(e.namespace); channel.postMessage('changed');
  await until(() => e.root.textContent.includes('Canonical same-revision content'));
  assert.equal(e.root.querySelector('[aria-label="Controlled reply input"]'), field); assert.equal(e.document.activeElement, field);
  const paths: string[] = []; replaceGlobals(t, { fetch: async (url: string) => { paths.push(new URL(url).pathname); return Response.json({ source: reply.source, replies: [reply.version], views: [reply.view] }); } });
  button(e.root, 'Load replies from helper').click(); await api.drain(); assert.deepEqual(paths, ['/api/read/replies']); assert.doesNotMatch(e.root.textContent, /different source version/);
  api.destroy(); await api.drain(); channel.close();
});
test('saved replies receive intent capabilities and solver only at the paired recompute gate', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace);
  const replies = [cached(seeded.thread, 'evidence', 'evidence'), cached(seeded.thread, 'explore', 'explore'), cached(seeded.thread, 'define', 'define')];
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, replies[0].source, replies.map(item => item.version), replies.map(item => item.view));
  boundaries.replyMounts.length = 0;
  let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  await until(() => boundaries.replyMounts.length === 3);
  assert.deepEqual(Object.fromEntries(boundaries.replyMounts.map(item => [item.intent, item.capabilities])), {
    evidence: ['samples', 'network.citations'], explore: ['samples', 'network.shelf'], define: ['samples'],
  });
  api.destroy(); await api.drain();

  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) }); boundaries.replyMounts.length = 0;
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: e.document.location.origin });
  await until(() => boundaries.replyMounts.length === 3);
  assert.ok(boundaries.replyMounts.every(item => item.capabilities?.at(-1) === 'solver'));
  api.destroy(); await api.drain();
});
test('embedded margin never reads a pairing credential or exposes management/privileged dispatch', async t => {
  const e = env(t), reads: string[] = []; e.onRead(async key => { reads.push(key); }); e.data(e.namespace).set('pairing', { token: 'must-not-read' });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, helperManagement: true });
  assert.equal(reads.includes('pairing'), false); for (const name of ['Pair', 'Disconnect', 'Show pairing code', 'Refresh browser list']) assert.equal(e.root.querySelectorAll('button').some(n => n.textContent === name), false);
  api.select(anchor()); button(e.root, 'Ask').click(); const question = e.root.querySelector('[aria-label="Your question"]')!; question.value = 'Why?'; question.fire('input');
  assert.equal(button(e.root, 'Review with local helper').disabled, true); api.destroy(); await api.drain();
});
test('Keep device version calls real T07 without sending or discarding the corresponding editor draft', async t => {
  const e = env(t), { journal, persistence } = await threadFixture(e.namespace);
  const mutation = { kind: 'note' as const, id: 'stale', threadId: 'thread', noteId: 'keep-note', expectedRevision: 0, text: 'My unsent correction' };
  await assert.rejects(journal.change(mutation));
  // A recovered draft retains its original immutable identity and capture.
  sessionStorage.setItem('marginalia-draft-tab', 'owned-tab'); await persistence.write('draft:owned-tab:' + capture.url, { text: mutation.text, source: capture, anchor: anchor(), mutation, threadId: 'thread', noteId: 'keep-note', revision: 0 });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  const field = e.root.querySelector('[aria-label="Your note"]')!;
  button(e.root, 'Keep device version; keep my change in history').click(); await api.drain();
  assert.equal(journal.state.resolutions![0].resolution, 'kept-device'); assert.equal(field.value, mutation.text); assert.equal(field.readOnly, false); assert.match(e.root.textContent, /Nothing was uploaded/);
  api.destroy(); await api.drain();
});
test('selection and question typing never send; explicit local context save preserves its stable identity', async t => {
  const e = env(t); let opens = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: () => ({ open() { opens++; }, setVisible() {}, destroy() {} }) });
  api.select(anchor()); button(e.root, 'Ask').click(); let q = e.root.querySelector('[aria-label="Your question"]')!; q.value = 'My question'; q.fire('input');
  button(e.root, 'Close question').click(); api.select(anchor(15, 30)); button(e.root, 'Ask').click(); q = e.root.querySelector('[aria-label="Your question"]')!;
  assert.equal(q.value, 'My question'); assert.equal(opens, 0);
  button(e.root, 'Keep this context on this device').click(); await api.drain();
  const journal = e.data(e.namespace).get('journal') as JournalState; assert.equal(journal.threads[0].anchor.start, 0); assert.equal(journal.pending.length, 1); assert.equal(opens, 0);
  button(e.root, 'Keep this context on this device').click(); await api.drain(); assert.equal((e.data(e.namespace).get('journal') as JournalState).pending.length, 1);
  api.destroy(); await api.drain();
});
test('explicit helper review invokes injected T08 only for acknowledged context; closing retains its question', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace, true); e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  let hostContext: any, selected: any, destroyed = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: (_root, context) => { hostContext = context; return { open(selection) { selected = selection; context.activity?.({ phase: 'working', sending: false, elapsedSeconds: 31 }); }, setVisible() {}, destroy() { destroyed++; } }; } });
  button(e.root, 'Ask about this note').click(); const field = e.root.querySelector('[aria-label="Your question"]')!; field.value = 'Explain my note'; field.fire('input');
  button(e.root, 'Review with local helper').click(); await api.drain(); assert.equal(selected?.answeredNote.text, 'Original reader note'); assert.equal(selected?.sourceVersionId, 'source');
  assert.equal(e.root.querySelector('.m-question')!.parentElement!.className, 'm-thread-body');
  assert.equal(e.root.querySelector('.m-question')!.parentElement!.children[0].className, 'm-thread-content', 'reader notes remain above the asking/reply surface');
  assert.equal(e.root.querySelector('.m-activity')!.dataset.sending, 'false'); assert.match(e.root.querySelector('.m-activity')!.getAttribute('aria-label')!, /31 seconds/);
  hostContext.retainedQuestion({ ...selected, question: 'More precise retained question' }); button(e.root, 'Close question').click(); await api.drain(); assert.equal(destroyed, 1);
  api.destroy(); await api.drain(); assert.equal(seeded.journal.state.pending.length, 0);
});
test('map encodes distinct lengths, density, marks/current position and line/tick/focus sizes', async t => {
  const e = env(t), { thread } = await threadFixture(e.namespace);
  const second = { ...thread, id: 'second', anchor: anchor(15, 30), notes: [] }, third = { ...thread, id: 'third', anchor: anchor(31, 44), notes: [] };
  const states = sectionMapState(capture.sections!, [thread, second, third], capture, 1);
  assert.deepEqual(states.map(s => s.marks), [1, 1, 1]); assert.deepEqual(states.map(s => s.notes), [1, 0, 0]); assert.equal(states[1].length, 16); assert.equal(states[1].current, true);
  assert.deepEqual([0, 1, 2, -1].map(section => marginItemSize(section, 0, false, false)), ['full', 'line', 'tick', 'full']); assert.equal(marginItemSize(2, 0, false, true), 'full');
});

test('end-of-page actions prepare explicit drafts and cannot replace an existing question or send', async t => {
  const e = env(t); let opened = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: () => ({ open() { opened++; }, setVisible() {}, destroy() {} }) });
  button(e.root, 'Go further').click(); const field = e.root.querySelector('[aria-label="Your question"]')!; assert.match(field.value, /further reading/);
  field.value = 'Keep my exact question'; field.fire('input'); button(e.root, 'Think with it').click(); assert.equal(e.root.querySelector('[aria-label="Your question"]')!.value, field.value); assert.equal(opened, 0);
  api.destroy(); await api.drain();
});

test('failed new-pairing storage does not mask the old local credential from a later offline Disconnect', async t => {
  const e = env(t), old = 'a'.repeat(43), newer = 'b'.repeat(43); e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: old });
  const paths: string[] = []; replaceGlobals(t, { fetch: async (url: string) => { const path = new URL(url).pathname; paths.push(path); if (path === '/pair') return Response.json({ token: newer }); throw new Error('offline'); } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace });
  e.onWrite(async key => { if (key === 'pairing') throw new Error('quota'); }); const input = e.root.querySelector('[aria-label="Pairing code"]')!; input.value = '001234'; input.fire('input'); button(e.root, 'Pair').click(); await api.drain();
  assert.equal(api.connection().token, old); assert.equal((e.data(e.namespace).get('pairing') as any).token, old); assert.match(e.root.textContent, /new pairing was not saved/);
  e.onWrite(async () => {}); button(e.root, 'Disconnect').click(); await api.drain(); assert.equal(e.data(e.namespace).get('pairing'), undefined); assert.match(e.root.textContent, /Remote revocation is unconfirmed/); assert.deepEqual(paths, ['/api/position', '/pair', '/api/revoke']);
  api.destroy(); await api.drain();
});

test('actual reply-cache failures retain unsaved inputs and competing sessions retain recovery without replacing the active view', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace, true), reply = cached(seeded.thread);
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, reply.source, [reply.version], [reply.view]);
  const record = (await seeded.persistence.replies.list(seeded.thread.id))[0]; const first = await seeded.persistence.replies.open(record), second = await seeded.persistence.replies.open(record);
  e.onWrite(async key => { if (key.startsWith('reply:')) throw new Error('quota'); });
  await assert.rejects(first.save({ parameters: { x: 2 }, view: {} }), /quota/); assert.equal(seeded.persistence.replies.unsaved(seeded.thread.id)[0].recovery.state.parameters.x, 2);
  e.onWrite(async () => {}); await first.save({ parameters: { x: 3 }, view: {} }); assert.equal(seeded.persistence.replies.unsaved(seeded.thread.id).length, 0);
  await assert.rejects(second.save({ parameters: { x: 4 }, view: {} }), { name: 'RecoveredViewConflict' });
  const final = (await seeded.persistence.replies.list(seeded.thread.id))[0]; assert.equal(final.local.parameters.x, 3); assert.equal(final.recovered![0].state.parameters.x, 4);
});

for (const [label, intent] of [['Move it', 'simulate'], ['Check this', 'evidence']] as const) {
  test(`${label} saves a selection draft without opening asking or sending`, async t => {
    const e = env(t), requests: string[] = []; let opened = 0;
    replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected outbound request'); } });
    const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace,
      asking: () => ({ open() { opened++; }, setVisible() {}, destroy() {} }) });
    api.select(anchor()); button(e.root, 'Ask').click(); button(e.root, label).click(); await api.drain();
    const draft = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as any;
    assert.equal(draft.intent, intent); assert.deepEqual(draft.anchor, anchor());
    assert.equal(draft.question, e.root.querySelector('[aria-label="Your question"]')!.value);
    assert.ok(draft.question.length); assert.equal(opened, 0); assert.deepEqual(requests, []);
    api.destroy(); await api.drain();
  });
}

test('saved reply follow-up retains the saved thread and current inputs as a draft without sending', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace), reply = cached(seeded.thread);
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, reply.source, [reply.version], [reply.view]);
  const requests: string[] = []; let opened = 0;
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected outbound request'); } });
  boundaries.replyMounts.length = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace,
    asking: () => ({ open() { opened++; }, setVisible() {}, destroy() {} }) });
  await until(() => boundaries.replyMounts.length === 1);
  const followup = boundaries.replyMounts[0].onFollowup; assert.equal(typeof followup, 'function');
  await followup!({ text: 'Why this value?', parameters: { x: 2 }, view: {} }); await api.drain();
  const draft = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as any;
  assert.equal(draft.threadId, seeded.thread.id); assert.equal(draft.resumeReplyId, reply.version.id);
  assert.equal(draft.answeredNote, undefined, 'follow-up uses the saved reply note identity, not the latest thread note');
  assert.equal(draft.question, 'Why this value?\n\nCurrent reader-selected inputs:\nx = 2');
  assert.equal(e.root.querySelector('[aria-label="Your question"]')!.value, draft.question);
  await followup!({ text: 'Do not replace my draft', parameters: {}, view: {} }); await api.drain();
  assert.equal(e.root.querySelector('[aria-label="Your question"]')!.value, draft.question);
  assert.equal(opened, 0); assert.deepEqual(requests, []); api.destroy(); await api.drain();
});
