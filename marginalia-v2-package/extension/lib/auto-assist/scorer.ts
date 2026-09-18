import type { DifficultyCandidate, DifficultyInput, DifficultyScorer } from '../../../contracts/auto-assist.ts';
import { COMMON_ENGLISH } from './frequency-en.ts';
export const MAX_PAGE_CHARS = 200_000;
export const MAX_CANDIDATES = 2_000;
export function normalizeTerm(term: string): string { return term.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase(); }
/** Bounded, English-only proxy. Offsets are UTF-16 and always refer to the original text. */
export class FrequencyPageScorer implements DifficultyScorer {
  readonly method = 'frequency-page-v0' as const;
  readonly version = 'curated-common-en-0.1';
  async scorePage(input: DifficultyInput, signal: AbortSignal): Promise<readonly DifficultyCandidate[]> {
    signal.throwIfAborted();
    if (!/^en(?:-|$)/iu.test(input.language) || input.text.length > MAX_PAGE_CHARS || input.sections.length > 1000) return [];
    const tokens: { term: string; normalized: string; start: number; end: number }[] = [];
    const counts = new Map<string, number>();
    const excluded = [...input.text.matchAll(/https?:\/\/\S+|www\.\S+|\S+@\S+|`[^`]*`|\[[^\]\n]*\]/gu)].map(m => [m.index, m.index + m[0].length]);
    let excludedIndex = 0;
    for (const match of input.text.matchAll(/[\p{L}][\p{L}\p{M}]*(?:[-'][\p{L}\p{M}]+)*/gu)) {
      const term = match[0], start = match.index, end = start + term.length;
      while (excludedIndex < excluded.length && excluded[excludedIndex][1] <= start) excludedIndex++;
      if (term.length < 3 || term.length > 64 || (excludedIndex < excluded.length && excluded[excludedIndex][0] < end)) continue;
      const normalized = normalizeTerm(term);
      tokens.push({ term, normalized, start, end }); counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    const candidates: DifficultyCandidate[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (i % 512 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
      const t = tokens[i];
      if (COMMON_ENGLISH.has(t.normalized)) continue;
      // A small seed cannot treat every unlisted short word as rare.
      if (t.term.length < 7 && !/^[A-Z]{3,6}$/u.test(t.term)) continue;
      const reasons = ['out-of-seed'];
      let score = 0.4;
      if (t.term.length >= 9) { score += 0.2; reasons.push('long-form'); }
      if (/-|(?:tion|ism|ity|ology|ization|escence)$/iu.test(t.term)) { score += 0.15; reasons.push('technical-shape'); }
      if ((counts.get(t.normalized) ?? 0) > 1) { score += 0.25; reasons.push('page-repeated'); }
      if (input.sections.some(s => t.start >= s.start && t.end <= s.end && normalizeTerm(s.title).includes(t.normalized))) { score += 0.15; reasons.push('heading'); }
      if (/^\s*(?:is|means|refers to)\s/iu.test(input.text.slice(t.end, t.end + 40))) { score -= 0.35; reasons.push('locally-defined'); }
      if (/^[A-Z][a-z]/u.test(t.term) && t.start > 0 && !/[.!?]\s*$/u.test(input.text.slice(Math.max(0, t.start - 5), t.start))) { score -= 0.3; reasons.push('likely-name'); }
      if (score < 0.6) continue;
      candidates.push({ candidateId: `${input.pageKeyHash}:${t.start}:${t.end}`, term: t.term, normalizedTerm: t.normalized, start: t.start, end: t.end, score: Math.min(1, score), reasons });
      if (candidates.length === MAX_CANDIDATES) break;
    }
    return candidates;
  }
}

