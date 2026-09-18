import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { replaceGlobals, settle, TestElement } from './t05-dom.ts';
import type { ReplyState } from '../ui/persistence.ts';

/** The installed scientific renderer/validator and T11/T13 mounts are separately
 * owned boundaries. These fixtures do not certify scientific claims or consent.
 * ReaderJournal, reader validation, persistence, helper and T05 UI remain real. */
export const boundaries = {
  replyMounts: [] as { intent: string | undefined; capabilities: readonly string[] | undefined; onFollowup?: (context: any) => Promise<void> }[],
  libraryOptions: undefined as any,
  libraryMounts: 0,
  canonicalReplyData(value: unknown): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Canonical data must contain finite numbers.'); return JSON.stringify(value); }
    if (Array.isArray(value)) return `[${value.map(boundaries.canonicalReplyData).join(',')}]`;
    if (typeof value === 'object' && value !== null) { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${boundaries.canonicalReplyData(record[key])}`).join(',')}}`; }
    throw new Error('Canonical data must be JSON.');
  },
  validateReply(value: any) { return value?.schema === 't05.fixture' ? { ok: true, value } : { ok: false, errors: ['Rejected fixture; not a scientific validator.'] }; },
  capabilitiesForIntent(intent: string) { return intent === 'evidence' ? ['samples', 'network.citations'] : intent === 'explore' ? ['samples', 'network.shelf'] : ['samples']; },
  mountReply(root: HTMLElement, reply: any, options: any) {
    boundaries.replyMounts.push({ intent: reply.intent, capabilities: options.capabilities && [...options.capabilities], onFollowup: options.onFollowup });
    let state = structuredClone(options.initialState ?? { parameters: { x: 0 }, view: {} }) as ReplyState;
    if (reply.normalize) state.parameters.x = 0;
    const field = document.createElement('input'); field.type = 'number'; field.setAttribute('aria-label', 'Controlled reply input'); field.value = String(state.parameters.x); root.append(field);
    field.addEventListener('input', () => { state.parameters.x = Number(field.value); void options.onStateChange?.(structuredClone(state))?.catch(() => {}); });
    return { getState: () => structuredClone(state), destroy: () => field.remove() };
  },
  mountConsentSheet() { return { destroy() {} }; },
  mountLibrary(root: HTMLElement, options: unknown) { boundaries.libraryOptions = options; boundaries.libraryMounts++; const content = document.createElement('section'); content.textContent = 'T11 mount boundary fixture'; root.replaceChildren(content); return { destroy() { content.remove(); } }; },
};
Object.defineProperty(globalThis, '__t05Boundaries', { value: boundaries, configurable: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.css')) return { url: 't05:css', shortCircuit: true };
    if (context.parentURL?.includes('/ui/') && specifier.endsWith('/contracts/reply.ts')) return { url: 't05:reply', shortCircuit: true };
    if (context.parentURL?.includes('/ui/') && specifier.endsWith('/renderer/index.ts')) return { url: 't05:renderer', shortCircuit: true };
    if (context.parentURL?.endsWith('/ui/asking-host.ts') && specifier === './consent.ts') return { url: 't05:consent', shortCircuit: true };
    if (context.parentURL?.endsWith('/webapp/main.ts') && specifier === './library/index.ts') return { url: 't05:library', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 't05:css') return { format: 'module', source: '', shortCircuit: true };
    const names: Record<string, string> = { 't05:reply': 'canonicalReplyData, capabilitiesForIntent, validateReply', 't05:renderer': 'mountReply', 't05:consent': 'mountConsentSheet', 't05:library': 'mountLibrary' };
    if (names[url]) return { format: 'module', source: `export const { ${names[url]} } = globalThis.__t05Boundaries;`, shortCircuit: true };
    if (url.includes('/webapp/main.ts')) return { format: 'module-typescript', source: readFileSync(new URL(url), 'utf8').replace('import.meta.env.PROD', 'false'), shortCircuit: true };
    return next(url, context);
  },
});

export function storage(t: TestContext) {
  const stores = new Map<string, Map<string, unknown>>(), tails = new Map<string, Promise<void>>(), locks = new Map<string, Promise<unknown>>();
  let beforeWrite = async (_key: string, _value: unknown) => {}, beforeRead = async (_key: string) => {}, openFailure = false;
  const data = (name: string) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name)!; };
  replaceGlobals(t, {
    navigator: { locks: { request<T>(key: string, fn: () => Promise<T>): Promise<T> { const pending = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn); locks.set(key, pending.catch(() => {})); return pending; } } },
    IDBKeyRange: { bound: (lower: string, upper: string) => ({ lower, upper }) },
    indexedDB: { open(name: string) {
      const opened: any = {};
      setImmediate(() => {
        if (openFailure) { opened.error = new Error('Storage is unavailable'); opened.onerror?.(); return; }
        const first = !stores.has(name); data(name);
        opened.result = { createObjectStore() {}, transaction(_store: string, mode = 'readonly') {
          const tx: any = {}, operations: any[] = [];
          tx.objectStore = () => ({
            get(key: string) { const request: any = {}; operations.push({ kind: 'get', key, request }); return request; },
            getAll(range: { lower: string; upper: string }) { const request: any = {}; operations.push({ kind: 'all', range, request }); return request; },
            put(value: unknown, key: string) { operations.push({ kind: 'put', key, value: structuredClone(value), request: {} }); },
          });
          const pending = (tails.get(name) ?? Promise.resolve()).then(async () => {
            await settle(); const next = new Map(data(name));
            try {
              for (const op of operations) {
                if (op.kind === 'put') { await beforeWrite(op.key, op.value); next.set(op.key, structuredClone(op.value)); }
                else if (op.kind === 'get') { await beforeRead(op.key); op.request.result = structuredClone(next.get(op.key)); }
                else op.request.result = [...next].filter(([key]) => key >= op.range.lower && key <= op.range.upper).map(([, value]) => structuredClone(value));
                op.request.onsuccess?.();
              }
              if (mode === 'readwrite') stores.set(name, next);
              tx.oncomplete?.();
            } catch (error) { tx.error = error; for (const op of operations) { op.request.error = error; op.request.onerror?.(); } tx.onabort?.(); tx.onerror?.(); }
          });
          tails.set(name, pending.catch(() => {})); return tx;
        } };
        if (first) opened.onupgradeneeded?.(); opened.onsuccess?.();
      }); return opened;
    } },
  });
  const channels = new Set<any>();
  class Channel {
    name: string; listeners: ((event: { data: unknown }) => void)[] = [];
    constructor(name: string) { this.name = name; channels.add(this); }
    addEventListener(_type: string, callback: (event: { data: unknown }) => void) { this.listeners.push(callback); }
    postMessage(value: unknown) { setImmediate(() => { for (const peer of channels) if (peer !== this && peer.name === this.name) for (const fn of peer.listeners) fn({ data: structuredClone(value) }); }); }
    close() { channels.delete(this); }
  }
  replaceGlobals(t, { BroadcastChannel: Channel, fetch: async () => { throw new Error('Unexpected network in this controlled test'); } });
  return { data, Channel, onWrite(fn: typeof beforeWrite) { beforeWrite = fn; }, onRead(fn: typeof beforeRead) { beforeRead = fn; }, failOpen(value: boolean) { openFailure = value; } };
}
export const asHost = (node: TestElement) => node as unknown as HTMLElement;
