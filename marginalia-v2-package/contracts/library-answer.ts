import type { QuoteAnchor } from './reader.ts';

export const LIBRARY_ANSWER_SCHEMA = 'marginalia.collection-answer.v1' as const;
export type LibraryAnswerReason = 'no-exact-saved-support' | 'ambiguous-support' | 'invalid-query';
export type LibraryAnswerCitation = {
  threadId: string;
  sourceVersionId: string;
  sourceHash: string;
  sourceUrl: string;
  sourceTitle: string;
  anchor: QuoteAnchor;
  excerpt: string;
  matchTerms: string[];
  kind: 'source' | 'note';
  noteId?: string;
  noteRevision?: number;
  excerptStart: number;
  excerptEnd: number;
  reason: string;
};
export type LibraryAnswer = {
  schema: typeof LIBRARY_ANSWER_SCHEMA;
  query: string;
  mode: 'extractive-local';
  status: 'answered' | 'abstained';
  answer: string | null;
  citations: LibraryAnswerCitation[];
  reason?: LibraryAnswerReason;
};
export type LibraryAnswerResponse = { answer: LibraryAnswer };

export function libraryAnswerFrom(value: unknown): LibraryAnswer {
  if (!record(value) || !record(value.answer)) invalid();
  const answer = value.answer;
  if (answer.schema !== LIBRARY_ANSWER_SCHEMA || answer.mode !== 'extractive-local' || !text(answer.query, 500)
    || !['answered', 'abstained'].includes(String(answer.status)) || !Array.isArray(answer.citations)
    || answer.citations.length > 5 || !answer.citations.every(citation)) invalid();
  if (answer.status === 'answered') {
    if (!text(answer.answer, 1_000) || answer.citations.length === 0 || answer.reason !== undefined) invalid();
  } else if (answer.answer !== null || !['no-exact-saved-support', 'ambiguous-support', 'invalid-query'].includes(String(answer.reason))) invalid();
  return answer as LibraryAnswer;
}

function citation(value: unknown): value is LibraryAnswerCitation {
  if (!record(value) || !id(value.threadId) || !id(value.sourceVersionId) || !text(value.sourceHash, 500)
    || !safeUrl(value.sourceUrl) || !text(value.sourceTitle, 1_000) || !anchor(value.anchor)
    || !text(value.excerpt, 600) || !stringList(value.matchTerms, 32, 500)
    || !['source', 'note'].includes(String(value.kind)) || !count(value.excerptStart) || !count(value.excerptEnd)
    || Number(value.excerptEnd) < Number(value.excerptStart) || Number(value.excerptEnd) - Number(value.excerptStart) !== value.excerpt.length
    || !text(value.reason, 1_000)) return false;
  return value.kind === 'note' ? id(value.noteId) && positive(value.noteRevision)
    : value.noteId === undefined && value.noteRevision === undefined;
}
function anchor(value: unknown): value is QuoteAnchor {
  if (!record(value) || (value.kind !== undefined && !['quote', 'section', 'whole-page'].includes(String(value.kind)))
    || !text(value.exact, 16_000) || !text(value.prefix, 256) || !text(value.suffix, 256)
    || !count(value.start) || !count(value.end) || Number(value.end) < Number(value.start)) return false;
  return value.kind === 'whole-page'
    ? value.exact === '' && value.prefix === '' && value.suffix === '' && value.start === 0 && value.end === 0
    : value.exact.length > 0 && Number(value.end) - Number(value.start) === value.exact.length;
}
function invalid(): never { throw new Error('The helper returned an invalid saved-passage answer.'); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, limit: number): value is string { return typeof value === 'string' && value.length <= limit; }
function id(value: unknown): value is string { return typeof value === 'string' && /^[\w-]{1,100}$/.test(value); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function stringList(value: unknown, items: number, characters: number): value is string[] {
  return Array.isArray(value) && value.length <= items && value.every(item => text(item, characters));
}
function safeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_000) return false;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password; }
  catch { return false; }
}
