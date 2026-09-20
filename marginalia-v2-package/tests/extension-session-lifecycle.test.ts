import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const listeners: Record<string, Function> = {}, session = new Map<string, unknown>([['baseline', true]]);
let background: (() => void) | undefined, reconnects = 0;
const event = (name: string) => ({ addListener(fn: Function) { listeners[name] = fn; } });
const browser = {
  commands: { onCommand: event('command') },
  alarms: { onAlarm: event('alarm') }, action: { onClicked: event('clicked') }, sidePanel: {},
  runtime: { id: 'extension-id', getURL: (path: string) => 'chrome-extension://extension-id' + path, onMessage: event('message'), getContexts: async () => [], sendMessage: async () => {} },
  tabs: { onRemoved: event('removed'), get: async () => ({}), query: async () => [], sendMessage: async () => true, create: async () => ({ id: 1 }) },
  webNavigation: { onCommitted: event('committed'), getFrame: async () => undefined, getAllFrames: async () => [] },
  storage: {
    local: { setAccessLevel: async () => {}, get: async () => ({ excludedHosts: [] }), set: async () => {} },
    session: {
      setAccessLevel: async () => {},
      async get(key: string | null) { if (key === null) return Object.fromEntries(session); return { [key]: session.get(key) }; },
      async set(values: Record<string, unknown>) { for (const [key, value] of Object.entries(values)) session.set(key, value); },
      async remove(key: string) { session.delete(key); },
    },
    onChanged: event('storage'),
  },
};
Object.defineProperty(globalThis, '__p11', { value: { browser }, configurable: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'wxt/browser') return { url: 'p11:browser', shortCircuit: true };
    if (specifier === 'wxt/utils/define-background') return { url: 'p11:background', shortCircuit: true };
    if (context.parentURL?.endsWith('/extension/entrypoints/background.ts') && specifier === '../lib/helper-reconnect.ts') return { url: 'p11:helper', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'p11:browser') return { format: 'module', source: 'export const browser=globalThis.__p11.browser;', shortCircuit: true };
    if (url === 'p11:background') return { format: 'module', source: 'export const defineBackground=fn=>{globalThis.__p11.capture(fn)};', shortCircuit: true };
    if (url === 'p11:helper') return { format: 'module', source: "export const HELPER_RECONNECT_ALARM='marginalia-helper-reconnect'; export const helperReconnect=()=>({status:async()=>'',setEnabled:async()=>'',reconnect:async()=>{globalThis.__p11.reconnects()}});", shortCircuit: true };
    return next(url, context);
  },
});
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

test('background alarm only redials and workspace session bindings expire with their tabs', async () => {
  (globalThis as any).__p11.capture = (fn: () => void) => { background = fn; };
  (globalThis as any).__p11.reconnects = () => { reconnects++; };
  Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_key: string, work: () => unknown) => work() } }, configurable: true });
  const moduleUrl = new URL('../extension/entrypoints/background.ts', import.meta.url).href;
  await import(moduleUrl); background!(); await settle();
  listeners.alarm({ name: 'other' }); listeners.alarm({ name: 'marginalia-helper-reconnect' });
  assert.equal(reconnects, 1);
  const baseline = session.size;
  for (let tabId = 1; tabId <= 50; tabId++) session.set('workspace:' + tabId, { tabId, url: 'https://example.test/' + tabId, surfaceTab: tabId + 100 });
  for (let tabId = 1; tabId <= 50; tabId++) listeners.removed(tabId);
  await settle(); assert.equal(session.size, baseline);
  session.set('workspace:hash', { tabId: 99, url: 'https://example.test/page?q=1', surfaceTab: 199 });
  listeners.committed({ tabId: 99, frameId: 0, url: 'https://example.test/page?q=1#section' }); await settle();
  assert.equal(session.has('workspace:hash'), true);
  listeners.committed({ tabId: 99, frameId: 0, url: 'https://example.test/other' }); await settle();
  assert.equal(session.has('workspace:hash'), false);
});

test('saved-mark relay validates sender, exclusion, capture identity and bounds before targeting the browser document', async t => {
  (globalThis as any).__p11.capture = (fn: () => void) => { background = fn; };
  (globalThis as any).__p11.reconnects = () => {};
  await import(new URL('../extension/entrypoints/background.ts', import.meta.url).href); background!(); await settle();
  const url = 'https://source.example/page', document = 'capture-id', panel = 'chrome-extension://extension-id/panel.html';
  const anchor = { exact: 'Text', prefix: '', suffix: '', start: 0, end: 4 };
  const snapshot = { document, revision: 1, anchor, position: 0, sections: [{ title: 'Text', start: 0, end: 4 }], capture: { url, title: 'Text', pageType: 'article', text: 'Text', extractionVersion: 'dom-safe-text-v1', capturedAt: '2026-09-18T00:00:00Z' } };
  let excludedHosts: string[] = [], frameDocument = 'browser-document';
  const sent: any[] = [];
  t.mock.method(browser.runtime, 'getContexts', async () => [{ documentId: 'panel-document', documentUrl: panel, windowId: 1 }]);
  t.mock.method(browser.tabs, 'query', async () => [{ id: 7, url }]);
  t.mock.method(browser.tabs, 'get', async () => ({ id: 7, url }));
  t.mock.method(browser.storage.local, 'get', async () => ({ excludedHosts }));
  t.mock.method(browser.webNavigation, 'getFrame', async () => ({ documentId: frameDocument, documentLifecycle: 'active', url }));
  t.mock.method(browser.tabs, 'sendMessage', async (...args: any[]) => {
    if (args[1].type === 'snapshot') return { ok: true, value: snapshot };
    sent.push(args); return { ok: true, value: true };
  });
  const sender = { id: 'extension-id', url: panel, documentId: 'panel-document' };
  const packet = { type: 'surface', version: 1, action: 'saved-marks', document, url, revision: 1, marks: [{ anchor: { ...anchor, privateNote: 'do not forward' }, highlighted: true, note: 'do not forward' }] };
  const send = (value = packet, from = sender) => new Promise<any>(resolve => listeners.message(value, from, resolve));
  assert.equal((await send()).ok, true); assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][2], { documentId: 'browser-document', frameId: 0 });
  assert.equal(JSON.stringify(sent).includes('do not forward'), false);
  for (const change of [{ document: 'other' }, { revision: 2 }, { url: 'https://other.example/' }, { marks: Array(501).fill(packet.marks[0]) }]) assert.equal((await send({ ...packet, ...change })).ok, false);
  assert.equal((await send(packet, { ...sender, id: 'spoof' })).value, undefined);
  excludedHosts = ['source.example']; assert.equal((await send()).ok, false);
  excludedHosts = []; frameDocument = 'changed-browser-document';
  // Captured document is checked separately; routing always targets the newly
  // verified native document rather than a caller-supplied tab/document target.
  assert.equal((await send()).ok, true); assert.equal(sent.at(-1)[2].documentId, frameDocument);
  assert.equal(sent.length, 2);
});
