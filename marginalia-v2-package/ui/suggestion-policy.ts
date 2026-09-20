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

/** The reader policy is opt-in until the caller and exposure store migrate together. The v1
 * functions above preserve historical scoring; their arrays are not explicit reader evidence. */
export const READER_SUGGESTION_POLICY_VERSION = weights.readerPolicy.version;
export const READER_SUGGESTION_SCORE_VERSION = weights.readerPolicy.scoreVersion;
export type ReaderSuggestionFeedback =
  | { kind: 'reply-marked-useful' | 'offer-dismissed'; intent: Intent }
  | { kind: 'question-closed' | 'reply-retained' | 'reply-reopened' | 'reply-followed-up'; intent?: Intent };
export type ReaderSuggestionInput = {
  text: string;
  target: 'word' | 'passage' | 'page';
  page: SuggestionPage;
  posture: ReadingPosture;
  preferredIntent?: Intent;
  note?: string;
  /** D102: reader-set tuner scores only. Missing/invalid entries are neutral. */
  readerBaseScores?: Readonly<Partial<Record<Intent, number>>>;
  /** Host supplies a bounded, current, source-scoped set of explicit events.
   * Neither legacy dismissals nor retained replies may be relabelled as events. */
  feedback?: readonly ReaderSuggestionFeedback[];
  /** Reader-entered state in the current sense/domain, never inferred from use. */
  vocabulary?: readonly { term: string; state: 'familiar' | 'difficult' }[];
};
export type ReaderSuggestionScore = {
  intent: Intent;
  score: number;
  terms: SuggestionScore['terms'] & { explicitVocabulary: number; readerBaseScore: number };
};

/** Literal bounded token matching; this establishes neither meaning nor mastery. */
function vocabularyTerms(input: ReaderSuggestionInput) {
  const tokens = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const selected = tokens(input.text.slice(0, weights.readerPolicy.maxTextChars));
  let familiar = false, difficult = false;
  for (const entry of (input.vocabulary ?? []).slice(0, weights.readerPolicy.maxVocabulary)) {
    if (!entry.term || entry.term.length > weights.readerPolicy.maxTermChars) continue;
    const term = tokens(entry.term);
    if (!term.length) continue;
    const matches = selected.some((_, index) => term.every((word, offset) => selected[index + offset] === word));
    if (matches && entry.state === 'familiar') familiar = true;
    if (matches && entry.state === 'difficult') difficult = true;
  }
  // A stated difficulty wins over familiarity; repetition never stacks a boost.
  return { familiar: familiar && !difficult, difficult };
}

/** Local reader ranker. Eligibility remains host-owned. Word is a host target class,
 * not the classifier's short-text heuristic, and always offers Define only. */
export function rankReaderSuggestions(input: ReaderSuggestionInput, eligible: readonly Intent[]): ReaderSuggestionScore[] {
  const feedback = (input.feedback ?? []).slice(0, weights.readerPolicy.maxFeedback);
  const vocabulary = vocabularyTerms(input);
  const ranked = rankEligibleSuggestions({
    block: suggestionBlock(input.text.slice(0, weights.readerPolicy.maxTextChars), input.target === 'page'),
    page: input.page, posture: input.posture, preferredIntent: input.preferredIntent,
    note: (input.note ?? '').slice(0, weights.readerPolicy.maxTextChars),
    usefulNearby: feedback.filter(event => event.kind === 'reply-marked-useful').map(event => event.intent!),
    dismissed: feedback.filter(event => event.kind === 'offer-dismissed').map(event => event.intent!),
  }, input.target === 'word' ? eligible.filter(intent => intent === 'define') : eligible);
  return ranked.map(value => {
    const explicitVocabulary = value.intent === 'define'
      ? vocabulary.difficult ? weights.readerPolicy.difficultDefineBoost : vocabulary.familiar ? -weights.readerPolicy.familiarDefinePenalty : 0
      : value.intent === 'instantiate' && vocabulary.difficult ? weights.readerPolicy.difficultExampleBoost : 0;
    const rawBaseScore = input.readerBaseScores && Object.hasOwn(input.readerBaseScores, value.intent) ? input.readerBaseScores[value.intent] : undefined;
    const readerBaseScore = typeof rawBaseScore === 'number' && Number.isFinite(rawBaseScore) &&
      rawBaseScore >= weights.readerPolicy.readerBaseScoreMin && rawBaseScore <= weights.readerPolicy.readerBaseScoreMax ? rawBaseScore : 0;
    return { intent: value.intent, score: value.score + explicitVocabulary + readerBaseScore, terms: { ...value.terms, explicitVocabulary, readerBaseScore } };
  }).sort((a, b) => b.score - a.score || SUGGESTION_ORDER.indexOf(a.intent) - SUGGESTION_ORDER.indexOf(b.intent));
}

/** All ranking-affecting changes (target, eligibility, posture, tuner scores, note, vocabulary,
 * feedback) must advance generation, even when the saved note revision is equal. */
export type ReaderSuggestionRevision = {
  sourceVersion: string;
  targetKey: string;
  noteRevision: number;
  generation: number;
};
export type ReaderSuggestionSnapshot = Readonly<{
  policyVersion: string;
  scoreVersion: string;
  revision: Readonly<ReaderSuggestionRevision>;
  eligible: readonly Intent[];
  shown: readonly Readonly<{ intent: Intent; position: number; score: number; terms: Readonly<ReaderSuggestionScore['terms']> }>[];
}>;

/** Capture once when exposing offers; keep this object while pointer/focus holds
 * the display. This is an in-memory API, not the persisted v1 exposure schema. */
export function snapshotReaderSuggestions(input: ReaderSuggestionInput, eligible: readonly Intent[], revision: ReaderSuggestionRevision): ReaderSuggestionSnapshot {
  if (!revision.sourceVersion || revision.sourceVersion.length > 256 || !revision.targetKey || revision.targetKey.length > 256 ||
      !Number.isSafeInteger(revision.noteRevision) || revision.noteRevision < 0 || !Number.isSafeInteger(revision.generation) || revision.generation < 0) {
    throw new Error('Invalid suggestion revision.');
  }
  const ranked = rankReaderSuggestions(input, eligible);
  return Object.freeze({
    policyVersion: READER_SUGGESTION_POLICY_VERSION, scoreVersion: READER_SUGGESTION_SCORE_VERSION,
    revision: Object.freeze({ sourceVersion: revision.sourceVersion, targetKey: revision.targetKey, noteRevision: revision.noteRevision, generation: revision.generation }),
    eligible: Object.freeze(ranked.map(value => value.intent)),
    shown: Object.freeze(ranked.slice(0, weights.readerPolicy.maxOffers).map((value, index) => Object.freeze({
      intent: value.intent, position: index + 1, score: value.score, terms: Object.freeze({ ...value.terms }),
    }))),
  });
}

/** A host must check immediately before mounting or choosing a computed offer. */
export function readerSuggestionsAreCurrent(snapshot: ReaderSuggestionSnapshot, current: ReaderSuggestionRevision) {
  return snapshot.policyVersion === READER_SUGGESTION_POLICY_VERSION && snapshot.scoreVersion === READER_SUGGESTION_SCORE_VERSION &&
    snapshot.revision.sourceVersion === current.sourceVersion && snapshot.revision.targetKey === current.targetKey &&
    snapshot.revision.noteRevision === current.noteRevision && snapshot.revision.generation === current.generation;
}
