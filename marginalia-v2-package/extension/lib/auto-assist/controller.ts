import type { DifficultyCandidate, DifficultyInput, DifficultyScorer } from '../../../contracts/auto-assist.ts';
import { selectAutoAssistCandidates, type SelectionPolicy } from './policy.ts';
import { normalizeTerm } from './scorer.ts';
export type FamiliarObservation = { operationId: string; term: string; origin: 'stated'; observedAt: string; source: { kind: 'reader' } };
/** Local lifecycle only. The owner supplies persistence and paint; there is no provider transport. */
export function createAutoAssistController(options: { scorer: DifficultyScorer; onMarks: (marks: readonly DifficultyCandidate[]) => void; onDismiss: (observation: FamiliarObservation) => Promise<void> }) {
  let generation = 0, active: AbortController | undefined;
  let marks: readonly DifficultyCandidate[] = [];
  const dismissed = new Set<string>();
  const pendingDismissals = new Map<string, Promise<void>>();
  function clear() { generation++; active?.abort(); marks = []; options.onMarks([]); }
  return {
    clear,
    async update(input: DifficultyInput, policy: SelectionPolicy) {
      clear(); const mine = generation;
      if (!policy.enabled || policy.excluded) return;
      const abort = new AbortController(); active = abort;
      try {
        const candidates = await options.scorer.scorePage(input, abort.signal);
        if (mine !== generation || abort.signal.aborted) return;
        marks = selectAutoAssistCandidates(input, candidates, { ...policy, dismissed: [...(policy.dismissed ?? []), ...dismissed] });
        options.onMarks(marks);
      } catch (error) { if (!abort.signal.aborted) throw error; }
    },
    async dismiss(term: string) {
      const normalized = normalizeTerm(term);
      const pending = pendingDismissals.get(normalized); if (pending) return pending;
      if (dismissed.has(normalized)) return;
      const mine = generation, removed = marks.filter(c => c.normalizedTerm === normalized);
      dismissed.add(normalized);
      marks = marks.filter(c => c.normalizedTerm !== normalized); options.onMarks(marks);
      const operation = Promise.resolve().then(async () => {
        try {
          await options.onDismiss({ operationId: crypto.randomUUID(), term, origin: 'stated', observedAt: new Date().toISOString(), source: { kind: 'reader' } });
        } catch (error) {
          dismissed.delete(normalized);
          // Do not repaint an old page or undo another term's concurrent dismissal.
          if (mine === generation) {
            marks = [...marks, ...removed].filter(c => !dismissed.has(c.normalizedTerm)).sort((a, b) => a.start - b.start);
            options.onMarks(marks);
          }
          throw error;
        } finally { pendingDismissals.delete(normalized); }
      });
      pendingDismissals.set(normalized, operation);
      return operation;
    },
    /** Vocabulary deletion must release the local dismissal as well as refresh policy. */
    forgetDismissal(term: string) { dismissed.delete(normalizeTerm(term)); },
  };
}

