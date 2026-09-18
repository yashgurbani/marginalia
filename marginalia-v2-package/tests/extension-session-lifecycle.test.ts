import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const listeners: Record<string, Function> = {}, session = new Map<string, unknown>([['baseline', true]]);
let background: (() => void) | undefined, reconnects = 0;
const event = (name: string) => ({ addListener(fn: Function) { listeners[name] = fn; } });
const browser = {
  alarms: { onAlarm: event('alarm') }, action: { onClicked: event('clicked') }, sidePanel: {},
  runtime: { id: 'extension-id', getURL: (path: string) => 'chrome-extension://extension-id' + path, onMessage: event('message'), getContexts: async () => [] },
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
