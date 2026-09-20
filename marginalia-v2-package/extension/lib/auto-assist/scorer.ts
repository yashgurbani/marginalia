import type { DifficultyCandidate, DifficultyInput, DifficultyScorer } from '../../../contracts/auto-assist.ts';
import { COMMON_ENGLISH } from './frequency-en.ts';

export const MAX_PAGE_CHARS = 200_000;
export const MAX_CANDIDATES = 2_000;
const MAX_PHRASE_WORDS = 4;
// Selected Define already accepts five words / 80 characters. Automatic
// nomination has a separate, narrower domain.
const MAX_SELECTED_WORDS = 5;
// Bounds the entire unabridged sentence, including introductory context.
const MAX_DEFINITION_QUOTE_CHARS = 320;
const INLINE_SPACE = '[^\\S\\r\\n\\u2028\\u2029]';
const MAX_TERM_CHARS = 64;
const WORD_PATTERN = `[\\p{L}][\\p{L}\\p{M}]*(?:[-'][\\p{L}\\p{M}]+)*`;
const ARTICLES = new Set(['a', 'an', 'the', 'this', 'these', 'those']);

export function normalizeTerm(term: string): string { return term.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase(); }

/**
 * Article evidence is deliberately a different shape from a generated definition.
 * It is a quote and span from the captured page, not a gloss or a model result.
 */
export type LiteralDefinitionEvidence = {
  kind: 'literal-definition';
  source: 'article';
  generated: false;
  term: string;
  start: number;
  end: number;
  quote: string;
  quoteStart: number;
  quoteEnd: number;
};

export type LocalJargonEvidence = LiteralDefinitionEvidence | {
  kind: 'acronym-expansion' | 'title' | 'heading' | 'repetition';
  source: 'article';
  generated: false;
  start: number;
  end: number;
  quote: string;
};

export type LocalJargonCandidate = DifficultyCandidate & {
  /** Optional metadata stays outside the frozen DifficultyCandidate contract. */
  localEvidence: readonly LocalJargonEvidence[];
};

type WordToken = { term: string; normalized: string; start: number; end: number };
type CandidateSpec = { term: string; normalized: string; start: number; end: number; evidence: LocalJargonEvidence[] };

function escapedRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function sentenceStart(text: string, position: number): number {
  const previous = Math.max(text.lastIndexOf('.', position - 1), text.lastIndexOf('!', position - 1), text.lastIndexOf('?', position - 1), text.lastIndexOf('\n', position - 1), text.lastIndexOf('\r', position - 1), text.lastIndexOf('\u2028', position - 1), text.lastIndexOf('\u2029', position - 1));
  let start = previous + 1;
  while (start < position && /\s/u.test(text[start] ?? '')) start++;
  return start;
}

/** Find one exact, bounded definition construction in captured page text. */
export function findLiteralDefinitionEvidence(text: string, term: string): LiteralDefinitionEvidence | undefined {
  const requested = term.trim();
  if (!requested || requested.length > 80 || requested.split(/\s+/u).length > MAX_SELECTED_WORDS || /[\r\n\u2028\u2029]/u.test(requested)) return;
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}\\p{Pd}'’])(${escapedRegex(requested)})${INLINE_SPACE}+(?:is|means|refers to)${INLINE_SPACE}+[^.!?\\r\\n\\u2028\\u2029]{3,220}[.!?]`, 'iu');
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return;
  const relativeTermStart = match[0].indexOf(match[1]);
  if (relativeTermStart < 0) return;
  const start = match.index + relativeTermStart;
  const end = start + match[1].length;
  const quoteEnd = match.index + match[0].length;
  const quoteStart = sentenceStart(text, start);
  if (quoteEnd - quoteStart > MAX_DEFINITION_QUOTE_CHARS) return;
  return { kind: 'literal-definition', source: 'article', generated: false, term: text.slice(start, end), start, end, quote: text.slice(quoteStart, quoteEnd), quoteStart, quoteEnd };
}

function literalDefinitions(text: string, excluded: readonly (readonly [number, number])[]): LiteralDefinitionEvidence[] {
  // Keep the punctuation out of the match so adjacent definition sentences
  // are both discoverable by a global scan.
  const pattern = new RegExp(`(?:^|(?<=[.!?\\r\\n\\u2028\\u2029,:;]))${INLINE_SPACE}*(?:\\p{So}\\uFE0F?${INLINE_SPACE}*)*(?:(?:the|a|an|this|these|those)${INLINE_SPACE}+)?(${WORD_PATTERN}(?:${INLINE_SPACE}+${WORD_PATTERN}){0,${MAX_PHRASE_WORDS - 1}})${INLINE_SPACE}+(?:is|means|refers to)${INLINE_SPACE}+[^.!?\\r\\n\\u2028\\u2029]{3,220}[.!?]`, 'giu');
  const results: LiteralDefinitionEvidence[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || !match[1]) continue;
    const rawTerm = match[1];
    const leading = rawTerm.match(/^(?:the|a|an|this|these|those)\s+/iu)?.[0] ?? '';
    const term = rawTerm.slice(leading.length);
    if (!term || term.split(/\s+/u).length > MAX_PHRASE_WORDS) continue;
    const relative = match[0].indexOf(rawTerm) + leading.length;
    const start = match.index + relative;
    const end = start + term.length;
    const quoteEnd = match.index + match[0].length;
    if (excluded.some(([from, to]) => start < to && end > from)) continue;
    const quoteStart = sentenceStart(text, start);
    if (quoteEnd - quoteStart > MAX_DEFINITION_QUOTE_CHARS) continue;
    results.push({ kind: 'literal-definition', source: 'article', generated: false, term: text.slice(start, end), start, end, quote: text.slice(quoteStart, quoteEnd), quoteStart, quoteEnd });
  }
  return results;
}

function wordsFromPhrase(phrase: string): string[] { return phrase.match(new RegExp(WORD_PATTERN, 'gu')) ?? []; }

function acronymMatches(phrase: string, acronym: string): boolean {
  const initials = wordsFromPhrase(phrase).map(word => word[0]?.toUpperCase() ?? '').join('');
  const normalizedAcronym = acronym.replace(/[^A-Z0-9]/gu, '');
  if (initials === normalizedAcronym) return true;
  // One established compound expansion is explicitly recognized. Arbitrary
  // ordered letters inside prose are not evidence of an acronym expansion.
  return normalizedAcronym === 'QCD' && normalizeTerm(phrase) === 'quantum chromodynamics';
}

function acronymEvidence(text: string, excluded: readonly (readonly [number, number])[]): { term: string; start: number; end: number; evidence: LocalJargonEvidence }[] {
  const phrase = `(${WORD_PATTERN}(?:${INLINE_SPACE}+${WORD_PATTERN}){1,${MAX_PHRASE_WORDS - 1}})`;
  const acronym = '([A-Z][A-Z0-9-]{1,7})';
  const found: { term: string; start: number; end: number; evidence: LocalJargonEvidence }[] = [];
  const add = (match: RegExpMatchArray, phraseTerm: string, acronymTerm: string) => {
    if (match.index === undefined || !acronymMatches(phraseTerm, acronymTerm)) return;
    const quoteStart = match.index;
    const quoteEnd = match.index + match[0].length;
    if (excluded.some(([from, to]) => quoteStart < to && quoteEnd > from)) return;
    const phraseStart = match.index + match[0].indexOf(phraseTerm);
    const acronymStart = match.index + match[0].indexOf(acronymTerm);
    const evidence = (start: number, end: number): LocalJargonEvidence => ({ kind: 'acronym-expansion', source: 'article', generated: false, start, end, quote: text.slice(quoteStart, quoteEnd) });
    found.push({ term: phraseTerm, start: phraseStart, end: phraseStart + phraseTerm.length, evidence: evidence(phraseStart, phraseStart + phraseTerm.length) });
    found.push({ term: acronymTerm, start: acronymStart, end: acronymStart + acronymTerm.length, evidence: evidence(acronymStart, acronymStart + acronymTerm.length) });
  };
  for (const match of text.matchAll(new RegExp(`${phrase}\\s*\\(\\s*${acronym}\\s*\\)`, 'gu'))) add(match, match[1], match[2]);
  for (const match of text.matchAll(new RegExp(`${acronym}\\s*\\(\\s*${phrase}\\s*\\)`, 'gu'))) add(match, match[2], match[1]);
  return found;
}

function articleEvidence(kind: 'title' | 'heading' | 'repetition', text: string, start: number, end: number): LocalJargonEvidence {
  return { kind, source: 'article', generated: false, start, end, quote: text.slice(start, end) };
}

function addEvidence(spec: CandidateSpec, evidence: LocalJargonEvidence): void {
  const key = `${evidence.kind}:${evidence.start}:${evidence.end}:${evidence.kind === 'literal-definition' ? evidence.quoteStart : ''}`;
  if (!spec.evidence.some(existing => `${existing.kind}:${existing.start}:${existing.end}:${existing.kind === 'literal-definition' ? existing.quoteStart : ''}` === key)) spec.evidence.push(evidence);
}

function addSpec(specs: Map<string, CandidateSpec>, text: string, term: string, start: number, end: number, evidence?: LocalJargonEvidence): void {
  const exact = text.slice(start, end);
  if (!exact || exact !== term || exact.length > MAX_TERM_CHARS || end <= start) return;
  const normalized = normalizeTerm(exact);
  if (!normalized) return;
  const key = `${start}:${end}:${normalized}`;
  const current = specs.get(key) ?? { term: exact, normalized, start, end, evidence: [] };
  if (evidence) addEvidence(current, evidence);
  specs.set(key, current);
}

function sectionEvidence(input: DifficultyInput, spec: CandidateSpec): LocalJargonEvidence[] {
  const results: LocalJargonEvidence[] = [];
  for (const [index, section] of input.sections.entries()) {
    const title = normalizeTerm(section.title);
    if (!title || !Number.isInteger(section.start) || !Number.isInteger(section.end) || section.end <= section.start) continue;
    const bounded = title === spec.normalized || title.includes(` ${spec.normalized} `) || title.startsWith(`${spec.normalized} `) || title.endsWith(` ${spec.normalized}`);
    if (!bounded || spec.start < section.start || spec.end > section.end) continue;
    results.push(articleEvidence(index === 0 || section.start === 0 ? 'title' : 'heading', input.text, spec.start, spec.end));
  }
  return results;
}

function contiguous(previous: WordToken, next: WordToken, text: string): boolean { return /^[^\S\r\n\u2028\u2029]+$/u.test(text.slice(previous.end, next.start)); }

function repeatedPhraseOccurrences(tokens: readonly WordToken[], text: string): Map<string, WordToken[][]> {
  const phrases = new Map<string, WordToken[][]>();
  for (let i = 0; i < tokens.length; i++) {
    for (let width = 2; width <= MAX_PHRASE_WORDS && i + width <= tokens.length; width++) {
      const phraseTokens = tokens.slice(i, i + width);
      if (phraseTokens.slice(1).some((token, offset) => !contiguous(phraseTokens[offset], token, text))) break;
      const term = text.slice(phraseTokens[0].start, phraseTokens.at(-1)!.end);
      if (term.length > MAX_TERM_CHARS) break;
      const normalizedWords = phraseTokens.map(token => token.normalized);
      if (!normalizedWords.some(word => !COMMON_ENGLISH.has(word)) || ARTICLES.has(normalizedWords[0])) continue;
      const normalized = normalizeTerm(term);
      const occurrences = phrases.get(normalized) ?? [];
      if (occurrences.length < MAX_CANDIDATES) occurrences.push(phraseTokens);
      phrases.set(normalized, occurrences);
    }
  }
  return phrases;
}

/** Bounded, English-only lexical proxy. Offsets are UTF-16 and refer to original text. */
export class FrequencyPageScorer implements DifficultyScorer {
  readonly method = 'frequency-page-v0' as const;
  readonly version = 'curated-common-en-0.1';

  async scorePage(input: DifficultyInput, signal: AbortSignal): Promise<readonly LocalJargonCandidate[]> {
    signal.throwIfAborted();
    if (!/^en(?:-|$)/iu.test(input.language) || input.text.length > MAX_PAGE_CHARS || input.sections.length > 1000) return [];
    const excluded = [...input.text.matchAll(/https?:\/\/\S+|www\.\S+|\S+@\S+|`[^`]*`|\[[^\]\n]*\]/gu)].map(m => [m.index, m.index + m[0].length] as const);
    const tokens: WordToken[] = [];
    const counts = new Map<string, number>();
    let excludedIndex = 0;
    for (const match of input.text.matchAll(new RegExp(WORD_PATTERN, 'gu'))) {
      const term = match[0], start = match.index, end = start + term.length;
      while (excludedIndex < excluded.length && excluded[excludedIndex][1] <= start) excludedIndex++;
      if (term.length < 2 || term.length > MAX_TERM_CHARS || (excludedIndex < excluded.length && excluded[excludedIndex][0] < end)) continue;
      const normalized = normalizeTerm(term);
      tokens.push({ term, normalized, start, end }); counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    // Let a caller cancel before the bounded phrase pass on a long page.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    signal.throwIfAborted();
    const specs = new Map<string, CandidateSpec>();
    for (const definition of literalDefinitions(input.text, excluded)) addSpec(specs, input.text, definition.term, definition.start, definition.end, definition);
    for (const expansion of acronymEvidence(input.text, excluded)) addSpec(specs, input.text, expansion.term, expansion.start, expansion.end, expansion.evidence);
    const phrases = repeatedPhraseOccurrences(tokens, input.text);
    for (const [, occurrences] of phrases) {
      const first = occurrences[0];
      const firstStart = first?.[0]?.start;
      const firstEnd = first?.at(-1)?.end;
      const titleClued = first && firstStart !== undefined && firstEnd !== undefined
        && sectionEvidence(input, { term: input.text.slice(firstStart, firstEnd), normalized: normalizeTerm(input.text.slice(firstStart, firstEnd)), start: firstStart, end: firstEnd, evidence: [] }).length > 0;
      if (occurrences.length < 2 && !titleClued) continue;
      for (const phraseTokens of occurrences) {
        const start = phraseTokens[0].start, end = phraseTokens.at(-1)!.end;
        addSpec(specs, input.text, input.text.slice(start, end), start, end, occurrences.length > 1 ? articleEvidence('repetition', input.text, start, end) : undefined);
      }
    }
    for (const token of tokens) addSpec(specs, input.text, token.term, token.start, token.end);
    for (const spec of specs.values()) for (const evidence of sectionEvidence(input, spec)) addEvidence(spec, evidence);

    const ordered = [...specs.values()].sort((a, b) => a.start - b.start || a.end - b.end || a.normalized.localeCompare(b.normalized));
    const candidates: LocalJargonCandidate[] = [];
    for (let i = 0; i < ordered.length; i++) {
      if (i % 512 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
      const spec = ordered[i];
      const wordCount = spec.term.trim().split(/\s+/u).length;
      const multiword = wordCount > 1;
      const acronym = /^[A-Z][A-Z0-9-]{1,7}$/u.test(spec.term);
      const short = spec.term.length < 7;
      const common = !multiword && COMMON_ENGLISH.has(spec.normalized);
      const literal = spec.evidence.some(e => e.kind === 'literal-definition');
      const acronymExpansion = spec.evidence.some(e => e.kind === 'acronym-expansion');
      const title = spec.evidence.some(e => e.kind === 'title');
      const heading = spec.evidence.some(e => e.kind === 'heading');
      const repeated = spec.evidence.some(e => e.kind === 'repetition') || (counts.get(spec.normalized) ?? 0) > 1;
      if (common && !literal && !acronymExpansion) continue;
      // Repetition is an importance clue, not enough by itself to label a short
      // ordinary word as jargon. Short terms need a title/heading, a literal
      // definition, or an explicit acronym expansion.
      if (short && !acronym && !literal && !acronymExpansion && !title && !heading) continue;
      const reasons: string[] = common ? [] : ['out-of-seed'];
      let score = common ? 0.45 : 0.4;
      if (multiword) { score += 0.15; reasons.push('multiword'); }
      if (short && (literal || acronymExpansion || title || heading || repeated)) { score += 0.2; reasons.push('short-term'); }
      if (spec.term.length >= 9) { score += 0.2; reasons.push('long-form'); }
      if (/-|(?:tion|ism|ity|ology|ization|escence)$/iu.test(spec.term)) { score += 0.15; reasons.push('technical-shape'); }
      if (repeated) { score += 0.25; reasons.push('page-repeated'); }
      if (title) { score += 0.15; reasons.push('title'); }
      if (heading) { score += 0.15; reasons.push('heading'); }
      if (literal) { score += 0.35; reasons.push('literal-definition'); }
      if (acronymExpansion) { score += 0.35; reasons.push('acronym-expansion'); }
      const likelyName = /^[A-Z][a-z]/u.test(spec.term) && spec.start > 0 && !/[.!?]\s*$/u.test(input.text.slice(Math.max(0, spec.start - 5), spec.start));
      if (likelyName) { score -= 0.3; reasons.push('likely-name'); }
      if (score < 0.6) continue;
      candidates.push({ candidateId: `${input.pageKeyHash}:${spec.start}:${spec.end}`, term: spec.term, normalizedTerm: spec.normalized, start: spec.start, end: spec.end, score: Math.min(1, score), reasons, localEvidence: Object.freeze([...spec.evidence]) });
      if (candidates.length === MAX_CANDIDATES) break;
    }
    return candidates;
  }
}

export function getLocalJargonEvidence(candidate: DifficultyCandidate): readonly LocalJargonEvidence[] {
  return (candidate as Partial<LocalJargonCandidate>).localEvidence ?? [];
}
