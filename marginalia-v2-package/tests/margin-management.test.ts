import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHelperManagement } from '../ui/helper-management.ts';
import { dom, button, deferred, settle, replaceGlobals, type TestElement } from './t05-dom.ts';
const asHost = (node: TestElement) => node as unknown as HTMLElement;
const entry = { id: '11111111-1111-4111-8111-111111111111', origin: 'chrome-extension://test', createdAt: '2026-09-17T00:00:00Z', revoked: false };
test('management is never mounted on extension, external or framed surfaces and has no startup requests', t => {
  const e = dom(t); const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('not requested'); });
  for (const [url, frame] of [['chrome-extension://test/index.html', false], ['http://example.org/', false], ['http://localhost/', true]] as const) { e.document.location = new URL(url); e.document.defaultView.top = frame ? {} : e.document.defaultView; const m = mountHelperManagement(asHost(e.root)); m.open(); assert.equal(e.root.children.length, 0); m.destroy(); }
  assert.equal(fetch.mock.callCount(), 0);
});
test('Show/Renew, expiry and unknown failures use relative POST without a bearer or fake metadata', async t => {
  const e = dom(t); const calls: any[] = []; let fail = false;
  replaceGlobals(t, { fetch: async (path: string, init: RequestInit) => { calls.push([path, init]); if (fail) throw new Error('offline'); return Response.json(path.endsWith('browsers') ? { browsers: [entry] } : { code: '012345', expiresInSeconds: 300, singleUse: true }); } });
  const m = mountHelperManagement(asHost(e.root)); t.after(() => m.destroy()); assert.equal(calls.length, 0); m.open(); await settle(); button(e.root, 'Show pairing code').click(); await settle(); assert.equal(e.root.querySelector('output')!.textContent, '012345');
  fail = true; button(e.root, 'Renew pairing code').click(); assert.equal(e.root.querySelector('output')!.textContent, ''); await settle(); assert.match(e.root.textContent, /previous code may have been replaced/);
  for (const [path, init] of calls) { assert.ok(path.startsWith('/api/helper-management/')); assert.equal(init.method, 'POST'); assert.deepEqual(init.headers, { 'Content-Type': 'application/json' }); assert.equal(init.credentials, 'omit'); }
  fail = false; t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); button(e.root, 'Renew pairing code').click(); await settle(); t.mock.timers.tick(300000); assert.equal(e.root.querySelector('output')!.textContent, '');
});
test('Forget is explicit, preserves a stable identity after failure, and does not steal draft focus', async t => {
  const e = dom(t), reply = deferred<Response>(); let fail = true; const sent: string[] = [];
  replaceGlobals(t, { fetch: async (path: string, init: RequestInit) => { if (path.endsWith('browsers')) return Response.json({ browsers: [entry] }); sent.push(String(init.body)); if (fail) throw new Error('offline'); return reply.promise; } });
  const m = mountHelperManagement(asHost(e.root)); t.after(() => m.destroy()); m.open(); await settle(); button(e.root, 'Forget').click(); assert.equal(sent.length, 0);
  button(e.root, 'Forget this browser').click(); await settle(); assert.match(e.root.textContent, /could not be confirmed/); fail = false; button(e.root, 'Forget this browser').click();
  const draft = e.document.createElement('textarea'); e.root.append(draft); draft.value = 'Unsaved'; draft.focus(); reply.resolve(Response.json({ result: 'revoked' })); await settle(); assert.equal(e.document.activeElement, draft); assert.equal(draft.value, 'Unsaved'); assert.match(e.root.textContent, /Browser forgotten/); assert.equal(sent[0], sent[1]);
});
test('stale lists cannot undo Forget and close/reopen rejects an old code response', async t => {
  const e = dom(t), list = deferred<Response>(), revoke = deferred<Response>(), code = deferred<Response>(); let count = 0;
  replaceGlobals(t, { fetch: async (path: string) => path.endsWith('browsers') ? ++count === 1 ? Response.json({ browsers: [entry] }) : list.promise : path.endsWith('revoke') ? revoke.promise : code.promise });
  const m = mountHelperManagement(asHost(e.root)); t.after(() => m.destroy()); m.open(); await settle(); button(e.root, 'Refresh browser list').click(); button(e.root, 'Forget').click(); button(e.root, 'Forget this browser').click(); revoke.resolve(Response.json({ result: 'revoked' })); await settle(); list.resolve(Response.json({ browsers: [entry] })); await settle(); assert.equal(e.root.querySelectorAll('button').some(n => n.textContent === 'Forget'), false); assert.equal(button(e.root, 'Refresh browser list').disabled, false);
  button(e.root, 'Show pairing code').click(); m.close(); code.resolve(Response.json({ code: '123456', expiresInSeconds: 300, singleUse: true })); await settle(); assert.equal(e.root.querySelector('output')!.textContent, '');
});
