import weights from '../contracts/suggestions.v1.json' with { type: 'json' };
import type { Intent } from '../contracts/reply.ts';

export type SuggestionBlock = keyof typeof weights.blockFit;
export type SuggestionPage = keyof typeof weights.pageFit;
export type ReadingPosture = keyof typeof weights.posture;
export type SuggestionScoreInput = {
  block: SuggestionBlock;
  page: SuggestionPage;
  posture: ReadingPosture;
  /** Explicit reader choice, never inferred from dwell time or familiarity. */
  preferredIntent?: Intent;
  note?: string;
  /** Caller supplies locally retained usefulness evidence; absence carries no penalty. */
  usefulNearby: readonly Intent[];
  /** Only a recent deliberate dismissal, never merely choosing another offer. */
  dismissed: readonly Intent[];
};
export type SuggestionScore = { intent: Intent; score: number; terms: {
  blockFit: number; pageFit: number; statedPreference: number; usefulNearby: number; dismissalPenalty: number;
} };
export const SUGGESTION_SCORE_VERSION = weights.version;
export const SUGGESTION_ORDER: readonly Intent[] = Object.freeze(weights.order as Intent[]);

/** Fixed, inspectable heuristics. These classify text shape, not reader knowledge. */
export function suggestionBlock(text: string, wholePage = false): SuggestionBlock {
  if (wholePage) return 'page';
  const value = text.trim().slice(0, 4000);
  if (quantitativePassage(value)) return 'equation';
  if (/^\s*\d+[.)]\s/m.test(value) || /\b(?:step|procedure|algorithm|first.*then|instructions)\b/i.test(value)) return 'procedure';
  if (/\b(?:causes?|because|mechanism|flow|stretch|spiral|drives?|leads? to)\b/i.test(value)) return 'mechanism';
  if (/\b\d+(?:[.,]\d+)?\b|\[\d+\]|\([^)]*\b(?:19|20)\d{2}[^)]*\)/.test(value) || /\b(?:claim|assert|evidence|supports?|proves?|shows?|demonstrates?)\b/i.test(value)) return 'claim';
  if (value && value.length <= 80 && value.split(/\s+/).length <= 4) return 'term';
  return value ? 'prose' : 'unknown';
}

/** Quantitative means an explicit relation/unit, or a named quantity paired with a change or dependency. */
function quantitativePassage(value: string) {
  const explicitRelation = /[=∫∑∂∝≈≤≥]|\b(?:equation|derivative|integral)\b/i.test(value);
  const symbolWithUnits = /\b(?:[a-z]|[α-ω])(?:\w+)?\s*(?:\([^)]*\b(?:1\/s|m\/s|kg|pa|k|hz|%)\b[^)]*\)|\[[^\]]*\b(?:1\/s|m\/s|kg|pa|k|hz|%)\b[^\]]*\])/iu.test(value);
  const namedQuantity = /\b(?:parameter|coefficient|rate|viscosity|velocity|temperature|pressure|density|damping|forcing)\b/i.test(value);
  const changingRelation = /\b(?:grows?|decays?|depends?\s+on|increases?|decreases?|varies?\s+with|tends?\s+to\s+(?:grow|decay|increase|decrease|smooth)|as\s+\w+\s+increases?)\b/i.test(value);
  return explicitRelation || symbolWithUnits || (namedQuantity && changingRelation);
}
export function suggestionPage(pageType: string | null | undefined): SuggestionPage {
  const value = pageType?.trim().toLowerCase();
  if (value === 'paper' || value === 'docs' || value === 'article' || value === 'social' || value === 'reference') return value;
  return 'unknown';
}

/** All five terms remain separate so an exposure can explain its deterministic order. */
export function scoreSuggestions(input: SuggestionScoreInput): SuggestionScore[] {
  return SUGGESTION_ORDER.map(intent => {
    const terms = {
      blockFit: weights.blockFit[input.block][intent], pageFit: weights.pageFit[input.page][intent],
      statedPreference: weights.posture[input.posture][intent] + (questioningNote(input.note) ? weights.questioningNote[intent] : 0) + (input.preferredIntent === intent ? weights.preferredIntentBoost : 0),
      usefulNearby: input.usefulNearby.includes(intent) ? weights.usefulNearbyBoost : 0,
      dismissalPenalty: input.dismissed.includes(intent) ? weights.dismissalPenalty : 0,
    };
    return { intent, terms, score: terms.blockFit + terms.pageFit + terms.statedPreference + terms.usefulNearby - terms.dismissalPenalty };
  }).sort((a, b) => b.score - a.score || SUGGESTION_ORDER.indexOf(a.intent) - SUGGESTION_ORDER.indexOf(b.intent));
}

/** Eligibility is supplied by the host boundary, never derived from relevance scores. */
export function rankEligibleSuggestions(input: SuggestionScoreInput, eligible: readonly Intent[]): SuggestionScore[] {
  const allowed = new Set(eligible);
  return scoreSuggestions(input).filter(value => allowed.has(value.intent));
}

/** A literal question or an explicit comparison; never infer the reader's knowledge. */
export function questioningNote(note = '') {
  return /\?|\b(?:compare\s+.+\s+(?:with|to)|.+\s+versus\s+.+|.+\s+vs\.?\s+.+)\b/i.test(note);
}
export const SUGGESTION_LABELS: Record<Intent, string> = {
  unsure: 'Say it plainly', define: 'Define it here', derive: 'Show the steps', instantiate: 'Give an example',
  diagram: 'See it', simulate: 'Simulate it', evidence: 'Check this claim', explore: 'Connect it',
};
export function suggestionOffer(intent: Intent) {
  return { id: intent, intent, label: SUGGESTION_LABELS[intent], question: intent === 'simulate' ? 'Simulate this passage.' : SUGGESTION_LABELS[intent] + ' in this passage.',
    time: intent === 'define' ? 'quick' as const : 'longer' as const };
}
