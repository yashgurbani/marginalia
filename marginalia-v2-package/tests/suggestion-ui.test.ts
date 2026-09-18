import test from 'node:test';
import assert from 'node:assert/strict';
import { storage, asHost } from './t05-harness.ts';
import { dom, button, replaceGlobals } from './t05-dom.ts';
import type { SourceCapture } from '../contracts/reader.ts';
import type { SuggestionExposureRecord } from '../ui/persistence.ts';

const { mountMargin } = await import('../ui/margin.ts');
const { localPersistence, SUGGESTION_POLICY_VERSION } = await import('../ui/persistence.ts');
const capture: SourceCapture = {
  url: 'https://example.org/suggestions', title: 'Suggestion source', pageType: 'article',
  text: 'A passage whose support can be inspected.', capturedAt: '2026-09-18T08:00:00Z', extractionVersion: 'test',
  sections: [{ title: 'Passage', start: 0, end: 42 }],
};
const anchor = () => ({ start: 0, end: 9, exact: capture.text.slice(0, 9), prefix: '', suffix: capture.text.slice(9) });
function env(t: import('node:test').TestContext) { return { ...dom(t), ...storage(t), namespace: crypto.randomUUID() }; }
function records(data: Map<string, unknown>) {
  return [...data].filter(([key]) => key.startsWith('suggestion-exposure:')).map(([, value]) => value as SuggestionExposureRecord);
}

test('visible selection has six stable exact offers and records exact labels only when shown', async t => {
  const e = env(t), api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  assert.deepEqual(records(e.data(e.namespace)), [], 'mounting a hidden question surface is not an exposure');
  api.select(anchor()); button(e.root, 'Ask').click(); await api.drain();
  const row = e.root.querySelector('.m-question .m-actions')!;
  assert.deepEqual(row.querySelectorAll('button').map(node => node.textContent), ['See it', 'What supports this', 'Define this', 'Show me an example', 'Explain step by step', 'diagram']);
  assert.match(row.textContent, /about a minute/);
  assert.doesNotMatch(row.textContent, /\d+\s*(ms|seconds?)/i, 'the visible time is a category, not a runtime measurement');
  const [record] = records(e.data(e.namespace));
  assert.equal(record.policyVersion, SUGGESTION_POLICY_VERSION);
  assert.deepEqual(record.eligible, ['simulate', 'evidence', 'define', 'instantiate', 'derive', 'diagram']);
  assert.deepEqual(record.shown, [
    { intent: 'simulate', label: 'See it', position: 1 },
    { intent: 'evidence', label: 'What supports this', position: 2 },
    { intent: 'define', label: 'Define this', position: 3 },
    { intent: 'instantiate', label: 'Show me an example', position: 4 },
    { intent: 'derive', label: 'Explain step by step', position: 5 },
    { intent: 'diagram', label: 'diagram', position: 6 },
  ]);
  assert.match(record.contextHash, /^[a-f0-9]{64}$/); assert.doesNotMatch(JSON.stringify(record), /A passage/);
  assert.equal(record.resolution, null); api.destroy(); await api.drain();
});

for (const [label, intent] of [['See it', 'simulate'], ['What supports this', 'evidence'], ['Define this', 'define']] as const) {
  test(`${label}: selection and choice record chosen state with zero dispatch`, async t => {
    const e = env(t); let hostOpens = 0, requests = 0;
    replaceGlobals(t, { fetch: async () => { requests++; throw new Error('Unexpected outbound request'); } });
    const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace,
      asking: () => ({ open() { hostOpens++; }, setVisible() {}, destroy() {} }) });
    api.select(anchor()); button(e.root, 'Ask').click(); button(e.root, label).click(); await api.drain();
    assert.ok(e.root.querySelector('.m-question .m-actions')!.querySelectorAll('button').every(control => control.disabled));
    const [record] = records(e.data(e.namespace));
    assert.equal(record.resolution, 'chosen'); assert.equal(record.choice, intent); assert.ok(record.resolvedAt);
    assert.equal(typeof record.latencyMs, 'number'); assert.equal(hostOpens, 0); assert.equal(requests, 0);
    const draft = [...e.data(e.namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as { suggestionExposureId?: string };
    assert.equal(draft.suggestionExposureId, record.exposureId);
    api.destroy(); await api.drain();
  });
}

test('whole-page state offers the named diagram request and opening it dispatches nothing', async t => {
  const e = env(t); let hostOpens = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace,
    asking: () => ({ open() { hostOpens++; }, setVisible() {}, destroy() {} }) });
  button(e.root, 'Go further').click(); await api.drain();
  const row = e.root.querySelector('.m-question .m-actions')!;
  assert.deepEqual(row.querySelectorAll('button').map(node => node.textContent), ['Define this', 'Show me an example', 'Explain step by step', 'diagram']);
  assert.equal(records(e.data(e.namespace))[0].shown.length, 4); assert.equal(hostOpens, 0);
  api.destroy(); await api.drain();
});

test('dismissal, replacement and page close are distinct no-choice resolutions', async t => {
  for (const resolution of ['dismissed', 'replaced', 'page-closed'] as const) {
    const e = env(t), api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
    api.select(anchor()); button(e.root, 'Ask').click();
    if (resolution === 'dismissed') button(e.root, 'Close question').click();
    else if (resolution === 'replaced') button(e.root, 'Retain draft in history and start another').click();
    else api.destroy();
    await api.drain();
    const [record] = records(e.data(e.namespace));
    assert.equal(record.resolution, resolution); assert.equal(record.choice, null); assert.ok(record.resolvedAt);
    if (resolution === 'page-closed') assert.equal(record.latencyMs, null);
    else assert.equal(typeof record.latencyMs, 'number');
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
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
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
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  await api.drain();
  assert.equal(e.root.querySelector('[aria-label="Your note"]')!.value, 'My saved note');
  button(e.root, 'Return to retained question').click();
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
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  await api.drain(); button(e.root, 'Return to retained question').click();
  assert.equal(e.root.querySelector('[aria-label="Your question"]')!.value, 'Retain me');
  await api.drain(); e.onWrite(async () => {});
  button(e.root, 'Settings').click(); button(e.root, 'Retry saving').click(); await api.drain();
  assert.equal((e.data(e.namespace).get(`suggestion-exposure:${scope}:old`) as SuggestionExposureRecord).resolution, 'page-closed');
  api.destroy(); await api.drain();
});

for (const resolution of ['chosen', 'dismissed', 'replaced'] as const) {
  test(`failed ${resolution} resolution survives close/remount and retries the exact observed decision`, async t => {
    const e = env(t);
    let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
    await api.drain(); api.select(anchor()); button(e.root, 'Ask').click(); await api.drain();
    e.onWrite(async (key, value) => { if (key.startsWith('suggestion-exposure:') && (value as SuggestionExposureRecord).resolution === resolution) throw new Error('resolution quota'); });
    if (resolution === 'chosen') button(e.root, 'See it').click();
    else button(e.root, resolution === 'dismissed' ? 'Close question' : 'Retain draft in history and start another').click();
    await api.drain();
    const scope = `draft:${sessionStorage.getItem('marginalia-draft-tab')}:${capture.url}`;
    const persistence = localPersistence(e.namespace), [pending] = persistence.suggestions.unsaved(scope);
    assert.equal(pending.resolution, resolution); assert.equal(pending.choice, resolution === 'chosen' ? 'simulate' : null);
    assert.equal(records(e.data(e.namespace))[0].resolution, null);
    api.destroy(); await api.drain(); e.onWrite(async () => {});
    api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false }); await api.drain();
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
    let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false,
      asking: () => ({ open() { hostOpens++; }, setVisible() {}, destroy() {} }) });
    await api.drain(); api.select(anchor()); button(e.root, 'Ask').click(); await api.drain();
    if (chosen) { button(e.root, 'See it').click(); await api.drain(); }
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
    button(e.root, 'What supports this').click(); await api.drain();
    assert.equal(records(e.data(e.namespace)).find(record => record.exposureId === fresh.exposureId)!.choice, 'evidence');
    assert.equal(requests, 0); assert.equal(hostOpens, 0);
    api.destroy(); await api.drain();
    api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
    await api.drain(); button(e.root, 'Return to retained question').click(); await api.drain();
    assert.equal(e.root.querySelector('.m-question blockquote')!.textContent, b.exact);
    assert.equal(e.root.querySelector('[aria-label="Context to attach"]')!.value, 'My exact context');
    assert.equal(records(e.data(e.namespace)).find(record => record.exposureId === original.exposureId)!.resolution, chosen ? 'chosen' : 'replaced');
    api.destroy(); await api.drain();
  });
}
