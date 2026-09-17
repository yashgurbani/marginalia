import type { CandidateReply } from './reply.ts';
import type { HostCheckReport } from './host-checks.ts';

// Missing kind means a legacy quote. Whole-page anchors deliberately contain no quote.
export type QuoteAnchor = { kind?: 'quote' | 'section' | 'whole-page'; exact: string; prefix: string; suffix: string; start: number; end: number };
export const wholePageAnchor = (): QuoteAnchor => ({ kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 });
export type SourceSection = { title: string; start: number; end: number };
export type SourceCapture = { url: string; title: string; pageType: string; text: string; capturedAt: string; extractionVersion: string; sections?: SourceSection[] };
export type SourceVersion = { id: string; sourceId: string; hash: string; text: string; capturedAt: string | null; extractionVersion: string | null; title: string | null; pageType: string | null; metadataStatus: 'provided' | 'legacy' | 'unavailable'; sections?: SourceSection[] };
export type NoteVersionRef = { noteId: string; revision: number };
export type NoteVersion = NoteVersionRef & { text: string; createdAt: string };
export type ReplyVersion = { id: string; threadId: string; parentId: string | null; supersedes: string | null; reply: CandidateReply; hash: string; validation: HostCheckReport; answeredNote: NoteVersion | null; createdAt: string; deletedAt: string | null; revision: number };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
// The authored reply is immutable; these reader controls are stored independently.
export type ReplyViewState = { replyVersionId: string; parameters: Record<string, number>; view: { [key: string]: JsonValue }; revision: number; updatedAt: string };
export type ThreadState = 'open' | 'parked' | 'done' | 'archived';
export type ReaderMutation =
  | { id: string; kind: 'keep'; threadId: string; capture: SourceCapture; anchor: QuoteAnchor; note?: string }
  | { id: string; kind: 'note'; threadId: string; noteId: string; text: string; expectedRevision: number }
  | { id: string; kind: 'thread-state'; threadId: string; state: ThreadState; expectedRevision: number }
  | { id: string; kind: 'remove'; threadId: string; removed: boolean; expectedRevision: number };
export type Note = { id: string; threadId: string; text: string; revision: number; createdAt: string; deletedAt: string | null };
export type Thread = { id: string; anchorId: string; state: ThreadState; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null; sourceVersionId: string; sourceUrl: string; sourceTitle: string; anchor: QuoteAnchor; notes: Note[]; highlighted: boolean };
export type Attachment = { state: 'exact' | 'moved' | 'unsure' | 'lost'; candidates: { start: number; end: number }[] };
export type AttachmentRecord = Attachment & { id: string; anchorId: string; targetVersionId: string; tabCapture: string; recordedAt: string | null; targetAvailable: boolean };

/** Exact quote matching only. Similar text is never silently promoted to a match. */
export function attachQuote(anchor: QuoteAnchor, text: string): Attachment {
  if (anchor.kind === 'whole-page') return { state: 'exact', candidates: [] };
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
  const matches = candidates.filter(({ start, end }) =>
    (!anchor.prefix || text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix) &&
    (!anchor.suffix || text.slice(end, end + anchor.suffix.length) === anchor.suffix));
  if (matches.length !== 1) return { state: 'unsure', candidates };
  return { state: matches[0].start === anchor.start ? 'exact' : 'moved', candidates: matches };
}
