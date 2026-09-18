import type { CandidateReply } from './reply.ts';
import type { HostCheckReport } from './host-checks.ts';
import type { ReaderSkillProvenance } from './reader-skills.ts';

// Missing kind means a legacy quote. Whole-page anchors deliberately contain no quote.
export type QuoteAnchor = { kind?: 'quote' | 'section' | 'whole-page'; exact: string; prefix: string; suffix: string; start: number; end: number };
export const wholePageAnchor = (): QuoteAnchor => ({ kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 });
export type SourceSection = { title: string; start: number; end: number };
export type SourceMetadata = { author?: string; publicationDate?: string; venue?: string };
export type SourceCapture = SourceMetadata & { url: string; title: string; pageType: string; text: string; capturedAt: string; extractionVersion: string; sections?: SourceSection[] };
export type SourceVersion = SourceMetadata & { id: string; sourceId: string; hash: string; text: string; capturedAt: string | null; extractionVersion: string | null; title: string | null; pageType: string | null; metadataStatus: 'provided' | 'legacy' | 'unavailable'; sections?: SourceSection[] };
export type NoteVersionRef = { noteId: string; revision: number };
export type NoteVersion = NoteVersionRef & { text: string; createdAt: string };
export type ReplyCorrection = { ancestorId: string; ancestorTitle: string; correctionId: string; correctedAt: string };
// Derived from immutable lineage, including removed versions. Missing on legacy caches.
export type ReplyVersion = { id: string; threadId: string; parentId: string | null; supersedes: string | null; reply: CandidateReply; hash: string; validation: HostCheckReport; answeredNote: NoteVersion | null; createdAt: string; deletedAt: string | null; revision: number; corrections?: ReplyCorrection[]; readerSkill?: ReaderSkillProvenance };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
// The authored reply is immutable; these reader controls are stored independently.
export type ReplyViewState = { replyVersionId: string; parameters: Record<string, number>; view: { [key: string]: JsonValue }; revision: number; updatedAt: string };
export type ReplyRemovalChange = { id: string; threadId: string; replyVersionId: string; removed: boolean; expectedRevision: number };
export type ThreadState = 'open' | 'parked' | 'done' | 'archived';
export const HIGHLIGHT_COLOURS = ['yellow', 'green', 'blue', 'rose'] as const;
export type HighlightColour = typeof HIGHLIGHT_COLOURS[number];
export const isHighlightColour = (value: unknown): value is HighlightColour => HIGHLIGHT_COLOURS.includes(value as HighlightColour);
export const highlightColour = (value: unknown): HighlightColour => {
  if (value === undefined) return 'yellow';
  if (isHighlightColour(value)) return value;
  throw new InvalidReaderMutationError('Invalid highlight colour.');
};
export type ReaderMutation =
  | { id: string; kind: 'keep'; threadId: string; capture: SourceCapture; anchor: QuoteAnchor; note?: string }
  | { id: string; kind: 'note'; threadId: string; noteId: string; text: string; expectedRevision: number }
  | { id: string; kind: 'note-remove'; threadId: string; noteId: string; removed: boolean; expectedRevision: number }
  | { id: string; kind: 'highlight'; threadId: string; highlighted: boolean; highlightColour?: HighlightColour; expectedRevision: number }
  | { id: string; kind: 'thread-state'; threadId: string; state: ThreadState; expectedRevision: number }
  | { id: string; kind: 'remove'; threadId: string; removed: boolean; expectedRevision: number };
export type Note = { id: string; threadId: string; text: string; revision: number; createdAt: string; deletedAt: string | null };
export type Thread = { id: string; anchorId: string; state: ThreadState; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null; sourceVersionId: string; sourceUrl: string; sourceTitle: string; anchor: QuoteAnchor; notes: Note[]; highlighted: boolean; highlightColour?: HighlightColour };
export type Attachment = { state: 'exact' | 'moved' | 'unsure' | 'lost'; candidates: { start: number; end: number }[] };
export type AttachmentRecord = Attachment & { id: string; anchorId: string; targetVersionId: string; tabCapture: string; recordedAt: string | null; targetAvailable: boolean };
/** The explicit, local-only observation request made when a reader chooses to
 * remember where a saved passage appears in the current source document. */
export type ReattachRequest = { threadId: string; text: string; tabCapture: string; capture: SourceCapture };
/** A validated observation carries the request identity back to the reader.
 * The helper route predates this envelope, so the client fills these identity
 * fields from the request only after validating any fields a newer helper may
 * return. */
export type ReattachResponse = Attachment & { threadId: string; sourceGeneration: string; sourceUrl: string };

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

/** A content rejection, not a transport, pairing or storage failure. */
export class InvalidReaderMutationError extends Error {
  override name = 'InvalidReaderMutation';
  readonly code = 'INVALID_READER_MUTATION';
}

/** Shared browser/daemon bounds. No persistence or provider authority lives here. */
export function validateReaderMutation(value: unknown): asserts value is ReaderMutation {
  const m = value as ReaderMutation;
  if (!m || typeof m !== 'object' || Array.isArray(m) || !readerId(m.id) || !readerId(m.threadId)) invalidReaderMutation('Invalid change identifier.');
  if (m.kind === 'keep') {
    const { capture: c, anchor: a } = m;
    validateSourceCapture(c);
    validateQuoteAnchor(a, c.text);
    if (m.note !== undefined && (typeof m.note !== 'string' || m.note.length > 20000)) invalidReaderMutation('Note is too large.');
  } else {
    if (!Number.isSafeInteger(m.expectedRevision) || m.expectedRevision < 0) invalidReaderMutation('Invalid revision.');
    if (m.kind === 'note') {
      if (typeof m.text !== 'string' || m.text.length > 20000 || !readerId(m.noteId)) invalidReaderMutation('Invalid note.');
    } else if (m.kind === 'note-remove') {
      if (!readerId(m.noteId) || typeof m.removed !== 'boolean') invalidReaderMutation('Invalid note removal.');
    } else if (m.kind === 'highlight') {
      if (typeof m.highlighted !== 'boolean') invalidReaderMutation('Invalid highlight change.');
      if (m.highlightColour !== undefined && (!m.highlighted || !isHighlightColour(m.highlightColour))) invalidReaderMutation('Invalid highlight colour.');
    } else if (m.kind === 'thread-state') {
      if (!['open', 'parked', 'done', 'archived'].includes(m.state)) invalidReaderMutation('Invalid thread state.');
    } else if (m.kind === 'remove') {
      if (typeof m.removed !== 'boolean') invalidReaderMutation('Invalid removal.');
    } else invalidReaderMutation('Unknown reader change.');
  }
}

/** Shared boundary for the reply-only tombstone route. Reply authorship and view data are not mutable here. */
export function validateReplyRemovalChange(value: unknown): asserts value is ReplyRemovalChange {
  const change = value as ReplyRemovalChange;
  if (!change || typeof change !== 'object' || Array.isArray(change) ||
    !readerId(change.id) || !readerId(change.threadId) || !readerId(change.replyVersionId) ||
    typeof change.removed !== 'boolean' || !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) {
    invalidReaderMutation('Invalid reply removal.');
  }
}

export function validateQuoteAnchor(a: unknown, text: string): asserts a is QuoteAnchor {
  const anchor = a as QuoteAnchor;
  if (!anchor || (anchor.kind !== undefined && !['quote', 'section', 'whole-page'].includes(anchor.kind)) || typeof anchor.exact !== 'string' || anchor.exact.length > 16000 || typeof anchor.prefix !== 'string' || typeof anchor.suffix !== 'string' || anchor.prefix.length > 256 || anchor.suffix.length > 256 || !Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) || anchor.start < 0 || anchor.end < anchor.start || anchor.end > text.length) invalidReaderMutation('Invalid passage attachment.');
  if (anchor.kind === 'whole-page' ? (anchor.exact !== '' || anchor.prefix !== '' || anchor.suffix !== '' || anchor.start !== 0 || anchor.end !== 0) : (!anchor.exact.length || anchor.end - anchor.start !== anchor.exact.length)) invalidReaderMutation('Invalid passage attachment.');
  if (text.slice(anchor.start, anchor.end) !== anchor.exact) invalidReaderMutation('The selected passage does not match the captured page.');
}

export function validateSourceCapture(value: unknown): asserts value is SourceCapture {
  const c = value as SourceCapture;
  if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.url !== 'string' || c.url.length > 8000 || typeof c.text !== 'string' || c.text.length > 1000000 || typeof c.title !== 'string' || c.title.length > 1000 || typeof c.pageType !== 'string' || c.pageType.length > 100 || typeof c.extractionVersion !== 'string' || !c.extractionVersion.length || c.extractionVersion.length > 100 || typeof c.capturedAt !== 'string' || !Number.isFinite(Date.parse(c.capturedAt))) invalidReaderMutation('Invalid source capture.');
  let url: URL;
  try { url = new URL(c.url); } catch { invalidReaderMutation('Invalid source capture.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalidReaderMutation('Invalid source capture.');
  for (const field of ['author', 'venue'] as const) {
    const metadata = c[field];
    if (metadata !== undefined && (typeof metadata !== 'string' || !metadata.trim() || metadata !== metadata.trim() || metadata.length > 500 || /[\u0000-\u001f\u007f]/.test(metadata))) invalidReaderMutation('Invalid source metadata.');
  }
  if (c.publicationDate !== undefined && !validPublicationDate(c.publicationDate)) invalidReaderMutation('Invalid source metadata.');
  if (c.sections !== undefined) {
    if (!Array.isArray(c.sections) || c.sections.length > 2000) invalidReaderMutation('Invalid source sections.');
    let previousEnd = 0;
    for (const section of c.sections) {
      if (!section || typeof section !== 'object' || typeof section.title !== 'string' || !section.title.length || section.title.length > 1000 || !Number.isSafeInteger(section.start) || !Number.isSafeInteger(section.end) || section.start < previousEnd || section.end <= section.start || section.end > c.text.length) invalidReaderMutation('Invalid source sections.');
      previousEnd = section.end;
    }
  }
}

/** Calendar metadata retains its observed precision and spelling. Never parse prose. */
export function validPublicationDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false;
  const match = /^(\d{4})(?:[-/](\d{2})(?:[-/](\d{2}))?)?(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match || (value.includes('T') && (!match[3] || !Number.isFinite(Date.parse(value))))) return false;
  const year = Number(match[1]), month = Number(match[2] ?? 1), day = Number(match[3] ?? 1);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month > 0 && month <= 12 && day > 0 && day <= days[month - 1];
}

function readerId(id: unknown): id is string { return typeof id === 'string' && /^[\w-]{1,100}$/.test(id); }
function invalidReaderMutation(message: string): never { throw new InvalidReaderMutationError(message); }
