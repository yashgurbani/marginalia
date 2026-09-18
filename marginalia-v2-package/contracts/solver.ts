import { createHash } from 'node:crypto';
import {
  canonicalReplyData,
  type CandidateReply,
  type ModelBlock,
  type ReplyBlock,
  type SolverBlock,
} from './reply.ts';
import { isDigest } from './digest.ts';

/**
 * Path 3 of the four computation paths: re-running a solver that a model already
 * wrote, with new inputs, in the isolated job environment, with no model turn.
 *
 * Nothing here executes anything. These are the request, output and provenance
 * shapes plus pure validators. `daemon/solver/**` owns execution.
 */
export const SOLVER_REQUEST_SCHEMA = 'marginalia.solver-recompute.v1' as const;
export const SOLVER_INPUT_SCHEMA = 'marginalia.solver-input.v1' as const;
export const SOLVER_OUTPUT_SCHEMA = 'marginalia.solver-output.v1' as const;
export const SOLVER_EXECUTION_SCHEMA = 'marginalia.solver-execution.v1' as const;
/** The two halves of the handshake a margin can actually speak. */
export const SOLVER_PLAN_REQUEST_SCHEMA = 'marginalia.solver-plan-request.v1' as const;
export const SOLVER_PLAN_SCHEMA = 'marginalia.solver-plan.v1' as const;
export const SOLVER_EXECUTE_SCHEMA = 'marginalia.solver-execute.v1' as const;

export const SOLVER_LIMITS = Object.freeze({
  minTimeoutMs: 1_000,
  maxTimeoutMs: 600_000,
  minOutputBytes: 1_024,
  maxOutputBytes: 4 * 1024 * 1024,
  maxInputs: 32,
  maxOutputBlocks: 16,
  maxSeriesRows: 20_000,
  maxSeriesColumns: 8,
  maxValueNames: 64,
  maxSolverBytes: 1024 * 1024,
});

const ID = /^[\w-]{1,100}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * The view-state key on the wire is a digest, never the renderer's own string.
 *
 * The renderer builds its key as `canonicalReplyData({ reply, parameters })`, which
 * contains the whole accepted reply and so can reach the reply limit of 256 KiB. A
 * bounded raw string on the wire would reject a legal large reply, and an unbounded
 * one would put a quarter of a megabyte of margin-supplied text into every plan,
 * every execute and every result. Both sides hash that canonical string instead and
 * compare 64 hex characters.
 *
 * `SOLVER_STATE_KEY_SCHEMA` names the exact pre-image, so a later change to the
 * renderer's canonical form is a version change rather than a silent mismatch.
 */
export const SOLVER_STATE_KEY_SCHEMA = 'marginalia.solver-state-key.v1' as const;

/**
 * The largest canonical string this adapter will hash: the reply limit of 256 KiB plus
 * room for the parameter map the renderer wraps around it. Anything larger cannot have
 * come from a validated reply.
 */
export const SOLVER_STATE_KEY_INPUT_MAX_BYTES = 256 * 1024 + 16 * 1024;

/**
 * The exact artifacts a recompute is pinned to. The host resolves these from the
 * original job attempt; a reply can never supply them.
 */
export type SolverArtifactBinding = {
  jobId: string;
  attemptId: string;
  /** Absolute host path of the original attempt workspace, already realpath-resolved. */
  workspace: string;
  /** Host-owned generation identity for that workspace; changes when the workspace is rebuilt. */
  workspaceGeneration: string;
  /** Safe relative path from the solver block, as validated by the reply contract. */
  solverRelativePath: string;
  /** Pinned SHA-256 of the solver file bytes observed when the job succeeded. */
  solverSha256: string;
  /** Absolute host-selected interpreter. Never taken from reply data. */
  runtimeExecutable: string;
  /** Present only when the host actually hashed the interpreter. */
  runtimeSha256?: string;
};

export type SolverLimits = {
  timeoutMs: number;
  /** Per-stream capture cap. The adapter applies it to stdout and stderr separately. */
  maxOutputBytes: number;
  /**
   * Declared only, and never enforceable today: Codex 0.153.4 `command/exec` has no
   * memory parameter. A request that declares one is refused rather than accepted
   * and silently ignored.
   */
  maxMemoryBytes?: number;
};

/**
 * Everything the host actually prepared for one execution attempt. The fingerprint
 * of this record is what authority binds to, and the host computes it from the
 * policy it prepared. No caller-supplied value takes part, so nothing a margin
 * sends can certify its own policy.
 */
export type SolverPolicyBinding = {
  policyVersion: string;
  codexVersion: string;
  platform: string;
  adapter: string;
  /** From the reviewed profile the policy module pinned for this platform. */
  profileManifestSha256: string;
  runtimeBackend: string;
  sandboxPolicy: unknown;
  command: readonly string[];
  cwd: string;
  timeoutMs: number;
  outputBytesCapPerStream: number;
  workspaceGeneration: string;
  solverSha256: string;
  runtimeSha256: string | null;
  inputDigest: string;
};

/** Pure. The one value that names the concrete policy a recompute would run under. */
export function solverPolicyFingerprint(binding: SolverPolicyBinding): string {
  return solverDigest('policy', {
    policyVersion: binding.policyVersion,
    codexVersion: binding.codexVersion,
    platform: binding.platform,
    adapter: binding.adapter,
    profileManifestSha256: binding.profileManifestSha256,
    runtimeBackend: binding.runtimeBackend,
    sandboxPolicy: binding.sandboxPolicy,
    command: [...binding.command],
    cwd: binding.cwd,
    timeoutMs: binding.timeoutMs,
    outputBytesCapPerStream: binding.outputBytesCapPerStream,
    workspaceGeneration: binding.workspaceGeneration,
    solverSha256: binding.solverSha256,
    runtimeSha256: binding.runtimeSha256,
    inputDigest: binding.inputDigest,
  });
}

/** An explicit reader action. It is never derived from a slider move or a page load. */
export type SolverRecomputeRequest = {
  schema: typeof SOLVER_REQUEST_SCHEMA;
  /** Stable request identity supplied by the margin; a repeat is the same request, not a new one. */
  requestId: string;
  replyVersionId: string;
  /** digestReply of the committed immutable reply. */
  replyHash: string;
  threadId: string;
  sourceVersionId: string;
  sourceHash: string;
  /** The block the reader acted on. Must be the solver block or one of its output blocks. */
  blockId: string;
  solverId: string;
  /**
   * Complete validated input tuple: every declared reply parameter, finite and in
   * bounds. Empty when the reply declares no parameters, which is how a fixed-input
   * solver such as a reproduce-figure recompute is asked for.
   */
  inputs: Readonly<Record<string, number>>;
  /** `solverStateKeyFrom` digest of the renderer state; late results for a superseded state are discarded. */
  stateKey: string;
  grantId: string;
  policyKey: string;
  limits: SolverLimits;
  requestedAt: string;
};

export type SolverBlockOutput =
  | { kind: 'values'; values: Readonly<Record<string, number>> }
  | { kind: 'series'; columns: readonly string[]; rows: readonly (readonly number[])[] };

/** What a saved solver prints on stdout. Untrusted until validated against the reply. */
export type SolverOutputDocument = {
  schema: typeof SOLVER_OUTPUT_SCHEMA;
  /** Echoed request identity. A solver that cannot echo it cannot be accepted. */
  requestId: string;
  outputs: Readonly<Record<string, SolverBlockOutput>>;
};

/**
 * Host-owned provenance for one real execution. Deliberately NOT a
 * SampleGenerationRecord: it never upgrades a recorded sample grid, and
 * `origin` is fixed so imported or model-authored data cannot assert host execution.
 */
export type SolverExecutionRecord = {
  schema: typeof SOLVER_EXECUTION_SCHEMA;
  origin: 'host-execution';
  executionId: string;
  /** Unique per dispatch attempt. Two attempts for one request identity never share it. */
  executionAttemptId: string;
  requestId: string;
  /** Canonical content identity. Two requests with this value asked the same question. */
  requestIdentity: string;
  replyVersionId: string;
  replyHash: string;
  solverId: string;
  solverSha256: string;
  runtimeExecutable: string;
  runtimeSha256?: string;
  workspace: string;
  workspaceGeneration: string;
  inputDigest: string;
  outputDigest: string;
  grantId: string;
  grantRevision: number;
  /**
   * The policy identity carried on the host request this record came from. The host
   * fills it from the plan it issued, and it is accepted only when it equals
   * `policyFingerprint`. It is no longer a wire field a margin can set.
   */
  policyKey: string;
  /** Host-computed from the policy that was actually prepared for this attempt. */
  policyFingerprint: string;
  /** The handoff the job store committed before dispatch. */
  handoffToken: string;
  /** Fresh evidence epoch from the audited policy for this attempt. */
  evidenceScope: string;
  permissionFingerprint: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: number;
  outputBytes: number;
  /** Truthful enforcement report. Absent enforcement is stated, not implied. */
  enforced: { timeout: boolean; outputBytes: boolean; memoryBytes: boolean };
  /** The generation lease the host committed before dispatch and held through the result. */
  generationLeaseId: string;
  /**
   * How strong the at-most-once promise actually is for this attempt.
   * `process-local` means only this process's bounded memory prevented a redispatch,
   * which does not survive eviction or restart. `durable-host-journal` means a durable
   * host attempt lookup answered first. Never write `durable-host-journal` without one.
   */
  atMostOnce: 'process-local' | 'durable-host-journal';
  /** True when stdout arrived as `command/exec/outputDelta` chunks rather than in the reply. */
  streamed: boolean;
  /** Structural invariant of path 3. */
  modelTurns: 0;
};

export type SolverResult = {
  requestId: string;
  stateKey: string;
  replyVersionId: string;
  outputs: Readonly<Record<string, SolverBlockOutput>>;
  record: SolverExecutionRecord;
};

export type SolverRejectionCode =
  | 'invalid-request'
  | 'unknown-reply'
  | 'unknown-solver'
  | 'reply-changed'
  | 'artifact-unknown'
  | 'artifact-modified'
  | 'path-unsafe'
  | 'inputs-invalid'
  | 'limits-invalid'
  | 'unsupported-capability'
  | 'authorization-refused'
  | 'authorization-expired'
  | 'policy-mismatch'
  | 'handoff-refused'
  | 'output-invalid'
  /** The echoed plan is unknown here, already spent, or was issued to another caller. */
  | 'plan-unknown'
  | 'plan-expired'
  /** A request id was reused for different content. */
  | 'request-identity-mismatch'
  /** The workspace generation or profile manifest moved after the host hashed the solver. */
  | 'generation-drift';

export type SolverUnavailableCode =
  | 'not-configured'
  | 'platform-unverified'
  | 'isolation-evidence-unavailable'
  | 'limit-enforcement-unavailable'
  | 'transport-unavailable';

export type SolverOutcome =
  | { status: 'succeeded'; origin: 'execution' | 'cache'; result: SolverResult }
  | { status: 'rejected'; code: SolverRejectionCode; reason: string }
  | { status: 'unavailable'; code: SolverUnavailableCode; reason: string; issues?: readonly string[] }
  | { status: 'failed'; reason: string; exitCode?: number }
  | { status: 'cancelled'; reason: string }
  | { status: 'outcome_unknown'; reason: string };

export function solverDigest(
  domain: 'inputs' | 'outputs' | 'cache-key' | 'policy' | 'request-identity',
  value: unknown,
): string {
  return createHash('sha256').update(canonicalReplyData({ domain: `${SOLVER_REQUEST_SCHEMA}/${domain}`, value })).digest('hex');
}

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/** Canonical, order-independent input identity. Used for binding and for cache keys. */
export function digestSolverInputs(inputs: Readonly<Record<string, number>>): string {
  const entries = Object.keys(inputs).sort().map((name) => [name, normalizeNumber(inputs[name])] as const);
  return solverDigest('inputs', entries);
}

export function digestSolverOutputs(outputs: Readonly<Record<string, SolverBlockOutput>>): string {
  return solverDigest('outputs', outputs);
}

/**
 * The normative definition of the wire view-state key.
 *
 * `canonical` is exactly what `canonicalReplyData({ reply, parameters })` returns in
 * the renderer. The digest is plain SHA-256 over the UTF-8 bytes of that string, with
 * no domain prefix, so a margin can compute the identical value with one call to
 * `crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))`, which the
 * renderer already relies on in `renderer/host-authority.ts`.
 *
 * The host cannot compute this value for a margin: it never receives the renderer's
 * canonical string. This function is the shared specification and the host-side test
 * oracle, not a substitute for the margin computing its own key.
 */
export function solverStateKeyFrom(canonical: string): string {
  if (typeof canonical !== 'string' || canonical.length === 0) {
    throw new TypeError('A view state key is computed from a non-empty canonical reply string.');
  }
  const bytes = Buffer.from(canonical, 'utf8');
  if (bytes.byteLength > SOLVER_STATE_KEY_INPUT_MAX_BYTES) {
    throw new RangeError('The canonical reply string is larger than any validated reply can produce.');
  }
  return createHash('sha256').update(bytes).digest('hex');
}

/** True for a well-formed wire view-state key. Any length of reply produces one. */
export function isSolverStateKey(value: unknown): value is string {
  return isDigest(value);
}

/**
 * Stale-result comparison. A result is for the view the reader is still looking at
 * only when the two keys are the same digest. Unequal or unreadable means stale, so a
 * late result is discarded rather than painted over a changed view.
 */
export function solverStateKeyMatches(resultKey: unknown, currentKey: unknown): boolean {
  return isSolverStateKey(resultKey) && isSolverStateKey(currentKey) && resultKey === currentKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export type SolverValidation<T> = { ok: true; value: T } | { ok: false; code: SolverRejectionCode; reason: string };

const reject = (code: SolverRejectionCode, reason: string): { ok: false; code: SolverRejectionCode; reason: string } =>
  ({ ok: false, code, reason });

export function validateSolverLimits(limits: unknown): SolverValidation<SolverLimits> {
  if (!isRecord(limits)) return reject('limits-invalid', 'Execution limits are required.');
  const timeoutMs = limits.timeoutMs;
  const maxOutputBytes = limits.maxOutputBytes;
  const maxMemoryBytes = limits.maxMemoryBytes;
  if (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs < SOLVER_LIMITS.minTimeoutMs || timeoutMs > SOLVER_LIMITS.maxTimeoutMs) {
    return reject('limits-invalid', `The time limit must be an integer from ${SOLVER_LIMITS.minTimeoutMs} through ${SOLVER_LIMITS.maxTimeoutMs} ms.`);
  }
  if (typeof maxOutputBytes !== 'number' || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < SOLVER_LIMITS.minOutputBytes || maxOutputBytes > SOLVER_LIMITS.maxOutputBytes) {
    return reject('limits-invalid', `The output limit must be an integer from ${SOLVER_LIMITS.minOutputBytes} through ${SOLVER_LIMITS.maxOutputBytes} bytes.`);
  }
  if (maxMemoryBytes !== undefined && (typeof maxMemoryBytes !== 'number' || !Number.isSafeInteger(maxMemoryBytes) || maxMemoryBytes <= 0)) {
    return reject('limits-invalid', 'A declared memory limit must be a positive whole number of bytes.');
  }
  return { ok: true, value: maxMemoryBytes === undefined ? { timeoutMs, maxOutputBytes } : { timeoutMs, maxOutputBytes, maxMemoryBytes } };
}

/** Structural request check only. Authority, artifacts and reply binding are checked separately. */
export function validateSolverRequest(request: unknown): SolverValidation<SolverRecomputeRequest> {
  if (!isRecord(request)) return reject('invalid-request', 'A recompute request object is required.');
  if (request.schema !== SOLVER_REQUEST_SCHEMA) return reject('invalid-request', 'The recompute request has an unsupported schema.');
  // Each loop fills every key of its record before the record is read.
  const ids = {} as Record<'requestId' | 'replyVersionId' | 'threadId' | 'sourceVersionId' | 'blockId' | 'solverId' | 'grantId', string>;
  for (const field of ['requestId', 'replyVersionId', 'threadId', 'sourceVersionId', 'blockId', 'solverId', 'grantId'] as const) {
    const value = request[field];
    if (typeof value !== 'string' || !ID.test(value)) return reject('invalid-request', `The recompute request has an invalid ${field}.`);
    ids[field] = value;
  }
  const hashes = {} as Record<'replyHash' | 'sourceHash' | 'policyKey', string>;
  for (const field of ['replyHash', 'sourceHash', 'policyKey'] as const) {
    const value = request[field];
    if (!isDigest(value)) return reject('invalid-request', `The recompute request has an invalid ${field}.`);
    hashes[field] = value;
  }
  if (!isSolverStateKey(request.stateKey)) {
    return reject('invalid-request', 'The recompute request has an invalid view state key.');
  }
  if (typeof request.requestedAt !== 'string' || Number.isNaN(Date.parse(request.requestedAt))) {
    return reject('invalid-request', 'The recompute request has an invalid timestamp.');
  }
  const limits = validateSolverLimits(request.limits);
  if (!limits.ok) return limits;
  if (!isRecord(request.inputs)) return reject('inputs-invalid', 'A complete input tuple is required.');
  const names = Object.keys(request.inputs);
  // An empty tuple is legal. The reply contract allows a solver block with no declared
  // inputs, and `resolveSolverBlock` still requires the tuple to match the reply's own
  // parameter list exactly, so an empty tuple is accepted only for a reply that
  // declares no parameters.
  if (names.length > SOLVER_LIMITS.maxInputs) return reject('inputs-invalid', 'The input tuple is larger than the declared limit.');
  const inputs: Record<string, number> = {};
  for (const name of names) {
    const value = request.inputs[name];
    if (!NAME.test(name)) return reject('inputs-invalid', `Input ${name} is not a declarable parameter name.`);
    if (typeof value !== 'number' || !Number.isFinite(value)) return reject('inputs-invalid', `Input ${name} must be a finite number.`);
    inputs[name] = normalizeNumber(value);
  }
  return { ok: true, value: {
    schema: SOLVER_REQUEST_SCHEMA,
    requestId: ids.requestId,
    replyVersionId: ids.replyVersionId,
    replyHash: hashes.replyHash,
    threadId: ids.threadId,
    sourceVersionId: ids.sourceVersionId,
    sourceHash: hashes.sourceHash,
    blockId: ids.blockId,
    solverId: ids.solverId,
    inputs: Object.freeze(inputs),
    stateKey: request.stateKey,
    grantId: ids.grantId,
    policyKey: hashes.policyKey,
    limits: limits.value,
    requestedAt: request.requestedAt,
  } };
}

/** Resolves the unique solver block and checks the request against the immutable reply. */
export function resolveSolverBlock(reply: CandidateReply, request: SolverRecomputeRequest): SolverValidation<SolverBlock> {
  const matches = reply.blocks.filter((block): block is SolverBlock => block.type === 'solver' && block.id === request.solverId);
  if (matches.length !== 1) return reject('unknown-solver', 'This reply does not contain exactly one solver block with that identity.');
  const solver = matches[0];
  if (request.blockId !== solver.id && !solver.outputBlocks.includes(request.blockId)) {
    return reject('unknown-solver', 'The requested block is neither the solver block nor one of its declared output blocks.');
  }
  if (solver.outputBlocks.length === 0 || solver.outputBlocks.length > SOLVER_LIMITS.maxOutputBlocks) {
    return reject('unsupported-capability', 'The solver declares no output blocks, or more than this version accepts.');
  }
  if (new Set(solver.outputBlocks).size !== solver.outputBlocks.length) {
    return reject('unknown-solver', 'The solver declares a duplicate output block.');
  }
  // A solver with no declared inputs is legal: contracts/reply.ts validates inputNames
  // with a minimum of zero, and the spec's reproduce-figure case is exactly that. A
  // duplicate is still a broken declaration.
  if (new Set(solver.inputNames).size !== solver.inputNames.length) {
    return reject('unknown-solver', 'The solver declares a duplicate input.');
  }
  const declared = new Map(reply.parameters.map((parameter) => [parameter.name, parameter]));
  if (declared.size !== reply.parameters.length) return reject('unknown-reply', 'The reply has ambiguous parameter identities.');
  for (const name of solver.inputNames) {
    if (!declared.has(name)) return reject('unknown-solver', `The solver requires undeclared input ${name}.`);
  }
  // The complete declared tuple must be supplied: a partial tuple would let an
  // omitted parameter silently take a solver-chosen default.
  if (Object.keys(request.inputs).length !== reply.parameters.length) {
    return reject('inputs-invalid', 'Every declared reply parameter must be supplied for a recompute.');
  }
  for (const parameter of reply.parameters) {
    const value = request.inputs[parameter.name];
    if (value === undefined) return reject('inputs-invalid', `Input ${parameter.name} is missing.`);
    if (value < parameter.min || value > parameter.max) return reject('inputs-invalid', `Input ${parameter.name} is outside its declared bounds.`);
  }
  return { ok: true, value: solver };
}

function expectedSeriesColumns(block: ModelBlock): string[] {
  // Independently derived from the model contract, not from any kernel result.
  return [block.kind === 'map' ? 'n' : 't', ...block.state];
}

function validateValues(names: readonly string[], output: SolverBlockOutput, blockId: string): SolverValidation<SolverBlockOutput> {
  if (output.kind !== 'values') return reject('output-invalid', `Block ${blockId} requires named values, not a series.`);
  if (!isRecord(output.values)) return reject('output-invalid', `Block ${blockId} returned no values object.`);
  const supplied = Object.keys(output.values);
  if (supplied.length !== names.length || names.some((name) => !Object.hasOwn(output.values, name))) {
    return reject('output-invalid', `Block ${blockId} requires exactly the declared quantities ${names.join(', ')}.`);
  }
  const values: Record<string, number> = {};
  for (const name of supplied) {
    const value = output.values[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) return reject('output-invalid', `Block ${blockId} returned a non-finite value for ${name}.`);
    values[name] = normalizeNumber(value);
  }
  return { ok: true, value: { kind: 'values', values: Object.freeze(values) } };
}

function validateSeries(columns: readonly string[], output: SolverBlockOutput, blockId: string): SolverValidation<SolverBlockOutput> {
  if (output.kind !== 'series') return reject('output-invalid', `Block ${blockId} requires a series, not named values.`);
  if (columns.length > SOLVER_LIMITS.maxSeriesColumns) return reject('unsupported-capability', `Block ${blockId} declares more columns than this version accepts.`);
  if (!Array.isArray(output.columns) || output.columns.length !== columns.length || columns.some((name, index) => output.columns[index] !== name)) {
    return reject('output-invalid', `Block ${blockId} requires exactly the columns ${columns.join(', ')} in that order.`);
  }
  if (!Array.isArray(output.rows) || output.rows.length === 0 || output.rows.length > SOLVER_LIMITS.maxSeriesRows) {
    return reject('output-invalid', `Block ${blockId} returned no rows, or more than ${SOLVER_LIMITS.maxSeriesRows}.`);
  }
  const rows: number[][] = [];
  for (const [index, row] of output.rows.entries()) {
    if (!Array.isArray(row) || row.length !== columns.length) return reject('output-invalid', `Block ${blockId} row ${index} does not match its columns.`);
    const cells: number[] = [];
    for (const cell of row) {
      if (typeof cell !== 'number' || !Number.isFinite(cell)) return reject('output-invalid', `Block ${blockId} row ${index} contains a non-finite value.`);
      cells.push(normalizeNumber(cell));
    }
    rows.push(cells);
  }
  return { ok: true, value: { kind: 'series', columns: [...columns], rows } };
}

function sampleValueNames(block: Extract<ReplyBlock, { type: 'samples' }>): string[] {
  return [...new Set(block.samples.flatMap((sample) => Object.keys(sample.values)))].sort();
}

/**
 * Validates untrusted solver stdout against the reply's declared output model.
 * A solver may not invent blocks, rename quantities, or answer a different request.
 */
export function validateSolverOutput(
  reply: CandidateReply,
  solver: SolverBlock,
  request: SolverRecomputeRequest,
  document: unknown,
): SolverValidation<Readonly<Record<string, SolverBlockOutput>>> {
  if (!isRecord(document)) return reject('output-invalid', 'The solver did not return a JSON object.');
  if (document.schema !== SOLVER_OUTPUT_SCHEMA) return reject('output-invalid', 'The solver output has an unsupported schema.');
  if (document.requestId !== request.requestId) return reject('output-invalid', 'The solver output answers a different request.');
  const outputs = document.outputs;
  if (!isRecord(outputs)) return reject('output-invalid', 'The solver output has no outputs object.');
  const supplied = Object.keys(outputs);
  if (supplied.length !== solver.outputBlocks.length || solver.outputBlocks.some((id) => !Object.hasOwn(outputs, id))) {
    return reject('output-invalid', 'The solver output must cover exactly its declared output blocks.');
  }
  const accepted: Record<string, SolverBlockOutput> = {};
  for (const blockId of solver.outputBlocks) {
    const raw = outputs[blockId];
    if (!isRecord(raw) || (raw.kind !== 'values' && raw.kind !== 'series')) {
      return reject('output-invalid', `Block ${blockId} has an unsupported output shape.`);
    }
    const blocks = reply.blocks.filter((block) => block.id === blockId);
    if (blocks.length !== 1) return reject('output-invalid', `Block ${blockId} is not a unique member of this reply.`);
    const target = blocks[0];
    const output = raw as unknown as SolverBlockOutput;
    let checked: SolverValidation<SolverBlockOutput>;
    if (target.type === 'samples') {
      const names = sampleValueNames(target);
      if (names.length === 0 || names.length > SOLVER_LIMITS.maxValueNames) return reject('output-invalid', `Block ${blockId} records no reusable quantity names.`);
      checked = validateValues(names, output, blockId);
    } else if (target.type === 'derived') {
      checked = validateValues([target.name], output, blockId);
    } else if (target.type === 'model') {
      checked = validateSeries(expectedSeriesColumns(target), output, blockId);
    } else if (target.type === 'table') {
      checked = validateSeries(target.columns.map((column) => column.key), output, blockId);
    } else {
      return reject('unsupported-capability', `This version cannot accept recomputed output for a ${target.type} block.`);
    }
    if (!checked.ok) return checked;
    accepted[blockId] = checked.value;
  }
  return { ok: true, value: Object.freeze(accepted) };
}

/**
 * Cache identity. It binds the exact artifacts, complete inputs and the host-computed
 * policy fingerprint. It deliberately excludes request identity, timestamps and the
 * fresh evidence epoch, so a hit is reusable; current authorization is still re-checked
 * at every hit. `request.policyKey` is not part of the key: even though the host now
 * fills it rather than the margin, the key must depend on the policy that was actually
 * prepared, never on a value copied along beside it.
 */
export function solverCacheKey(
  binding: SolverArtifactBinding,
  request: SolverRecomputeRequest,
  policyFingerprint: string,
): string {
  return solverDigest('cache-key', {
    replyVersionId: request.replyVersionId,
    replyHash: request.replyHash,
    solverId: request.solverId,
    solverSha256: binding.solverSha256,
    solverRelativePath: binding.solverRelativePath,
    runtimeExecutable: binding.runtimeExecutable,
    runtimeSha256: binding.runtimeSha256 ?? null,
    workspace: binding.workspace,
    workspaceGeneration: binding.workspaceGeneration,
    inputDigest: digestSolverInputs(request.inputs),
    policyFingerprint,
    limits: request.limits,
  });
}

/**
 * Canonical content identity of a recompute, independent of who asked or when.
 *
 * Idempotency binds to this value, not to `requestId`. A margin that reuses a
 * request id for different inputs, a different reply, a different grant or a
 * different renderer state produces a different identity, and the service refuses
 * the reuse instead of silently returning the earlier answer.
 */
export type SolverIdentityFields = Pick<
  SolverRecomputeRequest,
  'replyVersionId' | 'replyHash' | 'threadId' | 'sourceVersionId' | 'sourceHash' |
  'blockId' | 'solverId' | 'inputs' | 'stateKey' | 'grantId' | 'limits'
>;

export function solverRequestIdentity(
  fields: SolverIdentityFields,
  binding: Pick<SolverArtifactBinding, 'workspaceGeneration' | 'solverSha256' | 'runtimeSha256'>,
): string {
  return solverDigest('request-identity', {
    replyVersionId: fields.replyVersionId,
    replyHash: fields.replyHash,
    threadId: fields.threadId,
    sourceVersionId: fields.sourceVersionId,
    sourceHash: fields.sourceHash,
    blockId: fields.blockId,
    solverId: fields.solverId,
    inputDigest: digestSolverInputs(fields.inputs),
    stateKey: fields.stateKey,
    grantId: fields.grantId,
    workspaceGeneration: binding.workspaceGeneration,
    solverSha256: binding.solverSha256,
    runtimeSha256: binding.runtimeSha256 ?? null,
    limits: fields.limits,
  });
}

/**
 * Host-resolved caller identity.
 *
 * The daemon derives this from the paired session that carried the HTTP request.
 * It is never read out of a request body, so a margin cannot name itself. Knowing
 * a requestId or a planId is therefore not enough to read a result.
 */
export type SolverPrincipal = {
  siteOrigin: string;
  threadId: string;
  sessionId: string;
};

export function sameSolverPrincipal(left: SolverPrincipal, right: SolverPrincipal): boolean {
  return left.siteOrigin === right.siteOrigin && left.threadId === right.threadId && left.sessionId === right.sessionId;
}

/**
 * Step 1 of the handshake: everything a margin can honestly know.
 *
 * There is no replyHash, sourceHash, grantId or policyKey here. Those are
 * host-private, and requiring the browser to send them was the reason no real
 * margin could construct a valid request.
 */
export type SolverPlanRequest = {
  schema: typeof SOLVER_PLAN_REQUEST_SCHEMA;
  replyVersionId: string;
  blockId: string;
  solverId: string;
  inputs: Readonly<Record<string, number>>;
  /** Renderer state key for this tab. Two tabs of one thread hold different keys. */
  stateKey: string;
};

/**
 * Step 2: the host answer. `planToken` is opaque, single-use and meaningless to
 * the margin; the margin echoes it and nothing else. It is not a bearer authority.
 * Executing a plan re-resolves the reply, the artifacts, the policy and current
 * authority from scratch, and refuses the plan if any of them moved.
 *
 * Preparing a plan starts no process and consumes no grant.
 */
export type SolverPlan = {
  schema: typeof SOLVER_PLAN_SCHEMA;
  planId: string;
  planToken: string;
  /** Host-decided, not negotiable by the margin. Shown so the reader knows the ceiling. */
  limits: SolverLimits;
  expiresAt: string;
  /** The structural promise of path 3, stated before the reader clicks. */
  modelTurns: 0;
  replyVersionId: string;
  blockId: string;
  solverId: string;
};

/** Step 3: the explicit click. Content is echoed so a plan cannot execute a different question. */
export type SolverExecuteRequest = {
  schema: typeof SOLVER_EXECUTE_SCHEMA;
  requestId: string;
  planId: string;
  planToken: string;
  replyVersionId: string;
  blockId: string;
  solverId: string;
  inputs: Readonly<Record<string, number>>;
  stateKey: string;
  requestedAt: string;
};

export type SolverPlanOutcome =
  | { status: 'planned'; plan: SolverPlan }
  | { status: 'rejected'; code: SolverRejectionCode; reason: string }
  | { status: 'unavailable'; code: SolverUnavailableCode; reason: string; issues?: readonly string[] };

function validateInputTuple(value: unknown): SolverValidation<Record<string, number>> {
  if (!isRecord(value)) return reject('inputs-invalid', 'A complete input tuple is required.');
  const names = Object.keys(value);
  // Empty is legal here for the same reason as in the recompute request: a fixed-input
  // solver on a reply with no parameters asks for exactly this.
  if (names.length > SOLVER_LIMITS.maxInputs) {
    return reject('inputs-invalid', 'The input tuple is larger than the declared limit.');
  }
  const inputs: Record<string, number> = {};
  for (const name of names) {
    const entry = value[name];
    if (!NAME.test(name)) return reject('inputs-invalid', `Input ${name} is not a declarable parameter name.`);
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return reject('inputs-invalid', `Input ${name} must be a finite number.`);
    inputs[name] = normalizeNumber(entry);
  }
  return { ok: true, value: inputs };
}

export function validateSolverPlanRequest(request: unknown): SolverValidation<SolverPlanRequest> {
  if (!isRecord(request)) return reject('invalid-request', 'A plan request object is required.');
  if (request.schema !== SOLVER_PLAN_REQUEST_SCHEMA) return reject('invalid-request', 'The plan request has an unsupported schema.');
  const ids = {} as Record<'replyVersionId' | 'blockId' | 'solverId', string>;
  for (const field of ['replyVersionId', 'blockId', 'solverId'] as const) {
    const value = request[field];
    if (typeof value !== 'string' || !ID.test(value)) return reject('invalid-request', `The plan request has an invalid ${field}.`);
    ids[field] = value;
  }
  if (!isSolverStateKey(request.stateKey)) return reject('invalid-request', 'The plan request has an invalid view state key.');
  const inputs = validateInputTuple(request.inputs);
  if (!inputs.ok) return inputs;
  return { ok: true, value: {
    schema: SOLVER_PLAN_REQUEST_SCHEMA,
    replyVersionId: ids.replyVersionId,
    blockId: ids.blockId,
    solverId: ids.solverId,
    inputs: Object.freeze(inputs.value),
    stateKey: request.stateKey,
  } };
}

export function validateSolverExecuteRequest(request: unknown): SolverValidation<SolverExecuteRequest> {
  if (!isRecord(request)) return reject('invalid-request', 'An execute request object is required.');
  if (request.schema !== SOLVER_EXECUTE_SCHEMA) return reject('invalid-request', 'The execute request has an unsupported schema.');
  const ids = {} as Record<'requestId' | 'planId' | 'replyVersionId' | 'blockId' | 'solverId', string>;
  for (const field of ['requestId', 'planId', 'replyVersionId', 'blockId', 'solverId'] as const) {
    const value = request[field];
    if (typeof value !== 'string' || !ID.test(value)) return reject('invalid-request', `The execute request has an invalid ${field}.`);
    ids[field] = value;
  }
  if (!isDigest(request.planToken)) {
    return reject('invalid-request', 'The execute request has an invalid plan token.');
  }
  if (!isSolverStateKey(request.stateKey)) return reject('invalid-request', 'The execute request has an invalid view state key.');
  if (typeof request.requestedAt !== 'string' || Number.isNaN(Date.parse(request.requestedAt))) {
    return reject('invalid-request', 'The execute request has an invalid timestamp.');
  }
  const inputs = validateInputTuple(request.inputs);
  if (!inputs.ok) return inputs;
  return { ok: true, value: {
    schema: SOLVER_EXECUTE_SCHEMA,
    requestId: ids.requestId,
    planId: ids.planId,
    planToken: request.planToken,
    replyVersionId: ids.replyVersionId,
    blockId: ids.blockId,
    solverId: ids.solverId,
    inputs: Object.freeze(inputs.value),
    stateKey: request.stateKey,
    requestedAt: request.requestedAt,
  } };
}
