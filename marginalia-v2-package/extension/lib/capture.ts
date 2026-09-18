import * as position from 'dom-anchor-text-position';
import * as quote from 'dom-anchor-text-quote';
import { attachQuote, validPublicationDate, type QuoteAnchor } from '../../contracts/reader.ts';
import { MAX_TEXT, pageIdentity, type Snapshot } from './protocol.ts';
import { detectPageType, type PageTypeInput } from './page-type.ts';

export type SectionMarker = { heading: Element; start: number };

type PageTypeDocument = Pick<Document, 'querySelector' | 'querySelectorAll'>;

function schemaTypes(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) schemaTypes(item, result);
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>, type = record['@type'];
    if (typeof type === 'string') result.push(type);
    else if (Array.isArray(type)) for (const item of type) if (typeof item === 'string') result.push(item);
    for (const [key, child] of Object.entries(record)) if (key !== '@type') schemaTypes(child, result);
  }
  return result;
}

/** Reads bounded structural metadata from the open document without logging or I/O. */
export function pageTypeInput(source: PageTypeDocument = document, address: Pick<Location, 'hostname' | 'pathname'> = location): PageTypeInput {
  let openGraphType: string | null = null;
  const citationMetaTags: string[] = [];
  for (const meta of Array.from(source.querySelectorAll('meta'))) {
    const name = (meta.getAttribute('name') ?? meta.getAttribute('property') ?? '').trim().toLowerCase();
    if (name === 'og:type' && !openGraphType) openGraphType = meta.getAttribute('content')?.trim() ?? null;
    if (name.startsWith('citation_')) citationMetaTags.push(name);
  }
  const observedSchemaTypes: string[] = [];
  for (const script of Array.from(source.querySelectorAll('script[type="application/ld+json"]')).slice(0, 20)) {
    const json = script.textContent ?? '';
    if (!json || json.length > 250_000) continue;
    try { schemaTypes(JSON.parse(json), observedSchemaTypes); } catch { /* Invalid publisher metadata is not a signal. */ }
  }
  for (const element of Array.from(source.querySelectorAll('[itemtype]'))) {
    const itemtype = element.getAttribute('itemtype');
    if (itemtype) observedSchemaTypes.push(...itemtype.split(/\s+/).filter(Boolean));
  }
  const headings = Array.from(source.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const headingDepth = headings.reduce((depth, heading) => Math.max(depth, Number(heading.tagName.slice(1)) || 0), 0);
  const codeBlockCount = source.querySelectorAll('pre').length;
  return {
    hostname: address.hostname,
    path: address.pathname,
    openGraphType,
    schemaTypes: observedSchemaTypes,
    citationMetaTags,
    hasArticleElement: !!source.querySelector('article'),
    codeBlockCount,
    headingDepth,
    hasReferencesSection: !!source.querySelector('[id="references"],[id="reference"],[class~="references"],[aria-label="References"]'),
    hasFeedMarkup: !!source.querySelector('[role="feed"],[itemtype$="/DataFeed"]'),
    hasThreadMarkup: !!source.querySelector('[data-thread-id],[data-conversation-id],[aria-label="Thread"]'),
  };
}

const metadataNames = {
  author: ['author', 'article:author', 'citation_author', 'dc.creator', 'byl'],
  publicationDate: ['article:published_time', 'date', 'datepublished', 'citation_publication_date', 'citation_date', 'dc.date'],
  venue: ['citation_journal_title', 'citation_conference_title', 'og:site_name', 'publisher'],
} as const;

/** Reads only metadata already present in this document. It performs no lookup and
 * does not derive facts from the URL, title, prose, or page type. */
export function extractPageMetadata(source: Pick<Document, 'querySelectorAll'> = document) {
  const observed = new Map<string, string[]>();
  for (const element of Array.from(source.querySelectorAll('meta'))) {
    const name = (element.getAttribute('name') ?? element.getAttribute('property') ?? element.getAttribute('itemprop') ?? '').trim().toLowerCase();
    const content = (element.getAttribute('content') ?? '').replace(/\s+/g, ' ').trim();
    if (!name || !content) continue;
    const values = observed.get(name) ?? [];
    values.push(content); observed.set(name, values);
  }
  const first = (names: readonly string[], valid: (value: string) => boolean = () => true) => {
    for (const name of names) for (const value of observed.get(name) ?? []) if (valid(value)) return value;
  };
  const author = first(metadataNames.author, value => value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value));
  const publicationDate = first(metadataNames.publicationDate, validPublicationDate);
  const venue = first(metadataNames.venue, value => value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value));
  return { ...(author ? { author } : {}), ...(publicationDate ? { publicationDate } : {}), ...(venue ? { venue } : {}) };
}

const excluded = 'script,style,noscript,template,form,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[hidden],[inert],[aria-hidden="true"],[id^="marginalia-host-"]';
export function safeNode(node: Node): boolean {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  if (!element || element.closest(excluded)) return false;
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector('summary')?.contains(element)) return false;
  }
  return true;
}
/** A detached text projection gives the anchor libraries exactly the text we retain.
 * No input values, scripts, private margin DOM, or page mutation enter this projection. */
export function projectPage() {
  const nodes: { node: Text; start: number; end: number }[] = [];
  const root = document.createElement('div');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null, size = 0;
  while ((node = walker.nextNode())) {
    if (!safeNode(node)) continue;
    const value = node.textContent ?? '';
    if (size + value.length > MAX_TEXT) throw new Error('This page is too large to capture safely.');
    nodes.push({ node: node as Text, start: size, end: size + value.length });
    root.append(document.createTextNode(value)); size += value.length;
  }
  const starts = Array.from(document.querySelectorAll('h1,h2,h3')).filter(safeNode).slice(0, 299).flatMap(heading => {
    const admitted = nodes.filter(entry => entry.end > entry.start && heading.contains(entry.node));
    const title = admitted.map(entry => entry.node.textContent ?? '').join('').trim().slice(0, 200);
    const first = admitted[0];
    return title && first && first.start < size ? [{ title, start: first.start, heading }] : [];
  }).filter((section, index, all) => index === 0 || section.start > all[index - 1].start);
  const leading = size && (!starts.length || starts[0].start > 0) ? [{ title: 'Beginning', start: 0 }] : [];
  const boundaries = [...leading, ...starts];
  const sections = boundaries.map((section, index) => ({ title: section.title, start: section.start, end: boundaries[index + 1]?.start ?? size }));
  const markers = starts.map(({ heading, start }) => ({ heading, start }));
  return { root, nodes, sections, markers, text: root.textContent ?? '' };
}
export function captureSelection(documentId: string, revision: number, requireSelection = true, onSections?: (markers: SectionMarker[]) => void): Snapshot | null {
  const selection = getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (requireSelection && (!range || range.collapsed || !safeNode(range.startContainer) || !safeNode(range.endContainer))) return null;
  const projection = projectPage();
  let anchor: QuoteAnchor | null = null;
  if (range && !range.collapsed) {
    const selected = projection.nodes.filter(e => range.intersectsNode(e.node));
    const start = selected[0];
    const end = selected[selected.length - 1];
    // Reject cross-field selections instead of silently including omitted text.
    if (start && end) {
      const offsets = { start: start.start + (start.node === range.startContainer ? range.startOffset : 0), end: end.start + (end.node === range.endContainer ? range.endOffset : end.node.length) };
      if (offsets.end - offsets.start > 20000 || offsets.end <= offsets.start) return null;
      const projectedRange = position.toRange(projection.root, offsets);
      const measured = position.fromRange(projection.root, projectedRange);
      const capturedAnchor: QuoteAnchor = { ...measured, ...quote.fromTextPosition(projection.root, measured) };
      if (range.toString() !== capturedAnchor.exact) return null;
      anchor = capturedAnchor;
    } else if (requireSelection) return null;
  }
  onSections?.(projection.markers);
  return { document: documentId, revision, anchor, position: anchor?.start ?? 0, sections: projection.sections, capture: { url: pageIdentity(location.href), title: document.title.slice(0, 500), pageType: detectPageType(pageTypeInput()).type, ...extractPageMetadata(), text: projection.text, capturedAt: new Date().toISOString(), extractionVersion: 'dom-safe-text-v1', sections: projection.sections } };
}
export function locate(anchor: QuoteAnchor): Range | null {
  const projection = projectPage(), attachment = attachQuote(anchor, projection.text);
  if (!['exact', 'moved'].includes(attachment.state) || attachment.candidates.length !== 1) return null;
  const match = attachment.candidates[0];
  const first = projection.nodes.find(e => match.start >= e.start && match.start < e.end);
  const last = projection.nodes.find(e => match.end > e.start && match.end <= e.end);
  if (!first || !last) return null;
  const range = document.createRange(); range.setStart(first.node, match.start - first.start); range.setEnd(last.node, match.end - last.start); return range;
}
