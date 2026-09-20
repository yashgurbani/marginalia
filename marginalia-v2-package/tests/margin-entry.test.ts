import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaries, storage, asHost } from './t05-harness.ts';
import { dom, button, until, settle, deferred, replaceGlobals } from './t05-dom.ts';
import { ReaderJournal, type JournalState } from '../ui/journal.ts';
import type { SourceCapture, Thread } from '../contracts/reader.ts';
import { startServer } from '../daemon/server.ts';
const nativeHttpFetch = globalThis.fetch;
const { mountMargin, sectionMapState, marginItemSize, egressMeasurements } = await import('../ui/margin.ts');
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

test('related margin reads saved overlaps locally, opens saved sources and refreshes only after saving', async t => {
  const nativeFetch = globalThis.fetch, e = env(t); let providerRequests = 0, opened: Thread | undefined;
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => { providerRequests++; return {}; } });
  t.after(() => helper.close());
  const origin = 'chrome-extension://' + 'a'.repeat(32), token = helper.pairing.exchange(helper.challenge, origin);
  e.data(e.namespace).set('pairing', { origin: helper.origin, token });
  const requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string, init: RequestInit) => {
    assert.equal(new URL(url).origin, helper.origin);
    requests.push(new URL(url).pathname);
    return nativeFetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
  } });
  const save = (id: string, source: SourceCapture) => helper.store.apply({ id: 'save-' + id, kind: 'keep', threadId: id, capture: source,
    anchor: { exact: source.text, prefix: '', suffix: '', start: 0, end: source.text.length } });
  save('current', capture);
  const source = e.document.createElement('article'); source.textContent = capture.text; e.document.body.append(source);
  const api = await mountMargin(asHost(e.root), { capture, sourceRoot: asHost(source), storageName: e.namespace, helperOrigin: helper.origin, readPosition: async () => undefined,
    onLibrary: thread => { opened = thread; } });
  await api.drain();
  const footer = e.root.querySelector('.m-related')!;
  const toggle = button(e.root, 'Connections');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(footer.hidden, true); assert.equal(footer.textContent, ''); assert.deepEqual(requests, []);
  const beforeSelection = requests.length;
  api.select(anchor()); await api.drain(); assert.equal(requests.length, beforeSelection);
  toggle.click(); await api.drain();
  assert.equal(footer.textContent, 'No related saved passages were found.'); const emptyReads = requests.length;
  for (let index = 0; index < 4; index++) save('other-' + index, { ...capture, sections: undefined, url: `https://example.org/other-${index}`, title: `Other source ${index}`, text: `First passage shared with source ${index}. ` + 'Saved context. '.repeat(100) });
  button(e.root, 'Keep').click(); await api.drain();
  assert.equal(requests.length, emptyReads); toggle.click(); toggle.click(); await api.drain();
  assert.ok(requests.length > emptyReads);
  assert.equal(footer.querySelectorAll('blockquote').length, 3);
  const open = footer.querySelectorAll('button')[0], title = open.textContent;
  assert.match(title, /^Other source/); open.click(); await api.drain();
  assert.equal(Boolean(opened), false); button(footer, 'Open in Library').click();
  assert.equal(opened?.sourceTitle, title); assert.equal(opened?.sourceUrl.startsWith('https://example.org/other-'), true);
  toggle.click(); const closedReads = requests.length;
  api.select(anchor(15, 30)); button(e.root, 'Keep').click(); await api.drain(); assert.equal(requests.length, closedReads);
  toggle.click(); await api.drain(); assert.ok(requests.length > closedReads); assert.equal(footer.querySelectorAll('blockquote').length, 3);
  const beforeReselect = requests.length; api.select(anchor(15, 30)); await api.drain();
  assert.equal(requests.length, beforeReselect);
  assert.equal(source.textContent, capture.text);
  assert.ok(requests.every(path => ['/api/read/threads', '/api/read/library-related', '/api/read/export'].includes(path)));
  assert.equal(providerRequests, 0); assert.equal(helper.jobs.list().length, 0);
  assert.equal(helper.store.db.prepare('SELECT COUNT(*) FROM egress_events').pluck().get(), 0);
  api.destroy(); await api.drain();

  let externalOpens = 0;
  Object.defineProperty(e.document.defaultView!, 'open', { configurable: true, value: () => { externalOpens++; return null; } });
  const fallback = await mountMargin(asHost(e.root), { capture, sourceRoot: asHost(source), storageName: e.namespace, helperOrigin: helper.origin, readPosition: async () => undefined });
  button(e.root, 'Connections').click(); await fallback.drain();
  const fallbackFooter = e.root.querySelector('.m-related')!, fallbackOpen = fallbackFooter.querySelectorAll('button')[0], fallbackTitle = fallbackOpen.textContent;
  fallbackOpen.click(); await fallback.drain();
  assert.equal(externalOpens, 0); assert.equal(fallbackFooter.querySelector('h3')!.textContent, fallbackTitle);
  assert.match(fallbackFooter.textContent, /First passage shared with source/);
  const close = button(fallbackFooter, 'Close saved source'); close.focus();
  const preview = fallbackFooter.querySelector('.m-related-excerpt')!;
  assert.ok(preview.textContent.length <= 602);
  const previewReads = requests.length;
  await documentJournal(e.namespace, localPersistence(e.namespace).journal).change({ id: crypto.randomUUID(), kind: 'keep', threadId: crypto.randomUUID(), capture, anchor: anchor(15, 30) });
  // A real margin mutation must not rebuild the open Related snapshot or move its focus.
  button(e.root, 'Save page').click(); await fallback.drain();
  assert.equal(fallbackFooter.querySelector('.m-related-excerpt'), preview);
  assert.equal(e.document.activeElement, close); assert.equal(requests.length, previewReads);
  button(fallbackFooter, 'Open in Library').click();
  const localLibrary = e.root.querySelector('.m-local-library')!;
  assert.equal(localLibrary.hidden, false);
  assert.equal(e.document.activeElement, button(localLibrary, 'Close Library'));
  button(localLibrary, 'Close Library').click(); close.click(); assert.equal(fallbackFooter.querySelector('h3'), null); assert.equal(e.document.activeElement, fallbackOpen);
  fallback.destroy(); await fallback.drain();
});

test('related margin reports an unavailable helper quietly and discards late results after closing', async t => {
  const e = env(t); e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  replaceGlobals(t, { fetch: async () => { throw new Error('offline'); } });
  let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, readPosition: async () => undefined });
  await api.drain(); const firstFooter = e.root.querySelector('.m-related')!; assert.equal(firstFooter.textContent, '');
  button(e.root, 'Connections').click(); await api.drain(); assert.equal(firstFooter.textContent, 'Related passages need the app on this device.');
  api.destroy(); await api.drain();
  const pending = deferred<Response>(); replaceGlobals(t, { fetch: async () => pending.promise });
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, readPosition: async () => undefined });
  const footer = e.root.querySelector('.m-related')!; const toggle = button(e.root, 'Connections');
  assert.equal(footer.textContent, ''); toggle.click(); assert.equal(footer.textContent, 'Looking for related saved passages…'); toggle.click();
  pending.resolve(Response.json({ threads: [] })); await api.drain();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(footer.textContent, '');
  api.destroy(); await api.drain();
});

test('E38 cached correction warning names its ancestor and survives an older helper response with local controls intact', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace, true);
  const reply = cached(seeded.thread);
  reply.version.corrections = [{ ancestorId: 'ancestor', ancestorTitle: 'Earlier calculation', correctionId: 'corrected', correctedAt: capture.capturedAt }];
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, reply.source, [reply.version], [reply.view]);
  const older = structuredClone(reply.version); delete older.corrections;
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, reply.source, [older], [reply.view]);
  const records = await seeded.persistence.replies.list(seeded.thread.id);
  assert.equal(records[0].version.corrections?.[0].ancestorId, 'ancestor');
  assert.deepEqual(records[0].local, { parameters: { x: 1 }, view: {} });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  await api.drain();
  assert.match(e.root.textContent, /Earlier calculation.*was corrected by a later reply/);
  assert.match(e.root.textContent, /Original reader note/);
  assert.doesNotMatch(e.root.querySelector('.m-saved-replies')!.textContent, /ancestor|2026-09-17T/);
  api.destroy(); await api.drain();
});

for (const outcome of ['succeeded', 'cancelled', 'failed', 'outcome_unknown', 'cancelled-after-handoff']) {
  test(`activity record reads stored ${outcome} work without writes`, async t => {
    const e = env(t); await threadFixture(e.namespace, true);
    e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
    let hostContext: any, selection: any;
    const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: (_root, context) => {
      hostContext = context;
      return { open(value) { selection = value; }, setVisible() {}, destroy() {} };
    } });
    button(e.root, 'Ask about this note').click(); await api.drain(); button(e.root, 'Define it here').click(); await api.drain();
    hostContext.retainedQuestion({ ...selection, resumeJobId: 'stored-job' }); await api.drain();
    hostContext.onState({ phase: outcome === 'succeeded' ? 'committed' : outcome === 'outcome_unknown' ? 'unknown' : 'cancelled' });
    assert.equal(e.root.querySelector('.m-activity')!.hidden, false);
    const noSend = outcome === 'cancelled' || outcome === 'failed';
    const job = {
      id: 'stored-job', provider: 'app-server', model: 'recorded-model',
      state: outcome === 'cancelled-after-handoff' ? 'cancelled' : outcome,
      createdAt: '2026-09-18T09:00:00Z', updatedAt: '2026-09-18T09:01:00Z', preparedPayloadDigest: 'a'.repeat(64),
      latestAttemptId: 'attempt-1',
      attempts: [{ id: 'attempt-1', number: 1, handoffMarked: !noSend, dispatchClaimed: !noSend,
        ...(!noSend ? { startedAt: '2026-09-18T09:00:01Z', sentContent: [{ label: 'Question', text: 'two bytes', sha256: 'b'.repeat(64) }] } : {}) }],
      context: { outgoing: { question: 'The frozen question <script>', selection: { exact: 'Reviewed passage' }, availableCapabilities: ['samples', 'solver'] } },
    };
    const requests: { path: string; method: string; body: unknown }[] = [];
    replaceGlobals(t, { fetch: async (url: string, init: RequestInit) => {
      requests.push({ path: new URL(url).pathname, method: init.method!, body: init.body }); return Response.json(job);
    } });
    const writes: string[] = []; e.onWrite(async key => { writes.push(key); });
    button(e.root, 'Collapse').click();
    const dot = e.root.querySelector('.m-activity')!; dot.click();
    assert.match(dot.getAttribute('aria-label')!, /^Open What was sent:/);
    assert.equal(e.root.querySelector('.mg')!.classList.contains('is-collapsed'), false);
    const sheet = e.root.querySelector('[aria-label="What was sent"]')!;
    await until(() => sheet.textContent.includes('recorded-model'));
    assert.equal(sheet.hidden, false);
    for (const text of ['What was sent', 'app-server', 'recorded-model',  'samples, solver', job.preparedPayloadDigest, 'full reviewed text is no longer stored', 'The frozen question <script>', 'Reviewed passage']) assert.ok(sheet.textContent.includes(text), text);
    assert.equal(sheet.querySelectorAll('textarea,input,select,script').length, 0);
    assert.equal(sheet.textContent.includes('Nothing left this machine'), noSend);
    assert.doesNotMatch(sheet.textContent, /2026-09-18T/);
    assert.match(sheet.textContent, /2026/);
    assert.match(sheet.textContent, noSend ? /Unknown for this record\. No measurement is backfilled\./ : /9 UTF-8 bytes\. The reviewed content size is recorded\. Transmission size is unmeasured\./);
    assert.match(sheet.textContent, noSend ? /No durable provider handoff is recorded\./ : /Provider handoffRecorded in the durable attempt record\./);
    assert.match(sheet.textContent, /Observed transmissionNot observed\. This record can establish provider handoff\. Transmission evidence is unavailable\./);
    if (outcome === 'succeeded') assert.match(sheet.textContent, /Ready/);
    if (outcome === 'outcome_unknown') assert.match(sheet.textContent, /Outcome unconfirmed/);
    assert.deepEqual(requests, [{ path: '/api/read/jobs/stored-job', method: 'POST', body: '{}' }]);
    assert.deepEqual(writes, []);
    sheet.fire('keydown', { key: 'Escape' }); assert.equal(sheet.hidden, true); assert.equal(e.document.activeElement, dot);
    dot.click(); await until(() => sheet.textContent.includes('recorded-model'));
    button(sheet, 'Close').click(); assert.equal(sheet.hidden, true); assert.deepEqual(writes, []);
    api.destroy(); await api.drain();
  });
}

test('collapsed saved-work dot identifies and opens its thread without sending', async t => {
  const e = env(t); await threadFixture(e.namespace);
  replaceGlobals(t, { matchMedia: (query: string) => ({ matches: query === '(max-width: 899px)' }) });
  let asks = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false,
    asking: () => { asks++; return { open() {}, setVisible() {}, destroy() {} }; } });
  button(e.root, 'Collapse').click();
  const dots = e.root.querySelectorAll('.m-rail-thread');
  assert.equal(dots.length, 1);
  const dot = dots[0];
  assert.match(dot.getAttribute('aria-label')!, /^Open saved thread:/);
  dot.focus(); dot.click();
  await until(() => e.root.querySelector('.mg')!.classList.contains('is-collapsed') === false);
  assert.equal(e.document.activeElement, e.root.querySelector('.m-note'));
  e.root.fire('keydown', { key: 'Escape' });
  assert.equal(e.document.activeElement, dot);
  assert.equal(asks, 0);
  api.destroy(); await api.drain();
});

test('sending status follows the durable record rather than asking-flow state', async t => {
  const e = env(t); await threadFixture(e.namespace, true);
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  let context: any, selection: any;
  const job = { id: 'record-job', provider: 'app-server', model: 'recorded-model', state: 'sending', latestAttemptId: 'attempt-1',
    attempts: [{ id: 'attempt-1', handoffMarked: true, dispatchClaimed: true, sentContent: [{ label: 'Question', text: 'é', sha256: 'b'.repeat(64) }] }] };
  const reads: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { reads.push(new URL(url).pathname); return Response.json(job); } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: (_root, value) => {
    context = value; return { open(current) { selection = current; }, setVisible() {}, destroy() {} };
  } });
  button(e.root, 'Ask about this note').click(); await api.drain(); button(e.root, 'Define it here').click(); await api.drain();
  context.activity({ phase: 'sending', sending: true });
  assert.equal(e.root.querySelector('.m-activity')!.textContent, 'Working');
  assert.equal(e.root.querySelector('.m-activity')!.dataset.sending, 'false');
  context.retainedQuestion({ ...selection, resumeJobId: job.id });
  context.activity({ phase: 'sending', sending: true });
  await until(() => e.root.querySelector('.m-activity')!.textContent === 'Request passed to Codex');
  assert.equal(e.root.querySelector('.m-activity')!.dataset.sending, 'false');
  assert.deepEqual(reads.filter(path => path.startsWith('/api/read/jobs/')), ['/api/read/jobs/record-job']);
  assert.deepEqual(egressMeasurements(job as any), { reviewedBytes: 2, handoffRecorded: true, observedSentBytes: null, transmissionObserved: false });
  api.destroy(); await api.drain();
});
test('reading-position editor is connected, anchored and single-map across save failure, collapse and suspend', async t => {
  const e = env(t); const api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false });
  button(e.root, 'Settings').click(); assert.equal(e.root.querySelectorAll('button').some(node => node.textContent === 'Retry saving'), false, 'clean hydrated settings do not claim recovery is needed'); button(e.root, 'Close settings').click();
  api.setReadingPosition(21); const write = button(e.root, 'Write here\u2026'); write.focus();
  const field = e.root.querySelector('[aria-label="Your note"]')!; field.value = 'Frozen text?'; field.fire('input'); field.setSelectionRange(2, 5); field.scrollTop = 13;
  const compose = e.root.querySelector('.m-compose')!, before = e.root.querySelector('.m-reading')!;
  assert.ok(compose.parentElement!.children.indexOf(compose) > compose.parentElement!.children.indexOf(before));
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

test('narrow margin stays open through hydration and Escape returns focus to its opener', async t => {
  const e = env(t);
  replaceGlobals(t, { matchMedia: (query: string) => ({ matches: query === '(max-width: 899px)' }) });
  const mounting = mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  const shell = e.root.querySelector('.mg')!;
  assert.equal(shell.classList.contains('is-collapsed'), true);
  const opener = button(e.root, 'Open margin'); opener.focus(); opener.click();
  assert.equal(shell.classList.contains('is-collapsed'), false);
  const api = await mounting;
  assert.equal(shell.classList.contains('is-collapsed'), false, 'late hydration must not undo the reader action');
  assert.equal(e.document.activeElement, button(e.root, 'Collapse'));
  e.root.fire('keydown', { key: 'Escape' });
  assert.equal(shell.classList.contains('is-collapsed'), true);
  assert.equal(e.document.activeElement, opener);
  const railDot = e.root.querySelector('.m-segment')!; railDot.focus(); railDot.click();
  assert.equal(shell.classList.contains('is-collapsed'), false, 'a rail dot must not close the sheet it just opened');
  assert.equal(e.document.activeElement, button(e.root, 'Collapse'));
  e.root.fire('keydown', { key: 'Escape' });
  assert.equal(e.document.activeElement, railDot);
  api.destroy(); await api.drain();
});

test('local Library skips a hidden history action when opening and returns focus', async t => {
  const e = env(t);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  const hiddenHistory = e.root.querySelector('.m-footer-history button')!;
  assert.equal(hiddenHistory.hidden, true);
  const opener = button(e.root, 'Library'); opener.focus(); opener.click();
  const localLibrary = e.root.querySelector('.m-local-library')!;
  assert.equal(localLibrary.hidden, false);
  assert.equal(e.document.activeElement, button(localLibrary, 'Close Library'));
  assert.notEqual(e.document.activeElement, hiddenHistory);
  button(localLibrary, 'Close Library').click();
  assert.equal(e.document.activeElement, opener);
  api.destroy(); await api.drain();
});

test('Library keeps page work accessible locally and uses the host route when supplied', async t => {
  const e = env(t);
  let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  button(e.root, 'Library').click();
  assert.equal(e.root.querySelector('.m-local-library')!.hidden, false);
  button(e.root, 'Close Library').click();
  assert.equal(e.document.activeElement, button(e.root, 'Library'));
  api.destroy(); await api.drain();

  let opens = 0;
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, onLibrary: () => { opens++; } });
  button(e.root, 'Library').click();
  assert.equal(opens, 1);
  api.destroy(); await api.drain();
});

test('bottom availability keeps local paths actionable and explains unavailable related passages', async t => {
  const e = env(t), requests: string[] = []; let libraryOpens = 0;
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected outbound request'); } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, onLibrary: () => { libraryOpens++; } });
  const footer = e.root.querySelector('.m-footer')!;
  assert.doesNotMatch(footer.textContent, /0 threads on this page/);
  assert.doesNotMatch(footer.textContent, /Related passages need the app on this device\./);
  assert.match(e.root.querySelector('.m-settings')!.textContent, /Hear it needs a local voice\./);
  assert.equal(e.root.querySelector('.m-footer-voice')!.children.length, 0);
  assert.equal(Array.from(footer.querySelectorAll('button')).some(node => node.textContent === 'Connections'), true);
  button(footer, 'Connections').click(); assert.match(footer.textContent, /Related passages need the app on this device\./);
  assert.equal(e.root.querySelectorAll('audio,video').length, 0);

  button(e.root, 'Library').click();
  api.select(anchor()); button(e.root, 'Keep').click(); await api.drain();
  // Read later is a page action now. A kept passage is saved for later on its own card.
  api.select(anchor(15, 30)); button(e.root, 'Keep').click(); await api.drain();
  const card = e.root.querySelectorAll('[data-thread]').find(node => node.textContent.includes(anchor(15, 30).exact))!;
  const parked = card.querySelector('[aria-label="Thread state"]')!;
  parked.value = 'parked'; parked.fire('change'); await api.drain();

  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(libraryOpens, 1);
  assert.equal(state.threads.length, 2);
  assert.equal(state.threads.find(thread => thread.anchor.exact === anchor().exact)?.state, 'open');
  assert.equal(state.threads.find(thread => thread.anchor.exact === anchor(15, 30).exact)?.state, 'parked');
  assert.deepEqual(requests, []);
  api.destroy(); await api.drain();
});

test('stored reading anchor restores quietly and an unresolved anchor keeps the current section fallback', async t => {
  const e = env(t), restored = anchor(21, 30), navigated: unknown[] = [], writes: unknown[] = [];
  let api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false,
    positionDebounceMs: 10, readPosition: async () => restored, writePosition: async value => { writes.push(value); }, onSource: value => { navigated.push(value); } });
  assert.equal(e.root.querySelector('.m-reading')!.textContent.includes('Second'), true);
  const resume = button(e.root, 'You were here');
  assert.equal(resume.classList.contains('m-meta'), true);
  assert.equal(resume.parentElement, e.root.querySelector('.m-head'), 'the top-zone cue remains outside the following margin scroller');
  assert.deepEqual(navigated, [restored]);
  assert.deepEqual(writes, [], 'restoring never writes the value back');
  api.setReadingPosition(15); await new Promise(resolve => setTimeout(resolve, 20)); await api.drain();
  assert.deepEqual(writes, [], 'the host section fallback cannot overwrite a precise restored anchor');
  resume.click();
  assert.deepEqual(navigated, [restored, restored], 'the resume line navigates to the precise restored anchor');
  assert.equal(e.root.querySelectorAll('.m-resume').length, 0, 'one interaction dismisses the resume line');
  api.destroy(); await api.drain();

  const missing = { exact: 'not on this page', prefix: '', suffix: '', start: 0, end: 16 };
  api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false,
    readPosition: async () => missing, onSource: value => { navigated.push(value); } });
  assert.equal(e.root.querySelector('.m-reading')!.textContent.includes('First'), true);
  assert.deepEqual(navigated, [restored, restored]);
  assert.equal(e.root.querySelectorAll('.m-resume').length, 0);
  api.destroy(); await api.drain();
});

test('resume line is absent on a fresh or top-restored page and clears after reading past it', async t => {
  const e = env(t);
  let api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false,
    readPosition: async () => undefined });
  assert.equal(e.root.querySelectorAll('.m-resume').length, 0);
  api.destroy(); await api.drain();

  api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false,
    readPosition: async () => anchor() });
  assert.equal(e.root.querySelectorAll('.m-resume').length, 0);
  api.destroy(); await api.drain();

  api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false,
    readPosition: async () => anchor(21, 30) });
  assert.equal(e.root.querySelectorAll('.m-resume').length, 1);
  api.setReadingPosition(22);
  assert.equal(e.root.querySelectorAll('.m-resume').length, 0, 'scrolling beyond the restored anchor dismisses the line');
  api.destroy(); await api.drain();
});

test('a margin interaction dismisses the resume line without navigating or sending', async t => {
  const e = env(t), navigated: unknown[] = [];
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false,
    readPosition: async () => anchor(21, 30), onSource: value => navigated.push(value) });
  button(e.root, 'Settings').click();
  assert.equal(e.root.querySelectorAll('.m-resume').length, 0);
  assert.equal(navigated.length, 1, 'only the existing startup restore navigated');
  api.destroy(); await api.drain();
});

test('standalone source scrolling past the restored section dismisses the resume line', async t => {
  const e = env(t), source = e.document.createElement('article');
  const blocks = capture.sections!.map((_section, index) => {
    const block = e.document.createElement('p'); block.dataset.readingSection = String(index);
    block.offsetTop = index * 1000; source.append(block); return block;
  });
  e.document.body.append(source);
  const api = await mountMargin(asHost(e.root), { capture, sourceRoot: asHost(source), storageName: e.namespace,
    allowHelper: false, readPosition: async () => anchor(21, 30) });
  assert.equal(e.root.querySelectorAll('.m-resume').length, 1);
  blocks[2].offsetTop = 0;
  (window as unknown as typeof e.root).fire('scroll');
  assert.equal(e.root.querySelectorAll('.m-resume').length, 0);
  api.destroy(); await api.drain();
});

test('standalone same-section scroll keeps resume before the anchor and dismisses only after its first character passes the viewport', async t => {
  const e = env(t), source = e.document.createElement('article'), texts: ReturnType<typeof e.document.createTextNode>[] = [];
  const blocks = capture.sections!.map((section, index) => {
    const block = e.document.createElement('p'), text = e.document.createTextNode(capture.text.slice(section.start, section.end));
    block.dataset.readingSection = String(index); block.offsetTop = (index - 1) * 1000;
    block.append(text); source.append(block); texts.push(text); return block;
  });
  e.document.body.append(source);
  let anchorBottom = 120, measured = 0;
  Object.assign(e.document, {
    createTreeWalker() { let index = 0; return { nextNode: () => texts[index++] ?? null }; },
    createRange() {
      return { startContainer: texts[0], startOffset: 0, endOffset: 0,
        setStart(node: typeof texts[number], offset: number) { this.startContainer = node; this.startOffset = offset; },
        setEnd(_node: typeof texts[number], offset: number) { this.endOffset = offset; },
        getClientRects() {
          assert.equal(this.startContainer, texts[1]); assert.equal(this.startOffset, 6, 'global restored offset 21 is offset 6 in section starting at 15');
          assert.equal(this.endOffset, 7, 'measure the first character, not the end of a multi-line quote');
          measured++; return [{ top: anchorBottom - 18, bottom: anchorBottom }];
        },
      };
    },
  });
  replaceGlobals(t, { NodeFilter: { SHOW_TEXT: 4 } });
  const navigated: unknown[] = [], writes: unknown[] = [];
  const api = await mountMargin(asHost(e.root), { capture, sourceRoot: asHost(source), storageName: e.namespace,
    allowHelper: false, readPosition: async () => anchor(21, 30), onSource: value => navigated.push(value),
    writePosition: async value => { writes.push(value); } });
  const scroll = () => (window as unknown as typeof e.root).fire('scroll');
  scroll();
  assert.equal(e.root.querySelectorAll('.m-resume').length, 1, 'before offset 21 the cue stays visible');
  anchorBottom = 1; scroll();
  assert.equal(e.root.querySelectorAll('.m-resume').length, 1, 'partly visible first character is not past the anchor');
  anchorBottom = -1; scroll();
  assert.equal(blocks[1].offsetTop, 0, 'still in the same section starting at 15');
  assert.equal(e.root.querySelectorAll('.m-resume').length, 0, 'the viewport passed offset 21 inside the same section');
  assert.equal(measured, 3); assert.equal(navigated.length, 1); assert.deepEqual(writes, []);
  assert.equal(source.textContent, capture.text, 'source remains unchanged');
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
  button(e.root, 'Write here\u2026').click(); assert.equal(e.root.querySelector('[aria-label="Your note"]')!.readOnly, true);
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
  button(e.root, 'Sync').click(); await api.drain(); assert.deepEqual(paths, ['/api/read/replies']); assert.doesNotMatch(e.root.textContent, /different source version/);
  api.destroy(); await api.drain(); channel.close();
});
test('saved replies receive intent capabilities and solver only at the paired recompute gate', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace);
  const replies = [cached(seeded.thread, 'evidence', 'evidence'), cached(seeded.thread, 'explore', 'explore'), cached(seeded.thread, 'define', 'define')];
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, replies[0].source, replies.map(item => item.version), replies.map(item => item.view));
  boundaries.replyMounts.length = 0;
  let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  await until(() => boundaries.replyMounts.length === 3);
  assert.match(e.root.textContent, /This example cannot run again here yet\. Your notes and current inputs are unchanged\./);
  assert.doesNotMatch(e.root.textContent, /Saved-solver execution is not connected/);
  assert.deepEqual(Object.fromEntries(boundaries.replyMounts.map(item => [item.intent, item.capabilities])), {
    evidence: ['samples', 'network.citations'], explore: ['samples', 'network.shelf'], define: ['samples'],
  });
  api.destroy(); await api.drain();

  boundaries.replyMounts.length = 0;
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace });
  await until(() => boundaries.replyMounts.length === 3);
  assert.match(e.root.textContent, /Permission is needed before this example can run again\. Your notes and current inputs are unchanged\./);
  api.destroy(); await api.drain();

  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) }); boundaries.replyMounts.length = 0;
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: e.document.location.origin });
  await until(() => boundaries.replyMounts.length === 3);
  assert.ok(boundaries.replyMounts.every(item => item.capabilities?.at(-1) === 'solver'));
  assert.doesNotMatch(e.root.textContent, /cannot run again here yet|Permission is needed before this example can run again/);
  api.destroy(); await api.drain();
});
test('embedded margin never reads a pairing credential or exposes management/privileged dispatch', async t => {
  const e = env(t), reads: string[] = []; e.onRead(async key => { reads.push(key); }); e.data(e.namespace).set('pairing', { token: 'must-not-read' });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, helperManagement: true });
  assert.equal(reads.includes('pairing'), false); for (const name of ['Pair', 'Disconnect', 'Show pairing code', 'Refresh browser list']) assert.equal(e.root.querySelectorAll('button').some(n => n.textContent === name), false);
  api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain(); const question = e.root.querySelector('[aria-label="Your question"]')!; question.value = 'Why?'; question.fire('input');
  button(e.root, 'Define it here').click(); await api.drain(); assert.equal(reads.includes('pairing'), false); api.destroy(); await api.drain();
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
test('selection and typing send nothing; unpaired choices stay drafts and a closed draft stays in history', async t => {
  const e = env(t); let opens = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: () => ({ open() { opens++; }, setVisible() {}, destroy() {} }) });
  api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
  const q = e.root.querySelector('[aria-label="Your question"]')!; q.value = 'My question'; q.fire('input'); await api.drain();
  assert.equal(opens, 0); assert.equal((e.data(e.namespace).get('journal') as JournalState | undefined)?.pending.length ?? 0, 0);
  button(e.root, 'Define it here').click(); await api.drain();
  let journal = e.data(e.namespace).get('journal') as JournalState | undefined;
  assert.equal(journal?.threads.length ?? 0, 0); assert.equal(journal?.pending.length ?? 0, 0); assert.equal(opens, 0);
  button(e.root, 'Define it here').click(); await api.drain();
  journal = e.data(e.namespace).get('journal') as JournalState | undefined; assert.equal(journal?.threads.length ?? 0, 0); assert.equal(journal?.pending.length ?? 0, 0);
  const retained = [...e.data(e.namespace)].filter(([key]) => key.startsWith('question:draft:'));
  assert.equal(retained.length, 1); assert.equal((retained[0][1] as any).anchor.start, 0); assert.equal((retained[0][1] as any).question, 'Define it here in this passage.');
  e.root.querySelector('.m-question')!.fire('keydown', { key: 'Escape' });
  button(e.root.querySelector('.m-selection')!, 'Ask').click(); await api.drain();
  const history = [...e.data(e.namespace)].filter(([key]) => key.startsWith('question-history:'));
  assert.equal(history.length, 1); assert.equal((history[0][1] as any).question, 'Define it here in this passage.');
  api.destroy(); await api.drain();
});

test('Keep closes selection and the kept item Highlight preserves source-node identity and reader work', async t => {
  const e = env(t), source = e.document.createElement('article'), sourceText = e.document.createTextNode(capture.text);
  source.append(sourceText); e.document.body.prepend(source);
  const registered = new Map<string, { ranges: unknown[] }>();
  class TestHighlight { ranges: unknown[]; constructor(...ranges: unknown[]) { this.ranges = ranges; } }
  (e.document as any).createTreeWalker = () => { let walked = false; return { nextNode: () => walked ? null : (walked = true, sourceText) }; };
  (e.document as any).createRange = () => ({ setStart() {}, setEnd() {} });
  replaceGlobals(t, { CSS: { highlights: registered }, NodeFilter: { SHOW_TEXT: 4 }, window: Object.assign(globalThis.window, { Highlight: TestHighlight }) });
  const projections: { anchor: unknown; highlighted: boolean; highlightColour?: string }[][] = [];
  const api = await mountMargin(asHost(e.root), { capture, sourceRoot: asHost(source), storageName: e.namespace, allowHelper: false, onSavedMarks: marks => { projections.push(marks); } });
  const selected = anchor();
  api.select(selected);
  button(e.root, 'Keep').click(); await api.drain();
  let state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads[0].highlighted, false);
  assert.equal(e.root.querySelector('.m-selection')!.hidden, true);
  assert.equal(source.childNodes[0], sourceText);

  const selectionHighlight = button(e.root, 'Highlight');
  selectionHighlight.click(); await api.drain();
  state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads[0].highlighted, true);
  assert.equal(projections.at(-1)![0].highlighted, true);
  assert.equal(state.threads[0].highlightColour, undefined);
  assert.equal(registered.get('marginalia-highlighted-yellow')!.ranges.length, 1);
  assert.equal(registered.get('marginalia-highlighted-green')!.ranges.length, 0);
  const green = e.root.querySelector('[aria-label="Green"]')!; assert.equal(green.getAttribute('aria-pressed'), 'false');
  green.click(); await api.drain();
  state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads[0].highlightColour, 'green');
  assert.equal(registered.get('marginalia-highlighted-yellow')!.ranges.length, 0);
  assert.equal(registered.get('marginalia-highlighted-green')!.ranges.length, 1);
  assert.deepEqual(state.pending.map(change => change.kind), ['keep', 'highlight', 'highlight']);
  assert.equal(source.childNodes[0], sourceText);

  button(e.root, 'Remove highlight').click(); await api.drain();
  state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads[0].highlighted, false);
  assert.equal(projections.at(-1)![0].highlighted, false);
  assert.equal(state.threads[0].deletedAt, null);
  assert.equal(source.childNodes[0], sourceText);
  assert.equal(source.textContent, capture.text);
  api.destroy(); await api.drain();
  assert.deepEqual(projections.at(-1), []);
});

test('a replacement selection keeps or switches a note draft only after the explicit choice and survives reopen', async t => {
  const e = env(t), { journal } = await threadFixture(e.namespace); let askingMounts = 0;
  let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false,
    asking: () => { askingMounts++; return { open() {}, setVisible() {}, destroy() {} }; } });
  button(e.root, 'Edit note').click();
  let field = e.root.querySelector('[aria-label="Your note"]')!;
  field.value = 'Exact revised note text'; field.fire('input'); await api.drain();

  const original = anchor(), replacement = anchor(15, 30), originalRevision = journal.state.threads[0].notes[0].revision;
  api.select(replacement);
  let choice = e.root.querySelector('.m-selection')!;
  assert.equal(choice.textContent, 'Attach to the new passage?KeepSwitch');
  assert.deepEqual(choice.querySelectorAll('button').map(node => node.textContent), ['Keep', 'Switch']);
  let stored = [...e.data(e.namespace)].find(([key]) => key.startsWith('draft:'))![1] as any;
  assert.deepEqual(stored.anchor, original); assert.equal(stored.text, field.value); assert.equal(stored.revision, originalRevision);
  button(choice, 'Keep').click(); await api.drain();
  stored = [...e.data(e.namespace)].find(([key]) => key.startsWith('draft:'))![1] as any;
  assert.deepEqual(stored.anchor, original); assert.equal(stored.text, field.value); assert.equal(stored.revision, originalRevision);

  api.destroy(); await api.drain();
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false,
    asking: () => { askingMounts++; return { open() {}, setVisible() {}, destroy() {} }; } });
  field = e.root.querySelector('[aria-label="Your note"]')!;
  assert.equal(field.value, 'Exact revised note text'); assert.match(e.root.textContent, /Note on "First · passage\."/);
  api.select(replacement); choice = e.root.querySelector('.m-selection')!; button(choice, 'Switch').click(); await api.drain();
  stored = [...e.data(e.namespace)].find(([key]) => key.startsWith('draft:'))![1] as any;
  assert.deepEqual(stored.anchor, replacement); assert.deepEqual(stored.source, capture); assert.equal(stored.text, 'Exact revised note text');
  assert.equal(stored.threadId, undefined); assert.equal(stored.noteId, undefined); assert.equal(stored.revision, undefined);
  assert.equal(journal.state.threads[0].anchor.start, original.start); assert.equal(journal.state.threads[0].notes[0].text, 'Exact revised note text');

  api.destroy(); await api.drain();
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false,
    asking: () => { askingMounts++; return { open() {}, setVisible() {}, destroy() {} }; } });
  assert.equal(e.root.querySelector('[aria-label="Your note"]')!.value, 'Exact revised note text');
  assert.match(e.root.textContent, /Note on "Second · passage\."/); assert.equal(askingMounts, 0);
  api.destroy(); await api.drain();
});

test('a replacement selection keeps or switches a question draft locally with exact context across reopen', async t => {
  const e = env(t); let askingMounts = 0;
  const options = { capture, storageName: e.namespace, allowHelper: false,
    asking: () => { askingMounts++; return { open() {}, setVisible() {}, destroy() {} }; } };
  let api = await mountMargin(asHost(e.root), options);
  const original = anchor(), replacement = anchor(15, 30);
  api.select(original); button(e.root.querySelector('.m-selection')!, 'Ask').click(); await api.drain();
  let question = e.root.querySelector('[aria-label="Your question"]')!, context = e.root.querySelector('[aria-label="Context to attach"]')!;
  question.value = 'Exact retained question?'; question.fire('input'); context.value = 'Exact reader context'; context.fire('input'); await api.drain();

  api.select(replacement);
  let choice = e.root.querySelector('.m-selection')!;
  assert.equal(choice.textContent, 'Attach to the new passage?KeepSwitch');
  assert.deepEqual(choice.querySelectorAll('button').map(node => node.textContent), ['Keep', 'Switch']);
  button(choice, 'Keep').click(); await api.drain();
  let stored = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as any;
  assert.deepEqual(stored.anchor, original); assert.equal(stored.question, question.value); assert.equal(stored.context, context.value);

  api.destroy(); await api.drain(); api = await mountMargin(asHost(e.root), options);
  button(e.root, 'Return to retained question').click(); await api.drain();
  question = e.root.querySelector('[aria-label="Your question"]')!; context = e.root.querySelector('[aria-label="Context to attach"]')!;
  assert.equal(question.value, 'Exact retained question?'); assert.equal(context.value, 'Exact reader context');
  assert.equal(e.root.querySelector('.m-question blockquote')!.textContent, original.exact);
  api.select(replacement); choice = e.root.querySelector('.m-selection')!; button(choice, 'Switch').click(); await api.drain();
  stored = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as any;
  assert.deepEqual(stored.anchor, replacement); assert.deepEqual(stored.capture, capture);
  assert.equal(stored.question, 'Exact retained question?'); assert.equal(stored.context, 'Exact reader context');
  assert.equal(e.root.querySelector('.m-question blockquote')!.textContent, replacement.exact);

  api.destroy(); await api.drain(); api = await mountMargin(asHost(e.root), options);
  button(e.root, 'Return to retained question').click(); await api.drain();
  assert.equal(e.root.querySelector('.m-question blockquote')!.textContent, replacement.exact);
  assert.equal(e.root.querySelector('[aria-label="Your question"]')!.value, 'Exact retained question?');
  assert.equal(e.root.querySelector('[aria-label="Context to attach"]')!.value, 'Exact reader context');
  assert.equal(askingMounts, 0);
  api.destroy(); await api.drain();
});

test('a failed note Switch keeps the visible B draft, retries explicitly, and reopens on B', async t => {
  const e = env(t); let failDraftWrites = false;
  e.onWrite(async key => { if (failDraftWrites && key.startsWith('draft:')) throw new Error('draft quota'); });
  let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  const original = anchor(), replacement = anchor(15, 30);
  api.select(original); button(e.root, 'Write here\u2026').click();
  let field = e.root.querySelector('[aria-label="Your note"]')!; field.value = 'Exact note after failed switch'; field.fire('input'); await api.drain();
  failDraftWrites = true; api.select(replacement); button(e.root.querySelector('.m-selection')!, 'Switch').click(); await api.drain();
  field = e.root.querySelector('[aria-label="Your note"]')!;
  assert.equal(field.value, 'Exact note after failed switch'); assert.match(e.root.textContent, /Note on "Second · passage\."/); assert.match(e.root.textContent, /draft quota/);
  field.value = 'Exact note edited after failed switch'; field.fire('input'); await api.drain();
  button(e.root, 'Settings').click(); assert.ok(e.root.querySelectorAll('button').some(node => node.textContent === 'Retry saving'));
  failDraftWrites = false; button(e.root, 'Retry saving').click(); await api.drain();
  const stored = [...e.data(e.namespace)].find(([key]) => key.startsWith('draft:'))![1] as any;
  assert.deepEqual(stored.anchor, replacement); assert.equal(stored.text, 'Exact note edited after failed switch');
  api.destroy(); await api.drain(); api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  field = e.root.querySelector('[aria-label="Your note"]')!; assert.equal(field.value, 'Exact note edited after failed switch'); assert.match(e.root.textContent, /Note on "Second · passage\."/);
  api.destroy(); await api.drain();
});

test('a failed question Switch keeps the visible B draft, retries explicitly, and reopens on B', async t => {
  const e = env(t); let failQuestionWrites = false;
  e.onWrite(async key => { if (failQuestionWrites && key.startsWith('question:')) throw new Error('question quota'); });
  let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  const original = anchor(), replacement = anchor(15, 30);
  api.select(original); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
  let question = e.root.querySelector('[aria-label="Your question"]')!, context = e.root.querySelector('[aria-label="Context to attach"]')!;
  question.value = 'Exact question after failed switch?'; question.fire('input'); context.value = 'Exact context after failed switch'; context.fire('input'); await api.drain();
  failQuestionWrites = true; api.select(replacement); button(e.root.querySelector('.m-selection')!, 'Switch').click(); await api.drain();
  question = e.root.querySelector('[aria-label="Your question"]')!; context = e.root.querySelector('[aria-label="Context to attach"]')!;
  assert.equal(question.value, 'Exact question after failed switch?'); assert.equal(context.value, 'Exact context after failed switch');
  assert.equal(e.root.querySelector('.m-question blockquote')!.textContent, replacement.exact); assert.match(e.root.textContent, /question quota/);
  question.value = 'Exact question edited after failed switch?'; question.fire('input'); await api.drain();
  button(e.root, 'Settings').click(); assert.ok(e.root.querySelectorAll('button').some(node => node.textContent === 'Retry saving'));
  failQuestionWrites = false; button(e.root, 'Retry saving').click(); await api.drain();
  const stored = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as any;
  assert.deepEqual(stored.anchor, replacement); assert.equal(stored.question, 'Exact question edited after failed switch?'); assert.equal(stored.context, 'Exact context after failed switch');
  api.destroy(); await api.drain(); api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  button(e.root, 'Return to retained question').click(); await api.drain(); question = e.root.querySelector('[aria-label="Your question"]')!; context = e.root.querySelector('[aria-label="Context to attach"]')!;
  assert.equal(question.value, 'Exact question edited after failed switch?'); assert.equal(context.value, 'Exact context after failed switch'); assert.equal(e.root.querySelector('.m-question blockquote')!.textContent, replacement.exact);
  api.destroy(); await api.drain();
});
test('explicit helper review invokes injected T08 only for acknowledged context; closing retains its question', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace, true); e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  let hostContext: any, selected: any, destroyed = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: (_root, context) => { hostContext = context; return { open(selection) { selected = selection; context.activity?.({ phase: 'working', sending: false, elapsedSeconds: 31 }); }, setVisible() {}, destroy() { destroyed++; } }; } });
  button(e.root, 'Ask about this note').click(); await api.drain(); const field = e.root.querySelector('[aria-label="Your question"]')!; field.value = 'Explain my note'; field.fire('input');
  button(e.root, 'Define it here').click(); await api.drain(); assert.equal(selected?.answeredNote.text, 'Original reader note'); assert.equal(selected?.sourceVersionId, 'source');
  assert.equal(e.root.querySelector('.m-question')!.parentElement!.className, 'm-reply-frame-body');
  assert.equal(e.root.querySelector('.m-thread-content .m-note')!.textContent, 'Original reader note', 'reader notes remain intact in home while the reply owns the margin');
  assert.equal(e.root.querySelector('.m-activity')!.dataset.sending, 'false'); assert.match(e.root.querySelector('.m-activity')!.getAttribute('aria-label')!, /31 seconds/);
  hostContext.retainedQuestion({ ...selected, question: 'More precise retained question' }); e.root.querySelector('.m-question')!.fire('keydown', { key: 'Escape' }); await api.drain(); assert.equal(destroyed, 1);
  api.destroy(); await api.drain(); assert.equal(seeded.journal.state.pending.length, 0);
});
test('removing a note hides only the note and undo restores it without disturbing its thread or replies', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace, true), reply = cached(seeded.thread);
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, reply.source, [reply.version], [reply.view]);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  await until(() => !!e.root.querySelector('[aria-label="Controlled reply input"]'));
  const replyControl = e.root.querySelector('[aria-label="Controlled reply input"]')!;
  button(e.root, 'Remove this note').click(); await api.drain();
  assert.doesNotMatch(e.root.textContent, /Original reader note/);
  assert.match(e.root.textContent, /First passage/);
  assert.equal(e.root.querySelector('[data-thread="thread"]') !== null, true);
  assert.equal(e.root.querySelector('[aria-label="Controlled reply input"]'), replyControl);
  assert.match(e.root.textContent, /Note removed\.Undo/);
  button(e.root, 'Undo').click(); await api.drain();
  assert.match(e.root.textContent, /Original reader note/);
  assert.doesNotMatch(e.root.querySelector('.m-saved-replies')!.textContent, /ancestor|2026-09-17T/);
  assert.equal(e.root.querySelector('[data-thread="thread"]') !== null, true);
  assert.equal(e.root.querySelector('[aria-label="Controlled reply input"]'), replyControl);
  api.destroy(); await api.drain();
});
test('map encodes distinct lengths, density, marks/current position and line/tick/focus sizes', async t => {
  const e = env(t), { thread } = await threadFixture(e.namespace);
  const second = { ...thread, id: 'second', anchor: anchor(15, 30), notes: [] }, third = { ...thread, id: 'third', anchor: anchor(31, 44), notes: [] };
  const states = sectionMapState(capture.sections!, [thread, second, third], capture, 1);
  assert.deepEqual(states.map(s => s.marks), [1, 1, 1]); assert.deepEqual(states.map(s => s.notes), [1, 0, 0]); assert.equal(states[1].length, 16); assert.equal(states[1].current, true);
  assert.deepEqual([0, 1, 2, -1].map(section => marginItemSize(section, 0, false, false)), ['full', 'line', 'tick', 'full']); assert.equal(marginItemSize(2, 0, false, true), 'full');
});

test('opening a thread collapses the previous one and restores only on the same page', async t => {
  const e = env(t), persistence = localPersistence(e.namespace), journal = documentJournal(e.namespace, persistence.journal);
  await journal.change({ id: 'keep-a', kind: 'keep', threadId: 'thread-a', capture, anchor: anchor(15, 30), note: 'Thread A' });
  await journal.change({ id: 'keep-b', kind: 'keep', threadId: 'thread-b', capture, anchor: anchor(31, 44), note: 'Thread B' });
  const size = (id: string) => e.root.querySelector(`[data-thread="${id}"]`)!.dataset.size;
  let api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false });
  const first = button(e.root, 'Thread A'); first.focus(); first.click(); await settle(); assert.equal(size('thread-a'), 'full');
  const second = button(e.root, 'Thread B'); second.focus(); second.click();
  assert.equal(size('thread-a'), 'full'); assert.equal(size('thread-b'), 'full');
  await api.drain(); api.destroy(); await api.drain();

  api = await mountMargin(asHost(e.root), { capture, sections: capture.sections, storageName: e.namespace, allowHelper: false });
  assert.equal(size('thread-a'), 'full'); assert.equal(size('thread-b'), 'full');
  api.destroy(); await api.drain();

  const otherPage = { ...capture, url: 'https://example.org/b' };
  const otherState = structuredClone(e.data(e.namespace).get('journal')) as JournalState;
  for (const thread of otherState.threads) thread.sourceUrl = otherPage.url;
  e.data(e.namespace).set('journal', otherState);
  api = await mountMargin(asHost(e.root), { capture: otherPage, sections: otherPage.sections, storageName: e.namespace, allowHelper: false });
  assert.equal(size('thread-b'), 'full');
  api.destroy(); await api.drain();
});

test('end-of-page actions prepare explicit drafts and cannot replace an existing question or send', async t => {
  const e = env(t); let opened = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: () => ({ open() { opened++; }, setVisible() {}, destroy() {} }) });
  api.setReadingPosition(capture.text.length); button(e.root, 'Go further').click(); await api.drain(); const field = e.root.querySelector('[aria-label="Your question"]')!; assert.match(field.value, /further reading/);
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

for (const [label, intent, question] of [
  ['Simulate it', 'simulate', 'Simulate this passage.'],
  ['Check this claim', 'evidence', 'Check this claim in this passage.'],
  ['Give an example', 'instantiate', 'Give an example in this passage.'],
  ['Show the steps', 'derive', 'Show the steps in this passage.'],
  ['See it', 'diagram', 'See it in this passage.'],
] as const) {
  test(`${label} saves a selection draft without opening asking or sending`, async t => {
    const e = env(t), requests: string[] = []; let opened = 0;
    replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected outbound request'); } });
    const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace,
      asking: () => ({ open() { opened++; }, setVisible() {}, destroy() {} }) });
    // The selection card now carries its own Simulate it control, so the suggestion
    // with the same label is chosen inside the question surface.
    api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
    button(e.root.querySelector('.m-question')!, label).click(); await api.drain();
    const draft = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as any;
    assert.equal(draft.intent, intent); assert.deepEqual(draft.anchor, anchor());
    assert.equal(draft.question, e.root.querySelector('[aria-label="Your question"]')!.value);
    assert.equal(draft.question, question); assert.equal(opened, 0); assert.deepEqual(requests, []);
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

test('whole-page Save and Read later persist once and restore the local reading cue without requests', async t => {
  const e = env(t), requests: string[] = [], navigated: unknown[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected request'); } });
  let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  api.setReadingPosition(21);
  const footer = e.root.querySelector('.m-footer')!;
  button(e.root, 'Save page').click(); button(e.root, 'Save page').click(); await api.drain();
  let state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.length, 1); assert.equal(state.threads[0].anchor.kind, 'whole-page'); assert.equal(state.threads[0].anchor.exact, ''); assert.equal(state.threads[0].state, 'open');
  button(e.root, 'Read later').click(); button(e.root, 'Read later').click(); await api.drain();
  state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.length, 1); assert.equal(state.threads[0].state, 'parked');
  assert.ok(button(e.root, 'Export')); assert.deepEqual(requests, []);
  api.destroy(); await api.drain();
  const { mountLibrary } = await import('../ui/library/index.ts');
  const library = mountLibrary(asHost(e.root), { listThreads: async () => structuredClone(state.threads), exportThread: async () => { throw new Error('Export is separate'); }, onOpenThread() {}, onClose() {} });
  await until(() => e.root.textContent.includes('Saved threads')); await settle();
  button(e.root, 'Read later').click(); assert.match(e.root.textContent, /Original source/); library.destroy();
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, onSource: value => navigated.push(value) });
  await api.drain(); assert.ok(button(e.root, 'You were here')); assert.equal(api.restoredPosition, true);
  assert.equal((navigated[0] as { start: number }).start, 21); assert.deepEqual(requests, []);
  api.destroy(); await api.drain();
});

test('removed whole-page threads do not resurrect a parked checkpoint; explicit Save creates a new entry', async t => {
  const e = env(t); let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  api.setReadingPosition(21); button(e.root, 'Read later').click(); await api.drain(); api.destroy(); await api.drain();
  const persistence = localPersistence(e.namespace), journal = documentJournal(e.namespace, persistence.journal);
  const thread = journal.state.threads[0]; await journal.change({ id: 'remove-parked', kind: 'remove', removed: true, threadId: thread.id, expectedRevision: thread.revision });
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  await api.drain(); assert.equal(e.root.querySelectorAll('.m-resume').length, 0);
  button(e.root, 'Save page').click(); await api.drain();
  const state = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(state.threads.filter(value => !value.deletedAt).length, 1);
  assert.notEqual(state.threads.find(value => !value.deletedAt)!.id, thread.id);
  api.destroy(); await api.drain();
});

test('Read later at the top retains its explicit return cue; a changed capture saves a new immutable page', async t => {
  const e = env(t); let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  button(e.root, 'Read later').click(); await api.drain(); api.destroy(); await api.drain();
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  assert.ok(button(e.root, 'You were here')); api.destroy(); await api.drain();
  const changed = { ...capture, text: 'A replacement page.', sections: undefined };
  api = await mountMargin(asHost(e.root), { capture: changed, storageName: e.namespace, allowHelper: false });
  assert.equal(e.root.querySelectorAll('.m-resume').length, 0); button(e.root, 'Save page').click(); await api.drain();
  const state = e.data(e.namespace).get('journal') as JournalState;
  const keeps = state.pending.filter(value => value.kind === 'keep');
  assert.equal(keeps.length, 2); assert.equal(keeps[0].capture.text, capture.text); assert.equal(keeps[1].capture.text, changed.text);
  api.destroy(); await api.drain();
});

test('page save and checkpoint storage failures stay visible and retry without duplicate threads', async t => {
  const e = env(t); const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  e.onWrite(async key => { if (String(key).startsWith('saved-page:')) throw new Error('Page record storage failed.'); });
  button(e.root, 'Save page').click(); await api.drain();
  assert.equal((e.data(e.namespace).get('journal') as JournalState | undefined)?.threads.length ?? 0, 0);
  assert.match(e.root.textContent, /Page record storage failed/);
  e.onWrite(async () => {}); button(e.root, 'Save page').click(); await api.drain();
  e.onWrite(async key => { if (String(key).startsWith('parked-page-position:')) throw new Error('Checkpoint storage failed.'); });
  button(e.root, 'Read later').click(); await api.drain(); assert.match(e.root.textContent, /Checkpoint storage failed/);
  e.onWrite(async () => {}); button(e.root, 'Read later').click(); await api.drain();
  const state = e.data(e.namespace).get('journal') as JournalState; assert.equal(state.threads.length, 1); assert.equal(state.threads[0].state, 'parked');
  api.destroy(); await api.drain();
});

test('explicit helper synchronization places Read later in the actual library adapter without provider work', async t => {
  const nativeFetch = nativeHttpFetch, e = env(t), requests: string[] = []; let diagnosticsChecks = 0;
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => { diagnosticsChecks++; return {}; } });
  t.after(() => helper.close());
  const origin = 'chrome-extension://' + 'a'.repeat(32), token = helper.pairing.exchange(helper.challenge, origin);
  e.data(e.namespace).set('pairing', { origin: helper.origin, token });
  replaceGlobals(t, { fetch: async (url: string, init: RequestInit) => {
    requests.push(new URL(url).pathname); return nativeFetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
  } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: helper.origin, readPosition: async () => undefined });
  button(e.root, 'Read later').click(); await api.drain(); assert.equal(requests.length, 0);
  button(e.root, 'Settings').click(); button(e.root, 'Save queued changes').click(); await api.drain();
  const client = api.connection(); api.destroy(); await api.drain();
  const { libraryAdapters } = await import('../ui/helper.ts'); const { mountLibrary } = await import('../ui/library/index.ts');
  const library = mountLibrary(asHost(e.root), libraryAdapters(() => client, async () => { throw new Error('Restore is separate'); }, { onOpenThread() {}, onClose() {} }));
  await until(() => requests.includes('/api/read/threads')); await settle(); await settle();
  button(e.root, 'Read later').click();
  for (let attempt = 0; attempt < 200 && !e.root.textContent.includes('Original source'); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(e.root.textContent, /Original source/);
  assert.equal(diagnosticsChecks, 1, 'opening Settings checks readiness once'); assert.equal(requests.some(path => path.startsWith('/api/jobs')), false);
  library.destroy();
});

test('page save identity retains capture time for unchanged content and preserves new supplied metadata separately', async t => {
  const e = env(t);
  const versions = [capture, { ...capture, capturedAt: '2026-09-18T00:00:00Z' }, { ...capture, author: 'Reader-provided author' }, { ...capture, publicationDate: '2026-09-01' }, { ...capture, venue: 'Captured venue' }];
  const totals = [1, 1, 2, 3, 4];
  for (const [index, version] of versions.entries()) {
    const api = await mountMargin(asHost(e.root), { capture: version, storageName: e.namespace, allowHelper: false });
    button(e.root, 'Save page').click(); await api.drain(); api.destroy(); await api.drain();
    const state = e.data(e.namespace).get('journal') as JournalState; assert.equal(state.threads.length, totals[index]);
  }
  const state = e.data(e.namespace).get('journal') as JournalState;
  const keeps = state.pending.filter(value => value.kind === 'keep'); assert.equal(keeps[0].capture.capturedAt, capture.capturedAt);
  assert.equal(keeps[1].capture.author, 'Reader-provided author'); assert.equal(keeps[2].capture.publicationDate, '2026-09-01'); assert.equal(keeps[3].capture.venue, 'Captured venue');
});

test('R4 rerender keeps focus on a named action when its label changes', async t => {
  const e = env(t); await threadFixture(e.namespace);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  const highlight = button(e.root, 'Highlight'); highlight.focus(); highlight.click(); await api.drain();
  const replacement = button(e.root, 'Remove highlight');
  assert.notEqual(replacement, highlight); assert.equal(e.document.activeElement, replacement);
  button(e.root, 'Settings').click();
  const preview = button(e.root, 'Block question previews here'); preview.focus(); preview.click(); await api.drain();
  assert.equal(e.document.activeElement, button(e.root, 'Allow question previews here'));
  assert.deepEqual(e.root.querySelector('.m-footer')!.children.map(node => node.className),
    ['m-notice', 'm-related', 'm-actions m-footer-row']);
  api.destroy(); await api.drain();
});


test('R4 section markers mount only beside saved work and the current title appears once', async t => {
  const e = env(t);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  assert.equal(e.root.querySelectorAll('.m-section-marker').length, 0);
  api.select(anchor()); button(e.root, 'Keep').click(); await api.drain();
  assert.equal(e.root.querySelectorAll('.m-section-marker').length, 0);
  button(e.root, 'Follow reading').click(); api.setReadingPosition(21);
  const markers = e.root.querySelectorAll('.m-section-marker');
  assert.deepEqual(markers.map(node => node.textContent), []);
  assert.equal(e.root.querySelector('.m-reading h2')!.textContent, 'Second');
  api.destroy(); await api.drain();
});


test('R4 coloured map belongs only to the collapsed rail', async t => {
  const e = env(t); await threadFixture(e.namespace);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  const panel = e.root.querySelector('.m-panel')!, rail = e.root.querySelector('.m-rail')!;
  assert.equal(panel.querySelector('.m-map'), null); assert.equal(panel.querySelector('.m-density'), null);
  const map = rail.querySelector('.m-map')!; assert.ok(map);
  button(e.root, 'Collapse').click(); assert.equal(rail.querySelector('.m-map'), map);
  button(e.root, 'Open margin').click(); assert.equal(rail.querySelector('.m-map'), map);
  assert.equal(panel.querySelector('.m-map'), null);
  api.destroy(); await api.drain();
});

test('R4b notices announce without moving focus, pause on hover and focus, and errors require dismissal', async t => {
  const e = env(t);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  await api.drain();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const notice = e.root.querySelector('.m-notice')!;
  assert.equal(notice.hidden, true);
  assert.equal(e.root.querySelector('.m-status')!.getAttribute('aria-live'), 'polite');
  const settings = button(e.root, 'Settings'); settings.focus();
  api.select(anchor()); button(e.root, 'Keep').click(); await api.drain();
  assert.match(e.root.querySelector('.m-status')!.textContent, /Passage kept/);
  assert.equal(e.document.activeElement, settings);
  notice.fire('mouseenter'); t.mock.timers.tick(4100); assert.equal(notice.hidden, false);
  notice.fire('mouseleave'); notice.focus(); t.mock.timers.tick(4100); assert.equal(notice.hidden, false);
  settings.focus(); notice.fire('focusout'); await settle();
  t.mock.timers.tick(4100); assert.equal(notice.hidden, true);
  e.onWrite(async () => { throw new Error('Test save failure'); });
  button(e.root, 'Save page').click(); await api.drain();
  assert.equal(notice.hidden, false); t.mock.timers.tick(5000); assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /Test save failure/);
  button(notice, 'Dismiss').click(); assert.equal(notice.hidden, true);
  api.destroy(); await api.drain();
});


test('R4b empty resting margin has five controls, count disclosure and end offers appear only in context', async t => {
  const e = env(t);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, onLibrary() {} });
  await api.drain();
  assert.deepEqual(Object.keys(api).sort(), ['replaceQuestionExposure', 'sourceUrl', 'connection', 'exportWork', 'drain', 'restoredPosition', 'flushReadingPosition', 'getThread', 'focusThread', 'select', 'setReadingPosition', 'suspend', 'resume', 'openThread', 'selectionAction', 'readLater', 'destroy'].sort());
  const panel = e.root.querySelector('.m-panel')!;
  const visible = panel.querySelectorAll('button,input,textarea,select,summary').filter(node => {
    for (let at = node; at; at = at.parentElement!) {
      if (at.hidden) return false;
      if (at.tagName === 'DETAILS' && !at.open && node !== at.children[0]) return false;
    }
    return true;
  });
  assert.deepEqual(visible.map(node => node.textContent), ['Collapse', 'Save page', '', 'Ask', 'Connections', 'Skills', 'Library', 'Settings']);
  assert.equal(panel.querySelector('.m-empty')!.textContent, 'Suggestions appear as you write. Your notes, highlights and replies get marked on the left.');
  assert.equal(panel.querySelector('.m-section-marker'), null);
  assert.equal(panel.querySelector('.m-map'), null);
  assert.ok(e.root.querySelector('.m-rail .m-map'));
  assert.equal(panel.querySelector('.m-end-offers'), null);
  api.setReadingPosition(capture.text.length);
  const offers = panel.querySelector('.m-end-offers')!;
  assert.deepEqual(offers.children.map(node => node.textContent), ['Think with it', 'Go further']);
  assert.equal(offers.parentElement, panel.querySelector('.m-scroll'));
  api.setReadingPosition(0); assert.equal(panel.querySelector('.m-end-offers'), null);
  button(e.root, 'Save page').click(); await api.drain();
  const disclosure = e.root.querySelector('.m-page-actions')!;
  assert.equal(disclosure.hidden, false); assert.equal(disclosure.open, false);
  assert.equal(disclosure.querySelector('summary')!.textContent, 'Connections');
  assert.deepEqual(disclosure.querySelectorAll('button').map(node => node.textContent), ['Export']);
  assert.equal(e.root.querySelector('.m-footer-history')!.closest('.m-local-library')!.hidden, true);
  api.destroy(); await api.drain();
});

test('v12 shared field autosaves one note identity, preserves multiline edits and never sends while typing', async t => {
  const e = env(t), requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected request'); } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  const field = e.root.querySelector('[aria-label="Your note"]')!;
  field.focus(); field.value = 'First thought\nSecond line'; field.fire('input'); await api.drain();
  let saved = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(saved.threads.length, 1); const threadId = saved.threads[0].id, noteId = saved.threads[0].notes[0].id;
  assert.equal(saved.threads[0].notes[0].text, field.value);
  field.value += '\nA later thought'; field.fire('input'); await api.drain();
  saved = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(saved.threads.length, 1); assert.equal(saved.threads[0].id, threadId); assert.equal(saved.threads[0].notes[0].id, noteId);
  assert.equal(saved.threads[0].notes[0].text, field.value); assert.equal(e.root.querySelector('[aria-label="Your note"]'), field);
  assert.deepEqual(requests, []); assert.ok(e.root.querySelector('.m-note-offers')!.children.length > 0);
  api.destroy(); await api.drain();
});

test('v12 autosave retains newer typing while a journal write is delayed', async t => {
  const e = env(t), entered = deferred<void>(), release = deferred<void>(); let once = true;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  e.onWrite(async key => { if (key === 'journal' && once) { once = false; entered.resolve(); await release.promise; } });
  const field = e.root.querySelector('[aria-label="Your note"]')!;
  field.value = 'Earlier'; field.fire('input'); const drain = api.drain(); await entered.promise;
  assert.equal(field.readOnly, false); field.value = 'Latest typing'; field.fire('input'); release.resolve(); await drain; await api.drain();
  const saved = e.data(e.namespace).get('journal') as JournalState;
  assert.equal(field.value, 'Latest typing'); assert.equal(saved.threads.length, 1); assert.equal(saved.threads[0].notes[0].text, 'Latest typing');
  api.destroy(); await api.drain();
});

test('v12 Back reports view save failure and reopening retains the same mounted reply and controls', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace), reply = cached(seeded.thread);
  reply.version.reply.title = 'Saved explanation';
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, reply.source, [reply.version], [reply.view]);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false }); await api.drain();
  const opener = e.root.querySelector('.m-reply-title')!; opener.click();
  const frame = e.root.querySelector('.m-reply-frame')!, field = frame.querySelector('[aria-label="Controlled reply input"]')!;
  assert.equal(frame.hidden, false);
  e.onWrite(async key => { if (key.startsWith('reply:')) throw new Error('quota'); });
  field.value = '7'; field.fire('input'); button(frame, 'Back').click(); await api.drain();
  assert.equal(frame.hidden, false); assert.match(frame.textContent, /quota|unsaved|storage/i); assert.equal(field.value, '7');
  e.onWrite(async () => {}); button(frame, 'Back').click(); await api.drain(); assert.equal(frame.hidden, true);
  opener.click(); assert.equal(frame.querySelector('[aria-label="Controlled reply input"]'), field); assert.equal(field.value, '7');
  const record = (await seeded.persistence.replies.list(seeded.thread.id))[0]; assert.equal(record.version.id, reply.version.id); assert.equal(record.local.parameters.x, 7);
  api.destroy(); await api.drain();
});

test('v12 Back and live reopen keep one running request without opening or destroying it again', async t => {
  const e = env(t); await threadFixture(e.namespace, true);
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  let opens = 0, destroys = 0, saves = 0; const visibility: boolean[] = [];
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, asking: (_host, context) => ({
    open(selection) { opens++; context.retainedQuestion?.({ ...selection, resumeJobId: 'running-request' }); context.onState?.({ phase: 'working' }); },
    setVisible(value) { visibility.push(value); _host.hidden = !value; },
    async saveForNavigation() { saves++; },
    destroy() { destroys++; },
  }) });
  button(e.root, 'Ask about this note').click(); await api.drain(); button(e.root, 'Define it here').click(); await api.drain();
  const frame = e.root.querySelector('.m-reply-frame')!; assert.equal(frame.hidden, false); assert.equal(opens, 1);
  button(frame, 'Back').click(); await api.drain(); assert.equal(frame.hidden, true); assert.equal(saves, 1); assert.equal(destroys, 0);
  const retained = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as any;
  assert.equal(retained.resumeJobId, 'running-request');
  const live = e.root.querySelector('.m-threads .m-reply-title')!; live.click();
  assert.equal(frame.hidden, false); assert.equal(opens, 1); assert.equal(destroys, 0); assert.equal(visibility.at(-1), true);
  api.destroy(); await api.drain();
});

test('v12 Back waits for newer reply edits and stays open when the newer save fails', async t => {
  const e = env(t), seeded = await threadFixture(e.namespace), reply = cached(seeded.thread);
  await seeded.persistence.replies.cache(e.document.location.origin, seeded.thread.id, reply.source, [reply.version], [reply.view]);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false }); await api.drain();
  e.root.querySelector('.m-reply-title')!.click();
  const frame = e.root.querySelector('.m-reply-frame')!, field = frame.querySelector('[aria-label="Controlled reply input"]')!;
  const entered = deferred<void>(), release = deferred<void>(); let writes = 0;
  e.onWrite(async (key, value) => {
    if (!key.startsWith('reply:')) return;
    if (++writes === 1) { entered.resolve(); await release.promise; }
    if ((value as any)?.local?.parameters?.x === 9) throw new Error('newer view quota');
  });
  field.value = '5'; field.fire('input'); await entered.promise;
  button(frame, 'Back').click(); field.value = '9'; field.fire('input'); release.resolve(); await api.drain();
  assert.equal(frame.hidden, false); assert.equal(field.value, '9'); assert.match(frame.textContent, /quota|unsaved|storage/i);
  e.onWrite(async () => {}); button(frame, 'Back').click(); await api.drain(); assert.equal(frame.hidden, true);
  api.destroy(); await api.drain();
  const restored = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false }); await restored.drain();
  e.root.querySelector('.m-reply-title')!.click();
  assert.equal(e.root.querySelector('.m-reply-frame')!.querySelector('[aria-label="Controlled reply input"]')!.value, '9');
  assert.equal(e.root.querySelector('.m-reply-frame')!.querySelector('[data-reply-version]')!.dataset.replyVersion, reply.version.id);
  restored.destroy(); await restored.drain();
});
