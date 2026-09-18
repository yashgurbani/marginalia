import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('background Resume bridge rechecks the active source and forwards only a uniquely attached anchor', async t => {
  const listeners: Record<string, (...args: any[]) => unknown> = {};
  const event = (name: string) => ({ addListener(listener: (...args: any[]) => unknown) { listeners[name] = listener; } });
  const sourceUrl = 'https://example.org/article';
  const text = 'prefix saved passage suffix';
  const capture = {
    document: 'content-doc', revision: 1, position: 7, anchor: null,
    sections: [{ title: 'Page', start: 0, end: text.length }],
    capture: { url: sourceUrl, title: 'Page', pageType: 'article', text, capturedAt: '2026-09-18T00:00:00.000Z', extractionVersion: 'dom-safe-text-v1', sections: [{ title: 'Page', start: 0, end: text.length }] },
  };
  const thread = {
    id: 'thread-1', state: 'parked' as const, deletedAt: null, sourceUrl,
    anchorId: 'anchor-1', sourceVersionId: 'version-1', sourceTitle: 'Page', revision: 1,
    createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z', notes: [], highlighted: false,
    anchor: { kind: 'quote' as const, exact: 'saved passage', prefix: '', suffix: '', start: 7, end: 20 },
  };
  const calls: unknown[] = [];
  const persistence = {
    journal: { load: async () => ({ threads: [thread], pending: [], conflicts: [] }), save: async () => {} },
    read: async (_key: string) => undefined,
  };
  const browser = {
    runtime: { id: 'test', getURL: (path: string) => 'chrome-extension://test' + path, onMessage: event('message'), getContexts: async () => [] },
    alarms: { onAlarm: event('alarm') }, action: { onClicked: event('click') }, sidePanel: {},
    tabs: {
      onRemoved: event('removed'),
      get: async () => ({ id: 1, url: sourceUrl, incognito: false }),
      query: async () => [],
      sendMessage: async (_tab: number, message: { type: string; document?: string; anchor?: unknown }) => {
        if (message.type === 'snapshot') return { ok: true, value: capture };
        if (message.type === 'scroll') { calls.push(message); return { ok: true, value: true }; }
        return { ok: true, value: true };
      },
    },
    webNavigation: { onCommitted: event('committed'), onHistoryStateUpdated: event('history'), getFrame: async () => ({ documentId: 'content-doc', documentLifecycle: 'active', url: sourceUrl }) },
    storage: {
      onChanged: event('storage'),
      local: { setAccessLevel: async () => {}, get: async () => ({ excludedHosts: [] }) },
      session: { setAccessLevel: async () => {}, get: async () => ({}), remove: async () => {}, set: async () => {} },
    },
  };
  const globalKey = '__resumeBridgeTest';
  Object.defineProperty(globalThis, globalKey, { configurable: true, value: { browser, capture: (fn: () => void) => { listeners.start = fn; }, persistence } });
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name: string, work: () => unknown) => work() } } });
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'wxt/browser') return { url: 'resume-test:browser', shortCircuit: true };
      if (specifier === 'wxt/utils/define-background') return { url: 'resume-test:background', shortCircuit: true };
      if (context.parentURL?.includes('/extension/entrypoints/background.ts') && specifier === '../lib/instant-worker.ts') return { url: 'resume-test:worker', shortCircuit: true };
      if (specifier === '../lib/helper-reconnect.ts') return { url: 'resume-test:helper', shortCircuit: true };
      if (context.parentURL?.includes('/extension/entrypoints/background.ts') && specifier === '../../ui/journal.ts') return { url: 'resume-test:journal', shortCircuit: true };
      if (context.parentURL?.includes('/extension/entrypoints/background.ts') && specifier === '../../ui/persistence.ts') return { url: 'resume-test:persistence', shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      const source = url === 'resume-test:browser' ? 'export const browser=globalThis.__resumeBridgeTest.browser;'
        : url === 'resume-test:background' ? 'export const defineBackground=fn=>globalThis.__resumeBridgeTest.capture(fn);'
        : url === 'resume-test:worker' ? 'export const instantWorker=()=>({ release: async()=>{}, autoAssistPolicy: async()=>({ enabled: false }) });'
        : url === 'resume-test:helper' ? "export const HELPER_RECONNECT_ALARM='test';export const helperReconnect=()=>({});"
        : url === 'resume-test:journal' ? 'export class ReaderJournal { constructor(persistence){ this.persistence=persistence; this.state={ threads:[], pending:[], conflicts:[] }; } async load(){ this.state=await this.persistence.load(); return this.state; } }'
        : url === 'resume-test:persistence' ? 'export const localPersistence=()=>globalThis.__resumeBridgeTest.persistence;'
        : undefined;
      return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
    },
  });
  t.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, globalKey); if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); });
  await import(new URL('../extension/entrypoints/background.ts?resume-bridge-test', import.meta.url).href);
  (listeners.start as (() => void) | undefined)?.();
  const message = (body: unknown, sender: unknown) => new Promise<{ ok: boolean; value?: unknown }>(resolve => { listeners.message(body, sender, resolve); });
  const sender = { id: 'test', tab: { id: 1, incognito: false }, frameId: 0, documentId: 'content-doc', url: sourceUrl };
  const result = await message({ type: 'resume', version: 1, threadId: 'thread-1' }, sender);
  assert.deepEqual(result, { ok: true, value: { consumed: true, resumed: true } });
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { document: string }).document, 'content-doc');
  assert.equal(((calls[0] as { anchor: { exact: string } }).anchor).exact, 'saved passage');
  const missing = await message({ type: 'resume', version: 1, threadId: 'missing' }, sender);
  assert.deepEqual(missing, { ok: true, value: { consumed: true, resumed: false } });
  assert.equal(calls.length, 1);
});
