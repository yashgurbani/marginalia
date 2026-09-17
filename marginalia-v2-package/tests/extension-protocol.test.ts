import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedPage, validAnchor, validSnapshot, pageIdentity, isMessage } from '../extension/lib/protocol.ts';
import { DEFAULT_HELPER_ORIGIN, validHelperOrigin } from '../extension/lib/helper-origin.ts';
import { readReply, respondAsync } from '../extension/lib/respond.ts';
import { requestCaptureIdentity } from '../extension/lib/surface-identity.ts';
const source = 'Before selected passage after';
const anchor = { exact: 'selected passage', prefix: 'Before ', suffix: ' after', start: 7, end: 23 };
const snapshot = { document: 'document-1', revision: 1, position: 7, anchor, sections: [{ title: 'Page', start: 0, end: source.length }], capture: { url: 'https://arxiv.org/html/1234', title: 'Paper', pageType: 'Paper', text: source, capturedAt: '2026-09-17T00:00:00.000Z', extractionVersion: 'dom-safe-text-v1' } };
test('extension refuses privileged URLs, credentials, and excluded subdomains', () => {
  for (const url of ['chrome://settings', 'file:///private', 'javascript:alert(1)', 'https://user:secret@example.org', 'not a URL']) assert.equal(allowedPage(url), false);
  assert.equal(allowedPage('https://news.example.org/story', ['example.org']), false);
  assert.equal(allowedPage('https://notexample.org/story', ['example.org']), true);
  assert.equal(pageIdentity('https://example.org/a?q=1#part'), 'https://example.org/a?q=1');
});
test('helper address is a concrete HTTP loopback origin with a valid port', () => {
  assert.equal(validHelperOrigin(DEFAULT_HELPER_ORIGIN), DEFAULT_HELPER_ORIGIN);
  assert.equal(validHelperOrigin('http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
  assert.equal(validHelperOrigin('http://127.0.0.1:80'), 'http://127.0.0.1');
  for (const origin of ['http://localhost:54321', 'http://[::1]:43120', 'https://127.0.0.1:43120', 'http://127.0.0.2:43120', 'http://example.org:43120', 'http://user@127.0.0.1:43120', 'http://127.0.0.1:43120/path', 'http://127.0.0.1:43120/', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:43120?x=1']) assert.equal(validHelperOrigin(origin), null, origin);
});
test('message failures use an explicit bounded envelope', async () => {
  const reply = await new Promise<unknown>(resolve => respondAsync(() => { throw new Error('Source changed.'); }, resolve));
  assert.throws(() => readReply(reply), /Source changed/);
  const shortPrivateFailure = await new Promise<unknown>(resolve => respondAsync(() => { throw new Error('API key sk-live-secret'); }, resolve));
  assert.throws(() => readReply(shortPrivateFailure), error => error instanceof Error && error.message === 'The margin request failed. Reopen it from the source page.' && !error.message.includes('sk-live-secret'));
  const privateFailure = await new Promise<unknown>(resolve => respondAsync(() => { throw new Error('secret\n' + 'x'.repeat(300)); }, resolve));
  assert.throws(() => readReply(privateFailure), /margin request failed/);
  assert.deepEqual(readReply(await new Promise<unknown>(resolve => respondAsync(() => ({ allowed: true }), resolve))), { allowed: true });
  assert.throws(() => readReply(null), /did not answer/);
});
test('embedded margin separates capture identity from stable browser document identity', async () => {
  const targeted: string[] = [];
  const stableFrame = async () => ({ documentId: 'browser-document-1', documentLifecycle: 'active' });
  const captureDocument = await requestCaptureIdentity('browser-document-1', stableFrame, async documentId => {
    targeted.push(documentId);
    return { document: 'capture-document-a' };
  });
  assert.equal(captureDocument, 'capture-document-a');
  assert.deepEqual(targeted, ['browser-document-1']);

  let frameRead = 0;
  await assert.rejects(
    requestCaptureIdentity(
      'browser-document-1',
      async () => ({ documentId: ++frameRead === 1 ? 'browser-document-1' : 'browser-document-2', documentLifecycle: 'active' }),
      async () => ({ document: 'stale-capture-reply' }),
    ),
    /Reopen the margin after navigation/,
  );
});
test('extension binds exact quote, offsets and context to retained source', () => {
  assert.equal(validAnchor(anchor, source), true);
  for (const change of [{ start: 0 }, { end: 24 }, { exact: 'forged text' }, { prefix: 'wrong' }, { suffix: 'wrong' }, { kind: 'whole-page' }, { start: Infinity }]) assert.equal(validAnchor({ ...anchor, ...change }, source), false);
});
test('extension rejects oversized and malformed boundary payloads', () => {
  assert.equal(validSnapshot(snapshot), true);
  for (const change of [{ document: '' }, { position: 1000 }, { revision: -1 }, { anchor: { ...anchor, end: 100 } }, { sections: Array(301).fill(snapshot.sections[0]) }, { capture: { ...snapshot.capture, text: 'x'.repeat(1_000_001) } }, { capture: { ...snapshot.capture, url: 'chrome://settings' } }]) assert.equal(validSnapshot({ ...snapshot, ...change }), false);
  assert.equal(isMessage({ version: 1, type: 'surface' }, 'surface'), true);
  assert.equal(isMessage({ version: 2, type: 'surface' }, 'surface'), false);
});
