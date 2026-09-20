import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSuggestions, rankEligibleSuggestions, suggestionBlock, suggestionPage, SUGGESTION_ORDER, type SuggestionScoreInput } from '../ui/suggestion-policy.ts';
const base: SuggestionScoreInput = { block: 'unknown', page: 'unknown', posture: 'balanced', usefulNearby: [], dismissed: [] };
const score = (input: SuggestionScoreInput, intent: string) => scoreSuggestions(input).find(value => value.intent === intent)!;

test('five additive terms independently change scores and remain inspectable', () => {
  assert.equal(score(base, 'define').score, 0);
  assert.equal(score({ ...base, block: 'term' }, 'define').terms.blockFit, 6);
  assert.equal(score({ ...base, page: 'social' }, 'evidence').terms.pageFit, 5);
  assert.equal(score({ ...base, preferredIntent: 'diagram' }, 'diagram').terms.statedPreference, 4);
  assert.equal(score({ ...base, usefulNearby: ['explore'] }, 'explore').terms.usefulNearby, 3);
  assert.equal(score({ ...base, dismissed: ['simulate'] }, 'simulate').terms.dismissalPenalty, 5);
  const combined = score({ block: 'term', page: 'reference', posture: 'flow', preferredIntent: 'define', usefulNearby: ['define'], dismissed: ['define'] }, 'define');
  assert.deepEqual(combined.terms, { blockFit: 6, pageFit: 3, statedPreference: 7, usefulNearby: 3, dismissalPenalty: 5 });
  assert.equal(combined.score, 14);
});

test('relevance reorders but never removes an eligible kind or inserts an ineligible one', () => {
  const input = { ...base, block: 'term' as const, dismissed: [...SUGGESTION_ORDER] };
  assert.equal(rankEligibleSuggestions(input, SUGGESTION_ORDER).length, 8);
  assert.deepEqual(rankEligibleSuggestions(input, []), []);
  assert.deepEqual(rankEligibleSuggestions(input, ['simulate', 'unsure']).map(value => value.intent), ['unsure', 'simulate']);
  assert.equal(rankEligibleSuggestions(input, ['simulate']).length, 1, 'negative score stays eligible');
});

test('page and text shape produce different leading offers rather than a fixed trio', () => {
  const term = rankEligibleSuggestions({ ...base, block: 'term', page: 'reference' }, SUGGESTION_ORDER).slice(0, 3).map(value => value.intent);
  const claim = rankEligibleSuggestions({ ...base, block: 'claim', page: 'social' }, SUGGESTION_ORDER).slice(0, 3).map(value => value.intent);
  const mechanism = rankEligibleSuggestions({ ...base, block: 'mechanism', page: 'paper' }, SUGGESTION_ORDER).slice(0, 3).map(value => value.intent);
  assert.equal(term[0], 'define'); assert.equal(claim[0], 'evidence'); assert.equal(mechanism[0], 'simulate');
  assert.notDeepEqual(term, claim); assert.notDeepEqual(claim, mechanism);
});

test('fixed ties and caller-owned snapshots preserve stable ordering without mutating inputs', () => {
  const input = structuredClone(base), before = JSON.stringify(input);
  const drawn = scoreSuggestions(input);
  input.preferredIntent = 'unsure';
  assert.deepEqual(drawn.map(value => value.intent), SUGGESTION_ORDER);
  assert.equal(scoreSuggestions(input)[0].intent, 'unsure');
  assert.equal(JSON.stringify(base), before);
  assert.deepEqual(scoreSuggestions(base), scoreSuggestions(base));
});

test('local classification uses bounded text shape and metadata, with honest unknown fallbacks', () => {
  assert.equal(suggestionBlock('viscosity'), 'term');
  assert.equal(suggestionBlock('y = x + 2'), 'equation');
  assert.equal(suggestionBlock('First follow each step in the procedure.'), 'procedure');
  assert.equal(suggestionBlock('The mechanism causes a stretching flow.'), 'mechanism');
  assert.equal(suggestionBlock('The evidence supports this claim.'), 'claim');
  assert.equal(suggestionBlock('', true), 'page');
  assert.equal(suggestionBlock('An ordinary sentence with several words.'), 'prose');
  assert.equal(suggestionPage(' Paper '), 'paper'); assert.equal(suggestionPage('novel-category'), 'unknown');
});

test('questioning notes affect the contract preference term, including named comparisons', () => {
  for (const note of ['Why is that?', 'Compare Kelvin with Stokes', 'Kelvin versus Stokes']) {
    assert.equal(score({ ...base, note }, 'define').terms.statedPreference, -4);
    assert.equal(score({ ...base, note }, 'explore').terms.statedPreference, 5);
    assert.equal(score({ ...base, note }, 'evidence').terms.statedPreference, 5);
  }
  assert.equal(score({ ...base, note: 'My ordinary note' }, 'define').terms.statedPreference, 0);
});
test('five text shapes yield four or more distinct first offers on one page type', () => {
  const texts = ['viscosity', 'y = x + 2', '1. Open the lid.\n2. Pour water inside.', 'Heat causes expansion because the particles move faster.', 'The rate rose 24% [3].'];
  const first = texts.map(text => scoreSuggestions({ ...base, block: suggestionBlock(text), page: 'article' })[0].intent);
  assert.ok(new Set(first).size >= 4, first.join(', '));
});
test('ordinary prose is nonzero and page type changes the first offer', () => {
  const input = { ...base, block: suggestionBlock('An ordinary sentence with several words.') };
  assert.ok(scoreSuggestions(input).some(item => item.terms.blockFit > 0));
  assert.notEqual(scoreSuggestions({ ...input, page: 'paper' })[0].intent, scoreSuggestions({ ...input, page: 'social' })[0].intent);
});

test('a simulatable Navier-Stokes passage offers Simulate it in the first three', () => {
  const passage = 'The development of a singularity would have to happen despite the presence of viscosity, which tends to smooth out motion.';
  const firstThree = rankEligibleSuggestions({ ...base, block: suggestionBlock(passage), page: 'article' }, SUGGESTION_ORDER)
    .slice(0, 3).map(value => value.intent);
  assert.ok(firstThree.includes('simulate'), firstThree.join(', '));
});

test('plain narrative and definition-style prose keep their article ordering', () => {
  const expected = ['instantiate', 'diagram', 'explore', 'unsure', 'define', 'evidence', 'derive', 'simulate'];
  for (const passage of [
    'Mara crossed the courtyard and opened the wooden door before breakfast.',
    "Viscosity is a fluid's resistance to deformation.",
  ]) {
    const ranked = rankEligibleSuggestions({ ...base, block: suggestionBlock(passage), page: 'article' }, SUGGESTION_ORDER)
      .map(value => value.intent);
    assert.deepEqual(ranked, expected, passage);
  }
});

test('strong local quantitative signals classify a passage without a model call', () => {
  for (const passage of [
    'The growth parameter r (1/s) sets the trajectory.',
    'The damping rate grows with temperature.',
    'The value depends on pressure.',
    'As pressure increases, velocity decays.',
  ]) assert.equal(suggestionBlock(passage), 'equation', passage);
});

test('nearby explicit usefulness changes order by exactly the contract boost', () => {
  const input = { ...base, block: 'prose' as const, page: 'article' as const };
  assert.notEqual(scoreSuggestions(input)[0].intent, 'define');
  const helpful = scoreSuggestions({ ...input, usefulNearby: ['define'] });
  assert.equal(helpful[0].intent, 'define'); assert.equal(helpful[0].terms.usefulNearby, 3);
  assert.equal(helpful[0].score - score(input, 'define').score, 3);
});

import {
  rankReaderSuggestions, snapshotReaderSuggestions, readerSuggestionsAreCurrent,
  READER_SUGGESTION_POLICY_VERSION, READER_SUGGESTION_SCORE_VERSION,
  type ReaderSuggestionInput, type ReaderSuggestionFeedback,
} from '../ui/suggestion-policy.ts';
const readerBase: ReaderSuggestionInput = {
  text: 'Mara crossed the courtyard and opened the wooden door before breakfast.',
  target: 'passage', page: 'article', posture: 'balanced',
};
const revision = { sourceVersion: 'source-v1', targetKey: 'passage-1', noteRevision: 1, generation: 1 };
const readerScore = (input: ReaderSuggestionInput, intent: string) => rankReaderSuggestions(input, SUGGESTION_ORDER).find(value => value.intent === intent)!;

test('reader policy distinguishes explicit useful feedback from retention, reopening and follow-up', () => {
  const baseline = rankReaderSuggestions(readerBase, SUGGESTION_ORDER);
  for (const kind of ['reply-retained', 'reply-reopened', 'reply-followed-up'] as const) {
    assert.deepEqual(rankReaderSuggestions({ ...readerBase, feedback: [{ kind, intent: 'define' }] }, SUGGESTION_ORDER), baseline);
  }
  const input = { ...readerBase, feedback: [{ kind: 'reply-marked-useful', intent: 'define' }] as const };
  assert.equal(readerScore(input, 'define').terms.usefulNearby, 3);
  assert.equal(readerScore(input, 'define').score - readerScore(readerBase, 'define').score, 3);
  assert.equal(rankReaderSuggestions(input, SUGGESTION_ORDER)[0].intent, 'define');
  assert.deepEqual(rankReaderSuggestions({ ...input, feedback: Array(64).fill(input.feedback[0]) }, SUGGESTION_ORDER), rankReaderSuggestions(input, SUGGESTION_ORDER));
});

test('closing an initial question does not penalize its first offer in reader policy', () => {
  const baseline = rankReaderSuggestions(readerBase, SUGGESTION_ORDER);
  const first = baseline[0].intent;
  assert.deepEqual(rankReaderSuggestions({ ...readerBase, feedback: [{ kind: 'question-closed', intent: first }] }, SUGGESTION_ORDER), baseline);
  const dismissed = rankReaderSuggestions({ ...readerBase, feedback: [{ kind: 'offer-dismissed', intent: first }] }, SUGGESTION_ORDER);
  assert.equal(dismissed.find(value => value.intent === first)!.score, baseline[0].score - 5);
  assert.notEqual(dismissed[0].intent, first);
  assert.equal(dismissed.length, baseline.length, 'deliberate dismissal changes rank, not eligibility');
});

test('legacy proxy arrays cannot affect the reader policy API even on structurally wider inputs', () => {
  const withLegacy = { ...readerBase, usefulNearby: ['define'], dismissed: ['instantiate'] };
  assert.deepEqual(rankReaderSuggestions(withLegacy, SUGGESTION_ORDER), rankReaderSuggestions(readerBase, SUGGESTION_ORDER));
});

test('explicit vocabulary uses bounded literal tokens without matching substrings or inferring knowledge', () => {
  const input = { ...readerBase, text: 'The damping rate grows with temperature.' };
  for (const term of ['rate', 'DAMPING RATE']) {
    const difficult = readerScore({ ...input, vocabulary: [{ term, state: 'difficult' }] }, 'instantiate');
    assert.equal(difficult.terms.explicitVocabulary, 2);
    assert.equal(readerScore({ ...input, vocabulary: [{ term, state: 'familiar' }] }, 'define').terms.explicitVocabulary, -3);
  }
  for (const term of ['rat', 'damping pressure', '', '!', 'x'.repeat(81)]) {
    assert.equal(readerScore({ ...input, vocabulary: [{ term, state: 'difficult' }] }, 'define').terms.explicitVocabulary, 0);
  }
  const conflict = { ...input, vocabulary: [{ term: 'rate', state: 'familiar' }, { term: 'rate', state: 'difficult' }] as const };
  assert.equal(readerScore(conflict, 'define').terms.explicitVocabulary, 3);
  assert.equal(readerScore({ ...input, note: 'I used damping rate in a note.' }, 'define').terms.explicitVocabulary, 0);
  assert.equal(readerScore({ ...input, vocabulary: Array(64).fill({ term: 'rate', state: 'difficult' }) }, 'define').terms.explicitVocabulary, 3);
});

test('reader policy scanning has explicit text, feedback and vocabulary bounds', () => {
  const feedback: ReaderSuggestionFeedback[] = Array.from({ length: 64 }, () => ({ kind: 'question-closed' }));
  feedback.push({ kind: 'reply-marked-useful', intent: 'define' });
  const vocabulary: NonNullable<ReaderSuggestionInput['vocabulary']>[number][] = Array.from({ length: 64 }, () => ({ term: 'absent', state: 'difficult' }));
  vocabulary.push({ term: 'courtyard', state: 'difficult' });
  assert.equal(readerScore({ ...readerBase, feedback }, 'define').terms.usefulNearby, 0);
  assert.equal(readerScore({ ...readerBase, vocabulary }, 'define').terms.explicitVocabulary, 0);
  assert.equal(readerScore({ ...readerBase, text: 'x '.repeat(2000) + 'courtyard', vocabulary: [{ term: 'courtyard', state: 'difficult' }] }, 'define').terms.explicitVocabulary, 0);
  assert.equal(readerScore({ ...readerBase, note: 'x'.repeat(4000) + '?' }, 'evidence').terms.statedPreference, 0);
});

test('word shipping policy is Define only even for a misleading block classifier or preference', () => {
  for (const text of ['viscosity', 'equation', 'flow']) {
    const input: ReaderSuggestionInput = { ...readerBase, text, target: 'word', preferredIntent: 'simulate', vocabulary: [{ term: text, state: 'familiar' }] };
    assert.deepEqual(rankReaderSuggestions(input, SUGGESTION_ORDER).map(value => value.intent), ['define']);
    assert.deepEqual(rankReaderSuggestions(input, ['simulate']), []);
  }
});

test('reader policy eligibility stays host-owned with zero to three unpadded exposed offers', () => {
  for (const eligible of [[], ['diagram'], ['diagram', 'evidence'], [...SUGGESTION_ORDER]] as const) {
    const snapshot = snapshotReaderSuggestions(readerBase, eligible, revision);
    assert.equal(snapshot.shown.length, Math.min(eligible.length, 3));
    assert.ok(snapshot.shown.every(value => eligible.some(intent => intent === value.intent)));
    assert.deepEqual(snapshot.shown.map(value => value.position), snapshot.shown.map((_, index) => index + 1));
  }
  assert.equal(snapshotReaderSuggestions(readerBase, ['diagram', 'diagram'], revision).shown.length, 1);
});

test('exposed reader policy scores, terms and revisions are frozen independently of later input changes', () => {
  const input: ReaderSuggestionInput = structuredClone(readerBase), rev = { ...revision };
  const snapshot = snapshotReaderSuggestions(input, SUGGESTION_ORDER, rev);
  const original = JSON.stringify(snapshot);
  input.preferredIntent = 'evidence'; rev.generation++;
  assert.equal(JSON.stringify(snapshot), original);
  for (const value of [snapshot, snapshot.revision, snapshot.eligible, snapshot.shown, snapshot.shown[0], snapshot.shown[0].terms]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { (snapshot.shown[0].terms as { blockFit: number }).blockFit = 100; }, TypeError);
  assert.notDeepEqual(snapshotReaderSuggestions(input, SUGGESTION_ORDER, rev).shown, snapshot.shown);
  assert.equal(snapshot.policyVersion, 'marginalia.suggestions.reader.v3');
  assert.equal(snapshot.scoreVersion, 'marginalia.suggestions.score.v3');
  assert.equal(READER_SUGGESTION_POLICY_VERSION, snapshot.policyVersion);
  assert.equal(READER_SUGGESTION_SCORE_VERSION, snapshot.scoreVersion);
});

test('stale note, source, target and generation results cannot pass the reader policy revision check', () => {
  const snapshot = snapshotReaderSuggestions(readerBase, SUGGESTION_ORDER, revision);
  assert.ok(readerSuggestionsAreCurrent(snapshot, { ...revision }));
  for (const current of [{ ...revision, sourceVersion: 'source-v2' }, { ...revision, targetKey: 'passage-2' }, { ...revision, noteRevision: 2 }, { ...revision, generation: 2 }]) {
    assert.equal(readerSuggestionsAreCurrent(snapshot, current), false);
  }
  assert.equal(readerSuggestionsAreCurrent({ ...snapshot, scoreVersion: 'old' }, revision), false);
  assert.equal(readerSuggestionsAreCurrent({ ...snapshot, policyVersion: 'old' }, revision), false);
  for (const invalid of [{ ...revision, sourceVersion: '' }, { ...revision, targetKey: '' }, { ...revision, noteRevision: -1 }, { ...revision, generation: NaN }]) {
    assert.throws(() => snapshotReaderSuggestions(readerBase, SUGGESTION_ORDER, invalid), /Invalid suggestion revision/);
  }
});

// Fixed source data: Navier quote from the existing test above; other sentences
// are synthetic engineering/plain-reading fixtures, not D81 best-form labels.
// Rankings below measure deterministic choices, not usefulness or hit-rate.
export const readerRankingFixtures: readonly { id: string; input: ReaderSuggestionInput }[] = [
  { id: 'technical-navier', input: { ...readerBase, text: 'The development of a singularity would have to happen despite the presence of viscosity, which tends to smooth out motion.' } },
  { id: 'technical-equation', input: { ...readerBase, text: 'y = x + 2', page: 'paper' } },
  { id: 'technical-difficult', input: { ...readerBase, text: 'The damping rate grows with temperature.', vocabulary: [{ term: 'damping rate', state: 'difficult' }] } },
  { id: 'plain-narrative', input: { ...readerBase } },
  { id: 'plain-retained', input: { ...readerBase, feedback: [{ kind: 'reply-retained', intent: 'define' }] } },
  { id: 'plain-question-closed', input: { ...readerBase, feedback: [{ kind: 'question-closed', intent: 'instantiate' }] } },
  { id: 'plain-explicit-useful', input: { ...readerBase, feedback: [{ kind: 'reply-marked-useful', intent: 'define' }] } },
  { id: 'plain-reader-base-score', input: { ...readerBase, readerBaseScores: { evidence: 4 } } },
  { id: 'plain-offer-dismissed', input: { ...readerBase, feedback: [{ kind: 'offer-dismissed', intent: 'instantiate' }] } },
];
test('fixed technical and plain fixtures retain reproducible top1/top3 choices', t => {
  const choices = readerRankingFixtures.map(({ id, input }) => ({ id, top3: snapshotReaderSuggestions(input, SUGGESTION_ORDER, revision).shown.map(value => value.intent) }));
  t.diagnostic(JSON.stringify(choices));
  assert.deepEqual(choices.map(value => value.top3), [
    ['derive', 'simulate', 'instantiate'], ['simulate', 'instantiate', 'derive'],
    ['instantiate', 'derive', 'simulate'], ['instantiate', 'diagram', 'explore'],
    ['instantiate', 'diagram', 'explore'], ['instantiate', 'diagram', 'explore'],
    ['define', 'instantiate', 'diagram'], ['evidence', 'instantiate', 'diagram'], ['diagram', 'explore', 'unsure'],
  ]);
});

test('D102 reader-set per-form base scores are neutral by default and remain an inspectable additive term', () => {
  const neutral = rankReaderSuggestions(readerBase, SUGGESTION_ORDER);
  assert.deepEqual(rankReaderSuggestions({ ...readerBase, readerBaseScores: {} }, SUGGESTION_ORDER), neutral);
  assert.deepEqual(rankReaderSuggestions({ ...readerBase, readerBaseScores: Object.fromEntries(SUGGESTION_ORDER.map(intent => [intent, 0])) }, SUGGESTION_ORDER), neutral);
  for (const intent of SUGGESTION_ORDER) {
    for (const value of [-4, -1.5, 0, 2.5, 4]) {
      const ranked = rankReaderSuggestions({ ...readerBase, readerBaseScores: { [intent]: value } }, SUGGESTION_ORDER);
      for (const entry of ranked) {
        const expected = entry.intent === intent ? value : 0;
        assert.equal(entry.terms.readerBaseScore, expected);
        assert.equal(entry.score - neutral.find(item => item.intent === entry.intent)!.score, expected);
      }
    }
  }
  assert.equal(rankReaderSuggestions({ ...readerBase, readerBaseScores: { evidence: 4 } }, SUGGESTION_ORDER)[0].intent, 'evidence');
});

test('D102 rejects nonfinite, out-of-range, coerced and inherited scores to neutral without removing eligible forms', () => {
  const baseline = rankReaderSuggestions(readerBase, SUGGESTION_ORDER);
  for (const invalid of [NaN, Infinity, -Infinity, 4.001, -4.001, '4', null, true, {}, []]) {
    const input = { ...readerBase, readerBaseScores: { evidence: invalid } as unknown as ReaderSuggestionInput['readerBaseScores'] };
    assert.deepEqual(rankReaderSuggestions(input, SUGGESTION_ORDER), baseline);
  }
  assert.deepEqual(rankReaderSuggestions({ ...readerBase, readerBaseScores: Object.create({ evidence: 4 }) }, SUGGESTION_ORDER), baseline);
  const input = { ...readerBase, readerBaseScores: { evidence: 4, define: -4, instantiate: -4 } };
  assert.equal(rankReaderSuggestions(input, SUGGESTION_ORDER).length, 8);
  assert.deepEqual(rankReaderSuggestions(input, ['define']).map(value => value.intent), ['define']);
  assert.deepEqual(rankReaderSuggestions(input, []), []);
  assert.deepEqual(rankReaderSuggestions({ ...input, target: 'word' }, SUGGESTION_ORDER).map(value => value.intent), ['define']);
});

test('D102 tuner changes use a new generation; shown scores remain frozen until the next exposure', () => {
  const input = { ...readerBase, readerBaseScores: { evidence: 0 } };
  const snapshot = snapshotReaderSuggestions(input, SUGGESTION_ORDER, revision);
  input.readerBaseScores.evidence = 4;
  const current = { ...revision, generation: revision.generation + 1 };
  assert.equal(readerSuggestionsAreCurrent(snapshot, current), false);
  assert.ok(snapshot.shown.every(value => value.terms.readerBaseScore === 0));
  const next = snapshotReaderSuggestions(input, SUGGESTION_ORDER, current);
  assert.equal(next.shown[0].intent, 'evidence');
  assert.equal(next.shown[0].terms.readerBaseScore, 4);
});
