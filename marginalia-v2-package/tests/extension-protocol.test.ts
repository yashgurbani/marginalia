import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedPage, validAnchor, validSnapshot, pageIdentity, isMessage } from '../extension/lib/protocol.ts';
import { DEFAULT_HELPER_ORIGIN, validHelperOrigin } from '../extension/lib/helper-origin.ts';
import { readReply, respondAsync } from '../extension/lib/respond.ts';
import { liveSourceMatches, requestCaptureIdentity, requireWorkspaceSurface } from '../extension/lib/surface-identity.ts';
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
test('page exclusion errors pass through the public allow-list unchanged', async () => {
  const literal = 'This page is excluded or changed.';
  const reply = await new Promise<unknown>(resolve => respondAsync(() => { throw new Error(literal); }, resolve));
  assert.throws(() => readReply(reply), error => error instanceof Error && error.message === literal);
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
test('workspace accepts the current extension tab document initially and after reload', async () => {
  const workspaceUrl = 'chrome-extension://extension-id/workspace.html#workspace=12345678-1234-1234-1234-123456789abc';
  const calls: unknown[] = [];
  for (const documentId of ['workspace-document-1', 'workspace-document-2']) {
    const context = { contextType: 'TAB', tabId: 42, frameId: 0, documentId, documentUrl: workspaceUrl, documentOrigin: 'chrome-extension://extension-id', incognito: false };
    await requireWorkspaceSurface(
      { tabId: 42, documentId, documentLifecycle: 'active', url: workspaceUrl, origin: 'chrome-extension://extension-id', frameId: 0, incognito: false },
      42,
      workspaceUrl,
      'chrome-extension://extension-id',
      async filter => { calls.push(filter); return [context]; },
      async tabId => ({ id: tabId, url: workspaceUrl, incognito: false, discarded: false }),
    );
  }
  assert.deepEqual(calls, [
    { contextTypes: ['TAB'], documentIds: ['workspace-document-1'], tabIds: [42] },
    { contextTypes: ['TAB'], documentIds: ['workspace-document-1'], tabIds: [42] },
    { contextTypes: ['TAB'], documentIds: ['workspace-document-2'], tabIds: [42] },
    { contextTypes: ['TAB'], documentIds: ['workspace-document-2'], tabIds: [42] },
  ]);
});
test('workspace rejects spoofed sender, tab, URL, document, origin, frame, and stale context', async () => {
  const url = 'chrome-extension://extension-id/workspace.html#workspace=12345678-1234-1234-1234-123456789abc';
  const origin = 'chrome-extension://extension-id';
  const sender = { tabId: 42, documentId: 'workspace-document-1', documentLifecycle: 'active', url, origin, frameId: 0, incognito: false };
  const context = { contextType: 'TAB', tabId: 42, frameId: 0, documentId: sender.documentId, documentUrl: url, documentOrigin: origin, incognito: false };
  const tab = { id: 42, url, incognito: false, discarded: false };
  const rejects = async (candidateSender = sender, candidateContext = context, candidateTab = tab) => assert.rejects(
    requireWorkspaceSurface(candidateSender, 42, url, origin, async () => [candidateContext], async () => candidateTab),
    /Reopen this margin from the source/,
  );

  await rejects({ ...sender, tabId: 43 });
  await rejects({ ...sender, url: url.replace('12345678', '87654321') });
  await rejects({ ...sender, documentId: 'workspace-document-spoof' });
  await rejects({ ...sender, origin: 'chrome-extension://other-extension' });
  await rejects({ ...sender, frameId: 1 });
  await rejects({ ...sender, documentLifecycle: 'cached' });
  await rejects(sender, { ...context, tabId: 43 });
  await rejects(sender, { ...context, documentUrl: url + '-spoof' });
  await rejects(sender, { ...context, documentId: 'workspace-document-spoof' });
  await rejects(sender, { ...context, documentOrigin: 'chrome-extension://other-extension' });
  await rejects(sender, { ...context, frameId: 1 });
  await rejects(sender, context, { ...tab, url: url + '-spoof' });

  let reads = 0;
  await assert.rejects(
    requireWorkspaceSurface(sender, 42, url, origin, async () => ++reads === 1 ? [context] : [], async () => tab),
    /Reopen this margin from the source/,
  );
});
test('workspace retains the original live source document and URL', () => {
  const frame = { documentId: 'source-document-1', documentLifecycle: 'active', url: 'https://example.org/article#current-section' };
  assert.equal(liveSourceMatches(frame, 'source-document-1', 'https://example.org/article'), true);
  assert.equal(liveSourceMatches({ ...frame, documentId: 'source-document-2' }, 'source-document-1', 'https://example.org/article'), false);
  assert.equal(liveSourceMatches({ ...frame, documentLifecycle: 'cached' }, 'source-document-1', 'https://example.org/article'), false);
  assert.equal(liveSourceMatches({ ...frame, url: 'https://example.org/replacement' }, 'source-document-1', 'https://example.org/article'), false);
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
