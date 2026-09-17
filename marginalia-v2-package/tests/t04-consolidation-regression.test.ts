import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { captureSelection, locate } from '../extension/lib/capture.ts';
import { validAnchor } from '../extension/lib/protocol.ts';

const SHOW_TEXT = 4;
const GLOBALS = ['document', 'Node', 'NodeFilter', 'HTMLDetailsElement', 'getComputedStyle', 'location', 'getSelection', 'fetch'];
type GlobalState = { exists: boolean; value: unknown };

function textNodes(root: Node): Text[] {
  const result: Text[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      result.push(node as Text);
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(root);
  return result;
}

function treeRoot(node: Node): Node {
  let root = node;
  while (root.parentNode) root = root.parentNode;
  if (root.nodeType === 9 && (root as Document).body?.contains(node)) return (root as Document).body;
  return root;
}

function offsetAt(root: Node, target: Node, offset: number): number {
  let position = 0;
  let found = false;
  const visit = (node: Node): boolean => {
    if (node === target) {
      if (node.nodeType === 3) position += offset;
      else for (let index = 0; index < offset; index++) position += node.childNodes[index]?.textContent?.length ?? 0;
      found = true;
      return true;
    }
    if (node.nodeType === 3) {
      position += node.textContent?.length ?? 0;
      return false;
    }
    for (const child of Array.from(node.childNodes)) if (visit(child)) return true;
    return false;
  };
  visit(root);
  return found ? position : Number.NaN;
}

/** The anchor packages need Range and NodeIterator, which linkedom does not expose fully. */
class FixtureRange {
  startContainer: Node | null = null;
  startOffset = 0;
  endContainer: Node | null = null;
  endOffset = 0;

  setStart(container: Node, offset: number) { this.startContainer = container; this.startOffset = offset; }
  setEnd(container: Node, offset: number) { this.endContainer = container; this.endOffset = offset; }
  get collapsed() { return this.startContainer === this.endContainer && this.startOffset === this.endOffset; }

  toString() {
    if (!this.startContainer || !this.endContainer) return '';
    const root = treeRoot(this.startContainer);
    if (root !== treeRoot(this.endContainer)) return '';
    const start = offsetAt(root, this.startContainer, this.startOffset);
    const end = offsetAt(root, this.endContainer, this.endOffset);
    return (root.textContent ?? '').slice(start, end);
  }

  intersectsNode(node: Node) {
    if (!this.startContainer || !this.endContainer) return false;
    const root = treeRoot(node);
    if (root !== treeRoot(this.startContainer) || root !== treeRoot(this.endContainer)) return false;
    const start = offsetAt(root, this.startContainer, this.startOffset);
    const end = offsetAt(root, this.endContainer, this.endOffset);
    const nodeStart = offsetAt(root, node, 0);
    return start < nodeStart + (node.textContent?.length ?? 0) && end > nodeStart;
  }
}

class FixtureTextIterator {
  readonly whatToShow = SHOW_TEXT;
  readonly nodes: Text[];
  referenceNode: Node;
  pointerBeforeReferenceNode = true;

  constructor(root: Node) {
    this.nodes = textNodes(root);
    this.referenceNode = root;
  }

  nextNode(): Node | null {
    const index = this.nodes.indexOf(this.referenceNode as Text);
    if (this.pointerBeforeReferenceNode && index >= 0) {
      this.pointerBeforeReferenceNode = false;
      return this.referenceNode;
    }
    const next = index + 1;
    if (next >= this.nodes.length) return null;
    this.referenceNode = this.nodes[next];
    this.pointerBeforeReferenceNode = false;
    return this.referenceNode;
  }

  previousNode(): Node | null {
    const index = this.nodes.indexOf(this.referenceNode as Text);
    if (!this.pointerBeforeReferenceNode && index >= 0) {
      this.pointerBeforeReferenceNode = true;
      return this.referenceNode;
    }
    const previous = index - 1;
    if (previous < 0) return null;
    this.referenceNode = this.nodes[previous];
    this.pointerBeforeReferenceNode = true;
    return this.referenceNode;
  }
}

type Fixture = {
  document: Document;
  selected: Text | null;
  fetchCalls: () => number;
  markup: () => string;
  restore: () => void;
};

function installPage(markup: string, url: string): Fixture {
  const page = parseHTML(markup);
  const pageDocument = page.document;
  const selectedElement = pageDocument.querySelector('[data-selection]');
  const selectedNode = selectedElement?.firstChild;
  const selected = selectedNode?.nodeType === 3 ? selectedNode as Text : null;
  let selectionRange: FixtureRange | null = null;
  if (selected) {
    selectionRange = new FixtureRange();
    selectionRange.setStart(selected, 0);
    selectionRange.setEnd(selected, selected.textContent?.length ?? 0);
  }

  Object.defineProperty(pageDocument, 'createRange', { configurable: true, value: () => new FixtureRange() });
  Object.defineProperty(pageDocument, 'createNodeIterator', { configurable: true, value: (root: Node) => new FixtureTextIterator(root) });

  const globalObject = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, GlobalState>();
  for (const name of GLOBALS) previous.set(name, { exists: Object.hasOwn(globalObject, name), value: globalObject[name] });

  let fetchCalls = 0;
  globalObject.document = pageDocument;
  globalObject.Node = page.Node;
  globalObject.NodeFilter = { SHOW_TEXT };
  globalObject.HTMLDetailsElement = page.HTMLDetailsElement;
  globalObject.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
  globalObject.location = new URL(url);
  globalObject.getSelection = () => ({
    rangeCount: selectionRange ? 1 : 0,
    isCollapsed: selectionRange?.collapsed ?? true,
    getRangeAt: () => selectionRange,
  });
  globalObject.fetch = (..._args: unknown[]) => {
    fetchCalls++;
    throw new Error('network must not be used while capturing or locating a source');
  };

  return {
    document: pageDocument,
    selected,
    fetchCalls: () => fetchCalls,
    markup: () => pageDocument.body?.toString() ?? '',
    restore: () => {
      for (const name of GLOBALS) {
        const state = previous.get(name);
        if (state?.exists) globalObject[name] = state.value;
        else delete globalObject[name];
      }
    },
  };
}

const selectionPage = '<html><head><title>Reading</title></head><body><h1>Heading</h1><p id="passage" data-source="original">Before <em data-selection="yes">selected passage</em> after.</p><form><p>form text must not be captured</p></form><script>script text must not be captured</script><p hidden>hidden text must not be captured</p></body></html>';

test('selection captures safe source identity without page mutation or implicit send', () => {
  const fixture = installPage(selectionPage, 'https://arxiv.org/html/2303.08774v6#results');
  try {
    const before = fixture.markup();
    const markers: unknown[] = [];
    const snapshot = captureSelection('capture-document-1', 7, true, entries => markers.push(...entries));

    assert.ok(snapshot);
    assert.equal(snapshot.document, 'capture-document-1');
    assert.notEqual(snapshot.document, 'browser-document-1');
    assert.equal(snapshot.capture.url, 'https://arxiv.org/html/2303.08774v6');
    assert.equal(snapshot.capture.pageType, 'Paper');
    assert.equal(snapshot.capture.text, 'HeadingBefore selected passage after.');
    assert.deepEqual(snapshot.anchor, { exact: 'selected passage', prefix: 'HeadingBefore ', suffix: ' after.', start: 14, end: 30 });
    assert.deepEqual(snapshot.sections, [{ title: 'Heading', start: 0, end: 37 }]);
    assert.deepEqual(snapshot.capture.sections, snapshot.sections);
    assert.equal(markers.length, 1);
    assert.equal(fixture.document.querySelector('[data-selection]')?.firstChild, fixture.selected);
    assert.equal(fixture.markup(), before);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    fixture.restore();
  }
});

test('source locator accepts exact and uniquely moved immutable passages', () => {
  const fixture = installPage(selectionPage, 'https://example.org/article#part');
  try {
    const snapshot = captureSelection('capture-document-2', 1, true);
    assert.ok(snapshot?.anchor);
    const anchor = { ...snapshot.anchor };

    const exactBefore = fixture.markup();
    const exact = locate(anchor);
    assert.ok(exact);
    assert.equal(exact.toString(), 'selected passage');
    assert.deepEqual(anchor, snapshot.anchor);
    assert.equal(fixture.markup(), exactBefore);

    const introduction = fixture.document.createElement('p');
    introduction.textContent = 'Inserted introduction. ';
    fixture.document.body?.insertBefore(introduction, fixture.document.body.firstChild);
    const movedBefore = fixture.markup();
    const moved = locate(anchor);
    assert.ok(moved);
    assert.equal(moved.toString(), 'selected passage');
    assert.deepEqual(anchor, snapshot.anchor);
    assert.equal(fixture.markup(), movedBefore);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    fixture.restore();
  }
});

test('source locator refuses ambiguous passages without changing the source', () => {
  const fixture = installPage(selectionPage, 'https://example.org/article');
  try {
    const snapshot = captureSelection('capture-document-3', 1, true);
    assert.ok(snapshot?.anchor);
    const duplicate = fixture.document.createElement('p');
    duplicate.textContent = 'HeadingBefore selected passage after.';
    fixture.document.body?.append(duplicate);
    const before = fixture.markup();

    assert.equal(locate(snapshot.anchor), null);
    assert.equal(fixture.markup(), before);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    fixture.restore();
  }
});

test('source locator refuses a lost passage without changing the source', () => {
  const fixture = installPage(selectionPage, 'https://example.org/article');
  try {
    const snapshot = captureSelection('capture-document-4', 1, true);
    assert.ok(snapshot?.anchor);
    fixture.selected?.parentElement?.remove();
    const before = fixture.markup();

    assert.equal(locate(snapshot.anchor), null);
    assert.equal(fixture.markup(), before);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    fixture.restore();
  }
});

test('selection in excluded form content is declined without page mutation or implicit send', () => {
  const fixture = installPage('<html><body><p>Visible source.</p><form><p data-selection="yes">private form selection</p></form></body></html>', 'https://example.org/form');
  try {
    const before = fixture.markup();
    assert.equal(captureSelection('capture-document-5', 1, true), null);
    assert.equal(fixture.markup(), before);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    fixture.restore();
  }
});

test('oversized source capture fails closed instead of truncating or sending', () => {
  const source = 'x'.repeat(1_000_001);
  const fixture = installPage(`<html><body>${source}</body></html>`, 'https://example.org/large');
  try {
    const before = fixture.document.body?.textContent;
    assert.equal(before?.length, 1_000_001);
    assert.throws(() => captureSelection('capture-document-6', 1, false), /too large to capture safely/);
    assert.equal(fixture.document.body?.textContent, before);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    fixture.restore();
  }
});

test('source protocol keeps forty-character context and reserves the quote bound for explicit quotes', () => {
  const exact = 'selected';
  const source = 'p'.repeat(40) + exact + 's'.repeat(40);
  const longSectionSource = 'x'.repeat(20_001);
  const sectionAnchor = { kind: 'section' as const, exact: longSectionSource, prefix: '', suffix: '', start: 0, end: longSectionSource.length };
  const quoteAnchor = { kind: 'quote' as const, exact, prefix: 'p'.repeat(40), suffix: 's'.repeat(40), start: 40, end: 48 };

  assert.equal(validAnchor(quoteAnchor, source), true);
  assert.equal(validAnchor({ ...quoteAnchor, prefix: 'p'.repeat(41) }, source), false);
  assert.equal(validAnchor(sectionAnchor, longSectionSource), true);
  assert.equal(validAnchor({ ...sectionAnchor, kind: 'quote' }, longSectionSource), false);
});
