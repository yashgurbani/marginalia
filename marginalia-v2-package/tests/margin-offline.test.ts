import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/** Executes the production service-worker handlers. CacheStorage here models
 * ordering/failures, not browser quota, eviction or install conformance. */
function worker() {
  const stores = new Map<string, Map<string, Response>>(), files = new Map<string, string>(), handlers = new Map<string, (event: any) => void>();
  const origin = 'http://localhost:43120'; let failPointer = false, failAsset = '';
  const path = (input: string | Request) => new URL(typeof input === 'string' ? input : input.url, origin).pathname;
  const cacheStorage = { async open(name: string) { let store = stores.get(name); if (!store) { store = new Map(); stores.set(name, store); } return {
    async put(key: string, response: Response) { if (failPointer && path(key).includes('complete_generation')) throw new Error('pointer quota'); store!.set(path(key), response.clone()); },
    async match(key: string) { return store!.get(path(key))?.clone(); },
  }; }, async keys() { return [...stores.keys()]; }, async delete(name: string) { return stores.delete(name); } };
  const fetched: string[] = [];
  runInNewContext(readFileSync(new URL('../webapp/public/sw.js', import.meta.url), 'utf8'), {
    URL, Request, Response, TextEncoder, crypto, AbortSignal, caches: cacheStorage,
    self: { location: { origin }, addEventListener: (type: string, fn: (event: any) => void) => handlers.set(type, fn), clients: { claim: async () => {} }, skipWaiting: async () => {} },
    fetch: async (value: string | Request) => { const key = path(value); fetched.push(key); if (key === failAsset || !files.has(key)) throw new Error('offline: ' + key); return new Response(files.get(key)); },
  });
  return { files, stores, fetched, failPointer(value: boolean) { failPointer = value; }, failAsset(value: string) { failAsset = value; },
    async install() { let work: Promise<void> | undefined; handlers.get('install')!({ waitUntil(promise: Promise<void>) { work = promise; } }); await work; },
    request(url = '/', options?: RequestInit) { let work: Promise<Response> | undefined; handlers.get('fetch')!({ request: new Request(origin + url, options), respondWith(promise: Promise<Response>) { work = promise; } }); return work; },
  };
}
function oldBuild(w: ReturnType<typeof worker>) { w.files.set('/index.html', '<script type="module" src="/assets/old.js"></script>'); w.files.set('/assets/old.js', 'export const old = 1;'); }
test('missing transitive chunk/font prevents index promotion and previous offline shell remains usable', async () => {
  const w = worker(); oldBuild(w); await w.install();
  w.files.set('/index.html', '<script src="/assets/main.js"></script>'); w.files.set('/assets/main.js', 'import("./lazy.js");');
  assert.match(await (await w.request()!).text(), /old.js/);
  w.files.set('/assets/lazy.js', 'import "./style.css";'); w.files.set('/assets/style.css', 'body{src:url(./font.woff2)}');
  assert.match(await (await w.request()!).text(), /old.js/);
  w.files.set('/assets/font.woff2', 'font bytes'); assert.match(await (await w.request()!).text(), /main.js/);
  w.files.clear(); assert.match(await (await w.request()!).text(), /main.js/); assert.equal(await (await w.request('/assets/font.woff2')!).text(), 'font bytes');
  assert.match(await (await w.request('/assets/old.js')!).text(), /old/);
});
test('failed pointer write does not promote an orphan complete index, and same build reuses complete cache', async () => {
  const w = worker(); oldBuild(w); await w.install(); await w.request(); assert.equal(w.stores.size, 2);
  w.files.set('/index.html', '<script src="/assets/new.js"></script>'); w.files.set('/assets/new.js', 'new code'); w.failPointer(true);
  assert.match(await (await w.request()!).text(), /old.js/); w.files.clear(); assert.match(await (await w.request()!).text(), /old.js/);
});
test('Vite dependency maps and module URL assets are staged, ordinary prose filenames are not fetched', async () => {
  const w = worker(); w.files.set('/index.html', '<script src="/assets/main.js"></script>');
  w.files.set('/assets/main.js', 'const deps=["assets/lazy.js"]; new URL("./figure.svg", import.meta.url); const prose="solver.js";');
  w.files.set('/assets/lazy.js', 'export{}'); w.files.set('/assets/figure.svg', '<svg/>'); await w.install();
  assert.ok(w.fetched.includes('/assets/lazy.js')); assert.ok(w.fetched.includes('/assets/figure.svg')); assert.ok(!w.fetched.includes('/assets/solver.js'));
});
test('private, helper, authenticated, non-GET and external query requests bypass interception entirely', () => {
  const w = worker(); for (const url of ['/api/jobs', '/api/threads', '/api/consent/settings', '/api/helper-management/pairing-code', '/pair', '/health', '/assets/a.js?private=true']) assert.equal(w.request(url), undefined);
  assert.equal(w.request('/assets/a.js', { headers: { authorization: 'Bearer test' } }), undefined); assert.equal(w.request('/', { method: 'POST' }), undefined); assert.deepEqual(w.fetched, []);
});
test('first install failure leaves no promoted shell and never falls back to a possibly incomplete legacy index', async () => {
  const w = worker(); const legacy = new Map<string, Response>(); legacy.set('/index.html', new Response('<script src="missing.js"></script>')); w.stores.set('marginalia-page-v1', legacy);
  await assert.rejects(w.install(), /offline/); await assert.rejects(w.request()!, /No complete offline/);
});
