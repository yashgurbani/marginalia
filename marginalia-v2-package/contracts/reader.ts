export type QuoteAnchor = { exact: string; prefix: string; suffix: string; start: number; end: number };
export type SourceCapture = { url: string; title: string; pageType: string; text: string; capturedAt: string; extractionVersion: string };
export type ThreadState = 'open' | 'parked' | 'done' | 'archived';
export type ReaderMutation =
  | { id: string; kind: 'keep'; threadId: string; capture: SourceCapture; anchor: QuoteAnchor; note?: string }
  | { id: string; kind: 'note'; threadId: string; noteId: string; text: string; expectedRevision: number }
  | { id: string; kind: 'thread-state'; threadId: string; state: ThreadState; expectedRevision: number }
  | { id: string; kind: 'remove'; threadId: string; removed: boolean; expectedRevision: number };
export type Note = { id: string; threadId: string; text: string; revision: number; createdAt: string; deletedAt: string | null };
export type Thread = { id: string; anchorId: string; state: ThreadState; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null; sourceVersionId: string; sourceUrl: string; sourceTitle: string; anchor: QuoteAnchor; notes: Note[]; highlighted: boolean };
export type Attachment = { state: 'exact' | 'moved' | 'unsure' | 'lost'; candidates: { start: number; end: number }[] };

/** Exact quote matching only. Similar text is never silently promoted to a match. */
export function attachQuote(anchor: QuoteAnchor, text: string): Attachment {
  if (!anchor.exact) return { state: 'lost', candidates: [] };
  const candidates: Attachment['candidates'] = [];
  let from = 0;
  while (from <= text.length) {
    const start = text.indexOf(anchor.exact, from);
    if (start < 0) break;
    candidates.push({ start, end: start + anchor.exact.length });
    if (candidates.length > 100) return { state: 'unsure', candidates: candidates.slice(0, 100) };
    from = start + 1;
  }
  if (!candidates.length) return { state: 'lost', candidates };
  let matches = candidates;
  if (matches.length > 1) matches = candidates.filter(({ start, end }) =>
    (!anchor.prefix || text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix) &&
    (!anchor.suffix || text.slice(end, end + anchor.suffix.length) === anchor.suffix));
  if (matches.length !== 1) return { state: 'unsure', candidates };
  return { state: matches[0].start === anchor.start ? 'exact' : 'moved', candidates: matches };
}
