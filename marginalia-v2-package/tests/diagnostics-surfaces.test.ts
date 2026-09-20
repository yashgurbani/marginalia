import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { storage } from './t05-harness.ts';
import { dom, button, until, deferred, replaceGlobals } from './t05-dom.ts';
import { localPersistence } from '../ui/persistence.ts';

const data = { schema: 'marginalia.diagnostics.v1', paired: true, dataDirectory: '/private-data', helperVersion: '0.2.0',
  backup: { state: 'none' }, codex: { status: 'installed', login: 'signed-out', version: '1.2.3', expectedVersion: '1.2.3' } };
const token = 'a'.repeat(43), origin = 'http://127.0.0.1:43120';
function addPairingControls(document: any, root: any) {
  const form = document.createElement('form'); form.id = 'pairing-form'; form.hidden = true;
  const input = document.createElement('input'); input.id = 'pairing-code';
  const submit = document.createElement('button'); submit.textContent = 'Pair'; form.append(input, submit); root.append(form);
  return { form, input, submit };
}
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
  for (const [tag, id] of [['ul', 'sites'], ['form', 'add'], ['input', 'site-input'], ['p', 'status'], ['input', 'helper-origin'], ['p', 'helper-origin-status'], ['p', 'diagnostics-status'], ['section', 'diagnostics'], ['form', 'helper-origin-form']]) {
    const node = document.createElement(tag); node.id = id; root.append(node);
  }
  addPairingControls(document, root);
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
  await until(() => root.textContent.includes('six-digit code'));
  assert.doesNotMatch(root.textContent, /STALE/);
  const before = calls.length; mockWindow.top = {};
  changed({ helperOrigin: { newValue: origin } }, 'local');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, before); assert.equal(document.querySelector('#diagnostics')!.textContent, '');
});

test('D64 options collapses pre-pair diagnostics and completes the existing code exchange', async t => {
  const { document, root } = dom(t); storage(t);
  for (const [tag, id] of [['ul', 'sites'], ['form', 'add'], ['input', 'site-input'], ['p', 'status'], ['input', 'helper-origin'], ['p', 'helper-origin-status'], ['p', 'diagnostics-status'], ['section', 'diagnostics'], ['form', 'helper-origin-form']]) {
    const node = document.createElement(tag); node.id = id; root.append(node);
  }
  const controls = addPairingControls(document, root), returnedToken = 'b'.repeat(43);
  const mockWindow = window as any; mockWindow.top = mockWindow;
  const calls: { url: string; init: RequestInit }[] = [];
  const mockBrowser = { storage: { local: { get: async () => ({ helperOrigin: origin }), set: async () => {} }, onChanged: { addListener() {} } } };
  replaceGlobals(t, { __d64Browser: mockBrowser, fetch: async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/health')) return Response.json({ status: 'ready' });
    if (url.endsWith('/pair')) return Response.json({ token: returnedToken, codex: { account: 'CODEX_SENTINEL' } });
    if (url.endsWith('/api/read/diagnostics')) return Response.json(data);
    throw new Error('unexpected route');
  } });
  const hook = registerHooks({ resolve(specifier, context, next) {
    return specifier === 'wxt/browser' ? { url: 'e10:d64-browser', shortCircuit: true } : next(specifier, context);
  }, load(url, context, next) { return url === 'e10:d64-browser'
    ? { format: 'module', source: 'export const browser = globalThis.__d64Browser;', shortCircuit: true } : next(url, context); } });
  t.after(() => { mockWindow.fire('pagehide'); hook.deregister(); });
  await import('../extension/entrypoints/options/main.ts?' + 'd64=pairing');
  await until(() => document.querySelector('#diagnostics-status')!.textContent.includes('six-digit code'));
  assert.equal(controls.form.hidden, false);
  assert.equal(document.querySelector('#diagnostics')!.textContent, '');
  assert.doesNotMatch(root.textContent, /Unknown|browser margin Settings/);
  assert.equal(calls.filter(call => call.url.endsWith('/api/read/diagnostics')).length, 0);

  controls.input.value = '001-234';
  await (controls.form as any).onsubmit({ preventDefault() {} });
  await until(() => document.querySelector('#diagnostics')!.textContent.includes('Data folder'));
  const pair = calls.find(call => call.url.endsWith('/pair'))!;
  assert.equal(pair.init.method, 'POST'); assert.equal(pair.init.body, JSON.stringify({ challenge: '001234' }));
  assert.equal(pair.init.credentials, 'omit');
  assert.equal((pair.init.headers as Record<string, string>).authorization, undefined);
  assert.equal((await localPersistence('marginalia-extension-reader').read<{ origin: string; token: string }>('pairing'))?.token, returnedToken);
  assert.equal(controls.form.hidden, true);
  assert.match(root.textContent, /Signed out/);
  assert.doesNotMatch(root.textContent, new RegExp(returnedToken));
  assert.doesNotMatch(root.textContent, /CODEX_SENTINEL/);
  assert.equal(calls.some(call => call.url.includes('/api/helper-management/')), false);
});

test('D64 options keeps the code fallback retryable without exposing transport details', async t => {
  const { document, root } = dom(t); storage(t);
  for (const [tag, id] of [['ul', 'sites'], ['form', 'add'], ['input', 'site-input'], ['p', 'status'], ['input', 'helper-origin'], ['p', 'helper-origin-status'], ['p', 'diagnostics-status'], ['section', 'diagnostics'], ['form', 'helper-origin-form']]) {
    const node = document.createElement(tag); node.id = id; root.append(node);
  }
  const controls = addPairingControls(document, root), calls: { url: string; init: RequestInit }[] = [];
  let rejectPair = true;
  const mockWindow = window as any; mockWindow.top = mockWindow;
  const mockBrowser = { storage: { local: { get: async () => ({ helperOrigin: origin }), set: async () => {} }, onChanged: { addListener() {} } } };
  replaceGlobals(t, { __d64RetryBrowser: mockBrowser, fetch: async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/health')) return Response.json({ status: 'ready' });
    if (url.endsWith('/pair') && rejectPair) return Response.json({ error: 'Pairing code did not match.' }, { status: 403 });
    if (url.endsWith('/pair')) return Response.json({ token: 'c'.repeat(43) });
    if (url.endsWith('/api/read/diagnostics')) return Response.json(data);
    throw new Error('unexpected route');
  } });
  const hook = registerHooks({ resolve(specifier, context, next) {
    return specifier === 'wxt/browser' ? { url: 'e10:d64-retry-browser', shortCircuit: true } : next(specifier, context);
  }, load(url, context, next) { return url === 'e10:d64-retry-browser'
    ? { format: 'module', source: 'export const browser = globalThis.__d64RetryBrowser;', shortCircuit: true } : next(url, context); } });
  t.after(() => { mockWindow.fire('pagehide'); hook.deregister(); });
  await import('../extension/entrypoints/options/main.ts?' + 'd64=retry');
  await until(() => !controls.form.hidden);
  controls.input.value = '123456';
  await (controls.form as any).onsubmit({ preventDefault() {} });
  assert.equal(document.querySelector('#diagnostics-status')!.textContent, 'That code did not match. Check it and try again.');
  assert.equal(controls.form.hidden, false);
  assert.equal(calls.filter(call => call.url.endsWith('/pair')).length, 1);
  assert.equal(await localPersistence('marginalia-extension-reader').read('pairing'), undefined);
  assert.doesNotMatch(root.textContent, /CODEX_SENTINEL|Bearer|Pairing expired\./i);

  rejectPair = false;
  await (controls.form as any).onsubmit({ preventDefault() {} });
  await until(() => document.querySelector('#diagnostics')!.textContent.includes('Data folder'));
  assert.equal(calls.filter(call => call.url.endsWith('/pair')).length, 2);
});

test('D64 persistence aborts an active pairing write before commit and keeps the old record', async t => {
  const harness = storage(t), namespace = 'd64-persistence-' + crypto.randomUUID(), persistence = localPersistence(namespace);
  const prior = { origin: 'http://127.0.0.1:43999', token: 'p'.repeat(43) }, replacement = { origin, token: 'n'.repeat(43) };
  await persistence.write('pairing', prior);
  const started = deferred<void>(), release = deferred<void>();
  harness.onWrite(async key => { if (key === 'pairing') { started.resolve(); await release.promise; } });
  const controller = new AbortController(), before = harness.transactionCount();
  const pending = persistence.write('pairing', replacement, () => true, controller.signal);
  await started.promise; assert.equal(harness.transactionCount(), before + 1);
  controller.abort(); release.resolve();
  await assert.rejects(pending, /Saving was interrupted/);
  assert.deepEqual(await persistence.read('pairing'), prior);

  const preAborted = new AbortController(); preAborted.abort();
  const transactions = harness.transactionCount();
  await persistence.write('pairing', replacement, () => true, preAborted.signal);
  assert.equal(harness.transactionCount(), transactions);
  assert.deepEqual(await persistence.read('pairing'), prior);
});

test('D64 persistence aborts a stale pairing write at request success without changing legacy writes', async t => {
  const harness = storage(t), namespace = 'd64-request-success-' + crypto.randomUUID(), persistence = localPersistence(namespace);
  const prior = { origin: 'http://127.0.0.1:43999', token: 'p'.repeat(43) }, replacement = { origin, token: 'n'.repeat(43) };
  await persistence.write('pairing', prior);
  let current = true;
  harness.onWrite(async key => { if (key === 'pairing') current = false; });
  const pending = persistence.write('pairing', replacement, () => current, new AbortController().signal);
  await assert.rejects(pending, /Saving was interrupted/);
  assert.deepEqual(await persistence.read('pairing'), prior);

  const legacy = { origin, token: 'l'.repeat(43) };
  await persistence.write('pairing', legacy, () => false);
  assert.deepEqual(await persistence.read('pairing'), prior);
});

test('D64 persistence treats cancellation after the committing boundary as completed', async t => {
  const harness = storage(t), namespace = 'd64-commit-boundary-' + crypto.randomUUID(), persistence = localPersistence(namespace);
  const prior = { origin: 'http://127.0.0.1:43999', token: 'p'.repeat(43) }, replacement = { origin, token: 'n'.repeat(43) };
  await persistence.write('pairing', prior);
  const committing = deferred<void>(), release = deferred<void>();
  harness.onCommit(async () => { committing.resolve(); await release.promise; });
  const controller = new AbortController(), pending = persistence.write('pairing', replacement, () => true, controller.signal);
  await committing.promise; controller.abort(); release.resolve();
  await pending;
  assert.deepEqual(await persistence.read('pairing'), replacement);
  harness.failCommit(true);
  const failed = persistence.write('pairing', prior, () => true, new AbortController().signal);
  await assert.rejects(failed, /Saving failed/);
  assert.deepEqual(await persistence.read('pairing'), replacement);
});

for (const race of ['address', 'pagehide'] as const) test('D64 options preserves the prior pairing when ' + race + ' cancels storage', async t => {
  const { document, root } = dom(t), harness = storage(t);
  for (const [tag, id] of [['ul', 'sites'], ['form', 'add'], ['input', 'site-input'], ['p', 'status'], ['input', 'helper-origin'], ['p', 'helper-origin-status'], ['p', 'diagnostics-status'], ['section', 'diagnostics'], ['form', 'helper-origin-form']]) {
    const node = document.createElement(tag); node.id = id; root.append(node);
  }
  const controls = addPairingControls(document, root), prior = { origin: 'http://127.0.0.1:43999', token: 'p'.repeat(43) }, returnedToken = 'n'.repeat(43);
  const mockWindow = window as any; mockWindow.top = mockWindow;
  await localPersistence('marginalia-extension-reader').write('pairing', prior);
  const writeStarted = deferred<void>(), releaseWrite = deferred<void>();
  harness.onWrite(async key => { if (key === 'pairing') { writeStarted.resolve(); await releaseWrite.promise; } });
  let changed: (changes: any, area: string) => void = () => {};
  const mockBrowser = { storage: { local: { get: async () => ({ helperOrigin: origin }), set: async () => {} }, onChanged: { addListener: (fn: typeof changed) => { changed = fn; } } } };
  replaceGlobals(t, { ['__d64WriteRace' + race + 'Browser']: mockBrowser, fetch: async (url: string, init: RequestInit) => {
    if (url.endsWith('/health')) return Response.json({ status: 'ready' });
    if (url.endsWith('/pair')) return Response.json({ token: returnedToken });
    if (url.endsWith('/api/read/diagnostics')) return Response.json(data);
    throw new Error('unexpected route');
  } });
  const hook = registerHooks({ resolve(specifier, context, next) {
    return specifier === 'wxt/browser' ? { url: 'e10:d64-write-race-browser-' + race, shortCircuit: true } : next(specifier, context);
  }, load(url, context, next) { return url === 'e10:d64-write-race-browser-' + race
    ? { format: 'module', source: `export const browser = globalThis.__d64WriteRace${race}Browser;`, shortCircuit: true } : next(url, context); } });
  t.after(() => { if (race === 'address') mockWindow.fire('pagehide'); hook.deregister(); });
  await import('../extension/entrypoints/options/main.ts?d64=write-race-' + race);
  await until(() => !controls.form.hidden);
  controls.input.value = '123456';
  const submission = (controls.form as any).onsubmit({ preventDefault() {} });
  await writeStarted.promise;
  if (race === 'address') changed({ helperOrigin: { newValue: prior.origin } }, 'local'); else mockWindow.fire('pagehide');
  releaseWrite.resolve(); await submission;
  assert.deepEqual(await localPersistence('marginalia-extension-reader').read('pairing'), prior);
  assert.doesNotMatch(root.textContent, new RegExp(returnedToken));
});

for (const [fragment, expected, excludedHosts = ['example.org'], focusHost = 'example.org'] of [['#site=example.org', true], ['#site=example%2eorg', false], ['#site=other.org', false], ['#site=EXAMPLE.org', false], ['#site=example.org&code=123456', false], ['#site=sub.example.org', true], ['#site=notexample.org', false], ['#site=example.org.other', false], ['#site=deep.sub.example.org', true, ['example.org', 'sub.example.org'], 'sub.example.org'], ['#site=sub.example.org', true, ['sub.example.org', 'example.org'], 'sub.example.org']] as const) test('C5 options focuses only a literal matching exclusion: ' + fragment, async t => {
  const { document, root } = dom(t); storage(t); document.location.hash = fragment;
  for (const [tag, id] of [['ul', 'sites'], ['form', 'add'], ['input', 'site-input'], ['p', 'status'], ['input', 'helper-origin'], ['p', 'helper-origin-status'], ['p', 'diagnostics-status'], ['section', 'diagnostics'], ['form', 'helper-origin-form']]) {
    const node = document.createElement(tag); node.id = id; root.append(node);
  }
  const mockWindow = window as any; mockWindow.top = mockWindow; const writes: unknown[] = [];
  replaceGlobals(t, { __c5Browser: { storage: { local: { get: async () => ({ excludedHosts, helperOrigin: origin }), set: async (value: unknown) => { writes.push(value); } }, onChanged: { addListener() {} } }, runtime: { sendMessage: async (value: unknown) => { writes.push(value); } } }, fetch: async () => { throw new Error('offline'); } });
  const browserModule = 'c5:browser:' + encodeURIComponent(fragment + JSON.stringify(excludedHosts));
  const hook = registerHooks({ resolve(specifier, context, next) { return specifier === 'wxt/browser' ? { url: browserModule, shortCircuit: true } : next(specifier, context); }, load(url, context, next) { return url === browserModule ? { format: 'module', source: 'export const browser = globalThis.__c5Browser;', shortCircuit: true } : next(url, context); } });
  t.after(() => { mockWindow.fire('pagehide'); hook.deregister(); });
  await import('../extension/entrypoints/options/main.ts?c5=' + encodeURIComponent(fragment + JSON.stringify(excludedHosts)));
  await until(() => root.querySelectorAll('button').some(node => node.textContent === 'Stop excluding'));
  assert.equal(document.activeElement.getAttribute('aria-label') === 'Stop excluding ' + focusHost, expected);
  assert.deepEqual(writes, []);
});
