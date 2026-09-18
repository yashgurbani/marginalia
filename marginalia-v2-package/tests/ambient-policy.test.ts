import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AMBIENT_POLICY_PATH, createAmbientRoutes, type AmbientPolicyRead } from '../daemon/routes/ambient.ts';
import { evaluateAmbientPolicy } from '../daemon/ambient-policy.ts';
import type { ApiRouteContext } from '../daemon/routes/types.ts';

test('ambient help is off when auto assist is disabled', () => {
  assert.deepEqual(evaluateAmbientPolicy({ enabled: false, excluded: false, pageType: 'article' }), {
    trigger: 'ambient', pageType: 'article', applies: true, allowed: false, reason: 'auto-assist-disabled',
  });
});

test('ambient help is denied for excluded sites before page type is considered', () => {
  assert.deepEqual(evaluateAmbientPolicy({ enabled: true, excluded: true, pageType: 'paper' }), {
    trigger: 'ambient', pageType: 'paper', applies: true, allowed: false, reason: 'site-excluded',
  });
});

test('unknown pages are denied by the conservative default', () => {
  assert.deepEqual(evaluateAmbientPolicy({ enabled: true, excluded: false, pageType: 'unknown' }), {
    trigger: 'ambient', pageType: 'unknown', applies: true, allowed: false, reason: 'unknown-page-type',
  });
});

test('social pages stay out of the default while an explicit whitelist can opt them in', () => {
  assert.equal(evaluateAmbientPolicy({ enabled: true, excluded: false, pageType: 'social' }).allowed, false);
  assert.deepEqual(evaluateAmbientPolicy({ enabled: true, excluded: false, pageType: 'social', whitelist: ['social'] }), {
    trigger: 'ambient', pageType: 'social', applies: true, allowed: true, reason: 'allowed',
  });
  assert.equal(evaluateAmbientPolicy({ enabled: true, excluded: false, pageType: 'unknown', whitelist: ['unknown'] }).allowed, true);
});

test('explicit Ask and instant help pass through without changing their owner defaults', () => {
  assert.deepEqual(evaluateAmbientPolicy({ trigger: 'explicit-ask', enabled: false, excluded: true, pageType: 'unknown' }), {
    trigger: 'explicit-ask', pageType: 'unknown', applies: false, allowed: null, reason: 'explicit-ask',
  });
  assert.deepEqual(evaluateAmbientPolicy({ trigger: 'instant', enabled: false, excluded: true, pageType: 'unknown' }), {
    trigger: 'instant', pageType: 'unknown', applies: false, allowed: null, reason: 'instant-owner-default',
  });
});

test('ambient policy route reads existing auto-assist enablement and caller-supplied whitelist without writing settings', async () => {
  const sent: { status: number; data: unknown }[] = [];
  const handle = createAmbientRoutes({
    readSettings: () => ({ enabled: true }),
    readHostPolicy: site => ({ excluded: site === 'https://excluded.example' }),
    readWhitelist: () => ['social'],
  });
  const context = (query: string, method = 'GET'): ApiRouteContext => ({
    request: { method } as IncomingMessage,
    response: {} as ServerResponse,
    url: new URL(`http://127.0.0.1${AMBIENT_POLICY_PATH}${query}`),
    requestOrigin: undefined,
    authOrigin: 'http://127.0.0.1:43120',
    token: 'token',
    principal: { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' },
    requireCurrentPairing: () => true,
    send: (_response, status, data) => { sent.push({ status, data }); },
    body: async () => ({}),
    emptyBody: async () => undefined,
  });

  assert.equal(await handle(context('?sourceUrl=https%3A%2F%2Freader.example%2Fchapter%23part&type=social&excluded=false')), true);
  const response = sent.pop()!.data as AmbientPolicyRead;
  assert.equal(response.policy.allowed, true);
  assert.equal(response.sourceOrigin, 'https://reader.example');
  assert.deepEqual(response.whitelist, ['social']);
  assert.deepEqual(response.supportedPageTypes, ['paper', 'docs', 'article', 'social', 'reference', 'unknown']);
  assert.equal(await handle(context('?sourceUrl=https%3A%2F%2Fexcluded.example%2Fchapter&type=social&excluded=false')), true);
  const excluded = sent.pop()!.data as AmbientPolicyRead;
  assert.equal(excluded.excluded, true);
  assert.equal(excluded.policy.allowed, false);
  assert.equal(excluded.policy.reason, 'site-excluded');
  assert.equal(await handle(context('?sourceUrl=file%3A%2F%2Fprivate%2Fpage')), true);
  assert.deepEqual(sent.pop(), { status: 400, data: { error: 'A valid source URL is required for the ambient policy.' } });
  assert.equal(await handle(context('', 'POST')), true);
  assert.deepEqual(sent.pop(), { status: 405, data: { error: 'Use GET for the ambient policy.' } });
});
