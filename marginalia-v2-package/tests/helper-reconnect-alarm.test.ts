import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const records = new Map<string, unknown>([
  ['extension-helper-enabled', true],
  ['pairing', { origin: 'http://127.0.0.1:43120', token: 'a'.repeat(43) }],
]);
const session = new Map<string, unknown>(), created: unknown[] = [], cleared: string[] = [];
const browser = {
  storage: {
    session: {
      async get(key: string) { return { [key]: session.get(key) }; },
      async set(values: Record<string, unknown>) { for (const [key, value] of Object.entries(values)) session.set(key, value); },
      async remove(key: string) { session.delete(key); },
    },
    onChanged: { addListener() {} },
  },
  alarms: {
    create(name: string, options: unknown) { created.push({ name, options }); },
    async clear(name: string) { cleared.push(name); return true; },
  },
};
Object.defineProperty(globalThis, '__p10', { value: { browser, persistence: {
  journal: {}, async read(key: string) { return records.get(key); }, async write(key: string, value: unknown) { records.set(key, value); },
} }, configurable: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'wxt/browser') return { url: 'p10:browser', shortCircuit: true };
    if (context.parentURL?.endsWith('/extension/lib/helper-reconnect.ts')) {
      if (specifier.endsWith('/ui/persistence.ts')) return { url: 'p10:persistence', shortCircuit: true };
      if (specifier.endsWith('/ui/journal.ts')) return { url: 'p10:journal', shortCircuit: true };
      if (specifier.endsWith('/ui/helper.ts')) return { url: 'p10:helper', shortCircuit: true };
      if (specifier === './helper-origin.ts') return { url: 'p10:origin', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const sources: Record<string, string> = {
      'p10:browser': 'export const browser = globalThis.__p10.browser;',
      'p10:persistence': 'export const localPersistence = () => globalThis.__p10.persistence;',
      'p10:journal': 'export class ReaderJournal { async load() {} async sync(_save, list) { await list(); } }',
      'p10:helper': 'export class HelperClient { set token(value) {} async list() { globalThis.__p10.requests++; return []; } }',
      'p10:origin': "export const HELPER_ORIGIN_KEY='helperOrigin'; export const helperOrigin=async()=> 'http://127.0.0.1:43120';",
    };
    return sources[url] ? { format: 'module', source: sources[url], shortCircuit: true } : next(url, context);
  },
});

test('disconnect schedules a persisted alarm; alarm redial only probes and connect clears it', async t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const sockets: any[] = [];
  class Socket { static OPEN = 1; readyState = 0; url: string; onopen?: () => void; onmessage?: (event: unknown) => void; onerror?: () => void; onclose?: (event: { code: number }) => void; sent: string[] = []; constructor(url: string) { this.url = url; sockets.push(this); } send(value: string) { this.sent.push(value); } close() {} }
  Object.assign(globalThis as any, { WebSocket: Socket, BroadcastChannel: class { addEventListener() {} postMessage() {} } });
  Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_key: string, work: () => unknown) => work() } }, configurable: true });
  (globalThis as any).__p10.requests = 0;
  const moduleUrl = new URL('../extension/lib/helper-reconnect.ts', import.meta.url).href;
  const { helperReconnect, HELPER_RECONNECT_ALARM } = await import(moduleUrl);
  const helper = helperReconnect();
  await helper.status();
  assert.equal(sockets.length, 1);
  sockets[0].onclose({ code: 1006 }); await new Promise(setImmediate);
  assert.deepEqual(created.at(-1), { name: HELPER_RECONNECT_ALARM, options: { periodInMinutes: 1 } });
  assert.ok(session.has('helper-reconnect-backoff'));
  now += 60_000; await helper.reconnect();
  assert.equal(sockets.length, 2); assert.equal((globalThis as any).__p10.requests, 0);
  sockets[1].onopen(); await new Promise(setImmediate);
  assert.equal(sockets[1].sent.length, 1); assert.equal(session.has('helper-reconnect-backoff'), false);
  assert.equal(cleared.at(-1), HELPER_RECONNECT_ALARM);
});
