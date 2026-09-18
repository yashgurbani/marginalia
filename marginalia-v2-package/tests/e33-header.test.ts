import test from 'node:test';
import assert from 'node:assert/strict';
import { storage, asHost } from './t05-harness.ts';
import { dom, button, replaceGlobals, type TestElement } from './t05-dom.ts';
import type { SourceCapture } from '../contracts/reader.ts';
const { mountMargin } = await import('../ui/margin.ts');
const capture: SourceCapture = { url: 'https://invented-venue.example/2020/Someone', title: 'Original source title', pageType: 'article', text: 'First passage. Second passage.', capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'test' };

for (const [name, metadata, expected] of [
  ['complete', { author: 'Ada Reader', publicationDate: '2026-09-17', venue: 'Observed Journal' }, 'article · Ada Reader · 2026-09-17 · Observed Journal'],
  ['partial', { venue: 'Observed Journal' }, 'article · Observed Journal'],
  ['unavailable', {}, 'article'],
] as const) test(`E33 mounted header displays only ${name} captured metadata`, async t => {
  const e = { ...dom(t), ...storage(t) };
  replaceGlobals(t, { fetch: () => { throw new Error('Header must not look up metadata'); } });
  const api = await mountMargin(asHost(e.root), { capture: { ...capture, ...metadata }, allowHelper: false, storageName: crypto.randomUUID() });
  const heading = e.root.querySelector('.m-head')!, title = heading.querySelector('h1')!, detail = heading.querySelector('.m-meta')!;
  assert.equal(detail.textContent, expected); assert.equal(title.textContent, capture.title);
  assert.equal(heading.getAttribute('aria-labelledby'), title.id);
  assert.equal(heading.getAttribute('role'), 'region');
  assert.equal(heading.textContent.includes('invented-venue'), false);
  assert.equal(detail.hidden, false);
  api.setReadingPosition(5);
  assert.equal(heading.classList.contains('m-head-compact'), true); assert.equal(detail.hidden, true);
  assert.equal(heading.getAttribute('aria-labelledby'), title.id); assert.equal(title.hidden, false);
  const toggle = button(heading, 'Details');
  assert.equal(toggle.tagName, 'BUTTON'); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), detail.id);
  assert.equal(toggle.getAttribute('aria-label'), `Show source details: ${capture.title}`);
  toggle.focus(); toggle.click();
  assert.equal(e.document.activeElement, toggle); assert.equal(detail.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  api.setReadingPosition(12); assert.equal(detail.hidden, false, 'explicit reopening persists during reading');
  button(heading, 'Hide').click(); assert.equal(detail.hidden, true); assert.equal(e.document.activeElement, toggle);
  api.destroy(); await api.drain();
});

test('E33 automatic collapse preserves keyboard focus and header source nodes', async t => {
  const e = { ...dom(t), ...storage(t) };
  const api = await mountMargin(asHost(e.root), { capture, allowHelper: false, storageName: crypto.randomUUID() });
  const heading = e.root.querySelector('.m-head')!, title = heading.querySelector('h1')!, toggle = button(heading, 'Hide');
  toggle.focus(); api.setReadingPosition(4);
  assert.equal(e.document.activeElement, toggle); assert.equal(heading.classList.contains('m-head-compact'), false);
  e.root.focus(); toggle.fire('focusout'); await Promise.resolve();
  assert.equal(heading.classList.contains('m-head-compact'), true); assert.equal(heading.querySelector('h1'), title);
  api.destroy(); await api.drain();
});

test('E33 source scrolling collapses the header within the first reading section', async t => {
  const e = { ...dom(t), ...storage(t) }, source = e.document.createElement('article');
  source.textContent = capture.text; e.document.body.append(source);
  const api = await mountMargin(asHost(e.root), { capture, sourceRoot: asHost(source), allowHelper: false, storageName: crypto.randomUUID() });
  const heading = e.root.querySelector('.m-head')!;
  assert.equal(heading.classList.contains('m-head-compact'), false);
  (window as unknown as TestElement).fire('scroll');
  assert.equal(heading.classList.contains('m-head-compact'), true);
  assert.equal(source.textContent, capture.text);
  api.destroy(); await api.drain();
});
