import test from 'node:test';
import { startServer } from '../daemon/server.ts';
const nativeHttpFetch = globalThis.fetch;
import assert from 'node:assert/strict';
import { storage, asHost } from './t05-harness.ts';
import { dom, button, replaceGlobals } from './t05-dom.ts';
import { rankEligibleSuggestions, suggestionBlock, suggestionPage, SUGGESTION_ORDER, suggestionOffer } from '../ui/suggestion-policy.ts';
import type { SourceCapture, ReplyVersion } from '../contracts/reader.ts';
import type { SuggestionExposureRecord } from '../ui/persistence.ts';

const { mountMargin } = await import('../ui/margin.ts');
const { localPersistence, documentJournal, SUGGESTION_POLICY_VERSION } = await import('../ui/persistence.ts');
const capture: SourceCapture = {
  url: 'https://example.org/suggestions', title: 'Suggestion source', pageType: 'article',
  text: 'A passage whose support can be inspected.', capturedAt: '2026-09-18T08:00:00Z', extractionVersion: 'test',
  sections: [{ title: 'Passage', start: 0, end: 41 }],
};
const anchor = () => ({ start: 0, end: 9, exact: capture.text.slice(0, 9), prefix: '', suffix: capture.text.slice(9) });
function env(t: import('node:test').TestContext) { return { ...dom(t), ...storage(t), namespace: crypto.randomUUID() }; }
function records(data: Map<string, unknown>) {
  return [...data].filter(([key]) => key.startsWith('suggestion-exposure:')).map(([, value]) => value as SuggestionExposureRecord);
}

function choose(root: ReturnType<typeof dom>['root'], label: string) {
  // The selection card now carries a resting Simulate it control, so a suggestion
  // with the same label is chosen inside the question surface.
  const question = root.querySelector('.m-question');
  const control = question?.querySelectorAll('button').find(node => node.textContent === label) ?? button(root, label);
  const more = control.closest('details');
  if (more) { more.open = true; more.fire('toggle'); }
  control.click();
}
function offers(root: ReturnType<typeof dom>['root']) { return root.querySelector('.m-offers')!.querySelectorAll('button').map(node => node.dataset.intent); }

test('real asking surface ranks all eight candidates, numbers three, and records only shown positions', async t => {
  const e = env(t), api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false });
  assert.deepEqual(records(e.data(e.namespace)), []);
  const opener = e.document.createElement('button'); e.document.body.append(opener); opener.focus();
  api.select(anchor()); assert.equal(e.document.activeElement, opener);
  assert.deepEqual(e.root.querySelector('.m-selection-actions')!.querySelectorAll('button').map(node => node.textContent), ['Keep', 'Note', 'Ask', 'Simulate it']);
  button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
  const expected = rankEligibleSuggestions({ block: suggestionBlock(anchor().exact), page: suggestionPage(capture.pageType), posture: 'balanced', usefulNearby: [], dismissed: [] }, SUGGESTION_ORDER);
  assert.deepEqual(offers(e.root), expected.slice(0, 3).map(item => item.intent));
  assert.equal(e.root.querySelector('.m-question')!.parentElement, e.root.querySelector('.m-reply-frame-body'));
  assert.equal(e.root.querySelectorAll('form').length, 1);
  assert.deepEqual(e.root.querySelector('.m-offers')!.querySelectorAll('.m-suggestion').map(node => node.children[0].textContent), ['1', '2', '3']);
  const [record] = records(e.data(e.namespace));
  assert.equal(record.policyVersion, SUGGESTION_POLICY_VERSION); assert.deepEqual(record.eligible, SUGGESTION_ORDER);
  assert.deepEqual(record.shown, expected.slice(0, 3).map(({ intent }, index) => ({ intent, label: suggestionOffer(intent).label, position: index + 1 })));
  assert.match(record.contextHash, /^[a-f0-9]{64}$/); assert.doesNotMatch(JSON.stringify(record), /A passage/);
  const more = e.root.querySelector('.m-asking-draft details')!; more.open = true; more.fire('toggle'); await api.drain();
  assert.deepEqual(offers(e.root), expected.slice(0, 3).map(item => item.intent)); assert.equal(records(e.data(e.namespace))[0].shown.length, 8);
  more.open = false; more.fire('toggle'); assert.deepEqual(offers(e.root), expected.slice(0, 3).map(item => item.intent));
  api.destroy(); await api.drain();
});

for (const [label, intent] of [['Simulate it', 'simulate'], ['Check this claim', 'evidence'], ['Define it here', 'define']] as const) {
  test(`${label}: choosing records exact intent and latency without provider dispatch`, async t => {
    const e = env(t); let hostOpens = 0, requests = 0;
    replaceGlobals(t, { fetch: async () => { requests++; throw new Error('Unexpected outbound request'); } });
    const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER,
      asking: () => ({ open() { hostOpens++; }, setVisible() {}, destroy() {} }) });
    api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain(); choose(e.root, label); await api.drain();
    const [record] = records(e.data(e.namespace));
    assert.equal(record.resolution, 'chosen'); assert.equal(record.choice, intent); assert.ok(record.resolvedAt);
    assert.equal(typeof record.latencyMs, 'number'); assert.equal(hostOpens, 0); assert.equal(requests, 0);
    const draft = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as { suggestionExposureId?: string };
    assert.equal(draft.suggestionExposureId, record.exposureId); api.destroy(); await api.drain();
  });
}

test('whole-page asks use the same ranked surface without dispatch', async t => {
  const e = env(t); let hostOpens = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER,
    asking: () => ({ open() { hostOpens++; }, setVisible() {}, destroy() {} }) });
  api.setReadingPosition(capture.text.length); button(e.root, 'Go further').click(); await api.drain();
  assert.equal(offers(e.root)[0], 'explore'); assert.equal(e.root.querySelectorAll('form').length, 1);
  assert.equal(records(e.data(e.namespace))[0].shown.length, 3); assert.equal(hostOpens, 0); api.destroy(); await api.drain();
});

test('dismissal, explicit new ideas and page close have distinct no-choice resolutions', async t => {
  for (const resolution of ['dismissed', 'replaced', 'page-closed'] as const) {
    const e = env(t), api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false });
    api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
    if (resolution === 'dismissed') e.root.querySelector('.m-question')!.fire('keydown', { key: 'Escape' });
    else if (resolution === 'replaced') { const input = e.root.querySelector('[aria-label="Your question"]')!; input.value = 'Why?'; input.fire('input'); button(e.root, 'More ideas').click(); }
    else api.destroy();
    await api.drain(); const [record] = records(e.data(e.namespace));
    assert.equal(record.resolution, resolution); assert.equal(record.choice, null); assert.ok(record.resolvedAt); assert.equal(typeof record.latencyMs, 'number');
    api.destroy(); await api.drain();
  }
});

test('startup recovers an unresolved local exposure as page-closed without fabricating latency', async t => {
  const e = env(t), tab = 'stable-tab', scope = `draft:${tab}:${capture.url}`;
  sessionStorage.setItem('marginalia-draft-tab', tab);
  const persistence = localPersistence(e.namespace);
  await persistence.suggestions.record(scope, { exposureId: 'old-exposure', policyVersion: SUGGESTION_POLICY_VERSION,
    contextHash: 'a'.repeat(64), eligible: ['simulate'], shown: [{ intent: 'simulate', label: 'See it', position: 1 }],
    shownAt: '2026-09-17T08:00:00.000Z', resolvedAt: null, choice: null, resolution: null, latencyMs: null, eventualOutcome: 'unknown' });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false });
  await api.drain();
  const [record] = await persistence.suggestions.list(scope);
  assert.equal(record.resolution, 'page-closed'); assert.equal(record.choice, null); assert.equal(record.latencyMs, null); assert.ok(record.resolvedAt);
  api.destroy(); await api.drain();
});

function openRecord(exposureId: string): SuggestionExposureRecord {
  return { exposureId, policyVersion: SUGGESTION_POLICY_VERSION, contextHash: 'a'.repeat(64), eligible: ['simulate'],
    shown: [{ intent: 'simulate', label: 'See it', position: 1 }], shownAt: '2026-09-17T08:00:00.000Z',
    resolvedAt: null, choice: null, resolution: null, latencyMs: null, eventualOutcome: 'unknown' };
}

test('null, malformed, oversized and mismatched exposure rows cannot block note or question hydration', async t => {
  const e = env(t), tab = 'corrupt-tab', scope = `draft:${tab}:${capture.url}`;
  sessionStorage.setItem('marginalia-draft-tab', tab);
  e.data(e.namespace).set(scope, { source: capture, anchor: anchor(), text: 'My saved note' });
  e.data(e.namespace).set('question:' + scope, { capture, anchor: anchor(), question: 'My saved question', context: 'My context' });
  const corrupt = [null, {}, { ...openRecord('wrong-id'), shown: [null] },
    { ...openRecord('large'), shown: [{ intent: 'simulate', label: 'x'.repeat(10000), position: 1 }] },
    { ...openRecord('many'), eligible: Array(1000).fill('simulate') }, openRecord('different-identity')];
  corrupt.forEach((value, index) => e.data(e.namespace).set(`suggestion-exposure:${scope}:bad-${index}`, value));
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false });
  await api.drain();
  assert.equal(e.root.querySelector('[aria-label="Your note"]')!.value, 'My saved note');
  button(e.root, 'Return to retained question').click(); await api.drain();
  assert.equal(e.root.querySelector('[aria-label="Your question"]')!.value, 'My saved question');
  assert.equal(e.root.querySelector('[aria-label="Context to attach"]')!.value, 'My context');
  assert.equal([...e.data(e.namespace).keys()].filter(key => key.includes(':bad-')).length, corrupt.length, 'invalid history is preserved');
  api.destroy(); await api.drain();
});

test('failed recovery writes are isolated from question hydration and can be retried', async t => {
  const e = env(t), tab = 'recovery-failure', scope = `draft:${tab}:${capture.url}`;
  sessionStorage.setItem('marginalia-draft-tab', tab);
  e.data(e.namespace).set(`suggestion-exposure:${scope}:old`, openRecord('old'));
  e.data(e.namespace).set('question:' + scope, { capture, anchor: anchor(), question: 'Retain me', context: '' });
  e.onWrite(async key => { if (key.startsWith('suggestion-exposure:')) throw new Error('quota'); });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false });
  await api.drain(); button(e.root, 'Return to retained question').click(); await api.drain();
  assert.equal(e.root.querySelector('[aria-label="Your question"]')!.value, 'Retain me');
  await api.drain(); e.onWrite(async () => {});
  button(e.root, 'Settings').click(); button(e.root, 'Retry saving').click(); await api.drain();
  assert.equal((e.data(e.namespace).get(`suggestion-exposure:${scope}:old`) as SuggestionExposureRecord).resolution, 'page-closed');
  api.destroy(); await api.drain();
});

for (const resolution of ['chosen', 'dismissed', 'replaced'] as const) {
  test(`failed ${resolution} resolution survives close/remount and retries the exact observed decision`, async t => {
    const e = env(t);
    let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false });
    await api.drain(); api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
    e.onWrite(async (key, value) => { if (key.startsWith('suggestion-exposure:') && (value as SuggestionExposureRecord).resolution === resolution) throw new Error('resolution quota'); });
    if (resolution === 'chosen') choose(e.root, 'Simulate it');
    else if (resolution === 'dismissed') e.root.querySelector('.m-question')!.fire('keydown', { key: 'Escape' });
    else { const input = e.root.querySelector('[aria-label="Your question"]')!; input.value = 'Why?'; input.fire('input'); button(e.root, 'More ideas').click(); }
    await api.drain();
    const scope = `draft:${sessionStorage.getItem('marginalia-draft-tab')}:${capture.url}`;
    const persistence = localPersistence(e.namespace), [pending] = persistence.suggestions.unsaved(scope);
    assert.equal(pending.resolution, resolution); assert.equal(pending.choice, resolution === 'chosen' ? 'simulate' : null);
    assert.equal(records(e.data(e.namespace))[0].resolution, null);
    api.destroy(); await api.drain(); e.onWrite(async () => {});
    api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false }); await api.drain();
    const [saved] = records(e.data(e.namespace));
    assert.deepEqual(saved, pending); assert.equal(persistence.suggestions.unsaved(scope).length, 0);
    api.destroy(); await api.drain();
  });
}

test('session receipt restores the exact known choice after a restart without an in-memory pending write', async t => {
  const e = env(t), scope = 'restart-scope', record = openRecord('restart');
  const key = `suggestion-exposure:${scope}:${record.exposureId}`;
  const resolved = { ...record, resolution: 'chosen' as const, choice: 'simulate', resolvedAt: '2026-09-17T08:00:02.000Z', latencyMs: 2000 };
  e.data(e.namespace).set(key, record);
  sessionStorage.setItem('marginalia-suggestion-pending:' + JSON.stringify([e.namespace, key]), JSON.stringify(resolved));
  await localPersistence(e.namespace).suggestions.recover(scope, '2026-09-18T08:00:00.000Z');
  assert.deepEqual(e.data(e.namespace).get(key), resolved);
});

test('exposure recovery pages history without pruning it and rejects malformed writes/resolutions', async t => {
  const e = env(t), persistence = localPersistence(e.namespace), scope = 'many-exposures';
  for (let index = 0; index < 150; index++) {
    const record = openRecord(`exposure-${String(index).padStart(3, '0')}`);
    e.data(e.namespace).set(`suggestion-exposure:${scope}:${record.exposureId}`, record);
  }
  let after: string | undefined, total = 0, pages = 0;
  do {
    const result = await persistence.suggestions.recover(scope, '2026-09-18T08:00:00.000Z', after);
    assert.ok(result.recovered.length <= 64); total += result.recovered.length; pages++; after = result.next;
  } while (after);
  assert.equal(total, 150); assert.equal(pages, 3); assert.equal(e.data(e.namespace).size, 150);
  await assert.rejects(persistence.suggestions.record(scope, null as any));
  await assert.rejects(persistence.suggestions.record(scope, { ...openRecord('too-big'), eventualOutcome: 'x'.repeat(1000) }));
  e.data(e.namespace).set(`suggestion-exposure:${scope}:mismatch`, openRecord('another-id'));
  await assert.rejects(persistence.suggestions.resolve(scope, 'mismatch', 'chosen', 'simulate', '2026-09-18T08:00:00.000Z', 1));
  e.data(e.namespace).set(`suggestion-exposure:${scope}:bad-choice`, openRecord('bad-choice'));
  await assert.rejects(persistence.suggestions.resolve(scope, 'bad-choice', 'chosen', 'derive', '2026-09-18T08:00:00.000Z', 1));
});

for (const chosen of [false, true]) for (const failSwitch of [false, true]) {
  test(`E20/E23 Keep and Switch preserve ${chosen ? 'chosen' : 'unchosen'} A and stable B exposure${failSwitch ? ' through a failed save and retry' : ''}`, async t => {
    const e = env(t); let requests = 0, hostOpens = 0, failQuestion = false;
    replaceGlobals(t, { fetch: async () => { requests++; throw new Error('Unexpected request'); } });
    e.onWrite(async key => { if (failQuestion && key.startsWith('question:draft:')) throw new Error('question quota'); });
    let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false,
      asking: () => ({ open() { hostOpens++; }, setVisible() {}, destroy() {} }) });
    await api.drain(); api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
    if (chosen) { choose(e.root, 'Simulate it'); await api.drain(); }
    const field = e.root.querySelector('[aria-label="Your question"]')!;
    field.value = 'My exact question'; field.fire('input');
    const context = e.root.querySelector('[aria-label="Context to attach"]')!;
    context.value = 'My exact context'; context.fire('input'); await api.drain();
    const [original] = records(e.data(e.namespace));
    const b = { start: 10, end: 15, exact: capture.text.slice(10, 15), prefix: capture.text.slice(0, 10), suffix: capture.text.slice(15) };
    api.select(b);
    assert.deepEqual(e.root.querySelector('.m-selection')!.querySelectorAll('button').map(node => node.textContent), ['Keep', 'Switch']);
    button(e.root.querySelector('.m-selection')!, 'Keep').click(); await api.drain();
    assert.deepEqual(records(e.data(e.namespace)), [original]);
    assert.equal(e.root.querySelector('.m-question blockquote')!.textContent, anchor().exact);
    failQuestion = failSwitch;
    api.select(b); button(e.root.querySelector('.m-selection')!, 'Switch').click(); await api.drain();
    assert.equal(e.root.querySelector('.m-question blockquote')!.textContent, b.exact);
    assert.equal(e.root.querySelector('[aria-label="Your question"]')!.value, 'My exact question');
    assert.equal(e.root.querySelector('[aria-label="Context to attach"]')!.value, 'My exact context');
    const saved = records(e.data(e.namespace)), old = saved.find(record => record.exposureId === original.exposureId)!, fresh = saved.find(record => record.exposureId !== original.exposureId)!;
    assert.equal(saved.length, 2);
    assert.equal(old.resolution, chosen ? 'chosen' : 'replaced'); assert.equal(old.choice, chosen ? 'simulate' : null);
    assert.notEqual(fresh.contextHash, old.contextHash); assert.equal(fresh.resolution, null);
    if (failSwitch) {
      assert.match(e.root.textContent, /attachment is not saved yet/);
      failQuestion = false; button(e.root, 'Settings').click(); button(e.root, 'Retry saving').click(); await api.drain();
      assert.equal(records(e.data(e.namespace)).length, 2, 'retry must retain B exposure identity');
    }
    const questionKey = [...e.data(e.namespace).keys()].find(key => key.startsWith('question:draft:'))!;
    const draft = e.data(e.namespace).get(questionKey) as any;
    assert.deepEqual(draft.anchor, b); assert.equal(draft.suggestionExposureId, fresh.exposureId);
    choose(e.root, 'Check this claim'); await api.drain();
    assert.equal(records(e.data(e.namespace)).find(record => record.exposureId === fresh.exposureId)!.choice, 'evidence');
    assert.equal(requests, 0); assert.equal(hostOpens, 0);
    api.destroy(); await api.drain();
    api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false });
    await api.drain(); button(e.root, 'Return to retained question').click(); await api.drain(); await api.drain();
    assert.equal(e.root.querySelector('.m-question blockquote')!.textContent, b.exact);
    assert.equal(e.root.querySelector('[aria-label="Context to attach"]')!.value, 'My exact context');
    assert.equal(records(e.data(e.namespace)).find(record => record.exposureId === original.exposureId)!.resolution, chosen ? 'chosen' : 'replaced');
    api.destroy(); await api.drain();
  });
}


test('More exposure appends only newly displayed positions and preserves a resolved choice', async t => {
  const e = env(t), persistence = localPersistence(e.namespace), scope = 'reveal';
  const record = openRecord('reveal');
  record.eligible = ['simulate', 'evidence', 'define', 'derive'];
  record.shown = [
    { intent: 'simulate', label: 'See it', position: 1 },
    { intent: 'evidence', label: 'What supports this', position: 2 },
    { intent: 'define', label: 'Define this', position: 3 },
  ];
  await persistence.suggestions.record(scope, record);
  await assert.rejects(persistence.suggestions.resolve(scope, record.exposureId, 'chosen', 'derive', '2026-09-18T09:00:00Z', 1));
  const shown = [...record.shown, { intent: 'derive', label: 'Explain step by step', position: 4 }];
  const revealed = await persistence.suggestions.reveal(scope, record.exposureId, shown);
  assert.deepEqual(revealed.shown, shown);
  assert.deepEqual(await persistence.suggestions.reveal(scope, record.exposureId, shown), revealed);
  await assert.rejects(persistence.suggestions.reveal(scope, record.exposureId, [{ ...shown[1], position: 1 }, ...shown.slice(1)]));
  const resolved = await persistence.suggestions.resolve(scope, record.exposureId, 'chosen', 'derive', '2026-09-18T09:00:00Z', 1);
  assert.deepEqual(await persistence.suggestions.reveal(scope, record.exposureId, []), resolved, 'resolved history is immutable');
  assert.deepEqual((await persistence.suggestions.list(scope))[0], resolved);
});

test('failed reveal preserves the exact new visible positions for retry', async t => {
  const e = env(t), persistence = localPersistence(e.namespace), scope = 'reveal-retry';
  const record = openRecord('reveal-retry'); record.eligible = ['simulate', 'define'];
  await persistence.suggestions.record(scope, record);
  const shown = [...record.shown, { intent: 'define', label: 'Define this', position: 2 }];
  e.onWrite(async key => { if (key.startsWith('suggestion-exposure:')) throw new Error('quota'); });
  await assert.rejects(persistence.suggestions.reveal(scope, record.exposureId, shown));
  assert.deepEqual(persistence.suggestions.unsaved(scope)[0].shown, shown);
  e.onWrite(async () => {}); await persistence.suggestions.retry(scope);
  assert.deepEqual((await persistence.suggestions.list(scope))[0].shown, shown);
});


test('production passage and page inputs produce different first offers', async t => {
  const e = env(t), first: string[] = [];
  for (const text of ['viscosity', 'y = x + 2', '1. Open the lid.\n2. Pour water.', 'Heat causes expansion because the particles move faster.', 'The rate rose 24% [3].']) {
    const source = { ...capture, text }, api = await mountMargin(asHost(e.root), { capture: source, storageName: crypto.randomUUID(), allowHelper: false });
    api.select({ start: 0, end: text.length, exact: text, prefix: '', suffix: '' }); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
    first.push(offers(e.root)[0]); api.destroy(); await api.drain();
  }
  assert.ok(new Set(first).size >= 4, first.join(', '));
  const pageFirst: string[] = [];
  for (const pageType of ['paper', 'social']) {
    const text = 'An ordinary sentence with several words.', api = await mountMargin(asHost(e.root), { capture: { ...capture, pageType, text }, storageName: crypto.randomUUID(), allowHelper: false });
    api.select({ start: 0, end: text.length, exact: text, prefix: '', suffix: '' }); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
    pageFirst.push(offers(e.root)[0]); api.destroy(); await api.drain();
  }
  assert.notEqual(pageFirst[0], pageFirst[1]);
});

test('a stored same-session dismissal moves the first offer on the next Ask', async t => {
  const e = env(t), api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, suggestionEligibility: SUGGESTION_ORDER, allowHelper: false });
  api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
  const first = offers(e.root)[0];
  e.root.querySelector('.m-question')!.fire('keydown', { key: 'Escape' }); await api.drain();
  assert.equal(records(e.data(e.namespace))[0].resolution, 'dismissed');
  button(e.root.querySelector('.m-selection')!, 'Ask').click(); await api.drain();
  assert.notEqual(offers(e.root)[0], first); api.destroy(); await api.drain();
});

test('typing and background work leave visible offers fixed until More ideas is pressed', async t => {
  const e = env(t), api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
  const original = offers(e.root), field = e.root.querySelector('[aria-label="Your question"]')!;
  assert.equal(original[0], 'define'); field.value = 'How does this compare with Kelvin?'; field.fire('input'); await api.drain();
  assert.deepEqual(offers(e.root), original);
  api.setReadingPosition(20); await api.drain(); assert.deepEqual(offers(e.root), original);
  const more = e.root.querySelector('.m-asking-draft details')!; more.open = true; more.fire('toggle'); await api.drain();
  assert.deepEqual(offers(e.root), original); assert.equal(button(e.root, 'More ideas').hidden, false);
  button(e.root, 'More ideas').click(); await api.drain();
  assert.notEqual(offers(e.root)[0], 'define'); assert.ok(offers(e.root).some(intent => intent === 'explore' || intent === 'evidence'));
  api.destroy(); await api.drain();
});

test('a questioning reader note influences the first mounted offers', async t => {
  const e = env(t); sessionStorage.setItem('marginalia-draft-tab', 'note-ranking');
  e.data(e.namespace).set('question:draft:note-ranking:' + capture.url, { capture, anchor: anchor(), question: '', context: '', answeredNote: { noteId: 'note', revision: 1, text: 'Is this Kelvin versus Stokes?' } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  button(e.root, 'Return to retained question').click(); await api.drain();
  assert.notEqual(offers(e.root)[0], 'define'); assert.ok(offers(e.root).includes('explore') || offers(e.root).includes('evidence'));
  assert.match(e.root.querySelector('.m-note')!.textContent, /Kelvin/); api.destroy(); await api.drain();
});

test('unknown eligibility is never claimed as runnable in production observations', async t => {
  const e = env(t), api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
  assert.deepEqual(records(e.data(e.namespace)), []);
  const observation = [...e.data(e.namespace)].find(([key]) => key.startsWith('suggestion-observation:'))![1] as any;
  assert.deepEqual(observation.eligible, []); assert.equal(observation.eligibility, 'unknown'); assert.equal(observation.candidates.length, 8); assert.equal(observation.shown.length, 3);
  api.destroy(); await api.drain();
});

test('card keyboard offers work on controls, never while typing, and Escape restores the opener', async t => {
  const e = env(t), api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  const opener = e.document.createElement('button'); e.document.body.append(opener); opener.focus();
  api.select(anchor()); assert.equal(e.document.activeElement, opener); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain();
  const row = e.root.querySelector('.m-selection-actions')!, first = offers(e.root)[0]; row.children[1].focus();
  row.children[1].fire('keydown', { key: '/' }); const field = e.root.querySelector('[aria-label="Your question"]')!; assert.equal(e.document.activeElement, field);
  for (const key of ['1', '2', '3', 'k', 'p', 'Escape']) field.fire('keydown', { key });
  assert.equal(e.root.querySelector('.m-question')!.hidden, false);
  assert.equal((e.data(e.namespace).get('journal') as any)?.threads.length ?? 0, 0);
  row.children[1].focus(); row.children[1].fire('keydown', { key: '1' }); await api.drain();
  const draft = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as any;
  assert.equal(draft.intent, first);
  row.children[1].fire('keydown', { key: 'Escape' }); assert.equal(e.document.activeElement, opener);
  api.destroy(); await api.drain();
});

test('fresh selection reaches the review host in one choice after real awaited context saving', async t => {
  const e = env(t), helper = await startServer({ database: ':memory:', port: 0 }); t.after(() => helper.close());
  const origin = 'chrome-extension://' + 'a'.repeat(32), token = helper.pairing.exchange(helper.challenge, origin);
  e.data(e.namespace).set('pairing', { origin: helper.origin, token });
  const requests: string[] = []; let opened = 0;
  replaceGlobals(t, { fetch: async (url: string, init: RequestInit) => {
    if (new URL(url).pathname === '/api/read/jobs') { requests.push('/api/read/jobs'); return Response.json({ configured: true, available: true, unverified: [], disclosureVersion: null }); }
    requests.push(new URL(url).pathname); return nativeHttpFetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
  } });
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: helper.origin, readPosition: async () => undefined,
    asking: () => ({ async open(selection) {
      opened++; assert.equal(selection.intent, 'define'); assert.deepEqual(selection.anchor, anchor());
      const saved = helper.store.exportThread(selection.threadId!); assert.ok(saved); assert.equal(saved.thread.sourceVersionId, selection.sourceVersionId);
      assert.equal(saved.thread.anchor.exact, anchor().exact);
    }, setVisible() {}, destroy() {} }) });
  api.select(anchor()); button(e.root.querySelector('.m-selection-actions')!, 'Ask').click(); await api.drain(); assert.equal(requests.length, 0);
  button(e.root, 'Define it here').click(); await api.drain();
  assert.equal(opened, 1, e.root.textContent); assert.ok(requests.includes('/api/change')); assert.ok(requests.includes('/api/read/threads'));
  assert.equal(helper.jobs.list().length, 0); assert.equal(requests.some(path => path.startsWith('/api/jobs')), false);
  api.destroy(); await api.drain();
});

test('kept nearby replies change production ranking only after an explicit refresh', async t => {
  const e = env(t), text = 'An ordinary sentence with several words.', sourceCapture = { ...capture, text, sections: [{ title: 'Passage', start: 0, end: text.length }] };
  const persistence = localPersistence(e.namespace), journal = documentJournal(e.namespace, persistence.journal);
  const passage = { start: 0, end: text.length, exact: text, prefix: '', suffix: '' };
  await journal.change({ id: 'keep-nearby', kind: 'keep', threadId: 'nearby', capture: sourceCapture, anchor: passage });
  const api = await mountMargin(asHost(e.root), { capture: sourceCapture, storageName: e.namespace, allowHelper: false });
  api.select(passage); button(e.root.querySelector('.m-selection')!, 'Ask').click(); await api.drain();
  const original = offers(e.root); assert.notEqual(original[0], 'define');
  const source = { id: 'source', sourceId: 'page', hash: 'hash', text, title: capture.title, capturedAt: capture.capturedAt,
    extractionVersion: capture.extractionVersion, pageType: capture.pageType, metadataStatus: 'provided' as const };
  const version = { id: 'kept-definition', threadId: 'nearby', parentId: null, supersedes: null, hash: 'reply-hash',
    reply: { schema: 't05.fixture', intent: 'define', title: 'Saved definition' }, validation: {}, answeredNote: null,
    revision: 1, createdAt: capture.capturedAt, deletedAt: null } as unknown as ReplyVersion;
  await persistence.replies.cache('http://localhost:43120', 'nearby', source, [version], [{ replyVersionId: version.id, parameters: {}, view: {}, revision: 1, updatedAt: capture.capturedAt }]);
  const channel = new BroadcastChannel(e.namespace); channel.postMessage('changed'); await new Promise(resolve => setImmediate(resolve)); await api.drain();
  assert.deepEqual(offers(e.root), original); assert.equal(button(e.root, 'More ideas').hidden, false);
  button(e.root, 'More ideas').click(); await api.drain(); assert.equal(offers(e.root)[0], 'define');
  const [saved] = await persistence.replies.list('nearby'); await persistence.replies.setRemoved(saved, true);
  channel.postMessage('changed'); await new Promise(resolve => setImmediate(resolve)); await api.drain(); assert.equal(offers(e.root)[0], 'define');
  button(e.root, 'More ideas').click(); await api.drain(); assert.deepEqual(offers(e.root), original);
  channel.close(); api.destroy(); await api.drain();
});
