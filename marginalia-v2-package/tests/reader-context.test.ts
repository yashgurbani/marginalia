import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InvalidReaderContextError, assertReaderTunerManifest, assertReaderTunerState,
  assertReaderOnboardingManifest, assertReaderOnboardingAnswer, assertReaderContextProfile,
  assertReaderArticleBackground, assertReaderBaseScores, assertNeutralReaderBaseScores,
  normalizeReaderText, type ReaderTunerManifest, type ReaderTunerState,
  type ReaderOnboardingManifest, type ReaderOnboardingAnswer, type ReaderContextProfile,
  type ReaderArticleBackground,
} from '../contracts/reader-context.ts';

// Fixtures only: no installed assets/digest, chosen-demo defaults or production
// cardinality. Every test chooses its cardinality argument explicitly.
function questionnaire(limits: [number | null, number | null, number | null]): ReaderOnboardingManifest {
  return {
    schemaVersion: 2, questionnaireId: 'test-about-you', questionnaireVersion: 7,
    questions: [
      { questionId: 'mostly-read', questionVersion: 1, optionIds: ['papers-articles', 'news-essays', 'documentation', 'fiction'], maxSelections: limits[0] },
      { questionId: 'helps-first', questionVersion: 2, optionIds: ['example', 'simpler', 'definitions', 'big-picture'], maxSelections: limits[1] },
      { questionId: 'background-depth', questionVersion: 3, optionIds: ['answer-only', 'short-explanation', 'full-detail'], maxSelections: limits[2] },
    ],
  };
}
function deck(): ReaderTunerManifest {
  return {
    schemaVersion: 2, deckId: 'test-deck', deckDigest: 'test-digest', scoringMappingVersion: 'test-map',
    steps: [
      { stepId: 'hard-sentence', options: [
        { optionId: 'plain', effect: { kind: 'base-scores', scores: { unsure: 2 } } },
        { optionId: 'define', effect: { kind: 'base-scores', scores: { define: 2 } } },
        { optionId: 'example', effect: { kind: 'base-scores', scores: { instantiate: 2 } } },
      ] },
      { stepId: 'explanation-form', options: [
        { optionId: 'steps', effect: { kind: 'base-scores', scores: { derive: 2 } } },
        { optionId: 'picture', effect: { kind: 'base-scores', scores: { diagram: 2 } } },
        { optionId: 'move', effect: { kind: 'base-scores', scores: { simulate: 2 } } },
      ] },
      { stepId: 'answer-length', options: [
        { optionId: 'short', effect: { kind: 'response-length', value: 'short' } },
        { optionId: 'worked', effect: { kind: 'response-length', value: 'worked' } },
      ] },
      { stepId: 'answer-scope', options: [
        { optionId: 'inside', effect: { kind: 'base-scores', scores: { define: 1, instantiate: 1 } } },
        { optionId: 'wider', effect: { kind: 'base-scores', scores: { explore: 2 } } },
      ] },
    ],
  };
}
const skippedTuner = (): ReaderTunerState => ({
  schemaVersion: 2, deckId: 'test-deck', deckDigest: 'test-digest', scoringMappingVersion: 'test-map',
  tunerRevision: 1, state: 'skipped', choices: [],
});
const answer = (index: number, selectedOptionIds: string[]): ReaderOnboardingAnswer => ({
  answerId: `answer-${index}`, questionId: questionnaire([null, null, null]).questions[index].questionId,
  questionVersion: questionnaire([null, null, null]).questions[index].questionVersion,
  answerRevision: 1, state: 'active', selectedOptionIds,
});
const profile = (): ReaderContextProfile => ({
  schemaVersion: 2, profileId: 'profile', profileRevision: 1, availabilityEpoch: 1,
  questionnaireId: 'test-about-you', questionnaireVersion: 7,
  onboardingState: 'skipped', onboardingAnswers: [], tuner: null, updatedAt: 0,
});
const background = (): ReaderArticleBackground => ({
  schemaVersion: 1, backgroundId: 'background', threadId: 'thread', sourceId: 'source', sourceVersionId: 'version',
  revision: 1, availabilityEpoch: 1, newlinePolicy: 'preserve', text: '  Exact e\u0301 🧭  ',
});
const rejects = (action: () => void) => assert.throws(action, InvalidReaderContextError);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('explicit empty/skipped records have no inferred answers or default selections', () => {
  const input = deepFreeze(profile());
  const manifest = deepFreeze(questionnaire([null, null, null]));
  assertReaderContextProfile(input, manifest, null);
  assertReaderContextProfile({ ...input, tuner: skippedTuner() }, manifest, deck());
  assert.deepEqual(input.onboardingAnswers, []);
  assert.equal(input.tuner, null);
  assert.equal(Object.hasOwn(input, 'responseLength'), false);
  assert.equal(Object.hasOwn(input, 'readerBaseScores'), false);
});

test('partial and complete onboarding states count active answers and retain tombstones', () => {
  const input = profile();
  input.onboardingAnswers = [answer(0, ['documentation'])]; input.onboardingState = 'partial';
  assertReaderContextProfile(input, questionnaire([1, 1, 1]), null);
  input.onboardingAnswers.push({ ...answer(1, []), state: 'deleted' });
  assertReaderContextProfile(input, questionnaire([1, 1, 1]), null);
  input.onboardingAnswers[1] = answer(1, ['definitions']);
  assertReaderContextProfile(input, questionnaire([1, 1, 1]), null);
  input.onboardingAnswers.push(answer(2, ['full-detail'])); input.onboardingState = 'complete';
  assertReaderContextProfile(input, questionnaire([1, 1, 1]), null);
  for (const state of ['skipped', 'partial']) rejects(() => assertReaderContextProfile({ ...input, onboardingState: state }, questionnaire([1, 1, 1]), null));
  input.onboardingAnswers = input.onboardingAnswers.map(answer => ({ ...answer, state: 'deleted', selectedOptionIds: [] }));
  input.onboardingState = 'skipped';
  assertReaderContextProfile(input, questionnaire([null, null, null]), null);
  assert.equal(input.onboardingAnswers.length, 3);
  rejects(() => assertReaderContextProfile({ ...profile(), onboardingState: 'partial' }, questionnaire([1, 1, 1]), null));
  rejects(() => assertReaderContextProfile({ ...profile(), onboardingState: 'complete' }, questionnaire([1, 1, 1]), null));
});

test('all eleven exact onboarding option identities are admitted only for their own question', () => {
  let count = 0;
  questionnaire([1, 1, 1]).questions.forEach((question, index) => {
    for (const option of question.optionIds) {
      assertReaderOnboardingAnswer(answer(index, [option]), questionnaire([1, 1, 1])); count++;
      rejects(() => assertReaderOnboardingAnswer(answer((index + 1) % 3, [option]), questionnaire([1, 1, 1])));
    }
  });
  assert.equal(count, 11);
});

test('supplied single/multiple cardinality is enforced; unresolved/null never admits active answers', () => {
  const input = answer(0, ['papers-articles', 'fiction']);
  assertReaderOnboardingAnswer(input, questionnaire([2, 1, 1]));
  rejects(() => assertReaderOnboardingAnswer(input, questionnaire([1, 1, 1])));
  rejects(() => assertReaderOnboardingAnswer(answer(0, ['fiction']), questionnaire([null, null, null])));
  rejects(() => assertReaderOnboardingAnswer(answer(0, ['fiction']), null));
  const active = { ...profile(), onboardingState: 'partial', onboardingAnswers: [answer(0, ['fiction'])] };
  rejects(() => assertReaderContextProfile(active, null, null));
  rejects(() => assertReaderContextProfile(active, questionnaire([null, null, null]), null));
  assertReaderOnboardingAnswer({ ...answer(0, []), state: 'deleted' }, questionnaire([null, null, null]));
  rejects(() => assertReaderOnboardingAnswer(answer(0, []), questionnaire([1, 1, 1])));
  rejects(() => assertReaderOnboardingAnswer({ ...answer(0, ['fiction']), state: 'deleted' }, questionnaire([1, 1, 1])));
  const mixed = questionnaire([null, null, null]); mixed.questions[0].maxSelections = 2;
  assertReaderOnboardingAnswer(input, mixed);
  rejects(() => assertReaderOnboardingAnswer(answer(1, ['example']), mixed));
});

test('manifest pins exact question/option sets, versions and explicit cardinality field', () => {
  assertReaderOnboardingManifest(questionnaire([null, null, null]));
  assertReaderOnboardingManifest(questionnaire([3, 1, 1]));
  for (const value of [0, -1, 1.5, 5, NaN, Infinity, '1', undefined]) {
    const input = questionnaire([1, 1, 1]); (input.questions[0] as any).maxSelections = value;
    rejects(() => assertReaderOnboardingManifest(input));
  }
  for (const mutate of [
    (m: ReaderOnboardingManifest) => { m.questions.pop(); },
    (m: ReaderOnboardingManifest) => { m.questions.push(structuredClone(m.questions[0])); },
    (m: ReaderOnboardingManifest) => { m.questions[0].questionId = 'unknown'; },
    (m: ReaderOnboardingManifest) => { m.questions[1].questionId = m.questions[0].questionId; },
    (m: ReaderOnboardingManifest) => { m.questions[0].optionIds.pop(); },
    (m: ReaderOnboardingManifest) => { m.questions[0].optionIds[0] = 'guessed-option'; },
    (m: ReaderOnboardingManifest) => { m.questions[0].optionIds[0] = m.questions[0].optionIds[1]; },
    (m: ReaderOnboardingManifest) => { delete (m.questions[0] as any).maxSelections; },
  ]) { const input = questionnaire([1, 1, 1]); mutate(input); rejects(() => assertReaderOnboardingManifest(input)); }
  const reordered = questionnaire([1, 1, 1]); reordered.questions.reverse(); reordered.questions[0].optionIds.reverse();
  assertReaderOnboardingManifest(reordered);
});

test('Fable 20:37 cardinality ruling allows four first-question selections and caps other questions at one', () => {
  const approved = questionnaire([4, 1, 1]);
  assertReaderOnboardingManifest(approved);
  assertReaderOnboardingAnswer(answer(0, [...approved.questions[0].optionIds]), approved);
  for (const index of [1, 2]) {
    const contradictory = structuredClone(approved); contradictory.questions[index].maxSelections = 2;
    rejects(() => assertReaderOnboardingManifest(contradictory));
    const selected = approved.questions[index].optionIds.slice(0, 2);
    rejects(() => assertReaderOnboardingAnswer(answer(index, selected), approved));
    rejects(() => assertReaderOnboardingAnswer(answer(index, selected), contradictory));
  }
  // All questions are individually skippable: any single answered question is
  // partial, and omitted questions receive neither answers nor selections.
  for (const index of [0, 1, 2]) {
    const input = { ...profile(), onboardingState: 'partial', onboardingAnswers: [answer(index, [approved.questions[index].optionIds[0]])] };
    assertReaderContextProfile(input, approved, null);
    assert.equal(input.onboardingAnswers.length, 1);
  }
});

test('answers reject unknown/duplicate selections, versions and duplicate record identities', () => {
  for (const selections of [['unknown'], ['fiction', 'fiction'], ['example']]) {
    rejects(() => assertReaderOnboardingAnswer(answer(0, selections), questionnaire([2, 1, 1])));
  }
  rejects(() => assertReaderOnboardingAnswer({ ...answer(0, ['fiction']), questionVersion: 2 }, questionnaire([1, 1, 1])));
  const input = { ...profile(), onboardingState: 'partial', onboardingAnswers: [answer(0, ['fiction']), answer(1, ['example'])] };
  input.onboardingAnswers[1].answerId = input.onboardingAnswers[0].answerId;
  rejects(() => assertReaderContextProfile(input, questionnaire([1, 1, 1]), null));
  input.onboardingAnswers[1] = { ...answer(0, []), answerId: 'distinct', state: 'deleted' };
  rejects(() => assertReaderContextProfile(input, questionnaire([1, 1, 1]), null));
  for (const change of [{ questionnaireId: 'other' }, { questionnaireVersion: 8 }]) {
    rejects(() => assertReaderContextProfile({ ...profile(), ...change }, questionnaire([1, 1, 1]), null));
  }
});

test('tuner manifest admits all exact 3/3/2/2 options including length and two-form scope', () => {
  const input = deepFreeze(deck()); const before = structuredClone(input);
  assertReaderTunerManifest(input);
  assert.deepEqual(input.steps.map(step => step.options.length), [3, 3, 2, 2]);
  assert.deepEqual(input.steps[3].options[0].effect, { kind: 'base-scores', scores: { define: 1, instantiate: 1 } });
  assert.deepEqual(input.steps[2].options.map(option => option.effect), [
    { kind: 'response-length', value: 'short' }, { kind: 'response-length', value: 'worked' },
  ]);
  assert.deepEqual(input, before);
});

test('each accepted effect is pinned; well-shaped altered weights and stale evidence mapping reject', () => {
  deck().steps.forEach((step, index) => step.options.forEach((option, optionIndex) => {
    const input = deck();
    if (option.effect.kind === 'base-scores') {
      const effect = input.steps[index].options[optionIndex].effect;
      assert.equal(effect.kind, 'base-scores');
      if (effect.kind === 'base-scores') {
        const key = Object.keys(effect.scores)[0] as keyof typeof effect.scores;
        effect.scores[key] = 3;
      }
    } else input.steps[index].options[optionIndex].effect = { kind: 'base-scores', scores: { evidence: 2 } };
    rejects(() => assertReaderTunerManifest(input));
  }));
  const omitted = deck(); omitted.steps[3].options[0].effect = { kind: 'base-scores', scores: { define: 1 } };
  rejects(() => assertReaderTunerManifest(omitted));
  const zeroExtra = deck(); zeroExtra.steps[0].options[0].effect = { kind: 'base-scores', scores: { unsure: 2, evidence: 0 } };
  rejects(() => assertReaderTunerManifest(zeroExtra));
  const stale = deck(); stale.steps[2] = { stepId: 'claim-trust', options: [
    { optionId: 'explain', effect: { kind: 'base-scores', scores: { unsure: 2 } } },
    { optionId: 'check', effect: { kind: 'base-scores', scores: { evidence: 2 } } },
  ] };
  rejects(() => assertReaderTunerManifest(stale));
});

test('tuner rejects wrong arity, duplicate IDs, cross-step options and extra effect payloads', () => {
  for (const mutate of [
    (m: ReaderTunerManifest) => { m.steps.pop(); },
    (m: ReaderTunerManifest) => { m.steps.push(structuredClone(m.steps[0])); },
    (m: ReaderTunerManifest) => { m.steps[0].options.pop(); },
    (m: ReaderTunerManifest) => { m.steps[2].options.push(structuredClone(m.steps[2].options[0])); },
    (m: ReaderTunerManifest) => { m.steps[1].stepId = m.steps[0].stepId; },
    (m: ReaderTunerManifest) => { m.steps[0].options[0].optionId = 'picture'; },
    (m: ReaderTunerManifest) => { m.steps[0].options[1] = structuredClone(m.steps[0].options[0]); },
    (m: ReaderTunerManifest) => { (m.steps[2].options[0].effect as any).scores = {}; },
    (m: ReaderTunerManifest) => { (m.steps[2].options[0] as any).formId = 'unsure'; },
    (m: ReaderTunerManifest) => { (m.steps[0].options[0].effect as any).value = 'short'; },
  ]) { const input = deck(); mutate(input); rejects(() => assertReaderTunerManifest(input)); }
});

test('all 36 complete tuner selections and all 10 partial single choices preserve exact selected length', () => {
  const manifest = deck(); let completeCount = 0, partialCount = 0;
  for (const a of manifest.steps[0].options) for (const b of manifest.steps[1].options)
    for (const c of manifest.steps[2].options) for (const d of manifest.steps[3].options) {
      const options = [a, b, c, d];
      const input: ReaderTunerState = {
        ...skippedTuner(), state: 'complete',
        choices: options.map((option, index) => ({ stepId: manifest.steps[index].stepId, optionId: option.optionId })),
        responseLength: c.optionId as 'short' | 'worked',
      };
      assertReaderTunerState(deepFreeze(input), manifest); completeCount++;
    }
  for (const step of manifest.steps) for (const option of step.options) {
    const input: ReaderTunerState = { ...skippedTuner(), state: 'partial', choices: [{ stepId: step.stepId, optionId: option.optionId }] };
    if (option.effect.kind === 'response-length') input.responseLength = option.effect.value;
    assertReaderTunerState(input, manifest); partialCount++;
  }
  assert.equal(completeCount, 36); assert.equal(partialCount, 10);
});

test('length is absent without a choice and required/equal when chosen; no model or effort coupling', () => {
  for (const responseLength of ['short', 'worked', undefined, null, 'fast']) {
    rejects(() => assertReaderTunerState({ ...skippedTuner(), responseLength }, deck()));
  }
  const input: ReaderTunerState = { ...skippedTuner(), state: 'partial', choices: [{ stepId: 'answer-length', optionId: 'short' }] };
  rejects(() => assertReaderTunerState(input, deck()));
  rejects(() => assertReaderTunerState({ ...input, responseLength: 'worked' }, deck()));
  assertReaderTunerState({ ...input, responseLength: 'short' }, deck());
  for (const field of ['model', 'effort', 'speed', 'readerBaseScores']) {
    rejects(() => assertReaderTunerState({ ...input, responseLength: 'short', [field]: 'fast' }, deck()));
  }
  const independent = profile(); independent.onboardingState = 'partial'; independent.onboardingAnswers = [answer(2, ['full-detail'])];
  independent.tuner = { ...input, responseLength: 'short' };
  assertReaderContextProfile(independent, questionnaire([1, 1, 1]), deck());
  assert.equal(independent.onboardingAnswers[0].selectedOptionIds[0], 'full-detail');
  assert.equal(independent.tuner.responseLength, 'short');
});

test('tuner state rejects wrong identity, duplicate/unknown choices and incorrect completion states', () => {
  rejects(() => assertReaderTunerState(skippedTuner(), null));
  for (const field of ['deckId', 'deckDigest', 'scoringMappingVersion']) {
    rejects(() => assertReaderTunerState({ ...skippedTuner(), [field]: 'unknown' }, deck()));
  }
  for (const choices of [
    [{ stepId: 'unknown', optionId: 'plain' }],
    [{ stepId: 'hard-sentence', optionId: 'picture' }],
    [{ stepId: 'hard-sentence', optionId: 'plain' }, { stepId: 'hard-sentence', optionId: 'define' }],
  ]) rejects(() => assertReaderTunerState({ ...skippedTuner(), state: 'partial', choices }, deck()));
  for (const state of ['partial', 'complete', 'unknown']) rejects(() => assertReaderTunerState({ ...skippedTuner(), state }, deck()));
  const one = { ...skippedTuner(), choices: [{ stepId: 'hard-sentence', optionId: 'plain' }] };
  rejects(() => assertReaderTunerState(one, deck()));
  rejects(() => assertReaderTunerState({ ...one, state: 'complete' }, deck()));
});

test('redo/clear representation preserves old records and requires no hidden length default', () => {
  const old = deepFreeze({ ...skippedTuner(), tunerRevision: 2, state: 'partial', choices: [{ stepId: 'answer-length', optionId: 'worked' }], responseLength: 'worked' });
  assertReaderTunerState(old, deck());
  const cleared = { ...skippedTuner(), tunerRevision: 3 };
  assertReaderTunerState(cleared, deck());
  assert.equal(old.responseLength, 'worked');
  assert.equal(Object.hasOwn(cleared, 'responseLength'), false);
  // Shapes alone cannot establish monotonicity, CAS or who allocated revision3.
});

test('historical version1 profiles/tuners and removed fields reject without input mutation or conversion', () => {
  const historical = {
    schemaVersion: 1, profileId: 'old', profileRevision: 1, availabilityEpoch: 1,
    newlinePolicy: 'preserve', preferenceLines: [{ lineId: 'line1', text: 'retain old draft' }],
    interviewAnswers: [{ answerId: 'old-answer', text: 'retain this too' }], tuner: null, updatedAt: 0,
  };
  const before = structuredClone(historical);
  rejects(() => assertReaderContextProfile(deepFreeze(historical), questionnaire([1, 1, 1]), deck()));
  assert.deepEqual(historical, before);
  for (const field of ['preferenceLines', 'interviewAnswers', 'mastery', 'smartQuestions', 'newlinePolicy']) {
    rejects(() => assertReaderContextProfile({ ...profile(), [field]: [] }, questionnaire([1, 1, 1]), null));
  }
  rejects(() => assertReaderTunerState({ ...skippedTuner(), schemaVersion: 1 }, deck()));
  const oldDeck = deck() as any; oldDeck.steps[0] = { stepId: 'hard-sentence', pictures: [{ pictureId: 'x', formId: 'define' }] };
  rejects(() => assertReaderTunerManifest(oldDeck));
  rejects(() => assertReaderTunerState({ ...skippedTuner(), state: 'partial', choices: [{ stepId: 'hard-sentence', pictureId: 'x', formId: 'define' }] }, deck()));
});

test('closed shapes reject missing/unknown schema versions and required fields', () => {
  for (const version of [undefined, null, '2', 0, 1, 3]) {
    rejects(() => assertReaderContextProfile({ ...profile(), schemaVersion: version }, questionnaire([1, 1, 1]), null));
    rejects(() => assertReaderTunerManifest({ ...deck(), schemaVersion: version }));
    rejects(() => assertReaderOnboardingManifest({ ...questionnaire([1, 1, 1]), schemaVersion: version }));
  }
  for (const version of [undefined, null, '1', 0, 2]) rejects(() => assertReaderArticleBackground({ ...background(), schemaVersion: version }));
  for (const field of ['onboardingAnswers', 'tuner', 'questionnaireId']) {
    const input = profile() as any; delete input[field]; rejects(() => assertReaderContextProfile(input, questionnaire([1, 1, 1]), null));
  }
  rejects(() => assertReaderOnboardingAnswer({ ...answer(0, ['fiction']), text: 'not an onboarding answer' }, questionnaire([1, 1, 1])));
  rejects(() => assertReaderOnboardingAnswer({ ...answer(0, ['fiction']), selectedOptionIds: undefined }, questionnaire([1, 1, 1])));
});

test('all revision/epoch/version fields reject unsafe numbers and coerce nothing', () => {
  for (const value of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    for (const field of ['profileRevision', 'availabilityEpoch']) rejects(() => assertReaderContextProfile({ ...profile(), [field]: value }, questionnaire([1, 1, 1]), null));
    for (const field of ['revision', 'availabilityEpoch']) rejects(() => assertReaderArticleBackground({ ...background(), [field]: value }));
    rejects(() => assertReaderTunerState({ ...skippedTuner(), tunerRevision: value }, deck()));
    for (const field of ['answerRevision', 'questionVersion']) rejects(() => assertReaderOnboardingAnswer({ ...answer(0, ['fiction']), [field]: value }, questionnaire([1, 1, 1])));
    rejects(() => assertReaderOnboardingManifest({ ...questionnaire([1, 1, 1]), questionnaireVersion: value }));
    const input = questionnaire([1, 1, 1]); (input.questions[0] as any).questionVersion = value;
    rejects(() => assertReaderOnboardingManifest(input));
  }
  assertReaderContextProfile({ ...profile(), profileRevision: Number.MAX_SAFE_INTEGER, availabilityEpoch: Number.MAX_SAFE_INTEGER }, questionnaire([1, 1, 1]), null);
  for (const updatedAt of [-1, Infinity, 0.5, 'today']) rejects(() => assertReaderContextProfile({ ...profile(), updatedAt }, questionnaire([1, 1, 1]), null));
});

test('article background remains separately bound and preserves empty, removed and exact string states', () => {
  const input = deepFreeze(background()); const before = structuredClone(input);
  assertReaderArticleBackground(input);
  assert.deepEqual(input, before);
  for (const text of ['', null, 'reader text '.repeat(10000)]) assertReaderArticleBackground({ ...background(), text });
  for (const field of ['backgroundId', 'threadId', 'sourceId', 'sourceVersionId']) {
    for (const value of ['', ' padded ', '\n', null, 1]) rejects(() => assertReaderArticleBackground({ ...background(), [field]: value }));
  }
  assertReaderContextProfile({ ...profile(), onboardingState: 'partial', onboardingAnswers: [answer(0, ['fiction'])] }, questionnaire([1, 1, 1]), null);
  assert.deepEqual(input, before, 'unrelated global answer cannot change article data');
  rejects(() => assertReaderArticleBackground({ ...background(), profileId: 'global' }));
  rejects(() => assertReaderArticleBackground({ ...background(), sourceVersionId: undefined }));
});

test('newline handling is explicit with no trimming/paraphrase and article field stays one line', () => {
  const text = '  e\u0301\r\n🧭\rnext\n\u2028end  ';
  assert.equal(normalizeReaderText(text, 'preserve'), text);
  assert.equal(normalizeReaderText(text, 'lf'), '  e\u0301\n🧭\nnext\n\u2028end  ');
  rejects(() => normalizeReaderText(text, 'auto' as never));
  rejects(() => normalizeReaderText(42 as never, 'lf'));
  for (const separator of ['\n', '\r', '\r\n', '\u0085', '\u2028', '\u2029']) {
    for (const newlinePolicy of ['preserve', 'lf']) rejects(() => assertReaderArticleBackground({ ...background(), newlinePolicy, text: `one${separator}two` }));
  }
  assertReaderArticleBackground({ ...background(), newlinePolicy: 'lf' });
  rejects(() => assertReaderArticleBackground({ ...background(), newlinePolicy: 'auto' }));
});

test('score and neutral boundaries admit finite signed endpoints only, with no coercion or clamping', () => {
  assertReaderBaseScores({ define: -4, diagram: 4, derive: 0.5 });
  for (const value of [NaN, Infinity, -Infinity, -4.000001, 4.000001, '4', null, undefined, true]) rejects(() => assertReaderBaseScores({ define: value }));
  for (const value of [{ mastery: 1 }, [], null]) rejects(() => assertReaderBaseScores(value));
  const input = { define: 5 }; rejects(() => assertReaderBaseScores(input)); assert.equal(input.define, 5);
  assertNeutralReaderBaseScores({}); assertNeutralReaderBaseScores({ define: 0, simulate: -0 });
  for (const value of [-4, -0.001, 0.001, 4, NaN]) rejects(() => assertNeutralReaderBaseScores({ define: value }));
});

test('own-data boundary rejects inherited/accessor/hidden/symbol fields without invoking getters', () => {
  rejects(() => assertReaderBaseScores(Object.create({ define: 1 })));
  rejects(() => assertReaderContextProfile(Object.create(profile()), questionnaire([1, 1, 1]), null));
  let getterRuns = 0;
  const accessor = Object.defineProperty({}, 'define', { enumerable: true, get() { getterRuns++; return 1; } });
  rejects(() => assertReaderBaseScores(accessor));
  const input = profile(); Object.defineProperty(input, 'onboardingAnswers', { enumerable: true, get() { getterRuns++; return []; } });
  rejects(() => assertReaderContextProfile(input, questionnaire([1, 1, 1]), null));
  const manifest = deck(); Object.defineProperty(manifest.steps[0].options[0], 'effect', { enumerable: true, get() { getterRuns++; return {}; } });
  rejects(() => assertReaderTunerManifest(manifest));
  assert.equal(getterRuns, 0);
  rejects(() => assertReaderBaseScores(Object.defineProperty({}, 'define', { value: 1 })));
  rejects(() => assertReaderBaseScores({ [Symbol('hidden')]: 1 }));
  assertReaderBaseScores(Object.assign(Object.create(null), { define: 0 }));
});

test('nested arrays reject holes, attached data, symbols and accessor entries', () => {
  let getterRuns = 0;
  for (const makeBad of [
    () => new Array(1),
    () => Object.assign([], { privateData: 'hidden' }),
    () => Object.assign([], { [Symbol('hidden')]: 1 }),
    () => Object.defineProperty(new Array(1), '0', { enumerable: true, get() { getterRuns++; return 'fiction'; } }),
  ]) {
    rejects(() => assertReaderOnboardingAnswer({ ...answer(0, []), selectedOptionIds: makeBad() }, questionnaire([1, 1, 1])));
    rejects(() => assertReaderContextProfile({ ...profile(), onboardingAnswers: makeBad() }, questionnaire([1, 1, 1]), null));
  }
  assert.equal(getterRuns, 0);
});

test('validation errors never echo private content, identity values or attacker-controlled keys', () => {
  const sentinel = 'PRIVATE-SENTINEL';
  for (const action of [
    () => assertReaderContextProfile({ ...profile(), [sentinel]: sentinel }, questionnaire([1, 1, 1]), null),
    () => assertReaderOnboardingAnswer({ ...answer(0, [sentinel]) }, questionnaire([1, 1, 1])),
    () => assertReaderArticleBackground({ ...background(), text: `${sentinel}\nnext` }),
    () => assertReaderBaseScores({ [sentinel]: sentinel }),
    () => assertReaderTunerManifest({ ...deck(), deckId: ` ${sentinel}` }),
  ]) assert.throws(action, error => error instanceof InvalidReaderContextError && !error.message.includes(sentinel));
});

test('rejected current records and manifests remain byte-for-byte unchanged', () => {
  const badProfile = { ...profile(), onboardingState: 'partial', onboardingAnswers: [answer(0, ['fiction', 'fiction'])] };
  const badDeck = deck(); badDeck.steps[0].options.pop();
  const beforeProfile = JSON.stringify(badProfile), beforeDeck = JSON.stringify(badDeck);
  rejects(() => assertReaderContextProfile(deepFreeze(badProfile), questionnaire([2, 1, 1]), null));
  rejects(() => assertReaderTunerManifest(deepFreeze(badDeck)));
  assert.equal(JSON.stringify(badProfile), beforeProfile); assert.equal(JSON.stringify(badDeck), beforeDeck);
});
