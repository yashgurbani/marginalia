import * as position from 'dom-anchor-text-position';
import * as quote from 'dom-anchor-text-quote';
import { attachQuote, type QuoteAnchor } from '../../contracts/reader.ts';
import { MAX_TEXT, pageIdentity, type Snapshot } from './protocol.ts';

export type SectionMarker = { heading: Element; start: number };

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
      anchor = { ...measured, ...quote.fromTextPosition(projection.root, measured) };
      if (range.toString() !== anchor.exact) return null;
    } else if (requireSelection) return null;
  }
  onSections?.(projection.markers);
  return { document: documentId, revision, anchor, position: anchor?.start ?? 0, sections: projection.sections, capture: { url: pageIdentity(location.href), title: document.title.slice(0, 500), pageType: location.hostname.endsWith('arxiv.org') ? 'Paper' : 'Web page', text: projection.text, capturedAt: new Date().toISOString(), extractionVersion: 'dom-safe-text-v1', sections: projection.sections } };
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
