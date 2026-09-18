import type { QuoteAnchor } from '../contracts/reader.ts';
import type { ReaderStore } from './store.ts';

export type CollectionCitation = {
  threadId: string; sourceVersionId: string; sourceHash: string; sourceUrl: string; sourceTitle: string;
  anchor: QuoteAnchor; excerpt: string; matchTerms: string[];
  kind: 'source' | 'note'; noteId?: string; noteRevision?: number;
  /** UTF-16 offsets into the source version or the identified note revision. */
  excerptStart: number; excerptEnd: number;
  reason: string;
};
export type CollectionAnswer = {
  schema: 'marginalia.collection-answer.v1'; query: string; mode: 'extractive-local';
  status: 'answered' | 'abstained'; answer: string | null; citations: CollectionCitation[];
  reason?: 'no-exact-saved-support' | 'ambiguous-support' | 'invalid-query';
};
export type CollectionAnswerInput = { query: string; threadIds?: string[]; limit?: number };
const words = (text: string) => [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length }));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function validCollectionInput(input: CollectionAnswerInput): boolean {
  return !!input && typeof input.query === 'string' && input.query.length <= 500 &&
    (input.limit === undefined || Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 5) &&
    (input.threadIds === undefined || Array.isArray(input.threadIds) && input.threadIds.length <= 100 &&
      input.threadIds.every(id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)));
}

/** Local extraction only. Results are separate matches, never an assertion of agreement. */
export function answerCollection(reader: ReaderStore, input: CollectionAnswerInput): CollectionAnswer {
  const result: CollectionAnswer = { schema: 'marginalia.collection-answer.v1', query: typeof input?.query === 'string' ? input.query.slice(0, 500) : '',
    mode: 'extractive-local', status: 'abstained', answer: null, citations: [] };
  if (!validCollectionInput(input)) return { ...result, reason: 'invalid-query' };
  const queryWords = words(input.query).map(item => item.word), terms = [...new Set(queryWords)];
  if (!terms.length || queryWords.length > 32) return { ...result, reason: 'invalid-query' };
  const selected = input.threadIds === undefined ? undefined : new Set(input.threadIds);
  const candidates: { citation: CollectionCitation; phrase: boolean }[] = [];
  for (const thread of reader.list(undefined, false)) {
    if (thread.deletedAt || selected && !selected.has(thread.id)) continue;
    const source = reader.sourceVersion(thread.sourceVersionId), anchor = thread.anchor;
    if (!source || anchor.exact.length > 4000 || source.text.slice(anchor.start, anchor.end) !== anchor.exact) continue;
    const base = { threadId: thread.id, sourceVersionId: source.id, sourceHash: source.hash,
      sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle, anchor: { ...anchor } };
    const entries = [ { kind: 'source' as const, text: anchor.exact, offset: anchor.start, noteId: undefined, noteRevision: undefined },
      ...thread.notes.filter(note => !note.deletedAt).map(note => ({ kind: 'note' as const, text: note.text, offset: 0, noteId: note.id, noteRevision: note.revision })) ];
    for (const entry of entries) {
      const tokens = words(entry.text), present = new Set(tokens.map(item => item.word));
      if (!terms.every(term => present.has(term))) continue;
      const phraseIndex = tokens.findIndex((_, index) => queryWords.every((word, offset) => tokens[index + offset]?.word === word));
      const hits = phraseIndex >= 0 ? tokens.slice(phraseIndex, phraseIndex + queryWords.length)
        : terms.map(term => tokens.find(token => token.word === term)!);
      const first = Math.min(...hits.map(hit => hit.start)), last = Math.max(...hits.map(hit => hit.end));
      if (last - first > 600) continue;
      const start = Math.max(0, first - 60), end = Math.min(entry.text.length, start + 600);
      if (end < last) continue;
      // Removal/restoration advances the live note revision without creating a text revision.
      // Cite the latest immutable text revision, never the visibility-only revision.
      let noteRevision = entry.noteRevision;
      if (entry.kind === 'note') {
        const saved = reader.db.prepare('SELECT revision FROM note_versions WHERE noteId=? AND revision<=? ORDER BY revision DESC LIMIT 1')
          .get(entry.noteId!, entry.noteRevision!) as { revision: number } | undefined;
        if (!saved || reader.noteVersion({ noteId: entry.noteId!, revision: saved.revision })?.text !== entry.text) continue;
        noteRevision = saved.revision;
      }
      candidates.push({ phrase: phraseIndex >= 0, citation: { ...base, kind: entry.kind,
        ...(entry.kind === 'note' ? { noteId: entry.noteId, noteRevision } : {}),
        excerpt: entry.text.slice(start, end), excerptStart: entry.offset + start, excerptEnd: entry.offset + end, matchTerms: terms,
        reason: `${phraseIndex >= 0 ? 'Exact word sequence' : 'All question words'} found in this saved ${entry.kind === 'note' ? 'reader note' : 'source passage'}.` } });
    }
  }
  candidates.sort((a, b) => Number(b.phrase) - Number(a.phrase) || compare(a.citation.sourceVersionId, b.citation.sourceVersionId) ||
    compare(a.citation.threadId, b.citation.threadId) || compare(a.citation.kind, b.citation.kind) || compare(a.citation.noteId ?? '', b.citation.noteId ?? ''));
  result.citations = candidates.slice(0, input.limit ?? 5).map(item => item.citation);
  if (!candidates.length) return { ...result, reason: 'no-exact-saved-support' };
  // A deliberately narrow ambiguity check: identical words except for explicit negation.
  // This is not semantic contradiction detection. Different excerpts remain separate evidence.
  // Inspect all matches before applying the display limit, so a limit cannot hide a detected conflict.
  const polarity = new Map<string, boolean>();
  for (const { citation } of candidates) {
    const tokens = words(citation.excerpt).map(item => item.word);
    const negative = tokens.some(word => ['not', 'no', 'never'].includes(word));
    const key = tokens.filter(word => !['not', 'no', 'never'].includes(word)).join(' ');
    if (polarity.has(key) && polarity.get(key) !== negative) return { ...result, reason: 'ambiguous-support' };
    polarity.set(key, negative);
  }
  return { ...result, status: 'answered', answer: 'Extractive saved-passage answer. Saved excerpts matching this question:' };
}
