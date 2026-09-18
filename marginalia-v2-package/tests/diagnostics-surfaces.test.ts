import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { storage } from './t05-harness.ts';
import { dom, button, until, deferred, replaceGlobals } from './t05-dom.ts';
import { localPersistence } from '../ui/persistence.ts';

const data = { schema: 'marginalia.diagnostics.v1', paired: true, dataDirectory: '/private-data', helperVersion: '0.2.0',
  backup: { state: 'none' }, codex: { status: 'installed', login: 'signed-out', version: '1.2.3', expectedVersion: '1.2.3' } };
const token = 'a'.repeat(43), origin = 'http://127.0.0.1:43120';
test('margin Settings reads diagnostics on demand and fences a replaced pairing; embedded host sends nothing', async t => {
  const { root } = dom(t); storage(t);
  const { mountMargin } = await import('../ui/margin.ts');
  const namespace = 'e10-margin-' + crypto.randomUUID();
  await localPersistence(namespace).write('pairing', { origin, token });
  const calls: string[] = [], pending = deferred<Response>();
  let delay = false;
  replaceGlobals(t, { fetch: async (url: string) => {
    calls.push(url);
    if (url.endsWith('/health')) return Response.json({ status: 'ready' });
    if (url.endsWith('/api/diagnostics')) return delay ? pending.promise : Response.json(data);
    return Response.json({ anchor: null });
  } });
  const capture = { url: 'https://example.org/read', title: 'Reading', text: 'A passage.', pageType: 'article' as const, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' };
  const mounted = await mountMargin(root as any, { capture, storageName: namespace, helperOrigin: origin });
  t.after(() => mounted.destroy());
  assert.equal(calls.some(c => c.endsWith('/api/diagnostics')), false);
  button(root, 'Settings').click(); await until(() => root.textContent.includes('Signed out'));
  assert.match(root.textContent, /How things are/);
  delay = true; button(root, 'Check how things are').click();
  await until(() => calls.filter(c => c.endsWith('/api/diagnostics')).length === 2);
  mounted.connection().token = 'b'.repeat(43); pending.resolve(Response.json({ ...data, dataDirectory: '/STALE' }));
  await new Promise(resolve => setTimeout(resolve, 20)); assert.doesNotMatch(root.textContent, /STALE/);
  mounted.destroy(); calls.length = 0;
  const embedded = await mountMargin(root as any, { capture, storageName: 'e10-embedded', helperOrigin: origin, allowHelper: false });
  button(root, 'Settings').click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, []); assert.doesNotMatch(root.textContent, /How things are/); embedded.destroy();
});

test('options uses extension read transport, drops late address results, and suppresses embedded diagnostics', async t => {
  const { document, root } = dom(t); storage(t);
  for (const [tag, id] of [['ul', 'sites'], ['form', 'add'], ['input', 'site-input'], ['p', 'status'], ['input', 'helper-origin'], ['p', 'helper-origin-status'], ['section', 'diagnostics'], ['form', 'helper-origin-form']]) {
    const node = document.createElement(tag); node.id = id; root.append(node);
  }
  const mockWindow = window as any; mockWindow.top = mockWindow;
  await localPersistence('marginalia-extension-reader').write('pairing', { origin, token });
  const pending = deferred<Response>(), calls: { url: string; init: RequestInit }[] = [];
  let changed: (changes: any, area: string) => void = () => {};
  const mockBrowser = { storage: { local: { get: async () => ({ helperOrigin: origin }), set: async () => {} },
    onChanged: { addListener: (fn: typeof changed) => { changed = fn; } } } };
  replaceGlobals(t, { __e10Browser: mockBrowser, fetch: async (url: string, init: RequestInit) => {
    calls.push({ url, init }); return url.endsWith('/health') ? Response.json({ status: 'ready' }) : pending.promise;
  } });
  const hook = registerHooks({ resolve(specifier, context, next) {
    return specifier === 'wxt/browser' ? { url: 'e10:browser', shortCircuit: true } : next(specifier, context);
  }, load(url, context, next) { return url === 'e10:browser'
    ? { format: 'module', source: 'export const browser = globalThis.__e10Browser;', shortCircuit: true } : next(url, context); } });
  t.after(() => { mockWindow.fire('pagehide'); hook.deregister(); });
  const entry = '../extension/entrypoints/options/main.ts'; await import(entry);
  await until(() => calls.some(c => c.url.endsWith('/api/read/diagnostics')));
  const sent = calls.find(c => c.url.endsWith('/api/read/diagnostics'))!;
  assert.equal(sent.init.method, 'POST'); assert.equal(sent.init.body, '{}');
  changed({ helperOrigin: { newValue: 'http://127.0.0.1:43200' } }, 'local');
  pending.resolve(Response.json({ ...data, dataDirectory: '/STALE' }));
  await until(() => root.textContent.includes('Not paired'));
  assert.doesNotMatch(root.textContent, /STALE/);
  const before = calls.length; mockWindow.top = {};
  changed({ helperOrigin: { newValue: origin } }, 'local');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, before); assert.equal(document.querySelector('#diagnostics')!.textContent, '');
});
