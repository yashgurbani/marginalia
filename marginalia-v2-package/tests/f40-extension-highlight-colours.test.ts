import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { validSavedMarks } from '../extension/lib/protocol.ts';

const source = 'Before selected passage after';
const anchor = { kind: 'quote' as const, exact: 'selected passage', prefix: 'Before ', suffix: ' after', start: 7, end: 23 };
const envelope = (marks: unknown[]) => ({ document: 'document-1', url: 'https://example.org/article', revision: 1, marks });

test('extension saved-mark validation accepts legacy and fixed highlight colours', () => {
  assert.equal(validSavedMarks(envelope([{ anchor, highlighted: true }])), true, 'legacy marks keep the yellow default');
  for (const colour of ['yellow', 'green', 'blue', 'rose']) {
    assert.equal(validSavedMarks(envelope([{ anchor, highlighted: true, highlightColour: colour }])), true, colour);
  }
  for (const highlightColour of ['purple', '', 1, null, { value: 'rose' }]) {
    assert.equal(validSavedMarks(envelope([{ anchor, highlighted: true, highlightColour }])), false, String(highlightColour));
  }
  assert.equal(validSavedMarks(envelope([{ anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 }, highlighted: true, highlightColour: 'green' }])), false);
  assert.equal(validSavedMarks(envelope([{ anchor, highlighted: true, highlightColour: 'rose' }])), true);
  assert.equal(validSavedMarks({ ...envelope([{ anchor, highlighted: true, highlightColour: 'rose' }]), document: '' }), false);
  assert.equal(validSavedMarks({ ...envelope([{ anchor, highlighted: true, highlightColour: 'rose' }]), url: 'chrome://settings' }), false);
  assert.equal(validSavedMarks(envelope([{ anchor: { ...anchor, exact: 'forged text' }, highlighted: true, highlightColour: 'rose' }])), false);
  assert.equal(source.slice(anchor.start, anchor.end), anchor.exact);
});

test('extension bridge forwards colour and paints one registered highlight per palette entry', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const background = await readFile(resolve(root, 'extension', 'entrypoints', 'background.ts'), 'utf8');
  assert.match(background, /\{ anchor, highlighted, highlightColour \}/);
  assert.match(background, /highlightColour !== undefined \? \{ highlightColour \} : \{\}/);

  const { window, document } = parseHTML('<html><head><title>Paper</title></head><body><p>Before selected passage after</p></body></html>');
  window.top = window;
  const registry = new Map<string, { ranges: unknown[]; priority: number }>();
  class HighlightMock {
    priority = 0;
    readonly ranges: unknown[];
    constructor(...ranges: unknown[]) { this.ranges = ranges; }
  }
  const textNode = document.querySelector('p')?.firstChild;
  assert.ok(textNode);
  document.createRange = (() => ({
    startContainer: textNode,
    endContainer: textNode,
    setStart() {},
    setEnd() {},
    selectNodeContents() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, bottom: 0 }),
    toString: () => source,
  })) as unknown as typeof document.createRange;

  const globals = globalThis as Record<string, any>;
  globals.window = window;
  globals.document = document;
  globals.location = { href: 'https://example.org/article', hostname: 'example.org', pathname: '/article' } as Location;
  globals.NodeFilter = { SHOW_TEXT: 4 };
  globals.getComputedStyle = (() => ({ display: 'block', visibility: 'visible', opacity: '1' })) as unknown as typeof getComputedStyle;
  globals.HTMLDetailsElement = window.HTMLDetailsElement;
  globals.MutationObserver = window.MutationObserver;
  globals.getSelection = () => null;
  globals.innerHeight = 800;
  globals.scrollY = 0;
  globals.CSS = { highlights: registry };
  globals.Highlight = HighlightMock;

  let messageListener: ((message: unknown, sender: { id?: string; tab?: unknown }, respond: (value: unknown) => void) => unknown) | undefined;
  let invalidated: (() => void) | undefined;
  globals.chrome = {
    runtime: {
      id: 'extension-test',
      sendMessage: async () => ({ ok: true, value: { allowed: true } }),
      onMessage: { addListener: (listener: typeof messageListener) => { messageListener = listener; } },
    },
  };
  const content = await import('../extension/entrypoints/content.ts');
  content.default.main({
    addEventListener() {},
    onInvalidated(callback: () => void) { invalidated = callback; },
  } as never);
  try {
    assert.ok(messageListener);
    const invoke = (message: unknown) => new Promise<any>((resolveReply, reject) => {
      try {
        const returned = messageListener!(message, { id: 'extension-test' }, resolveReply);
        assert.equal(returned, true);
      } catch (error) {
        reject(error);
      }
    });

    const identity = await invoke({ type: 'identity', version: 1 });
    const documentId = identity.value.document;
    assert.deepEqual((await invoke({ type: 'activate', version: 1, panel: true })).value, true);
    const mark = (highlightColour?: string) => ({ anchor, highlighted: true, ...(highlightColour === undefined ? {} : { highlightColour }) });
    const stale = await invoke({ type: 'saved-marks', version: 1, document: 'spoofed-document', url: 'https://example.org/article', revision: 1, marks: [mark()] });
    assert.equal(stale.value, false);
    assert.equal(registry.size, 0);
    registry.set('marginalia-highlighted', new HighlightMock());
    const saved = await invoke({ type: 'saved-marks', version: 1, document: documentId, url: 'https://example.org/article', revision: 1, marks: [mark(), mark('green'), mark('blue'), mark('rose')] });
    assert.equal(saved.value, true);
    assert.equal(registry.has('marginalia-highlighted'), false);
    assert.equal(registry.get('marginalia-kept')?.ranges.length, 4);
    assert.equal(registry.get('marginalia-highlighted-yellow')?.ranges.length, 1);
    assert.equal(registry.get('marginalia-highlighted-green')?.ranges.length, 1);
    assert.equal(registry.get('marginalia-highlighted-blue')?.ranges.length, 1);
    assert.equal(registry.get('marginalia-highlighted-rose')?.ranges.length, 1);

    const changed = await invoke({ type: 'saved-marks', version: 1, document: documentId, url: 'https://example.org/article', revision: 1, marks: [mark('rose')] });
    assert.equal(changed.value, true);
    assert.equal(registry.get('marginalia-highlighted-yellow')?.ranges.length, 0);
    assert.equal(registry.get('marginalia-highlighted-green')?.ranges.length, 0);
    assert.equal(registry.get('marginalia-highlighted-blue')?.ranges.length, 0);
    assert.equal(registry.get('marginalia-highlighted-rose')?.ranges.length, 1);
  } finally {
    invalidated?.();
  }
  for (const name of ['marginalia-kept', 'marginalia-highlighted', 'marginalia-highlighted-yellow', 'marginalia-highlighted-green', 'marginalia-highlighted-blue', 'marginalia-highlighted-rose']) assert.equal(registry.has(name), false, name);
});
