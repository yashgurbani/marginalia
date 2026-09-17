import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedPage, validAnchor, validSnapshot, pageIdentity, isMessage } from '../extension/lib/protocol.ts';
const source = 'Before selected passage after';
const anchor = { exact: 'selected passage', prefix: 'Before ', suffix: ' after', start: 7, end: 23 };
const snapshot = { document: 'document-1', revision: 1, position: 7, anchor, sections: [{ title: 'Page', start: 0, end: source.length }], capture: { url: 'https://arxiv.org/html/1234', title: 'Paper', pageType: 'Paper', text: source, capturedAt: '2026-09-17T00:00:00.000Z', extractionVersion: 'dom-safe-text-v1' } };
test('extension refuses privileged URLs, credentials, and excluded subdomains', () => {
  for (const url of ['chrome://settings', 'file:///private', 'javascript:alert(1)', 'https://user:secret@example.org', 'not a URL']) assert.equal(allowedPage(url), false);
  assert.equal(allowedPage('https://news.example.org/story', ['example.org']), false);
  assert.equal(allowedPage('https://notexample.org/story', ['example.org']), true);
  assert.equal(pageIdentity('https://example.org/a?q=1#part'), 'https://example.org/a?q=1');
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
