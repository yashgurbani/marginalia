import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { deferred, settle, dom, until, replaceGlobals } from './t05-dom.ts';
import { storage, asHost } from './t05-harness.ts';
import * as selectionActions from '../extension/lib/selection-actions.ts';

function compile(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const text = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const output = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: (name: string) => {
    if (name.endsWith('.css')) return {};
    assert.ok(name in dependencies, name); return dependencies[name];
  }, URL, URLSearchParams, AbortController, Error, Promise, crypto, structuredClone, console, ...globals });
  return exports;
}

const protocol = compile('extension/lib/protocol.ts', { '../../contracts/reader.ts': {} });
const respond = compile('extension/lib/respond.ts', {});
function background(hosts: unknown = [], url = 'https://example.org/a', incognito = false) {
  const gate = deferred<void>(), listeners: Record<string, (...args: any[]) => any> = {};
  const opens: unknown[] = [], messages: any[] = [];
  const event = (name: string) => ({ addListener: (fn: (...args: any[]) => any) => { listeners[name] = fn; } });
  const tab = { id: 42, url, incognito, windowId: 8 };
  const browser = {
    commands: { onCommand: event('command') },
    alarms: { onAlarm: event('alarm') }, storage: {
      local: { setAccessLevel: async () => {}, get: async () => { await gate.promise; return { excludedHosts: hosts }; } },
      session: { setAccessLevel: async () => {}, get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: event('storage'),
    }, runtime: { id: 'fixture', getURL: (path: string) => 'chrome-extension://fixture/' + path.replace(/^\//, ''),
      onMessage: event('message'), sendMessage: async (message: unknown) => { messages.push(message); },
      getContexts: async () => [{ contextType: 'SIDE_PANEL', documentId: 'panel', documentUrl: 'chrome-extension://fixture/panel.html', windowId: 8, tabId: -1, incognito: false }] },
    tabs: { onRemoved: event('removed'), get: async () => tab, query: async () => [tab],
      sendMessage: async (_id: number, message: unknown) => { messages.push(message); return { ok: true, value: true }; } },
    sidePanel: { open: (options: unknown) => { opens.push(options); return Promise.resolve(); } },
    action: { onClicked: event('click') }, webNavigation: { onHistoryStateUpdated: event('history'), onCommitted: event('committed') },
  };
  compile('extension/entrypoints/background.ts', {
    'wxt/utils/define-background': { defineBackground: (fn: () => void) => fn() }, 'wxt/browser': { browser },
    '../lib/instant-lifecycle.ts': { sourceHash: async () => '' }, '../lib/instant-worker.ts': { instantWorker: () => ({ release: async () => {} }) },
    '../lib/respond.ts': respond, '../lib/protocol.ts': protocol, '../lib/helper-reconnect.ts': { helperReconnect: () => ({}) },
    '../lib/surface-identity.ts': {}, '../../contracts/reader.ts': {}, '../../ui/journal.ts': {}, '../../ui/persistence.ts': {}, '../../contracts/resume.ts': {},
    '../lib/selection-actions.ts': selectionActions,
  }, { navigator: { locks: { request: async (_: string, fn: () => unknown) => fn() } } });
  return { gate, listeners, opens, messages, click: () => listeners.click(tab) };
}

test('cold native gesture opens only a neutral shell until allowed policy resolves', async () => {
  const h = background(); h.click();
  assert.equal(h.opens.length, 1);
  assert.deepEqual(h.messages.map(m => m.type), ['panel-source-pending']);
  h.gate.resolve(); await settle();
  assert.equal(h.messages.find(m => m.type === 'activate')?.panel, true);
});
test('cold excluded or malformed policy never activates a source', async () => {
  for (const hosts of [['example.org'], 'invalid']) {
    const h = background(hosts); h.click(); assert.equal(h.opens.length, 1);
    h.gate.resolve(); await settle();
    assert.deepEqual(h.messages.map(m => m.type), ['panel-source-pending']);
  }
});
test('known excluded, incognito and privileged URLs cannot open the native shell', async () => {
  for (const [hosts, url, privateTab] of [
    [['example.org'], 'https://example.org/a', false], [[], 'https://example.org/a', true],
    [[], 'chrome://settings', false], [[], 'file:///private', false], [[], 'chrome-extension://other/a', false],
  ] as const) {
    const h = background(hosts, url, privateTab); h.gate.resolve(); await settle(); h.click(); await settle();
    assert.equal(h.opens.length, 0); assert.equal(h.messages.some(m => m.type === 'activate'), false);
  }
});

class Node {
  hidden = false; textContent = ''; handlers: Record<string, () => void> = {};
  addEventListener(type: string, fn: () => void) { this.handlers[type] = fn; }
  replaceChildren() { this.textContent = ''; }
}
const snapshot = (document = 'old') => ({ document, revision: 1, position: 0, sections: [], capture: { url: 'https://example.org/' + document, text: document } });
function panel() {
  const nodes = Object.fromEntries(['connection', 'exclude', 'controls', 'helper-status', 'margin', 'connect', 'disconnect', 'trusted-open'].map(id => [id, new Node()]));
  const handlers: Record<string, () => void> = {}, calls: string[] = [], mounts: any[] = [];
  let listener: (message: unknown, sender: unknown) => void = () => {};
  let read: () => Promise<unknown> = async () => snapshot();
  let origin: () => Promise<string> = async () => 'http://127.0.0.1:43120';
  let hydrate: () => Promise<void> = async () => {};
  const document = { visibilityState: 'visible', querySelector: (id: string) => nodes[id.slice(1)], getElementById: (id: string) => nodes[id],
    addEventListener: (type: string, fn: () => void) => { handlers[type] = fn; } };
  const window: any = { addEventListener: (type: string, fn: () => void) => { handlers[type] = fn; } }; window.top = window;
  compile('extension/entrypoints/panel/main.ts', {
    '../../../ui/forget/client.ts': { ForgetClient: class {} }, '../../lib/panel-instant.ts': { panelInstantTransport: () => ({}) },
    '../../lib/panel-controls.ts': { connectionControls: () => {} }, '../../lib/library-link.ts': {},
    'wxt/browser': { browser: { runtime: { id: 'fixture', onMessage: { addListener: (fn: typeof listener) => { listener = fn; } },
      sendMessage: async (m: any) => { calls.push(m.action); if (m.action === 'read') return read(); if (m.action === 'auto-assist-status') return null; return {}; } }, tabs: {} } },
    '../../../ui/margin.ts': { mountMargin: async (root: Node, options: any) => {
      const mount = { options, destroyed: false, restoredPosition: false, flushes: 0, async flushReadingPosition() { this.flushes++; }, destroy() { this.destroyed = true; }, select() {}, setReadingPosition() {}, clearAutoAssist() {} };
      mounts.push(mount); root.textContent = options.capture.text; await hydrate(); return mount;
    } }, '../../lib/protocol.ts': { validSnapshot: (s: any) => !!s?.document, validSavedMarks: () => true },
    '../../lib/respond.ts': { readReply: (v: unknown) => v }, '../../lib/helper-origin.ts': { DEFAULT_HELPER_ORIGIN: 'http://127.0.0.1:43120', helperOrigin: () => origin() },
    '../../lib/selection-actions.ts': selectionActions,
  }, { document, window, location: { hash: '' }, setInterval: () => 1, clearInterval: () => {} });
  return { nodes, calls, mounts, document, handlers, setRead: (fn: typeof read) => { read = fn; }, setOrigin: (fn: typeof origin) => { origin = fn; },
    setHydrate: (fn: typeof hydrate) => { hydrate = fn; }, invalidate: () => listener({ type: 'panel-source-pending', version: 1 }, { id: 'fixture' }) };
}

test('reused native panel clears prior private DOM while policy read is pending or denied', async () => {
  const h = panel(); await settle(); assert.equal(h.nodes.margin.hidden, false); assert.equal(h.nodes.margin.textContent, 'old');
  const gate = deferred<unknown>(); h.setRead(() => gate.promise); h.calls.length = 0; h.invalidate();
  assert.equal(h.nodes.margin.hidden, true); assert.equal(h.nodes.margin.textContent, ''); assert.equal(h.mounts[0].options.signal.aborted, true);
  assert.deepEqual(h.calls, ['read']); gate.reject(new Error('This page is excluded.')); await settle();
  assert.equal(h.mounts.length, 1); assert.equal(h.mounts[0].flushes, 0); assert.equal(h.nodes.margin.hidden, true); assert.deepEqual(h.calls, ['read']);
});
test('visibility hide clears retained content synchronously and reveal reauthorizes', async () => {
  const h = panel(); await settle(); h.document.visibilityState = 'hidden'; h.handlers.visibilitychange();
  assert.equal(h.nodes.margin.textContent, ''); assert.equal(h.nodes.margin.hidden, true); assert.equal(h.mounts[0].flushes, 1);
  h.setRead(async () => { throw new Error('Excluded'); }); h.document.visibilityState = 'visible'; h.handlers.visibilitychange(); await settle();
  assert.equal(h.nodes.margin.hidden, true); assert.equal(h.mounts.length, 1);
});
for (const phase of ['read', 'origin', 'mount']) test(`late ${phase} completion cannot restore an invalidated source`, async () => {
  const h = panel(); await settle();
  const gate = deferred<any>();
  h.setRead(phase === 'read' ? () => gate.promise : async () => snapshot('pending'));
  if (phase === 'origin') h.setOrigin(() => gate.promise);
  if (phase === 'mount') h.setHydrate(() => gate.promise);
  h.invalidate(); await settle();
  h.setRead(async () => { throw new Error('Excluded'); }); h.invalidate(); await settle();
  const calls = h.calls.length; gate.resolve(phase === 'read' ? snapshot('pending') : phase === 'origin' ? 'http://127.0.0.1:43120' : undefined); await settle();
  assert.equal(h.nodes.margin.hidden, true); assert.equal(h.nodes.margin.textContent, '');
  assert.equal(h.calls.length, calls); assert.ok(h.mounts.every(m => m.destroyed));
});

test('real margin host cancellation stops pending hydration before automatic helper position work', async t => {
  const e = dom(t), store = storage(t), namespace = crypto.randomUUID();
  const gate = deferred<void>(), controller = new AbortController(); let reads = 0;
  const { mountMargin } = await import('../ui/margin.ts');
  const { documentJournal, localPersistence } = await import('../ui/persistence.ts');
  const journal = documentJournal(namespace, localPersistence(namespace).journal), original = journal.load.bind(journal);
  journal.load = async () => { await gate.promise; return original(); };
  t.after(() => { journal.load = original; });
  store.data(namespace).set('pairing', { origin: 'http://127.0.0.1:43120', token: 'fixture' });
  const mounting = mountMargin(asHost(e.root), { signal: controller.signal, storageName: namespace,
    capture: { url: 'https://example.org/a', title: 'Page', pageType: 'article', text: 'Private source.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'test' },
    readPosition: async () => { reads++; return undefined; } });
  await settle(); controller.abort(); gate.resolve(); const mounted = await mounting; mounted.destroy();
  assert.equal(reads, 0); assert.equal(e.root.textContent.includes('Private source.'), false);
});


test('real margin cancellation aborts an in-flight automatic helper position read', async t => {
  const e = dom(t), store = storage(t), namespace = crypto.randomUUID(), controller = new AbortController();
  let requestSignal: AbortSignal | undefined, calls = 0;
  const { mountMargin } = await import('../ui/margin.ts');
  store.data(namespace).set('pairing', { origin: 'http://127.0.0.1:43120', token: 'fixture' });
  replaceGlobals(t, { fetch: async (url: string, init: RequestInit) => {
    assert.ok(new URL(url).pathname.endsWith('/position')); calls++;
    requestSignal = init.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => { requestSignal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }); });
  } });
  const mounting = mountMargin(asHost(e.root), { signal: controller.signal, storageName: namespace, helperOrigin: 'http://127.0.0.1:43120',
    capture: { url: 'https://example.org/a', title: 'Page', pageType: 'article', text: 'Private source.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'test' } });
  await until(() => calls === 1); assert.ok(requestSignal); controller.abort();
  assert.equal(requestSignal.aborted, true); const mounted = await mounting; mounted.destroy();
  assert.equal(calls, 1); assert.equal(e.root.textContent.includes('Private source.'), false);
});

test('new allowed source can commit while an older mount is still pending', async () => {
  const h = panel(); await settle(); const gate = deferred<void>();
  h.setRead(async () => snapshot('stale')); h.setHydrate(() => gate.promise); h.invalidate(); await settle();
  h.setRead(async () => snapshot('new')); h.setHydrate(async () => {}); h.invalidate(); await settle();
  assert.equal(h.nodes.margin.hidden, false); assert.equal(h.nodes.margin.textContent, 'new');
  gate.resolve(); await settle();
  assert.equal(h.nodes.margin.hidden, false); assert.equal(h.nodes.margin.textContent, 'new');
  assert.equal(h.mounts[1].destroyed, true); assert.equal(h.mounts[2].destroyed, false);
});


test('ordinary page close flushes the committed reading position before abort', async () => {
  const h = panel(); await settle(); const previous = h.mounts[0];
  h.handlers.pagehide();
  assert.equal(previous.flushes, 1); assert.equal(previous.options.signal.aborted, false);
  assert.equal(h.nodes.margin.hidden, true); assert.equal(h.nodes.margin.textContent, '');
  await settle(); assert.equal(previous.options.signal.aborted, true); assert.equal(previous.destroyed, true);
});


test('policy invalidation also aborts a previous benign close position flush', async () => {
  const h = panel(); await settle(); const previous = h.mounts[0], gate = deferred<void>();
  previous.flushReadingPosition = async () => { previous.flushes++; await gate.promise; };
  h.document.visibilityState = 'hidden'; h.handlers.visibilitychange();
  assert.equal(previous.options.signal.aborted, false);
  h.invalidate(); assert.equal(previous.options.signal.aborted, true);
  gate.resolve(); await settle(); assert.equal(previous.destroyed, true); assert.equal(previous.flushes, 1);
});
