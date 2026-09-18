import { AUTO_ASSIST_POSTURE_LIMITS, type AutoAssistPosture, type DifficultyCandidate, type DifficultyInput } from '../../../contracts/auto-assist.ts';
import { normalizeTerm } from './scorer.ts';
export type CandidatePlacement = { band: number; top: number; block: string };
export type SelectionPolicy = {
  enabled: boolean; excluded: boolean; posture: AutoAssistPosture;
  vocabulary: readonly string[]; dismissed?: readonly string[];
  placement: (candidate: DifficultyCandidate) => CandidatePlacement | null;
};
export function selectAutoAssistCandidates(input: DifficultyInput, candidates: readonly DifficultyCandidate[], policy: SelectionPolicy): DifficultyCandidate[] {
  if (!policy.enabled || policy.excluded) return [];
  const limits = AUTO_ASSIST_POSTURE_LIMITS[policy.posture];
  const familiar = new Set([...policy.vocabulary, ...(policy.dismissed ?? [])].map(normalizeTerm));
  const selected: { candidate: DifficultyCandidate; position: CandidatePlacement }[] = [];
  const bands = new Map<number, number>(); const terms = new Set<string>();
  const valid = candidates.slice(0, 2000).filter(c => Number.isFinite(c.score) && Number.isInteger(c.start) && Number.isInteger(c.end) && c.start >= 0 && c.end > c.start && c.end <= input.text.length && input.text.slice(c.start, c.end) === c.term && c.normalizedTerm === normalizeTerm(c.term) && !familiar.has(c.normalizedTerm));
  for (const candidate of valid.sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (terms.has(candidate.normalizedTerm)) continue;
    const position = policy.placement(candidate);
    if (!position || !Number.isInteger(position.band) || position.band < 0 || !Number.isFinite(position.top) || (bands.get(position.band) ?? 0) >= limits.underlinesPerBand) continue;
    if (selected.some(s => candidate.start < s.candidate.end && candidate.end > s.candidate.start || s.position.block === position.block && Math.abs(s.position.top - position.top) < 80)) continue;
    selected.push({ candidate, position }); terms.add(candidate.normalizedTerm); bands.set(position.band, (bands.get(position.band) ?? 0) + 1);
    if (selected.length === limits.pageCap) break;
  }
  return selected.map(s => s.candidate).sort((a, b) => a.start - b.start);
}
