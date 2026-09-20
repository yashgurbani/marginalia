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
  assert.equal(detail.hidden, false); assert.equal(title.hidden, false);
  // One header zone with exactly one control: collapse.
  assert.deepEqual(heading.querySelectorAll('button').map(node => node.textContent), ['Collapse']);
  assert.equal(heading.getAttribute('aria-labelledby'), title.id);
  api.destroy(); await api.drain();
});

test('R4 top row preserves page identity and merges Hide into Collapse', async t => {
  const e = { ...dom(t), ...storage(t) };
  const api = await mountMargin(asHost(e.root), { capture, allowHelper: false, storageName: crypto.randomUUID(), onLibrary() {} });
  const heading = e.root.querySelector('.m-head')!, title = heading.querySelector('h1')!;
  // The separate top bar is gone: collapse sits in the header, Library and Settings in the footer.
  assert.equal(e.root.querySelector('.m-bar'), null);
  assert.deepEqual(heading.querySelectorAll('button').map(node => node.textContent), ['Collapse']);
  const footerRow = e.root.querySelector('.m-footer-row')!;
  assert.deepEqual(footerRow.children.map(node => node.textContent), ['Connections', 'Skills', 'Library', 'Settings']);
  assert.ok(e.root.querySelector('.m-settings .m-footer-more'));
  assert.equal(button(e.root, 'Follow reading').hidden, true);
  const settings = button(e.root, 'Settings'); settings.focus(); api.setReadingPosition(4);
  assert.equal(e.document.activeElement, settings); assert.equal(heading.querySelector('h1'), title);
  button(e.root, 'Write here\u2026').click();
  assert.equal(button(e.root, 'Follow reading').hidden, true);
  api.destroy(); await api.drain();
});
