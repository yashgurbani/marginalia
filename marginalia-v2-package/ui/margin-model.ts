import { attachQuote, type QuoteAnchor, type SourceCapture, type Thread } from '../contracts/reader.ts';

export function anchorAt(text: string, start: number, end: number): QuoteAnchor {
  return { exact: text.slice(start, end), start, end, prefix: text.slice(Math.max(0, start - 40), start), suffix: text.slice(end, end + 40) };
}
export function orderedThreads(threads: Thread[], capture: SourceCapture): Thread[] {
  return threads.filter(thread => thread.sourceUrl === capture.url && !thread.deletedAt)
    .sort((a, b) => (displayPosition(a.anchor, capture) ?? Infinity) - (displayPosition(b.anchor, capture) ?? Infinity) || a.anchor.start - b.anchor.start || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export function displayPosition(anchor: QuoteAnchor, capture: SourceCapture): number | undefined {
  if (anchor.kind === 'whole-page') return 0;
  const attached = attachQuote(anchor, capture.text);
  return attached.state === 'exact' || attached.state === 'moved' ? attached.candidates[0]?.start : undefined;
}
export function outgoingPreview(capture: SourceCapture, anchor: QuoteAnchor, question: string, note?: { text: string; revision: number }, context = '') {
  // This is an explicit preview boundary, not an inference endpoint or grant.
  return { recipient: 'Your Codex', scope: 'This question only', page: { url: capture.url, title: capture.title, type: capture.pageType }, anchor: anchor.kind ?? 'quote', passage: anchor.exact, note: note ? { text: note.text, revision: note.revision } : null, question, context };
}
export function sourceLocation(thread: Thread, capture: SourceCapture) { return attachQuote(thread.anchor, capture.text); }

/** A conservative literal definition. Never invent a gloss or infer it from a paraphrase. */
export function pageDefinition(term: string, text: string): string | undefined {
  if (!term.trim() || term.length > 80 || term.trim().split(/\s+/).length > 5) return;
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.match(new RegExp(`(?:^|[.!?]\\s+|\\n)(${escaped} (?:is|means|refers to) [^.!?\\n]{3,220}[.!?])`, 'i'))?.[1];
}
