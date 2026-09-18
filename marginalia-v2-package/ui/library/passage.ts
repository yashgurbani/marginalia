import type { LibrarySearchResult } from '../../contracts/library.ts';

export function validateSavedPassage(result: LibrarySearchResult, source: { id: string; text: string }, threadId: string): void {
  if (result.threadId !== threadId || result.sourceVersionId !== source.id || !Number.isSafeInteger(result.start)
    || !Number.isSafeInteger(result.end) || result.start < 0 || result.end <= result.start || result.end > source.text.length
    || source.text.slice(result.start, result.end) !== result.passage) throw new Error('The cited passage does not match this saved source. Search again.');
}

/** Select the exact saved text through a DOM Range; do not rewrite source nodes. */
export function focusSavedPassage(root: HTMLElement, result: LibrarySearchResult): void {
  if (root.textContent?.slice(result.start, result.end) !== result.passage) throw new Error('The saved passage cannot be located in this view.');
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const range = root.ownerDocument.createRange();
  let node: Node | null, offset = 0, started = false, ended = false;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!started && result.start < offset + length) { range.setStart(node, result.start - offset); started = true; }
    if (started && result.end <= offset + length) { range.setEnd(node, result.end - offset); ended = true; break; }
    offset += length;
  }
  if (!started || !ended) throw new Error('The saved passage cannot be located in this view.');
  root.focus({ preventScroll: true });
  const selection = root.ownerDocument.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  const box = range.getBoundingClientRect();
  root.ownerDocument.defaultView?.scrollBy({ top: box.top - 120, behavior: 'instant' });
}
