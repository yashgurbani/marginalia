import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSelection, locate, projectPage } from '../extension/lib/capture.ts';
import { readingPositionAt } from '../extension/entrypoints/content.ts';
import { validAnchor } from '../extension/lib/protocol.ts';

const SHOW_TEXT = 4;
const GLOBALS = ['document', 'Node', 'NodeFilter', 'HTMLDetailsElement', 'getComputedStyle', 'location', 'getSelection', 'fetch'];
type GlobalState = { exists: boolean; value: unknown };

class FixtureNode {
  static readonly ELEMENT_NODE = 1;
  static readonly TEXT_NODE = 3;
  readonly nodeType: number;
  ownerDocument: FixtureDocument;
  parentNode: FixtureNode | null = null;
  childNodes: FixtureNode[] = [];
  rect = { top: 0, bottom: 0, width: 0, height: 0 };

  constructor(nodeType: number, ownerDocument?: FixtureDocument) {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument ?? this as unknown as FixtureDocument;
  }

  get parentElement(): FixtureElement | null { return this.parentNode instanceof FixtureElement ? this.parentNode : null; }
  get firstChild(): FixtureNode | null { return this.childNodes[0] ?? null; }
  get nextSibling(): FixtureNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }
  get textContent(): string { return this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.append(this.ownerDocument.createFixtureText(value));
  }
  append(...nodes: FixtureNode[]) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  appendChild(node: FixtureNode) { this.append(node); return node; }
  insertBefore(node: FixtureNode, reference: FixtureNode | null) {
    node.remove();
    node.parentNode = this;
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    return node;
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.childNodes.indexOf(this);
    if (index >= 0) this.parentNode.childNodes.splice(index, 1);
    this.parentNode = null;
  }
  contains(node: FixtureNode): boolean { return this === node || this.childNodes.some(child => child.contains(node)); }
}

class FixtureText extends FixtureNode {
  private value: string;
  constructor(value: string, ownerDocument: FixtureDocument) { super(3, ownerDocument); this.value = value; }
  override get textContent() { return this.value; }
  override set textContent(value: string) { this.value = value; }
  get nodeValue() { return this.value; }
  set nodeValue(value: string) { this.value = value; }
  get length() { return this.value.length; }
  override toString() { return this.value; }
}

class FixtureElement extends FixtureNode {
  readonly tagName: string;
  readonly attributes: Record<string, string>;
  open = false;

  constructor(tagName: string, ownerDocument: FixtureDocument, attributes: Record<string, string> = {}) {
    super(1, ownerDocument);
    this.tagName = tagName.toLowerCase();
    this.attributes = { ...attributes };
  }

  private excluded() {
    const tag = this.tagName;
    const contenteditable = this.attributes.contenteditable;
    return ['script', 'style', 'noscript', 'template', 'form', 'input', 'textarea', 'select', 'button'].includes(tag)
      || (contenteditable !== undefined && contenteditable !== 'false')
      || ['textbox', 'combobox'].includes(this.attributes.role ?? '')
      || 'hidden' in this.attributes || 'inert' in this.attributes || this.attributes['aria-hidden'] === 'true'
      || (this.attributes.id ?? '').startsWith('marginalia-host-');
  }
  closest(_selector: string): FixtureElement | null {
    for (let element: FixtureElement | null = this; element; element = element.parentElement) if (element.excluded()) return element;
    return null;
  }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  querySelector(selector: string): FixtureElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FixtureElement[] {
    const tags = selector.split(',').map(value => value.trim().toLowerCase());
    const matches = (element: FixtureElement) => tags.includes(element.tagName)
      || (selector === '[data-selection]' && 'data-selection' in element.attributes);
    const result: FixtureElement[] = [];
    const visit = (node: FixtureNode) => {
      if (node instanceof FixtureElement && matches(node)) result.push(node);
      for (const child of node.childNodes) visit(child);
    };
    for (const child of this.childNodes) visit(child);
    return result;
  }
  get isConnected() { return this.ownerDocument.body.contains(this); }
  getBoundingClientRect() { return this.rect; }
  override toString() {
    const attributes = Object.entries(this.attributes).map(([name, value]) => value ? ` ${name}="${value}"` : ` ${name}`).join('');
    return `<${this.tagName}${attributes}>${this.childNodes.map(node => node.toString()).join('')}</${this.tagName}>`;
  }
}

class FixtureDetailsElement extends FixtureElement {}

class FixtureDocument extends FixtureNode {
  readonly body: FixtureElement;
  title = '';

  constructor() {
    super(9);
    this.ownerDocument = this;
    this.body = new FixtureElement('body', this);
    this.append(this.body);
  }
  createFixtureText(value: string) { return new FixtureText(value, this); }
  createTextNode(value: string) { return this.createFixtureText(value) as unknown as Text; }
  createElement(tagName: string) { return new FixtureElement(tagName, this) as unknown as HTMLElement; }
  createRange() { return new FixtureRange() as unknown as Range; }
  createTreeWalker(root: Node) { return new FixtureTextIterator(root) as unknown as TreeWalker; }
  createNodeIterator(root: Node) { return new FixtureTextIterator(root) as unknown as NodeIterator; }
  querySelector(selector: string) { return this.body.querySelector(selector) as unknown as Element | null; }
  querySelectorAll(selector: string) { return this.body.querySelectorAll(selector) as unknown as NodeListOf<Element>; }
}

function appendElement(parent: FixtureNode, tagName: string, content: string | FixtureNode[], attributes: Record<string, string> = {}) {
  const element = new FixtureElement(tagName, parent.ownerDocument, attributes);
  if (typeof content === 'string') element.textContent = content;
  else element.append(...content);
  parent.append(element);
  return element;
}

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

/** The anchor packages need the browser Range and NodeIterator traversal semantics. */
class FixtureRange {
  startContainer: Node | null = null;
  startOffset = 0;
  endContainer: Node | null = null;
  endOffset = 0;
  selectedNode: Node | null = null;

  setStart(container: Node, offset: number) { this.startContainer = container; this.startOffset = offset; }
  setEnd(container: Node, offset: number) { this.endContainer = container; this.endOffset = offset; }
  selectNodeContents(node: Node) { this.selectedNode = node; }
  getBoundingClientRect() { return (this.selectedNode as unknown as FixtureNode).rect; }
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

function installPage(pageDocument: FixtureDocument, selectedNode: FixtureText | null, url: string): Fixture {
  const selected = selectedNode as unknown as Text | null;
  let selectionRange: FixtureRange | null = null;
  if (selected) {
    selectionRange = new FixtureRange();
    selectionRange.setStart(selected, 0);
    selectionRange.setEnd(selected, selected.textContent?.length ?? 0);
  }

  const globalObject = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, GlobalState>();
  for (const name of GLOBALS) previous.set(name, { exists: Object.hasOwn(globalObject, name), value: globalObject[name] });

  let fetchCalls = 0;
  globalObject.document = pageDocument as unknown as Document;
  globalObject.Node = FixtureNode;
  globalObject.NodeFilter = { SHOW_TEXT };
  globalObject.HTMLDetailsElement = FixtureDetailsElement;
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
    document: pageDocument as unknown as Document,
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

function selectionPage() {
  const document = new FixtureDocument();
  document.title = 'Reading';
  appendElement(document.body, 'h1', 'Heading');
  const selected = document.createFixtureText('selected passage');
  const emphasis = new FixtureElement('em', document, { 'data-selection': 'yes' });
  emphasis.append(selected);
  appendElement(document.body, 'p', [document.createFixtureText('Before '), emphasis, document.createFixtureText(' after.')], { id: 'passage', 'data-source': 'original' });
  const form = appendElement(document.body, 'form', []);
  appendElement(form, 'p', 'form text must not be captured');
  appendElement(document.body, 'script', 'script text must not be captured');
  appendElement(document.body, 'p', 'hidden text must not be captured', { hidden: '' });
  return { document, selected };
}

function excludedSelectionPage() {
  const document = new FixtureDocument();
  appendElement(document.body, 'p', 'Visible source.');
  const form = appendElement(document.body, 'form', []);
  const selected = document.createFixtureText('private form selection');
  appendElement(form, 'p', [selected], { 'data-selection': 'yes' });
  return { document, selected };
}

function textPage(text: string) {
  const document = new FixtureDocument();
  document.body.append(document.createFixtureText(text));
  return document;
}

test('selection captures safe source identity without page mutation or implicit send', () => {
  const page = selectionPage();
  appendElement(page.document.body, 'meta', '', { name: 'author', content: 'Ada Reader' });
  appendElement(page.document.body, 'meta', '', { property: 'article:published_time', content: '2026-09-17' });
  appendElement(page.document.body, 'meta', '', { name: 'citation_journal_title', content: 'Local Journal' });
  const fixture = installPage(page.document, page.selected, 'https://arxiv.org/html/2303.08774v6#results');
  try {
    const before = fixture.markup();
    const markers: unknown[] = [];
    const snapshot = captureSelection('capture-document-1', 7, true, entries => markers.push(...entries));

    assert.ok(snapshot);
    assert.equal(snapshot.document, 'capture-document-1');
    assert.notEqual(snapshot.document, 'browser-document-1');
    assert.equal(snapshot.capture.url, 'https://arxiv.org/html/2303.08774v6');
    assert.equal(snapshot.capture.pageType, 'paper');
    assert.equal(snapshot.capture.author, 'Ada Reader');
    assert.equal(snapshot.capture.publicationDate, '2026-09-17');
    assert.equal(snapshot.capture.venue, 'Local Journal');
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
  const page = selectionPage();
  const fixture = installPage(page.document, page.selected, 'https://example.org/article#part');
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
  const page = selectionPage();
  const fixture = installPage(page.document, page.selected, 'https://example.org/article');
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
  const page = selectionPage();
  const fixture = installPage(page.document, page.selected, 'https://example.org/article');
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
  const page = excludedSelectionPage();
  const fixture = installPage(page.document, page.selected, 'https://example.org/form');
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
  const fixture = installPage(textPage(source), null, 'https://example.org/large');
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

test('content position follows the first fully visible paragraph instead of its section start', () => {
  const document = new FixtureDocument();
  const heading = appendElement(document.body, 'h1', 'Heading');
  const clipped = appendElement(document.body, 'p', 'Clipped paragraph.');
  const visible = appendElement(document.body, 'p', 'Visible paragraph.');
  heading.rect = { top: -100, bottom: -80, width: 100, height: 20 };
  clipped.firstChild!.rect = { top: -5, bottom: 15, width: 200, height: 20 };
  visible.firstChild!.rect = { top: 40, bottom: 60, width: 200, height: 20 };
  const fixture = installPage(document, null, 'https://example.org/article');
  try {
    const projection = projectPage();
    assert.equal(readingPositionAt(projection.nodes, projection.markers, 600), 25);
    assert.notEqual(readingPositionAt(projection.nodes, projection.markers, 600), projection.sections[0].start);
  } finally { fixture.restore(); }
});

test('content position falls back to the section start when the viewport has no text', () => {
  const document = new FixtureDocument();
  const introduction = appendElement(document.body, 'p', 'Introduction.');
  const heading = appendElement(document.body, 'h2', 'Heading');
  introduction.firstChild!.rect = { top: -100, bottom: -80, width: 120, height: 20 };
  heading.rect = { top: -20, bottom: 0, width: 100, height: 20 };
  heading.firstChild!.rect = heading.rect;
  appendElement(document.body, 'img', []);
  const fixture = installPage(document, null, 'https://example.org/figures');
  try {
    const projection = projectPage();
    assert.equal(readingPositionAt(projection.nodes, projection.markers, 600), projection.sections[1].start);
  } finally { fixture.restore(); }
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
