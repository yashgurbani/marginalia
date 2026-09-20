import type { Intent } from './reply.ts';

/** Inert D114 S1 contracts, with no production consumers. Assertions establish
 * shape/membership only: not host authority, freshness, asset authenticity,
 * idempotency, source continuity, permission or a right to send. Cardinality
 * policy and manifests must be supplied explicitly (within the 4/1/1 ceilings
 * ruled by Fable at 20:37); there is no production
 * default deck, selected answer, scheduling policy or text byte limit here.
 * D116 smart-question routes require separate contracts and consumers.
 */
export type ReaderNewlinePolicy = 'preserve' | 'lf';
export type ReaderResponseLength = 'short' | 'worked';
export type ReaderBaseScores = Partial<Record<Intent, number>>;
export type ReaderChoiceEffect =
  | { kind: 'base-scores'; scores: ReaderBaseScores }
  | { kind: 'response-length'; value: ReaderResponseLength };
export type ReaderTunerManifest = {
  schemaVersion: 2;
  deckId: string;
  deckDigest: string;
  scoringMappingVersion: string;
  steps: { stepId: string; options: { optionId: string; effect: ReaderChoiceEffect }[] }[];
};
export type ReaderTunerState = {
  schemaVersion: 2;
  deckId: string;
  deckDigest: string;
  scoringMappingVersion: string;
  tunerRevision: number;
  state: 'skipped' | 'partial' | 'complete';
  choices: { stepId: string; optionId: string }[];
  responseLength?: ReaderResponseLength;
};
export type ReaderOnboardingManifest = {
  schemaVersion: 2;
  questionnaireId: string;
  questionnaireVersion: number;
  questions: {
    questionId: string;
    questionVersion: number;
    optionIds: string[];
    maxSelections: number | null;
  }[];
};
export type ReaderOnboardingAnswer = {
  answerId: string;
  questionId: string;
  questionVersion: number;
  answerRevision: number;
  state: 'active' | 'deleted';
  selectedOptionIds: string[];
};
export type ReaderContextProfile = {
  schemaVersion: 2;
  profileId: string;
  profileRevision: number;
  availabilityEpoch: number;
  questionnaireId: string;
  questionnaireVersion: number;
  onboardingState: 'skipped' | 'partial' | 'complete';
  onboardingAnswers: ReaderOnboardingAnswer[];
  tuner: ReaderTunerState | null;
  updatedAt: number;
};
export type ReaderArticleBackground = {
  schemaVersion: 1;
  backgroundId: string;
  threadId: string;
  sourceId: string;
  sourceVersionId: string;
  revision: number;
  availabilityEpoch: number;
  newlinePolicy: ReaderNewlinePolicy;
  text: string | null;
};

const forms: readonly Intent[] = ['define', 'simulate', 'instantiate', 'derive', 'diagram', 'evidence', 'explore', 'unsure'];

// Schema membership constraints, not an installed manifest or cardinality rule.
const questionOptions: Readonly<Record<string, readonly string[]>> = {
  'mostly-read': ['papers-articles', 'news-essays', 'documentation', 'fiction'],
  'helps-first': ['example', 'simpler', 'definitions', 'big-picture'],
  'background-depth': ['answer-only', 'short-explanation', 'full-detail'],
};
// Exact reviewed semantics. No identity/assets, scoring consumer or aggregation
// is supplied. In particular onboarding answers never become these effects.
const tunerEffects: Readonly<Record<string, Readonly<Record<string, ReaderChoiceEffect>>>> = {
  'hard-sentence': {
    plain: { kind: 'base-scores', scores: { unsure: 2 } },
    define: { kind: 'base-scores', scores: { define: 2 } },
    example: { kind: 'base-scores', scores: { instantiate: 2 } },
  },
  'explanation-form': {
    steps: { kind: 'base-scores', scores: { derive: 2 } },
    picture: { kind: 'base-scores', scores: { diagram: 2 } },
    move: { kind: 'base-scores', scores: { simulate: 2 } },
  },
  'answer-length': {
    short: { kind: 'response-length', value: 'short' },
    worked: { kind: 'response-length', value: 'worked' },
  },
  'answer-scope': {
    inside: { kind: 'base-scores', scores: { define: 1, instantiate: 1 } },
    wider: { kind: 'base-scores', scores: { explore: 2 } },
  },
};

/** Errors contain static field paths, never supplied text, IDs or key names. */
export class InvalidReaderContextError extends Error {
  constructor(path: string) {
    super(`Invalid reader context at ${path}.`);
    this.name = 'InvalidReaderContextError';
  }
}
function requireValue(condition: unknown, path: string): asserts condition {
  if (!condition) throw new InvalidReaderContextError(path);
}
function record(value: unknown, required: readonly string[], path: string, optional: readonly string[] = []): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), path);
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null, path);
  const keys = Reflect.ownKeys(value);
  requireValue(keys.every(key => typeof key === 'string' && (required.includes(key) || optional.includes(key))), path);
  requireValue(required.every(key => keys.includes(key)), path);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor && 'value' in descriptor && descriptor.enumerable && descriptor.value !== undefined, `${path}.${key}`);
  }
  return value as Record<string, unknown>;
}
function list(value: unknown, path: string): unknown[] {
  requireValue(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, path);
  requireValue(Reflect.ownKeys(value).length === value.length + 1, path);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireValue(descriptor && 'value' in descriptor && descriptor.enumerable, `${path}[${index}]`);
  }
  return value;
}
function identity(value: unknown, path: string): asserts value is string {
  requireValue(typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value), path);
}
function positiveInteger(value: unknown, path: string): asserts value is number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, path);
}
function unique(seen: Set<string>, value: string, path: string): void {
  requireValue(!seen.has(value), path);
  seen.add(value);
}
function newlinePolicy(value: unknown, path: string): asserts value is ReaderNewlinePolicy {
  requireValue(value === 'preserve' || value === 'lf', path);
}
/** Explicit opt-in conversion only; no trimming, Unicode normalization or clipping. */
export function normalizeReaderText(text: string, policy: ReaderNewlinePolicy): string {
  requireValue(typeof text === 'string', 'text');
  newlinePolicy(policy, 'newlinePolicy');
  return policy === 'lf' ? text.replace(/\r\n?/g, '\n') : text;
}

/** Bounds only. No derivation, mapping provenance or eligibility decision. */
export function assertReaderBaseScores(value: unknown): asserts value is ReaderBaseScores {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'scores');
  const keys = Reflect.ownKeys(value);
  requireValue(keys.every(key => typeof key === 'string' && forms.includes(key as Intent)), 'scores');
  const input = record(value, keys as string[], 'scores');
  for (const key of keys as string[]) {
    const score = input[key];
    requireValue(typeof score === 'number' && Number.isFinite(score) && score >= -4 && score <= 4, `scores.${key}`);
  }
}
/** Missing entries are neutral; explicitly invalid/nonzero entries reject. */
export function assertNeutralReaderBaseScores(value: unknown): asserts value is ReaderBaseScores {
  assertReaderBaseScores(value);
  requireValue(Object.values(value).every(score => score === 0), 'scores');
}
function effect(value: unknown, expected: ReaderChoiceEffect, path: string): void {
  if (expected.kind === 'response-length') {
    const input = record(value, ['kind', 'value'], path);
    requireValue(input.kind === expected.kind && input.value === expected.value, path);
  } else {
    const input = record(value, ['kind', 'scores'], path);
    requireValue(input.kind === expected.kind, `${path}.kind`);
    assertReaderBaseScores(input.scores);
    const scores = input.scores;
    const keys = Object.keys(expected.scores) as Intent[];
    requireValue(Object.keys(scores).length === keys.length && keys.every(key => scores[key] === expected.scores[key]), `${path}.scores`);
  }
}

export function assertReaderTunerManifest(value: unknown): asserts value is ReaderTunerManifest {
  const input = record(value, ['schemaVersion', 'deckId', 'deckDigest', 'scoringMappingVersion', 'steps'], 'manifest');
  requireValue(input.schemaVersion === 2, 'manifest.schemaVersion');
  for (const key of ['deckId', 'deckDigest', 'scoringMappingVersion']) identity(input[key], `manifest.${key}`);
  const steps = list(input.steps, 'manifest.steps');
  requireValue(steps.length === 4, 'manifest.steps');
  const stepIds = new Set<string>();
  steps.forEach((value, index) => {
    const path = `manifest.steps[${index}]`;
    const step = record(value, ['stepId', 'options'], path);
    identity(step.stepId, `${path}.stepId`);
    requireValue(Object.hasOwn(tunerEffects, step.stepId), `${path}.stepId`);
    unique(stepIds, step.stepId, `${path}.stepId`);
    const expected = tunerEffects[step.stepId];
    const options = list(step.options, `${path}.options`);
    requireValue(options.length === Object.keys(expected).length, `${path}.options`);
    const optionIds = new Set<string>();
    options.forEach((value, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      const option = record(value, ['optionId', 'effect'], optionPath);
      identity(option.optionId, `${optionPath}.optionId`);
      requireValue(Object.hasOwn(expected, option.optionId), `${optionPath}.optionId`);
      unique(optionIds, option.optionId, `${optionPath}.optionId`);
      effect(option.effect, expected[option.optionId], `${optionPath}.effect`);
    });
  });
}

export function assertReaderTunerState(value: unknown, manifest: unknown): asserts value is ReaderTunerState {
  assertReaderTunerManifest(manifest);
  const input = record(value, ['schemaVersion', 'deckId', 'deckDigest', 'scoringMappingVersion', 'tunerRevision', 'state', 'choices'], 'tuner', ['responseLength']);
  requireValue(input.schemaVersion === 2, 'tuner.schemaVersion');
  for (const key of ['deckId', 'deckDigest', 'scoringMappingVersion'] as const) requireValue(input[key] === manifest[key], `tuner.${key}`);
  positiveInteger(input.tunerRevision, 'tuner.tunerRevision');
  const choices = list(input.choices, 'tuner.choices');
  requireValue(input.state === 'skipped' ? choices.length === 0
    : input.state === 'partial' ? choices.length >= 1 && choices.length <= 3
      : input.state === 'complete' && choices.length === 4, 'tuner.state');
  const stepIds = new Set<string>();
  let length: ReaderResponseLength | undefined;
  choices.forEach((value, index) => {
    const path = `tuner.choices[${index}]`;
    const choice = record(value, ['stepId', 'optionId'], path);
    identity(choice.stepId, `${path}.stepId`);
    identity(choice.optionId, `${path}.optionId`);
    unique(stepIds, choice.stepId, `${path}.stepId`);
    const option = manifest.steps.find(step => step.stepId === choice.stepId)?.options.find(option => option.optionId === choice.optionId);
    requireValue(option, path);
    if (option.effect.kind === 'response-length') length = option.effect.value;
  });
  requireValue(length === undefined ? !Object.hasOwn(input, 'responseLength') : input.responseLength === length, 'tuner.responseLength');
}

export function assertReaderOnboardingManifest(value: unknown): asserts value is ReaderOnboardingManifest {
  const input = record(value, ['schemaVersion', 'questionnaireId', 'questionnaireVersion', 'questions'], 'onboardingManifest');
  requireValue(input.schemaVersion === 2, 'onboardingManifest.schemaVersion');
  identity(input.questionnaireId, 'onboardingManifest.questionnaireId');
  positiveInteger(input.questionnaireVersion, 'onboardingManifest.questionnaireVersion');
  const questions = list(input.questions, 'onboardingManifest.questions');
  requireValue(questions.length === 3, 'onboardingManifest.questions');
  const questionIds = new Set<string>();
  questions.forEach((value, index) => {
    const path = `onboardingManifest.questions[${index}]`;
    const question = record(value, ['questionId', 'questionVersion', 'optionIds', 'maxSelections'], path);
    identity(question.questionId, `${path}.questionId`);
    requireValue(Object.hasOwn(questionOptions, question.questionId), `${path}.questionId`);
    unique(questionIds, question.questionId, `${path}.questionId`);
    positiveInteger(question.questionVersion, `${path}.questionVersion`);
    const expected = questionOptions[question.questionId];
    const options = list(question.optionIds, `${path}.optionIds`);
    requireValue(options.length === expected.length, `${path}.optionIds`);
    const optionIds = new Set<string>();
    options.forEach((option, optionIndex) => {
      const optionPath = `${path}.optionIds[${optionIndex}]`;
      identity(option, optionPath);
      requireValue(expected.includes(option), optionPath);
      unique(optionIds, option, optionPath);
    });
    const ceiling = question.questionId === 'mostly-read' ? 4 : 1;
    requireValue(question.maxSelections === null || (typeof question.maxSelections === 'number'
      && Number.isSafeInteger(question.maxSelections) && question.maxSelections >= 1 && question.maxSelections <= ceiling), `${path}.maxSelections`);
  });
}

export function assertReaderOnboardingAnswer(value: unknown, manifest: unknown): asserts value is ReaderOnboardingAnswer {
  assertReaderOnboardingManifest(manifest);
  const input = record(value, ['answerId', 'questionId', 'questionVersion', 'answerRevision', 'state', 'selectedOptionIds'], 'answer');
  identity(input.answerId, 'answer.answerId');
  identity(input.questionId, 'answer.questionId');
  positiveInteger(input.questionVersion, 'answer.questionVersion');
  positiveInteger(input.answerRevision, 'answer.answerRevision');
  const question = manifest.questions.find(question => question.questionId === input.questionId && question.questionVersion === input.questionVersion);
  requireValue(question, 'answer.questionId');
  const selections = list(input.selectedOptionIds, 'answer.selectedOptionIds');
  requireValue(input.state === 'deleted' ? selections.length === 0
    : input.state === 'active' && question.maxSelections !== null && selections.length >= 1 && selections.length <= question.maxSelections, 'answer.state');
  const seen = new Set<string>();
  selections.forEach((option, index) => {
    const path = `answer.selectedOptionIds[${index}]`;
    identity(option, path);
    requireValue(question.optionIds.includes(option), path);
    unique(seen, option, path);
  });
}

export function assertReaderContextProfile(value: unknown, onboardingManifest: unknown, tunerManifest: unknown): asserts value is ReaderContextProfile {
  assertReaderOnboardingManifest(onboardingManifest);
  const input = record(value, ['schemaVersion', 'profileId', 'profileRevision', 'availabilityEpoch', 'questionnaireId', 'questionnaireVersion', 'onboardingState', 'onboardingAnswers', 'tuner', 'updatedAt'], 'profile');
  requireValue(input.schemaVersion === 2, 'profile.schemaVersion');
  identity(input.profileId, 'profile.profileId');
  positiveInteger(input.profileRevision, 'profile.profileRevision');
  positiveInteger(input.availabilityEpoch, 'profile.availabilityEpoch');
  requireValue(input.questionnaireId === onboardingManifest.questionnaireId, 'profile.questionnaireId');
  requireValue(input.questionnaireVersion === onboardingManifest.questionnaireVersion, 'profile.questionnaireVersion');
  requireValue(typeof input.updatedAt === 'number' && Number.isSafeInteger(input.updatedAt) && input.updatedAt >= 0, 'profile.updatedAt');
  const answerIds = new Set<string>(), questionIds = new Set<string>();
  let active = 0;
  list(input.onboardingAnswers, 'profile.onboardingAnswers').forEach((answer, index) => {
    assertReaderOnboardingAnswer(answer, onboardingManifest);
    unique(answerIds, answer.answerId, `profile.onboardingAnswers[${index}].answerId`);
    // Only the manifest's exact version can pass, so one record per question
    // also excludes duplicate question/version pairs, including tombstones.
    unique(questionIds, answer.questionId, `profile.onboardingAnswers[${index}].questionId`);
    if (answer.state === 'active') active++;
  });
  requireValue(input.onboardingState === 'skipped' ? active === 0
    : input.onboardingState === 'partial' ? active >= 1 && active <= 2
      : input.onboardingState === 'complete' && active === 3, 'profile.onboardingState');
  if (input.tuner !== null) assertReaderTunerState(input.tuner, tunerManifest);
}

export function assertReaderArticleBackground(value: unknown): asserts value is ReaderArticleBackground {
  const input = record(value, ['schemaVersion', 'backgroundId', 'threadId', 'sourceId', 'sourceVersionId', 'revision', 'availabilityEpoch', 'newlinePolicy', 'text'], 'background');
  requireValue(input.schemaVersion === 1, 'background.schemaVersion');
  for (const key of ['backgroundId', 'threadId', 'sourceId', 'sourceVersionId']) identity(input[key], `background.${key}`);
  positiveInteger(input.revision, 'background.revision');
  positiveInteger(input.availabilityEpoch, 'background.availabilityEpoch');
  newlinePolicy(input.newlinePolicy, 'background.newlinePolicy');
  if (input.text !== null) {
    requireValue(typeof input.text === 'string', 'background.text');
    requireValue(!/[\r\n\u0085\u2028\u2029]/u.test(input.text), 'background.text');
  }
}
