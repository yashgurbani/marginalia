import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConsentPrincipal } from '../contracts/consent.ts';
import { createInstantForgetService } from '../daemon/instant/forget.ts';
import { createInstantForgetRoute, instantPrincipalKey } from '../daemon/routes/instant-forget.ts';
import type { ApiRouteContext } from '../daemon/routes/types.ts';

const OWNER: ConsentPrincipal = { surface: 'browser-owned-margin', pairingId: 'pair-a', origin: 'moz-extension://a' };
const OTHER: ConsentPrincipal = { surface: 'browser-owned-margin', pairingId: 'pair-b', origin: 'moz-extension://b' };
const PAGE = 'page-1';

function routeContext(input: {
  principal?: ConsentPrincipal;
  body?: unknown;
  pairing?: () => boolean;
  method?: string;
  onSend?: (status: number, data: unknown) => void;
}): ApiRouteContext {
  const request = { method: input.method ?? 'POST' } as IncomingMessage;
  const response = {} as ServerResponse;
  return { request, response, url: new URL('http://127.0.0.1' + '/api/instant/forget'), requestOrigin: input.principal?.origin,
    authOrigin: input.principal?.origin ?? OWNER.origin, token: input.principal?.pairingId ?? OWNER.pairingId,
    principal: input.principal ?? OWNER, requireCurrentPairing: input.pairing ?? (() => true),
    send: (response, status, data) => { void response; input.onSend?.(status, data); },
    body: async request => { void request; return input.body ?? { pageId: PAGE }; },
    emptyBody: async request => { void request; } };
}

test('forget drops warm and prepared page state without touching reader records', async () => {
  const calls: string[] = [];
  const service = createInstantForgetService({
    release: async (principal, page) => { calls.push(`warm:${principal}:${page}`); },
    forgetPreparedDefinitions: async (principal, page) => { calls.push(`definitions:${principal}:${page}`); },
  });
  const result = await service.forget('owner', PAGE);
  assert.deepEqual(result, { forgotten: true, alreadyForgotten: false, providerHistory: 'retained' });
  assert.deepEqual(calls, ['warm:owner:page-1', 'definitions:owner:page-1']);
  assert.equal(service.isCurrent('owner', PAGE, 0), false);
  // The coordinator has no ReaderStore port, so notes, source and saved replies cannot be deleted.
  assert.equal(Object.keys(service).sort().join(','), 'fence,forget,isCurrent');
});

test('principal identity fences only its own page and request JSON cannot nominate another principal', async () => {
  const calls: string[] = [];
  const service = createInstantForgetService({ release: (principal, page) => { calls.push(`${principal}:${page}`); } });
  const ownerFence = service.fence(instantPrincipalKey(OWNER), PAGE);
  const otherFence = service.fence(instantPrincipalKey(OTHER), PAGE);
  await service.forget(instantPrincipalKey(OTHER), PAGE);
  assert.equal(ownerFence.isCurrent(), true);
  assert.equal(otherFence.isCurrent(), false);
  assert.deepEqual(calls, [`${instantPrincipalKey(OTHER)}:${PAGE}`]);

  let sent: unknown;
  const route = createInstantForgetRoute(service);
  await route(routeContext({ body: { pageId: PAGE }, principal: OWNER, onSend: (_status, data) => { sent = data; } }));
  assert.deepEqual(sent, { forgotten: true, alreadyForgotten: false, providerHistory: 'retained' });
  assert.deepEqual(calls, [`${instantPrincipalKey(OTHER)}:${PAGE}`, `${instantPrincipalKey(OWNER)}:${PAGE}`]);
});

test('repeated and concurrent forget requests are idempotent', async () => {
  let releaseCount = 0;
  let continueRelease!: () => void;
  const releaseGate = new Promise<void>(resolve => { continueRelease = resolve; });
  const service = createInstantForgetService({ release: async () => { releaseCount++; await releaseGate; } });
  const first = service.forget('owner', PAGE), second = service.forget('owner', PAGE);
  await Promise.resolve();
  assert.equal(releaseCount, 1);
  continueRelease();
  assert.deepEqual(await first, { forgotten: true, alreadyForgotten: false, providerHistory: 'retained' });
  assert.deepEqual(await second, { forgotten: true, alreadyForgotten: true, providerHistory: 'retained' });
  assert.equal(releaseCount, 1);
});

test('a failed cleanup remains fenced and retries only the unfinished hook', async () => {
  let releaseCount = 0, definitionCount = 0, failDefinitions = true;
  const service = createInstantForgetService({
    release: () => { releaseCount++; },
    forgetPreparedDefinitions: () => {
      definitionCount++;
      if (failDefinitions) throw new Error('definition cache busy');
    },
  });
  const fence = service.fence('owner', PAGE);
  await assert.rejects(() => service.forget('owner', PAGE), /definition cache busy/);
  assert.equal(fence.isCurrent(), false);
  failDefinitions = false;
  const result = await service.forget('owner', PAGE);
  assert.deepEqual(result, { forgotten: true, alreadyForgotten: true, providerHistory: 'retained' });
  assert.equal(releaseCount, 1);
  assert.equal(definitionCount, 2);
});

test('provider history status comes from the owner-bound warm-page hook', async () => {
  const deleted = createInstantForgetService({ release: () => Promise.resolve({ providerHistory: 'deleted' }) });
  const notCreated = createInstantForgetService({ release: () => ({ providerHistory: 'not-created' }) });
  const unknown = createInstantForgetService({ release: () => ({ providerHistory: 'unexpected' } as never) });
  assert.equal((await deleted.forget('owner', PAGE)).providerHistory, 'deleted');
  assert.equal((await notCreated.forget('owner', PAGE)).providerHistory, 'not-created');
  assert.equal((await unknown.forget('owner', PAGE)).providerHistory, 'unknown');
});

test('forget fences a queued selection and late output before hooks settle', async () => {
  let resolveHook!: () => void;
  const hook = new Promise<void>(resolve => { resolveHook = resolve; });
  const service = createInstantForgetService({ release: () => hook });
  const fence = service.fence('owner', PAGE);
  const pending = service.forget('owner', PAGE);
  assert.equal(fence.isCurrent(), false);
  assert.equal(service.isCurrent('owner', PAGE, fence.epoch), false);
  const lateOutputAccepted = fence.isCurrent();
  assert.equal(lateOutputAccepted, false);
  resolveHook();
  await pending;
});

test('route rechecks pairing after body read and does not call service when pairing changes', async () => {
  let calls = 0;
  const service = createInstantForgetService({ release: () => { calls++; } });
  let check = 0, status = 0;
  const route = createInstantForgetRoute(service);
  await route(routeContext({ pairing: () => ++check === 1, onSend: (code) => { status = code; } }));
  assert.equal(status, 401);
  assert.equal(calls, 0);
});

test('route is narrow and rejects malformed or non-POST requests', async () => {
  const service = createInstantForgetService({ release: () => {} });
  const route = createInstantForgetRoute(service);
  let status = 0;
  await route(routeContext({ method: 'GET', onSend: code => { status = code; } }));
  assert.equal(status, 405);
  await assert.rejects(() => route(routeContext({ body: { pageId: PAGE, extra: true } })), /A page is required/);
});
