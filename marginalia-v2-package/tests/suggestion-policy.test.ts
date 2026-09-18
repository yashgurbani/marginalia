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
