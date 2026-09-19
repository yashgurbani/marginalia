import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstantLifecycle, sourceHash, instantEvents, acceptInstantEvent, type InstantPage, type InstantDependencies } from '../extension/lib/instant-lifecycle.ts';
import { libraryThreadUrl } from '../extension/lib/library-link.ts';
const source = { document: 'doc1', url: 'https://example.org/a', sourceHash: 'hash1', text: 'A passage about diffusion.' };
function fixture() {
  const saved = new Map<number, InstantPage>(); const calls: string[] = []; let allow = true;
  const deps: InstantDependencies = {
    read: async tab => structuredClone(saved.get(tab)),
    write: async (tab, value) => { if (value) saved.set(tab, structuredClone(value)); else saved.delete(tab); },
    allowed: async () => allow,
    prepare: async () => { calls.push('prepare'); return { pageId: 'p' + calls.length, state: 'ready' }; },
    select: async function* (pageId, selectionId) { calls.push('select'); yield { type: 'draft', pageId, selectionId, sequence: 1, text: 'A short explanation.' }; yield { type: 'completed', pageId, selectionId, sequence: 1, reply: { summary: 'A short explanation.' } }; },
    release: async pageId => { calls.push('release:' + pageId); },
  };
  return { deps, calls, saved, setAllowed(value: boolean) { allow = value; } };
}
test('page preparation needs no panel and same generation prepares exactly once concurrently and on restart', async () => {
  const f = fixture(), controller = createInstantLifecycle(f.deps);
  await Promise.all([controller.prepare(1, source), controller.prepare(1, source)]);
  await createInstantLifecycle(f.deps).prepare(1, source);
  assert.deepEqual(f.calls, ['prepare']);
});
test('excluded page cannot prepare; revocation releases its lease', async () => {
  const f = fixture(), controller = createInstantLifecycle(f.deps); f.setAllowed(false);
  await controller.prepare(1, source); assert.deepEqual(f.calls, []);
  f.setAllowed(true); await controller.prepare(1, source); f.setAllowed(false);
  await controller.select(1, source, 's', 'passage'); assert.deepEqual(f.calls, ['prepare', 'release:p1']);
});
test('same URL with changed source hash releases and prepares a new generation', async () => {
  const f = fixture(), controller = createInstantLifecycle(f.deps);
  await controller.prepare(1, source); await controller.prepare(1, { ...source, sourceHash: 'hash2', text: 'Changed source.' });
  assert.deepEqual(f.calls, ['prepare', 'release:p1', 'prepare']);
});
test('selection draft completes and duplicate selection is not sent after restart', async () => {
  const f = fixture(), controller = createInstantLifecycle(f.deps);
  await controller.select(1, source, 's1', 'passage');
  assert.equal(f.saved.get(1)?.event?.type, 'completed');
  await createInstantLifecycle(f.deps).select(1, source, 's1', 'passage');
  assert.deepEqual(f.calls, ['prepare', 'select']);
});
test('failed preparation outcome is persisted before send and not automatically retried', async () => {
  const f = fixture(); f.deps.prepare = async () => { f.calls.push('prepare'); throw Error('Disconnected'); };
  await assert.rejects(createInstantLifecycle(f.deps).prepare(1, source));
  assert.equal(f.saved.get(1)?.state, 'outcome_unknown');
  await createInstantLifecycle(f.deps).prepare(1, source); assert.deepEqual(f.calls, ['prepare']);
});
test('rapid selections discard older drafts even when transport ignores cancellation', async () => {
  const f = fixture(); let unblock!: () => void; const hold = new Promise<void>(resolve => { unblock = resolve; });
  let started!: () => void; const waiting = new Promise<void>(resolve => { started = resolve; });
  f.deps.select = async function* (pageId, selectionId) { if (selectionId === 'old') { started(); await hold; } yield { type: 'draft', pageId, selectionId, sequence: 1, text: selectionId }; yield { type: 'state', pageId, selectionId, sequence: 1, state: 'ready' }; };
  const controller = createInstantLifecycle(f.deps), old = controller.select(1, source, 'old', 'old passage');
  await waiting; await controller.select(1, source, 'new', 'new passage'); unblock(); await old;
  assert.equal(f.saved.get(1)?.selectionId, 'new'); assert.equal(f.saved.get(1)?.event?.selectionId, 'new');
});
test('navigation while preparation is in flight releases late page without restoring it', async () => {
  const f = fixture(); let done!: () => void; const hold = new Promise<void>(resolve => { done = resolve; }); let start!: () => void; const waiting = new Promise<void>(resolve => { start = resolve; });
  f.deps.prepare = async () => { start(); await hold; return { pageId: 'late', state: 'ready' }; };
  const controller = createInstantLifecycle(f.deps), pending = controller.prepare(1, source); await waiting; await controller.release(1); done(); await pending;
  assert.equal(f.saved.has(1), false); assert.deepEqual(f.calls, ['release:late']);
});
test('event validator rejects stale IDs and malicious final output; draft stays plain data', () => {
  assert.equal(acceptInstantEvent({ type: 'draft', pageId: 'old', selectionId: 's', sequence: 1, text: 'old' }, 'p', 's'), undefined);
  assert.equal(acceptInstantEvent({ type: 'completed', pageId: 'p', selectionId: 's', sequence: 1, reply: { summary: '<script>bad</script>' } }, 'p', 's'), undefined);
});
test('SSE decoder handles fragmented UTF8 and CRLF', async () => {
  const bytes = new TextEncoder().encode('event: draft\r\ndata: {"text":"café"}\r\n\r\n');
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
  const events = []; for await (const event of instantEvents(response)) events.push(event);
  assert.deepEqual(events, [{ text: 'café' }]);
});
test('source SHA256 uses exact UTF8 text and library deep link preserves thread identity', async () => {
  assert.equal(await sourceHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(libraryThreadUrl('http://127.0.0.1:43120', 'thread/a'), 'http://127.0.0.1:43120/#thread=thread%2Fa');
  assert.throws(() => libraryThreadUrl('https://example.org', 'thread'), /Invalid local helper origin/);
  assert.throws(() => libraryThreadUrl('http://127.0.0.1:43120', ''), /Invalid saved thread identity/);
  assert.throws(() => libraryThreadUrl('http://127.0.0.1:43120', 'bad\u0000id'), /Invalid saved thread identity/);
});
test('oversized sources and passages never dispatch outside the frozen helper limits', async () => {
  const f = fixture(), controller = createInstantLifecycle(f.deps);
  await controller.prepare(1, { ...source, text: 'a'.repeat(200_001) });
  assert.deepEqual(f.calls, []);
  await controller.select(1, source, 'long', 'a'.repeat(8001));
  assert.deepEqual(f.calls, ['prepare']);
});
test('a confirmed evicted page can prepare again while an unknown outcome cannot', async () => {
  const f = fixture(); f.deps.select = async function* (pageId, selectionId) { yield { type: 'state', pageId, selectionId, sequence: 1, state: 'cancelled' }; };
  const controller = createInstantLifecycle(f.deps); await controller.select(1, source, 'old', 'passage');
  await controller.prepare(1, source);
  assert.deepEqual(f.calls, ['prepare', 'release:p1', 'prepare']);
});
import { stopExcluding } from '../extension/lib/instant-exclusions.ts';
test('explicit unexclude replaces the acknowledged union and survives the next synchronization', async () => {
  let local = ['example.org', 'other.org']; let remote = [...local]; const calls: string[] = [];
  const deps = {
    read: async () => [...local], write: async (hosts: string[]) => { local = hosts; },
    sync: async (hosts: string[]) => { remote = [...new Set([...remote, ...hosts])]; return { excludedHosts: remote, revision: 'r1' }; },
    unexclude: async (host: string, revision: string) => { assert.equal(revision, 'r1'); calls.push(host); remote = remote.filter(value => value !== host); return { excludedHosts: remote, revision: 'r2' }; },
  };
  assert.deepEqual(await stopExcluding(deps, 'example.org'), { excluded: false });
  assert.deepEqual(local, ['other.org']);
  assert.deepEqual((await deps.sync(local)).excludedHosts, ['other.org']);
  assert.deepEqual(calls, ['example.org']);
});
test('failed or stale unexclude keeps local denial; ancestor and deny-site responses remain excluded', async () => {
  let local = ['news.example.org'];
  const deps = { read: async () => [...local], write: async (hosts: string[]) => { local = hosts; }, sync: async () => ({ excludedHosts: local, revision: 'r1' }), unexclude: async () => { throw Error('stale revision'); } };
  await assert.rejects(stopExcluding(deps, 'news.example.org'), /stale/); assert.deepEqual(local, ['news.example.org']);
  const result = await stopExcluding({ ...deps, unexclude: async () => ({ excludedHosts: ['example.org', 'other.org'], revision: 'r2' }) }, 'news.example.org');
  assert.equal(result.excluded, true); assert.deepEqual(local, ['example.org', 'other.org']);
});
test('paused preparation retries once after authoritative budget epoch changes, including worker restart', async () => {
  const f = fixture(); let epoch = 'day1:revision0'; f.deps.budgetEpoch = () => epoch;
  f.deps.prepare = async () => { f.calls.push('prepare'); return { pageId: 'paused', state: 'paused-at-limit' }; };
  await createInstantLifecycle(f.deps).prepare(1, source);
  await createInstantLifecycle(f.deps).prepare(1, source); assert.deepEqual(f.calls, ['prepare']);
  epoch = 'day2:revision0'; const controller = createInstantLifecycle(f.deps);
  await Promise.all([controller.prepare(1, source), controller.prepare(1, source)]);
  assert.deepEqual(f.calls, ['prepare', 'release:paused', 'prepare']);
  assert.equal(f.saved.get(1)?.budgetEpoch, epoch);
});
test('unknown preparation is never retried merely because budget epoch changes', async () => {
  const f = fixture(); let epoch = 'day1'; f.deps.budgetEpoch = () => epoch;
  f.deps.prepare = async () => { f.calls.push('prepare'); throw Error('lost'); };
  await assert.rejects(createInstantLifecycle(f.deps).prepare(1, source)); epoch = 'day2';
  await createInstantLifecycle(f.deps).prepare(1, source); assert.deepEqual(f.calls, ['prepare']);
});
test('selection budget pause is retained until a confirmed budget epoch change', async () => {
  const f = fixture(); let epoch = 'day1:r0'; f.deps.budgetEpoch = () => epoch;
  f.deps.select = async function* (pageId, selectionId) { yield { type: 'state', pageId, selectionId, sequence: 1, state: 'paused-at-limit' }; };
  const controller = createInstantLifecycle(f.deps); await controller.select(1, source, 's', 'passage');
  assert.equal(f.saved.get(1)?.state, 'paused-at-limit');
  await controller.prepare(1, source); assert.deepEqual(f.calls, ['prepare']);
  epoch = 'day1:r1'; await controller.prepare(1, source); assert.deepEqual(f.calls, ['prepare', 'release:p1', 'prepare']);
});
import { createReadyHelp, readyTerms, type ReadyPage, type ReadyDependencies } from '../extension/lib/auto-assist-bridge.ts';
const readySource = { document: 'doc', url: 'https://example.org/a', sourceHash: 'hash', pageId: 'page', posture: 'balanced' as const, text: 'Diffusion moves material.' };
const candidates = [{ candidateId: 'c1', term: 'Diffusion', start: 0, end: 9 }];
function readyFixture() {
  let saved: ReadyPage | undefined; let epoch = 'day1'; const calls: string[] = [];
  const deps: ReadyDependencies = {
    read: async () => structuredClone(saved), write: async (_tab, page) => { saved = structuredClone(page); },
    allowed: async () => true, budgetEpoch: () => epoch,
    prepare: async (_pageId, terms) => { calls.push('prepare'); return { state: 'ready', definitions: terms.map(term => ({ candidateId: term.candidateId, text: 'Material spreads from a crowded region into its surroundings.' })) }; },
    dismiss: async () => { calls.push('dismiss'); },
  };
  return { deps, calls, state: () => saved, epoch: (value: string) => { epoch = value; } };
}
test('ready help validates exact source bounds and normalizes terms', () => {
  assert.equal(readyTerms(candidates, readySource.text)[0].normalizedTerm, 'diffusion');
  assert.throws(() => readyTerms([{ ...candidates[0], end: 10 }], readySource.text));
  assert.throws(() => readyTerms([...candidates, ...candidates], readySource.text));
});
test('ready help prepares visible terms once; pointer and keyboard focus open cached prose without inference', async () => {
  const f = readyFixture(), controller = createReadyHelp(f.deps);
  await controller.update(1, readySource, candidates, ['c1']);
  assert.equal(f.state()?.items[0].state, 'ready');
  await controller.focus(1, 'c1'); assert.equal(f.state()?.focused, 'c1');
  await createReadyHelp(f.deps).focus(1, 'c1');
  await createReadyHelp(f.deps).update(1, readySource, candidates, ['c1']);
  assert.deepEqual(f.calls, ['prepare']);
});
test('ready help leaves offscreen terms suggested and makes at most three terms per request', async () => {
  const f = readyFixture(), controller = createReadyHelp(f.deps);
  await controller.update(1, readySource, candidates, []); assert.equal(f.state()?.items[0].state, 'suggested'); assert.deepEqual(f.calls, []);
  await controller.update(1, readySource, candidates, ['c1']); assert.deepEqual(f.calls, ['prepare']);
});
test('ready help transport uncertainty and restarted pending requests are never replayed', async () => {
  const f = readyFixture(); f.deps.prepare = async () => { f.calls.push('prepare'); throw Error('lost'); };
  await createReadyHelp(f.deps).update(1, readySource, candidates, ['c1']);
  assert.equal(f.state()?.items[0].request, 'unknown'); f.epoch('day2');
  await createReadyHelp(f.deps).update(1, readySource, candidates, ['c1']); assert.deepEqual(f.calls, ['prepare']);
  const pending = f.state()!; pending.items[0].request = 'pending'; pending.items[0].state = 'preparing'; await f.deps.write(1, pending);
  await createReadyHelp(f.deps).update(1, readySource, candidates, ['c1']); assert.equal(f.state()?.items[0].state, 'suggested'); assert.deepEqual(f.calls, ['prepare']);
});
test('ready help pause retries only after new budget epoch', async () => {
  const f = readyFixture(); f.deps.prepare = async () => { f.calls.push('prepare'); return { state: 'paused-at-limit', definitions: [] }; };
  const controller = createReadyHelp(f.deps); await controller.update(1, readySource, candidates, ['c1']); await controller.update(1, readySource, candidates, ['c1']);
  assert.deepEqual(f.calls, ['prepare']); f.epoch('day2'); await controller.update(1, readySource, candidates, ['c1']); assert.deepEqual(f.calls, ['prepare', 'prepare']);
});
test('ready help rejects malformed prose and discards results after source release', async () => {
  const f = readyFixture(); f.deps.prepare = async () => ({ state: 'ready', definitions: [{ candidateId: 'c1', text: '<script>bad</script>' }] });
  await createReadyHelp(f.deps).update(1, readySource, candidates, ['c1']); assert.equal(f.state()?.items[0].definition, undefined);
  await f.deps.write(1, undefined); let complete!: () => void; let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; }), held = new Promise<void>(resolve => { complete = resolve; });
  f.deps.prepare = async () => { start(); await held; return { state: 'ready', definitions: [{ candidateId: 'c1', text: 'Old definition.' }] }; };
  const run = createReadyHelp(f.deps).update(1, readySource, candidates, ['c1']); await started; await f.deps.write(1, undefined); complete(); await run; assert.equal(f.state(), undefined);
});
test('ready help dismissal saves once with stable operation identity, retains UI on failure and does not infer', async () => {
  const f = readyFixture(), controller = createReadyHelp(f.deps); await controller.update(1, readySource, candidates, []);
  let original: string | undefined; let time: string | undefined; let attempts = 0;
  f.deps.dismiss = async (_pageId, term) => { attempts++; if (!original) { original = term.dismissOperation; time = term.dismissObservedAt; throw Error('offline'); } assert.equal(term.dismissOperation, original); assert.equal(term.dismissObservedAt, time); };
  await assert.rejects(controller.dismiss(1, 'c1'), /offline/); assert.equal(f.state()?.items.length, 1);
  await controller.dismiss(1, 'c1'); assert.equal(f.state()?.items.length, 0); assert.equal(attempts, 2); assert.deepEqual(f.calls, []);
});
import { registerHooks } from 'node:module';
test('background ready-help bridge authenticates source and options, forwards dismissal to the current content document', async t => {
  const listeners: Record<string, (...args: unknown[]) => unknown> = {}; const calls: string[] = []; let start!: () => void;
  const event = (name: string) => ({ addListener(listener: (...args: unknown[]) => unknown) { listeners[name] = listener; } });
  const capture = { document: 'captureDoc', revision: 1, position: 0, anchor: null, sections: [{ title: 'Page', start: 0, end: readySource.text.length }], capture: { url: readySource.url, title: 'Page', pageType: 'Article', text: readySource.text, capturedAt: '2026-09-18T00:00:00.000Z', extractionVersion: 'dom-safe-text-v1' } };
  const browser = { runtime: { id: 'test', getURL: (path: string) => 'chrome-extension://test' + path, onMessage: event('message'), getContexts: async () => [{ documentId: 'panelDoc', documentUrl: 'chrome-extension://test/panel.html', windowId: 1 }] }, alarms: { onAlarm: event('alarm') }, action: { onClicked: event('click') }, sidePanel: {},
    tabs: { onRemoved: event('removed'), get: async () => ({ id: 1, url: readySource.url }), query: async () => [{ id: 1, url: readySource.url }], sendMessage: async (_tab: number, message: { type: string }, target: { documentId?: string }) => { if (message.type === 'snapshot') return { ok: true, value: capture }; if (message.type === 'auto-assist-dismiss') { assert.equal(target.documentId, 'browserDoc'); calls.push('content-dismiss'); return { ok: true, value: { dismissed: true } }; } return { ok: true, value: true }; } },
    webNavigation: { onCommitted: event('committed'), onHistoryStateUpdated: event('history'), getFrame: async () => ({ documentId: 'browserDoc', documentLifecycle: 'active', url: readySource.url }) },
    storage: { onChanged: event('storage'), local: { setAccessLevel: async () => {}, get: async () => ({ excludedHosts: [] }) }, session: { setAccessLevel: async () => {} } } };
  const worker = { policy: async () => true, autoAssistPolicy: async () => ({ enabled: true }), autoStatus: async () => ({ ...readySource, document: 'captureDoc', items: readyTerms(candidates, readySource.text) }), autoFocus: async () => { calls.push('focus'); return true; }, autoCandidates: async () => { calls.push('prepare'); }, changeExclusion: async () => { calls.push('exclusion'); return { excluded: false }; } };
  const globalKey = '__instantBridgeTest'; Object.defineProperty(globalThis, globalKey, { configurable: true, value: { browser, worker, capture: (fn: () => void) => { start = fn; } } });
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name: string, work: () => unknown) => work() } } });
  const hooks = registerHooks({
    resolve(specifier, context, next) { if (specifier === 'wxt/browser') return { url: 'instant-test:browser', shortCircuit: true }; if (specifier === 'wxt/utils/define-background') return { url: 'instant-test:background', shortCircuit: true }; if (context.parentURL?.includes('/extension/entrypoints/background.ts') && specifier === '../lib/instant-worker.ts') return { url: 'instant-test:worker', shortCircuit: true }; if (specifier === '../lib/helper-reconnect.ts') return { url: 'instant-test:helper', shortCircuit: true }; return next(specifier, context); },
    load(url, context, next) { const source = url === 'instant-test:browser' ? 'export const browser=globalThis.__instantBridgeTest.browser;' : url === 'instant-test:background' ? 'export const defineBackground=fn=>globalThis.__instantBridgeTest.capture(fn);' : url === 'instant-test:worker' ? 'export const instantWorker=()=>globalThis.__instantBridgeTest.worker;' : url === 'instant-test:helper' ? "export const HELPER_RECONNECT_ALARM='test';export const helperReconnect=()=>({});" : undefined; return source ? { format: 'module', source, shortCircuit: true } : next(url, context); },
  });
  t.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, globalKey); if (nav) Object.defineProperty(globalThis, 'navigator', nav); });
  await import(new URL('../extension/entrypoints/background.ts?ready-bridge-test', import.meta.url).href); start();
  const message = (body: unknown, sender: unknown) => new Promise<{ ok: boolean; value?: unknown }>(resolve => { listeners.message(body, sender, resolve); });
  const content = { id: 'test', tab: { id: 1 }, frameId: 0, documentId: 'browserDoc', url: readySource.url };
  await message({ type: 'auto-assist-open', version: 1, candidateId: 'c1' }, content); assert.deepEqual(calls, ['focus']);
  await message({ type: 'instant-exclusion', version: 1, host: 'example.org', excluded: false }, content); assert.deepEqual(calls, ['focus']);
  await message({ type: 'instant-exclusion', version: 1, host: 'example.org', excluded: false }, { id: 'test', url: 'chrome-extension://test/options.html' }); assert.deepEqual(calls, ['focus', 'exclusion']);
  const result = await message({ type: 'surface', version: 1, action: 'auto-assist-dismiss', candidateId: 'c1' }, { id: 'test', documentId: 'panelDoc', url: 'chrome-extension://test/panel.html' });
  assert.equal(result.ok, true); assert.deepEqual(result.value, { dismissed: true }); assert.deepEqual(calls, ['focus', 'exclusion', 'content-dismiss']);
});
import { panelInstantTransport } from '../extension/lib/panel-instant.ts';
import { connectionControls } from '../extension/lib/panel-controls.ts';
import { defaultInstantHelpSettings, instantTextToReply } from '../contracts/instant.ts';
import { dom } from './t05-dom.ts';
test('margin instant transport consumes existing cumulative drafts and final reply without dispatching another selection', async () => {
  const calls: string[] = [], states = ['A short', 'A short explanation.', 'done'];
  const transport = panelInstantTransport(async action => {
    calls.push(action); const next = states.shift();
    return { document: 'doc', url: source.url, sourceHash: 'hash', pageId: 'page', state: 'ready', selectionId: 's', selectionText: 'passage', event: next === 'done' ? { type: 'completed', pageId: 'page', selectionId: 's', sequence: 1, reply: instantTextToReply('A short explanation.') } : { type: 'draft', pageId: 'page', selectionId: 's', sequence: 1, text: next } };
  }, async () => {});
  const events = []; for await (const event of transport.requestDefinition({ requestId: 'ui-request', pageKey: source.url, sourceUrl: source.url, sourceGeneration: 'capture', text: 'passage', action: 'define' })) events.push(event);
  assert.deepEqual(events.slice(0, 2), [{ type: 'text-delta', text: 'A short' }, { type: 'text-delta', text: ' explanation.' }]); assert.equal(events[2].type, 'reply');
  assert.deepEqual(calls, ['instant-status', 'instant-status', 'instant-status']);
});
test('margin instant transport settings use authenticated worker actions and aborted reads do not run', async () => {
  const calls: string[] = [], settings = defaultInstantHelpSettings();
  const transport = panelInstantTransport(async action => { calls.push(action); return settings; }, async () => {});
  assert.equal((await transport.getSettings()).enabled, true);
  const { version, revision, updatedAt, ...values } = settings;
  await transport.saveSettings({ ...values, expectedRevision: revision });
  assert.deepEqual(calls, ['instant-settings', 'instant-save-settings']);
  const abort = new AbortController(); abort.abort(); await assert.rejects(transport.getSettings(abort.signal)); assert.equal(calls.length, 2);
});
test('margin instant transport emits one quiet budget pause and rejects an older selection stream', async () => {
  const selection = { requestId: 'r', pageKey: source.url, sourceUrl: source.url, sourceGeneration: 'capture', text: 'passage', action: 'define' as const };
  const pause = panelInstantTransport(async () => ({ url: source.url, state: 'paused-at-limit' }), async () => {}); const events = [];
  for await (const event of pause.requestDefinition(selection)) events.push(event); assert.deepEqual(events, [{ type: 'state', state: 'paused-at-limit' }]);
  let call = 0; const switched = panelInstantTransport(async () => ({ url: source.url, pageId: 'page', selectionId: ++call === 1 ? 'old' : 'new', selectionText: 'passage', state: 'ready' }), async () => {});
  for await (const _event of switched.requestDefinition(selection)) assert.fail('A stale selection must not produce content'); assert.equal(call, 2);
});
test('native panel Settings mount preserves five resting controls, with Hear it behind footer More', async t => {
  const { storage, asHost } = await import('./t05-harness.ts');
  const { replaceGlobals } = await import('./t05-dom.ts');
  const { mountMargin } = await import('../ui/margin.ts');
  const d = dom(t); storage(t); let localVoice = false;
  replaceGlobals(t, { speechSynthesis: Object.assign(new EventTarget(), { getVoices: () => localVoice ? [{ name: 'Local', lang: 'en', voiceURI: 'local', localService: true }] : [], cancel() {}, speak() {} }), SpeechSynthesisUtterance: class {} });
  for (const count of [5, 6]) {
    localVoice = count === 6; d.root.replaceChildren();
    const controls = d.document.createElement('section');
    for (const id of ['exclude', 'connect', 'disconnect', 'trusted-open']) { const button = d.document.createElement('button'); button.id = id; controls.append(button); }
    connectionControls(controls as unknown as ParentNode, false, false);
    const capture = { url: source.url, title: 'Page', pageType: 'article', text: source.text, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'test' };
    const mounted = await mountMargin(asHost(d.root), { capture, storageName: crypto.randomUUID(), allowHelper: false, onLibrary() {}, settingsContent: asHost(controls) });
    await mounted.drain();
    const panel = d.root.querySelector('.m-panel')!, settings = d.root.querySelector('.m-settings')!;
    const visible = panel.querySelectorAll('button,input,textarea,select,summary').filter(node => {
      for (let at = node; at; at = at.parentElement!) { if (at.hidden || at.tagName === 'DETAILS' && !at.open && node !== at.children[0]) return false; }
      return true;
    });
    assert.equal(controls.parentElement, settings); assert.equal(visible.length, 5, visible.map(node => node.textContent).join(', '));
    assert.equal(!!panel.querySelector('.m-footer-more')!.querySelectorAll('button').find(node => node.textContent === 'Hear it'), count === 6);
    panel.querySelectorAll('button').find(node => node.textContent === 'Settings')!.click();
    assert.equal(settings.hidden, false); assert.equal(controls.querySelector('#exclude')?.hidden, false); assert.equal(controls.querySelector('#connect')?.hidden, false);
    connectionControls(controls as unknown as ParentNode, false, true); assert.equal(controls.querySelector('#connect')?.hidden, true); assert.equal(controls.querySelector('#disconnect')?.hidden, false);
    connectionControls(controls as unknown as ParentNode, true, false); assert.equal(controls.querySelector('#trusted-open')?.hidden, false);
    mounted.destroy(); await mounted.drain();
  }
});
test('explicit forget suppression prevents automatic rewarming and preserves page identity for an unconfirmed retry', async () => {
  const f = fixture(), controller = createInstantLifecycle(f.deps); await controller.prepare(1, source);
  assert.equal(await controller.suppress(1, 'wrong'), false);
  assert.equal(await controller.suppress(1, 'p1'), true);
  await createInstantLifecycle(f.deps).prepare(1, source); await controller.select(1, source, 's', 'passage');
  assert.deepEqual(f.calls, ['prepare']); assert.equal(f.saved.get(1)?.state, 'off'); assert.equal(f.saved.get(1)?.pageId, 'p1');
  await controller.prepare(1, { ...source, document: 'new-document' }); assert.deepEqual(f.calls, ['prepare', 'release:p1', 'prepare']);
});


test('ambient gate passes source classification to helper and requires an explicit applicable allow', async () => {
  const { ambientAssistanceAllowed } = await import('../extension/lib/ambient-policy.ts');
  let requested = '';
  assert.equal(await ambientAssistanceAllowed('https://example.org/a?x=1&y=2', 'Article', async path => { requested = path; return { policy: { applies: true, allowed: true } }; }), true);
  const query = new URL(requested, 'http://localhost').searchParams;
  assert.equal(query.get('sourceUrl'), 'https://example.org/a?x=1&y=2');
  assert.equal(query.get('type'), 'Article'); assert.equal(query.get('trigger'), 'ambient');
  for (const reply of [null, {}, { policy: { allowed: true } }, { policy: { applies: false, allowed: true } }, { policy: { applies: true, allowed: false } }, { policy: { applies: true, allowed: 'true' } }]) {
    assert.equal(await ambientAssistanceAllowed('https://example.org', 'Unknown', async () => reply), false);
  }
  assert.equal(await ambientAssistanceAllowed('https://example.org', 'Social', async () => { throw new Error('offline'); }), false);
});
