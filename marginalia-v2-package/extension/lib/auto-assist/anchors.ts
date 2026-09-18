import type { DifficultyCandidate } from '../../../contracts/auto-assist.ts';
import type { QuoteAnchor } from '../../../contracts/reader.ts';
/** Resolve this anchor through the existing readable projection, never document.textContent. */
export function autoAssistAnchor(text: string, candidate: DifficultyCandidate): QuoteAnchor | null {
  if (!Number.isInteger(candidate.start) || !Number.isInteger(candidate.end) || candidate.start < 0 || candidate.end <= candidate.start || candidate.end > text.length || candidate.term.length > 128 || text.slice(candidate.start, candidate.end) !== candidate.term) return null;
  return { kind: 'quote', exact: candidate.term, start: candidate.start, end: candidate.end, prefix: text.slice(Math.max(0, candidate.start - 32), candidate.start), suffix: text.slice(candidate.end, candidate.end + 32) };
}
