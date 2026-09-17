import {
  canonicalReplyData,
  type CandidateReply,
  type ModelBlock,
  type ReplyParameterState,
  type SamplesBlock,
} from './reply.ts';

export const SAMPLE_GENERATION_SCHEMA = 'marginalia.samples-generation.v1' as const;

export type SampleGenerationOrigin = 'host-execution' | 'imported';

export type SampleBindingDigests = {
  replyDigest: string;
  computationDigest: string;
  inputDigest: string;
  sampleDataDigest: string;
};

/**
 * Host-owned evidence stored beside, never inside, candidate reply JSON.
 * Optional references may be set only when the host actually observed them.
 */
type SampleGenerationRecordBase = SampleBindingDigests & {
  schema: typeof SAMPLE_GENERATION_SCHEMA;
  blockId: string;
};

export type SampleGenerationRecord = SampleGenerationRecordBase & (
  | { origin: 'host-execution'; executionId: string; runtime?: string; solver?: string }
  | { origin: 'imported'; executionId?: never; runtime?: never; solver?: never }
);

export type SamplesInterpolationReadiness =
  | { ok: true; binding: SampleBindingDigests; block: SamplesBlock; parameters: ReplyParameterState }
  | { ok: false; state: 'historical' | 'mismatch' | 'invalid'; reason: string };

const sha256Pattern = /^[a-f0-9]{64}$/;

function unavailable(state: 'historical' | 'mismatch' | 'invalid', reason: string): SamplesInterpolationReadiness {
  return { ok: false, state, reason };
}

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Creates an owned immutable JSON snapshot before any asynchronous digest work begins. */
function immutableJsonSnapshot<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalReplyData(value)) as T);
}

function rejectLoneSurrogates(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${path} contains an unpaired Unicode surrogate.`);
        index++;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error(`${path} contains an unpaired Unicode surrogate.`);
    }
  } else if (Array.isArray(value)) value.forEach((item, index) => rejectLoneSurrogates(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    rejectLoneSurrogates(key, `${path} key`);
    rejectLoneSurrogates(item, `${path}.${key}`);
  }
}

async function sha256(domain: 'reply' | 'computation' | 'inputs' | 'samples', value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable in this renderer.');
  rejectLoneSurrogates(value);
  const bytes = new TextEncoder().encode(canonicalReplyData({ domain: `${SAMPLE_GENERATION_SCHEMA}/${domain}`, value }));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function resolveModel(reply: CandidateReply, block: SamplesBlock): ModelBlock {
  const matches = reply.blocks.filter((candidate): candidate is ModelBlock => candidate.id === block.model && candidate.type === 'model');
  if (matches.length !== 1) throw new Error('The samples block does not reference a unique model block.');
  return matches[0];
}

function resolveSamplesBlock(reply: CandidateReply, supplied: SamplesBlock): SamplesBlock {
  const matches = reply.blocks.filter((candidate): candidate is SamplesBlock => candidate.id === supplied.id && candidate.type === 'samples');
  if (matches.length !== 1) throw new Error('The samples block is not a unique member of this reply.');
  const resolved = matches[0];
  if (canonicalReplyData(resolved) !== canonicalReplyData(supplied)) throw new Error('The supplied samples block does not match the immutable reply member.');
  return resolved;
}

/**
 * Derives identity only. Matching digests bind data to this reply and model;
 * they do not establish that a solver was correct or even executed.
 */
export async function deriveSamplesBinding(reply: CandidateReply, block: SamplesBlock): Promise<SampleBindingDigests> {
  const replySnapshot = immutableJsonSnapshot(reply);
  const suppliedBlockSnapshot = immutableJsonSnapshot(block);
  const resolved = resolveSamplesBlock(replySnapshot, suppliedBlockSnapshot);
  const model = resolveModel(replySnapshot, resolved);
  if (!resolved.envelope.fixedInputs) throw new Error('The samples block has no recorded fixed generation inputs.');
  const fixedInputs = Object.fromEntries(Object.entries(resolved.envelope.fixedInputs).map(([name, value]) => [name, normalizeNumber(value)]));
  const axes = resolved.envelope.axes.map((axis) => ({ ...axis, min: normalizeNumber(axis.min), max: normalizeNumber(axis.max) }));
  const [replyDigest, computationDigest, inputDigest, sampleDataDigest] = await Promise.all([
    sha256('reply', replySnapshot),
    sha256('computation', { modelId: resolved.model, model }),
    sha256('inputs', {
      parameterDeclarations: replySnapshot.parameters,
      axes,
      fixedInputs,
      interpolation: resolved.envelope.interpolation,
      forbiddenRegions: resolved.envelope.forbiddenRegions,
    }),
    sha256('samples', resolved.samples),
  ]);
  return { replyDigest, computationDigest, inputDigest, sampleDataDigest };
}

function generationRecordError(record: SampleGenerationRecord): string | undefined {
  if (record.schema !== SAMPLE_GENERATION_SCHEMA) return 'The sample generation record has an unsupported schema.';
  if (!record.blockId) return 'The sample generation record has no block identity.';
  if (record.origin !== 'host-execution' && record.origin !== 'imported') return 'The sample generation record has an unsupported origin.';
  for (const field of ['replyDigest', 'computationDigest', 'inputDigest', 'sampleDataDigest'] as const) {
    if (!sha256Pattern.test(record[field])) return `The sample generation record has an invalid ${field}.`;
  }
  for (const field of ['executionId', 'runtime', 'solver'] as const) {
    const value = record[field];
    if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0 || value.length > 512)) return `The sample generation record has an invalid ${field}.`;
  }
  if (record.origin === 'imported' && (record.executionId !== undefined || record.runtime !== undefined || record.solver !== undefined)) return 'An imported sample record cannot carry host execution, runtime or solver claims.';
  if (record.origin === 'host-execution' && record.executionId === undefined) return 'A host-execution sample record requires an observed execution reference.';
  return undefined;
}

/**
 * Requires a complete v1 binding before interpolation. Persisted replies that
 * predate fixed inputs or host provenance remain readable but are historical
 * until a host explicitly regenerates their sample grid.
 */
export async function validateSamplesInterpolationReadiness(
  reply: CandidateReply,
  block: SamplesBlock,
  currentParameters: ReplyParameterState,
  generationRecord?: SampleGenerationRecord,
): Promise<SamplesInterpolationReadiness> {
  let replySnapshot: CandidateReply;
  let resolved: SamplesBlock;
  let parameterSnapshot: ReplyParameterState;
  let recordSnapshot: SampleGenerationRecord | undefined;
  try {
    replySnapshot = immutableJsonSnapshot(reply);
    const suppliedBlockSnapshot = immutableJsonSnapshot(block);
    parameterSnapshot = immutableJsonSnapshot(Object.fromEntries(Object.entries(currentParameters).map(([name, value]) => [name, normalizeNumber(value)])));
    recordSnapshot = generationRecord === undefined ? undefined : immutableJsonSnapshot(generationRecord);
    resolved = resolveSamplesBlock(replySnapshot, suppliedBlockSnapshot);
    resolveModel(replySnapshot, resolved);
  } catch (error) {
    return unavailable('invalid', error instanceof Error ? error.message : 'The sample readiness snapshot could not be created.');
  }
  const fixedInputs = resolved.envelope.fixedInputs;
  if (!fixedInputs) return unavailable('historical', 'This sample grid predates complete generation binding and must be regenerated before interpolation.');

  const declared = new Map(replySnapshot.parameters.map((parameter) => [parameter.name, parameter]));
  if (declared.size !== replySnapshot.parameters.length) return unavailable('invalid', 'The reply has ambiguous parameter identities.');
  const axisNames = resolved.envelope.axes.map((axis) => axis.name);
  if (new Set(axisNames).size !== axisNames.length) return unavailable('invalid', 'The sample grid has duplicate axes.');
  const fixedNames = Object.keys(fixedInputs);
  if (axisNames.some((name) => Object.hasOwn(fixedInputs, name))) return unavailable('invalid', 'Sample axes and fixed generation inputs must be disjoint.');
  if ([...axisNames, ...fixedNames].some((name) => !declared.has(name))) return unavailable('invalid', 'The sample grid refers to an undeclared input.');
  if (replySnapshot.parameters.some((parameter) => !axisNames.includes(parameter.name) && !Object.hasOwn(fixedInputs, parameter.name))) {
    return unavailable('historical', 'The sample grid does not record every generation input and must be regenerated before interpolation.');
  }

  for (const key of Object.keys(parameterSnapshot)) if (!declared.has(key)) return unavailable('invalid', `The current state contains unknown parameter ${key}.`);
  for (const parameter of replySnapshot.parameters) {
    const current = parameterSnapshot[parameter.name];
    if (!Number.isFinite(current) || current < parameter.min || current > parameter.max) return unavailable('invalid', `Parameter ${parameter.name} is not finite and inside its declared bounds.`);
  }
  for (const axis of resolved.envelope.axes) {
    const parameter = declared.get(axis.name)!;
    const current = parameterSnapshot[axis.name];
    if (!Number.isFinite(axis.min) || !Number.isFinite(axis.max) || axis.min < parameter.min || axis.max > parameter.max || axis.min >= axis.max) return unavailable('invalid', `Sample axis ${axis.name} is outside its declared parameter bounds.`);
    if (current < axis.min || current > axis.max) return unavailable('mismatch', `The current value for ${axis.name} is outside the generated grid; recomputation is required.`);
  }
  for (const [name, generated] of Object.entries(fixedInputs)) {
    const parameter = declared.get(name)!;
    const current = parameterSnapshot[name];
    if (!Number.isFinite(generated) || generated < parameter.min || generated > parameter.max) return unavailable('invalid', `Fixed generation input ${name} is not finite and inside its declared bounds.`);
    if (!Object.is(normalizeNumber(current), normalizeNumber(generated))) return unavailable('mismatch', `The current value for ${name} differs from the value used to generate this grid; recomputation is required.`);
  }

  if (!recordSnapshot) return unavailable('historical', 'No host-owned generation record is available for this sample grid; recomputation is required.');
  const recordError = generationRecordError(recordSnapshot);
  if (recordError) return unavailable('invalid', recordError);
  if (recordSnapshot.blockId !== resolved.id) return unavailable('mismatch', 'The sample generation record belongs to a different block.');

  let binding: SampleBindingDigests;
  try {
    binding = await deriveSamplesBinding(replySnapshot, resolved);
  } catch (error) {
    return unavailable('invalid', error instanceof Error ? error.message : 'The sample grid binding could not be derived.');
  }
  for (const field of ['replyDigest', 'computationDigest', 'inputDigest', 'sampleDataDigest'] as const) {
    if (recordSnapshot[field] !== binding[field]) return unavailable('mismatch', `The sample generation record does not match the current ${field}.`);
  }
  return { ok: true, binding, block: resolved, parameters: parameterSnapshot };
}
