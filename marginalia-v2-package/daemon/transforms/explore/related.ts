import type { Note, QuoteAnchor, Thread } from '../../../contracts/reader.ts';
import { LibrarySettingsService } from '../../library.ts';
import type { ReaderStore } from '../../store.ts';

export const RELATED_MAX_RESULTS = 8;
const RELATED_SEARCH_RESULTS = 50;
const RELATED_STOP_WORDS = new Set(['about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'from', 'have', 'into', 'more', 'other', 'should', 'their', 'there', 'these', 'they', 'this', 'those', 'through', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your']);

export type RelatedPassageRequest = {
  passage: QuoteAnchor;
  threadId?: string;
  sourceVersionId?: string;
  limit?: number;
};

export type RelatedPassageNote = { id: string; revision: number; excerpt: string };

/** A local match that always points back to a saved thread and immutable source anchor. */
export type RelatedPassageResult = {
  kind: 'note' | 'thread';
  threadId: string;
  anchorId: string;
  sourceVersionId: string;
  sourceTitle: string;
  sourceUrl: string;
  anchor: QuoteAnchor;
  sourceExcerpt: string;
  note: RelatedPassageNote | null;
  matchedTerms: string[];
  score: number;
  reason: string;
};

type Candidate = {
  thread: Thread;
  kind: 'note' | 'thread';
  note: RelatedPassageNote | null;
  sourceExcerpt: string;
  matchedTerms: Set<string>;
  anchorMatchedTerms: Set<string>;
};

/**
 * Search only the reader's active local index. Search results are folded to one
 * card per saved thread, with a note match taking precedence over a bare source
 * match from the same thread.
 */
export function findRelatedPassages(store: ReaderStore, value: unknown): RelatedPassageResult[] {
  const request = validateRelatedPassageRequest(value);
  const terms = searchTerms(request.passage.exact).filter(term => term.length >= 3 && !RELATED_STOP_WORDS.has(term)).slice(0, 8);
  if (!terms.length) return [];

  const library = new LibrarySettingsService(store);
  const candidates = new Map<string, Candidate>();
  for (const term of terms) {
    for (const match of library.search(term, RELATED_SEARCH_RESULTS)) {
      if (match.kind !== 'source' && match.kind !== 'note') continue;
      const thread = store.get(match.threadId);
      if (!thread || thread.deletedAt || thread.id === request.threadId) continue;
      if (request.sourceVersionId && thread.sourceVersionId === request.sourceVersionId && sameAnchor(thread.anchor, request.passage)) continue;
      const source = store.sourceVersion(thread.sourceVersionId);
      if (!source) continue;

      if (match.kind === 'source') {
        const anchorText = thread.anchor.kind === 'whole-page' ? source.text : thread.anchor.exact;
        const matchedTerms = terms.filter(candidateTerm => containsWord(anchorText, candidateTerm));
        if (!matchedTerms.length) continue;
        upsert(candidates, thread, 'thread', null, matchedTerms, matchedTerms,
          thread.anchor.kind === 'whole-page' ? clip(match.passage) : excerptAround(thread.anchor.exact, matchedTerms));
        continue;
      }

      const note = bestNote(thread.notes, terms);
      if (!note) continue;
      const matchedTerms = terms.filter(candidateTerm => containsWord(note.text, candidateTerm));
      if (!matchedTerms.length) continue;
      const anchorText = thread.anchor.kind === 'whole-page' ? source.text : thread.anchor.exact;
      const anchorMatchedTerms = terms.filter(candidateTerm => containsWord(anchorText, candidateTerm));
      upsert(candidates, thread, 'note', {
        id: note.id, revision: note.revision, excerpt: excerptAround(note.text, matchedTerms),
      }, matchedTerms, anchorMatchedTerms, thread.anchor.kind === 'whole-page' ? clip(match.passage) : excerptAround(thread.anchor.exact, matchedTerms));
    }
  }

  return [...candidates.values()]
    .sort((left, right) => compareCandidates(left, right, terms.length))
    .slice(0, request.limit)
    .map(candidate => toResult(candidate, terms.length));
}

export function validateRelatedPassageRequest(value: unknown): RelatedPassageRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid related passage request.');
  const input = value as Record<string, unknown>;
  const allowed = new Set(['passage', 'threadId', 'sourceVersionId', 'limit']);
  if (Object.keys(input).some(key => !allowed.has(key)) || !Object.hasOwn(input, 'passage')) throw new Error('Invalid related passage request.');
  validateRelatedAnchor(input.passage);
  for (const key of ['threadId', 'sourceVersionId'] as const) {
    const id = input[key];
    if (id !== undefined && (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id))) throw new Error('Invalid related passage identifier.');
  }
  const limit = input.limit === undefined ? 5 : input.limit;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > RELATED_MAX_RESULTS) throw new Error('Related passage limit must be between 1 and 8.');
  return {
    passage: input.passage as QuoteAnchor,
    ...(input.threadId === undefined ? {} : { threadId: input.threadId as string }),
    ...(input.sourceVersionId === undefined ? {} : { sourceVersionId: input.sourceVersionId as string }),
    limit,
  };
}

function validateRelatedAnchor(value: unknown): asserts value is QuoteAnchor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid related passage anchor.');
  const anchor = value as QuoteAnchor;
  if ((anchor.kind !== undefined && !['quote', 'section', 'whole-page'].includes(anchor.kind)) ||
    typeof anchor.exact !== 'string' || anchor.exact.length > 16000 || typeof anchor.prefix !== 'string' || anchor.prefix.length > 256 ||
    typeof anchor.suffix !== 'string' || anchor.suffix.length > 256 || !Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) ||
    anchor.start < 0 || anchor.end < anchor.start || anchor.end > 1000000) throw new Error('Invalid related passage anchor.');
  if (anchor.kind === 'whole-page') {
    if (anchor.exact !== '' || anchor.prefix !== '' || anchor.suffix !== '' || anchor.start !== 0 || anchor.end !== 0) throw new Error('Invalid related passage anchor.');
  } else if (!anchor.exact.length || anchor.end - anchor.start !== anchor.exact.length) throw new Error('Invalid related passage anchor.');
}

function upsert(
  candidates: Map<string, Candidate>, thread: Thread, kind: 'note' | 'thread', note: RelatedPassageNote | null,
  matchedTerms: string[], anchorMatchedTerms: string[], sourceExcerpt: string,
) {
  const existing = candidates.get(thread.id);
  if (!existing) {
    candidates.set(thread.id, { thread, kind, note, sourceExcerpt, matchedTerms: new Set(matchedTerms), anchorMatchedTerms: new Set(anchorMatchedTerms) });
    return;
  }
  for (const term of matchedTerms) existing.matchedTerms.add(term);
  for (const term of anchorMatchedTerms) existing.anchorMatchedTerms.add(term);
  if (kind === 'note' && (existing.kind === 'thread' || note && existing.note && note.revision > existing.note.revision)) {
    existing.kind = 'note'; existing.note = note;
  } else if (kind === 'note' && existing.note === null) {
    existing.kind = 'note'; existing.note = note;
  }
  if (kind === 'note' && note && existing.note?.id === note.id) existing.note = note;
  if (!existing.sourceExcerpt) existing.sourceExcerpt = sourceExcerpt;
}

function toResult(candidate: Candidate, termCount: number): RelatedPassageResult {
  const matchedTerms = [...candidate.matchedTerms];
  const score = Number((matchedTerms.length / termCount).toFixed(3));
  const quoted = matchedTerms.slice(0, 4).map(term => `“${term}”`).join(', ');
  return {
    kind: candidate.kind, threadId: candidate.thread.id, anchorId: candidate.thread.anchorId,
    sourceVersionId: candidate.thread.sourceVersionId, sourceTitle: candidate.thread.sourceTitle, sourceUrl: candidate.thread.sourceUrl,
    anchor: candidate.thread.anchor, sourceExcerpt: candidate.sourceExcerpt, note: candidate.note,
    matchedTerms, score,
    reason: `${candidate.kind === 'note' ? 'Your note' : 'Your saved passage'} shares ${quoted || 'words'} with this selection.`,
  };
}

function compareCandidates(left: Candidate, right: Candidate, termCount: number): number {
  const score = right.matchedTerms.size / termCount - left.matchedTerms.size / termCount;
  if (score) return score;
  if (left.kind !== right.kind) return left.kind === 'note' ? -1 : 1;
  const anchorScore = right.anchorMatchedTerms.size - left.anchorMatchedTerms.size;
  if (anchorScore) return anchorScore;
  const recent = right.thread.updatedAt.localeCompare(left.thread.updatedAt);
  return recent || left.thread.id.localeCompare(right.thread.id);
}

function bestNote(notes: Note[], terms: string[]): Note | undefined {
  return notes.filter(note => !note.deletedAt)
    .map(note => ({ note, count: terms.filter(term => containsWord(note.text, term)).length }))
    .filter(value => value.count > 0)
    .sort((left, right) => right.count - left.count || right.note.revision - left.note.revision || left.note.id.localeCompare(right.note.id))[0]?.note;
}

function searchTerms(value: string): string[] {
  return [...new Set(value.slice(0, 300).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [])];
}

function containsWord(text: string, term: string): boolean {
  const wanted = normalize(term);
  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)) if (normalize(match[0]) === wanted) return true;
  return false;
}

function excerptAround(text: string, terms: string[]): string {
  const wanted = terms.map(normalize);
  const match = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)].find(value => wanted.includes(normalize(value[0])));
  const at = match?.index ?? 0;
  const start = Math.max(0, at - 90), end = Math.min(text.length, start + 240);
  return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function clip(text: string): string {
  return text.length <= 280 ? text : text.slice(0, 277) + '…';
}

function normalize(value: string): string { return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); }
function sameAnchor(left: QuoteAnchor, right: QuoteAnchor): boolean {
  return (left.kind ?? 'quote') === (right.kind ?? 'quote') && left.exact === right.exact && left.start === right.start && left.end === right.end;
}
