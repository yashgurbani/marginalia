import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOLVER_EXECUTE_SCHEMA,
  SOLVER_LIMITS,
  SOLVER_OUTPUT_SCHEMA,
  SOLVER_PLAN_REQUEST_SCHEMA,
  SOLVER_REQUEST_SCHEMA,
  SOLVER_STATE_KEY_INPUT_MAX_BYTES,
  digestSolverInputs,
  digestSolverOutputs,
  isSolverStateKey,
  resolveSolverBlock,
  sameSolverPrincipal,
  solverCacheKey,
  solverPolicyFingerprint,
  solverRequestIdentity,
  solverStateKeyFrom,
  solverStateKeyMatches,
  validateSolverExecuteRequest,
  validateSolverLimits,
  validateSolverOutput,
  validateSolverPlanRequest,
  validateSolverRequest,
  type SolverArtifactBinding,
  type SolverIdentityFields,
  type SolverPolicyBinding,
  type SolverPrincipal,
  type SolverRecomputeRequest,
} from '../contracts/solver.ts';
import { REPLY_LIMITS, REPLY_SCHEMA, type CandidateReply } from '../contracts/reply.ts';

// Independent fixtures. Expected column names and value names below are written
// from the reply contract and kernel/integrate.ts, not read back from a result.

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

// View-state keys as a margin computes them: the digest of the renderer's canonical
// string, so a 256 KiB reply produces a key the same size as a one-line reply.
const STATE_1 = solverStateKeyFrom('{"parameters":{"T0":95,"k":0.2},"reply":{"id":"reply-1"}}');
const STATE_2 = solverStateKeyFrom('{"parameters":{"T0":21,"k":0.2},"reply":{"id":"reply-1"}}');
const STATE_9 = solverStateKeyFrom('{"parameters":{"T0":95,"k":0.9},"reply":{"id":"reply-1"}}');

function reply(): CandidateReply {
  return {
    schema: REPLY_SCHEMA,
    intent: 'simulate',
    status: 'complete',
    title: 'Cooling coffee',
    summary: 'How the cup approaches room temperature.',
    sourceBindings: [],
    parameters: [
      { name: 'k', label: 'Cooling rate', default: 0.1, min: 0.01, max: 1, unit: '1/min' },
      { name: 'T0', label: 'Initial temperature', default: 90, min: 40, max: 100, unit: 'C' },
    ],
    assumptions: [],
    limitations: [],
    requiredCapabilities: ['solver'],
    blocks: [
      { id: 'model-1', type: 'model', kind: 'ode', state: ['T'], rhs: { T: '-k*(T-20)' }, initial: { T: 'T0' },
        horizon: 30, method: 'rk4', maxSteps: 2000 },
      { id: 'derived-1', type: 'derived', name: 'halfLife', expression: 'ln(2)/k', unit: 'min', label: 'Half life' },
      { id: 'solver-1', type: 'solver', path: 'solver/main.py', inputNames: ['k', 'T0'], outputBlocks: ['model-1', 'derived-1'] },
    ],
    checks: [],
    staticFallback: 'The cup cools toward room temperature.',
  };
}

function request(overrides: Partial<SolverRecomputeRequest> = {}): SolverRecomputeRequest {
  return {
    schema: SOLVER_REQUEST_SCHEMA,
    requestId: 'req-1',
    replyVersionId: 'reply-1',
    replyHash: HASH_A,
    threadId: 'thread-1',
    sourceVersionId: 'source-1',
    sourceHash: HASH_B,
    blockId: 'model-1',
    solverId: 'solver-1',
    inputs: { k: 0.2, T0: 95 },
    stateKey: STATE_1,
    grantId: 'grant-1',
    policyKey: HASH_C,
    limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 },
    requestedAt: '2026-09-17T10:00:00.000Z',
    ...overrides,
  };
}

test('a well formed recompute request validates and is normalized', () => {
  const result = validateSolverRequest({ ...request(), inputs: { T0: 95, k: -0 } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.requestId, 'req-1');
  assert.equal(result.value.replyHash, HASH_A);
  assert.equal(result.value.policyKey, HASH_C);
  // -0 is stored as 0 so two readers who typed the same number bind the same identity.
  assert.equal(Object.is(result.value.inputs.k, 0), true);
});

test('a request missing structural identity is rejected, never repaired', () => {
  const cases: [string, unknown][] = [
    ['not an object', 'recompute please'],
    ['wrong schema', { ...request(), schema: 'marginalia.solver-recompute.v2' }],
    ['unsafe request id', { ...request(), requestId: '../../etc' }],
    ['non hash reply digest', { ...request(), replyHash: 'not-a-hash' }],
    ['non finite input', { ...request(), inputs: { k: Number.POSITIVE_INFINITY, T0: 95 } }],
    ['too many inputs', { ...request(), inputs: Object.fromEntries(Array.from({ length: SOLVER_LIMITS.maxInputs + 1 }, (_, index) => [`p${index}`, 1])) }],
    ['unparseable timestamp', { ...request(), requestedAt: 'yesterday' }],
    ['raw renderer state key instead of its digest', { ...request(), stateKey: '{"parameters":{},"reply":{}}' }],
    ['uppercase state key digest', { ...request(), stateKey: STATE_1.toUpperCase() }],
  ];
  for (const [name, value] of cases) {
    const result = validateSolverRequest(value);
    assert.equal(result.ok, false, `${name} should be rejected`);
  }
});

test('limits outside the declared window are rejected with limits-invalid', () => {
  assert.equal(validateSolverLimits({ timeoutMs: 5_000, maxOutputBytes: 65_536 }).ok, true);
  for (const limits of [
    { timeoutMs: SOLVER_LIMITS.minTimeoutMs - 1, maxOutputBytes: 65_536 },
    { timeoutMs: SOLVER_LIMITS.maxTimeoutMs + 1, maxOutputBytes: 65_536 },
    { timeoutMs: 5_000.5, maxOutputBytes: 65_536 },
    { timeoutMs: 5_000, maxOutputBytes: SOLVER_LIMITS.minOutputBytes - 1 },
    { timeoutMs: 5_000, maxOutputBytes: SOLVER_LIMITS.maxOutputBytes + 1 },
    { timeoutMs: 5_000, maxOutputBytes: 65_536, maxMemoryBytes: 0 },
  ]) {
    const result = validateSolverLimits(limits);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'limits-invalid');
  }
});

test('a declared memory limit survives validation so the service can refuse it honestly', () => {
  const result = validateSolverLimits({ timeoutMs: 5_000, maxOutputBytes: 65_536, maxMemoryBytes: 256 * 1024 * 1024 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.maxMemoryBytes, 256 * 1024 * 1024);
});

test('the solver block resolves when the request names the solver or one of its outputs', () => {
  for (const blockId of ['solver-1', 'model-1', 'derived-1']) {
    const result = resolveSolverBlock(reply(), request({ blockId }));
    assert.equal(result.ok, true, `${blockId} should resolve`);
    if (result.ok) assert.equal(result.value.path, 'solver/main.py');
  }
});

test('the largest legal reply still produces a wire state key, and it is a digest', () => {
  // The producer is renderer/index.ts: stateKey = canonicalReplyData({ reply, parameters }),
  // which carries the whole accepted reply and so runs to REPLY_LIMITS.bytes, 256 KiB.
  // A wire field bounded at REPLY_LIMITS.string, 16 384, would reject that legal reply.
  const canonical = `{"parameters":{"k":0.2},"reply":{"summary":"${'s'.repeat(256 * 1024)}"}}`;
  assert.equal(canonical.length > REPLY_LIMITS.string, true, 'the fixture must exceed the old raw-key bound');
  const key = solverStateKeyFrom(canonical);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(validateSolverRequest(request({ stateKey: key })).ok, true, 'a large legal reply must still be recomputable');

  // Independent expected value: the published SHA-256 of "abc" from FIPS 180-4,
  // not a value read back from this module.
  assert.equal(solverStateKeyFrom('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(solverStateKeyFrom(canonical), solverStateKeyFrom(canonical), 'the digest is stable');
  assert.notEqual(solverStateKeyFrom(`${canonical} `), key);
  assert.throws(() => solverStateKeyFrom(''), TypeError);
  assert.throws(() => solverStateKeyFrom('x'.repeat(SOLVER_STATE_KEY_INPUT_MAX_BYTES + 1)), RangeError);
});

test('stale results are compared digest to digest, and anything unreadable is stale', () => {
  assert.equal(solverStateKeyMatches(STATE_1, STATE_1), true);
  assert.equal(solverStateKeyMatches(STATE_1, STATE_2), false, 'a moved slider is a different view');
  for (const bad of [undefined, null, '', 'state-1', STATE_1.toUpperCase(), `${STATE_1}0`]) {
    assert.equal(solverStateKeyMatches(bad, STATE_1), false);
    assert.equal(solverStateKeyMatches(STATE_1, bad), false);
  }
  assert.equal(isSolverStateKey(STATE_1), true);
  assert.equal(isSolverStateKey('state-1'), false);
});

test('a fixed-input solver on a reply with no parameters is legal, not a rejected request', () => {
  // SPEC-FINAL.md names a reproduce-figure as a path 3 case, and contracts/reply.ts
  // validates inputNames with a minimum of zero. A recompute that takes no inputs
  // must therefore reach execution rather than being refused by this contract.
  const fixed = reply();
  fixed.parameters = [];
  fixed.blocks = [
    { id: 'derived-1', type: 'derived', name: 'halfLife', expression: '2', unit: 'min', label: 'Half life' },
    { id: 'solver-1', type: 'solver', path: 'solver/figure.py', inputNames: [], outputBlocks: ['derived-1'] },
  ];
  const fixedRequest = request({ blockId: 'derived-1', inputs: {} });
  assert.equal(validateSolverRequest(fixedRequest).ok, true, 'an empty tuple is a legal wire request');
  assert.equal(validateSolverPlanRequest(planRequest({ inputs: {} })).ok, true);
  assert.equal(validateSolverExecuteRequest(executeRequest({ inputs: {} })).ok, true);

  const resolved = resolveSolverBlock(fixed, fixedRequest);
  assert.equal(resolved.ok, true, 'a solver with no declared inputs must resolve');
  if (resolved.ok) assert.equal(resolved.value.path, 'solver/figure.py');

  // The tuple must still match the reply exactly: this reply declares no parameters,
  // so supplying one is still wrong.
  const extra = resolveSolverBlock(fixed, request({ blockId: 'derived-1', inputs: { k: 0.2 } }));
  assert.equal(extra.ok, false);
  if (!extra.ok) assert.equal(extra.code, 'inputs-invalid');

  // And a reply that does declare parameters still requires the complete tuple.
  assert.equal(resolveSolverBlock(reply(), request({ inputs: {} })).ok, false);
});

test('a partial input tuple is refused so no parameter silently takes a solver default', () => {
  const result = resolveSolverBlock(reply(), request({ inputs: { k: 0.2 } }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'inputs-invalid');
});

test('an input outside its declared bounds is refused', () => {
  const result = resolveSolverBlock(reply(), request({ inputs: { k: 5, T0: 95 } }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'inputs-invalid');
});

test('an unrelated block identity does not resolve the solver', () => {
  const result = resolveSolverBlock(reply(), request({ blockId: 'plot-9' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'unknown-solver');
});

test('two solver blocks with the same identity are ambiguous, not a best guess', () => {
  const ambiguous = reply();
  ambiguous.blocks.push({ id: 'solver-1', type: 'solver', path: 'other/main.py', inputNames: ['k'], outputBlocks: ['model-1'] });
  const result = resolveSolverBlock(ambiguous, request());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'unknown-solver');
});

// An ode model block declares state ['T'], so kernel/integrate.ts produces the
// columns ['t', 'T']. A map block would produce ['n', ...state].
const goodOutputs = {
  'model-1': { kind: 'series', columns: ['t', 'T'], rows: [[0, 95], [1, 80.1], [2, 68.4]] },
  'derived-1': { kind: 'values', values: { halfLife: 3.4657 } },
};

function outputDocument(outputs: unknown, requestId = 'req-1') {
  return { schema: SOLVER_OUTPUT_SCHEMA, requestId, outputs };
}

test('solver output matching the declared output model is accepted', () => {
  const solver = resolveSolverBlock(reply(), request());
  assert.equal(solver.ok, true);
  if (!solver.ok) return;
  const result = validateSolverOutput(reply(), solver.value, request(), outputDocument(goodOutputs));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.value).sort(), ['derived-1', 'model-1']);
  const series = result.value['model-1'];
  assert.equal(series.kind, 'series');
  if (series.kind === 'series') assert.deepEqual([...series.columns], ['t', 'T']);
});

test('untrusted solver output is refused when it does not match the reply', () => {
  const solver = resolveSolverBlock(reply(), request());
  assert.equal(solver.ok, true);
  if (!solver.ok) return;
  const cases: [string, unknown][] = [
    ['not an object', '[]'],
    ['wrong schema', { ...outputDocument(goodOutputs), schema: 'anything.v1' }],
    ['answers a different request', outputDocument(goodOutputs, 'req-2')],
    ['invents a block', outputDocument({ ...goodOutputs, 'model-2': goodOutputs['model-1'] })],
    ['drops a declared block', outputDocument({ 'model-1': goodOutputs['model-1'] })],
    ['renames a column', outputDocument({ ...goodOutputs, 'model-1': { kind: 'series', columns: ['x', 'T'], rows: [[0, 95]] } })],
    ['reorders columns', outputDocument({ ...goodOutputs, 'model-1': { kind: 'series', columns: ['T', 't'], rows: [[95, 0]] } })],
    ['returns values where a series is required', outputDocument({ ...goodOutputs, 'model-1': { kind: 'values', values: { T: 95 } } })],
    ['returns a ragged row', outputDocument({ ...goodOutputs, 'model-1': { kind: 'series', columns: ['t', 'T'], rows: [[0, 95], [1]] } })],
    ['returns a non finite cell', outputDocument({ ...goodOutputs, 'model-1': { kind: 'series', columns: ['t', 'T'], rows: [[0, null]] } })],
    ['returns no rows', outputDocument({ ...goodOutputs, 'model-1': { kind: 'series', columns: ['t', 'T'], rows: [] } })],
    ['renames a derived quantity', outputDocument({ ...goodOutputs, 'derived-1': { kind: 'values', values: { halflife: 3.4 } } })],
    ['adds an extra derived quantity', outputDocument({ ...goodOutputs, 'derived-1': { kind: 'values', values: { halfLife: 3.4, extra: 1 } } })],
  ];
  for (const [name, document] of cases) {
    const result = validateSolverOutput(reply(), solver.value, request(), document);
    assert.equal(result.ok, false, `${name} should be refused`);
  }
});

test('a solver may not recompute a block type this version cannot validate', () => {
  const unsupported = reply();
  unsupported.blocks.push({ id: 'text-1', type: 'text', md: 'Some prose.' });
  const solverBlock = unsupported.blocks.find((block) => block.id === 'solver-1');
  assert.ok(solverBlock && solverBlock.type === 'solver');
  if (!solverBlock || solverBlock.type !== 'solver') return;
  solverBlock.outputBlocks = ['text-1'];
  const solver = resolveSolverBlock(unsupported, request({ blockId: 'text-1' }));
  assert.equal(solver.ok, true);
  if (!solver.ok) return;
  const result = validateSolverOutput(unsupported, solver.value, request({ blockId: 'text-1' }),
    outputDocument({ 'text-1': { kind: 'values', values: { anything: 1 } } }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'unsupported-capability');
});

test('a samples block is recomputed into exactly the quantity names its grid recorded', () => {
  const withSamples = reply();
  withSamples.blocks.push({
    id: 'samples-1', type: 'samples', model: 'model-1',
    envelope: { axes: [{ name: 'k', min: 0.01, max: 1, count: 5 }], interpolation: 'linear', errorEvidence: 'grid refinement', forbiddenRegions: [] },
    samples: [{ at: { k: 0.01 }, values: { settleTime: 100, finalT: 20 } }],
  });
  const solverBlock = withSamples.blocks.find((block) => block.id === 'solver-1');
  if (!solverBlock || solverBlock.type !== 'solver') { assert.fail('solver block missing'); return; }
  solverBlock.outputBlocks = ['samples-1'];
  const solver = resolveSolverBlock(withSamples, request({ blockId: 'samples-1' }));
  assert.equal(solver.ok, true);
  if (!solver.ok) return;
  const accepted = validateSolverOutput(withSamples, solver.value, request({ blockId: 'samples-1' }),
    outputDocument({ 'samples-1': { kind: 'values', values: { finalT: 20.5, settleTime: 88 } } }));
  assert.equal(accepted.ok, true);
  const refused = validateSolverOutput(withSamples, solver.value, request({ blockId: 'samples-1' }),
    outputDocument({ 'samples-1': { kind: 'values', values: { finalT: 20.5 } } }));
  assert.equal(refused.ok, false);
});

test('input identity ignores key order and distinguishes different numbers', () => {
  assert.equal(digestSolverInputs({ k: 0.2, T0: 95 }), digestSolverInputs({ T0: 95, k: 0.2 }));
  assert.equal(digestSolverInputs({ k: -0, T0: 95 }), digestSolverInputs({ k: 0, T0: 95 }));
  assert.notEqual(digestSolverInputs({ k: 0.2, T0: 95 }), digestSolverInputs({ k: 0.2, T0: 95.0001 }));
  assert.notEqual(digestSolverInputs({ k: 0.2, T0: 95 }), digestSolverInputs({ k: 0.2 }));
});

test('output identity changes when any recomputed number changes', () => {
  const base = { 'derived-1': { kind: 'values' as const, values: { halfLife: 3.4657 } } };
  const moved = { 'derived-1': { kind: 'values' as const, values: { halfLife: 3.4658 } } };
  assert.equal(digestSolverOutputs(base), digestSolverOutputs({ ...base }));
  assert.notEqual(digestSolverOutputs(base), digestSolverOutputs(moved));
});

test('the cache key binds artifacts, inputs, the prepared policy and limits', () => {
  const binding: SolverArtifactBinding = {
    jobId: 'job-1', attemptId: 'attempt-1',
    workspace: '/jobs/one', workspaceGeneration: 'gen-1',
    solverRelativePath: 'solver/main.py', solverSha256: HASH_A,
    runtimeExecutable: '/usr/bin/python3',
  };
  const key = solverCacheKey(binding, request(), HASH_C);
  assert.equal(key, solverCacheKey(binding, request({ requestId: 'req-9', requestedAt: '2026-09-18T00:00:00.000Z', stateKey: STATE_9 }), HASH_C));
  assert.notEqual(key, solverCacheKey({ ...binding, solverSha256: HASH_B }, request(), HASH_C));
  assert.notEqual(key, solverCacheKey({ ...binding, workspaceGeneration: 'gen-2' }, request(), HASH_C));
  assert.notEqual(key, solverCacheKey({ ...binding, runtimeExecutable: '/usr/bin/python3.12' }, request(), HASH_C));
  assert.notEqual(key, solverCacheKey(binding, request({ inputs: { k: 0.3, T0: 95 } }), HASH_C));
  assert.notEqual(key, solverCacheKey(binding, request(), HASH_B));
  assert.notEqual(key, solverCacheKey(binding, request({ limits: { timeoutMs: 6_000, maxOutputBytes: 65_536 } }), HASH_C));
});

test('the cache key ignores the policy identity the margin claims', () => {
  const binding: SolverArtifactBinding = {
    jobId: 'job-1', attemptId: 'attempt-1',
    workspace: '/jobs/one', workspaceGeneration: 'gen-1',
    solverRelativePath: 'solver/main.py', solverSha256: HASH_A,
    runtimeExecutable: '/usr/bin/python3',
  };
  // A caller that could move the key by changing `policyKey` could partition or
  // poison the cache. Only the host-computed fingerprint moves it.
  assert.equal(
    solverCacheKey(binding, request({ policyKey: HASH_A }), HASH_C),
    solverCacheKey(binding, request({ policyKey: HASH_B }), HASH_C),
  );
});

function policyBinding(): SolverPolicyBinding {
  return {
    policyVersion: 'marginalia.codex-policy.v1',
    codexVersion: '0.153.4',
    platform: 'linux',
    adapter: 'app-server',
    profileManifestSha256: HASH_A,
    runtimeBackend: 'linux-landlock-seccomp',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    command: ['/usr/bin/python3', '/jobs/one/solver/main.py', '--input', '<attempt-input>'],
    cwd: '/jobs/one',
    timeoutMs: 5_000,
    outputBytesCapPerStream: 65_537,
    workspaceGeneration: 'gen-1',
    solverSha256: HASH_B,
    runtimeSha256: null,
    inputDigest: HASH_C,
  };
}

test('the policy fingerprint is stable and moves with every bound field', () => {
  const base = solverPolicyFingerprint(policyBinding());
  assert.equal(base, solverPolicyFingerprint(policyBinding()));
  assert.match(base, /^[a-f0-9]{64}$/);

  const moved: Array<Partial<SolverPolicyBinding>> = [
    { platform: 'win32' },
    { runtimeBackend: 'macos-seatbelt' },
    { profileManifestSha256: HASH_B },
    { sandboxPolicy: { type: 'readOnly', networkAccess: true } },
    { command: ['/usr/bin/python3', '/jobs/one/solver/other.py', '--input', '<attempt-input>'] },
    { cwd: '/jobs/two' },
    { timeoutMs: 5_001 },
    { outputBytesCapPerStream: 65_538 },
    { workspaceGeneration: 'gen-2' },
    { solverSha256: HASH_C },
    { runtimeSha256: HASH_A },
    { inputDigest: HASH_A },
    { adapter: 'mcp-server' },
    { codexVersion: '0.153.5' },
  ];
  for (const change of moved) {
    assert.notEqual(solverPolicyFingerprint({ ...policyBinding(), ...change }), base,
      `changing ${Object.keys(change)[0]} must change the policy fingerprint`);
  }
});

test('two platforms with the same command never share a policy fingerprint', () => {
  // The same argv under a different sandbox backend is a different policy.
  const linux = solverPolicyFingerprint(policyBinding());
  const windows = solverPolicyFingerprint({
    ...policyBinding(), platform: 'win32', runtimeBackend: 'windows-native',
  });
  const mac = solverPolicyFingerprint({
    ...policyBinding(), platform: 'darwin', runtimeBackend: 'macos-seatbelt',
  });
  assert.equal(new Set([linux, windows, mac]).size, 3);
});

// ---------------------------------------------------------------------------
// The prepare/execute handshake
// ---------------------------------------------------------------------------

function planRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SOLVER_PLAN_REQUEST_SCHEMA,
    replyVersionId: 'reply-1',
    blockId: 'model-1',
    solverId: 'solver-1',
    inputs: { k: 0.2, T0: 95 },
    stateKey: STATE_1,
    ...overrides,
  };
}

function executeRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SOLVER_EXECUTE_SCHEMA,
    requestId: 'req-1',
    planId: 'plan-1',
    planToken: HASH_C,
    replyVersionId: 'reply-1',
    blockId: 'model-1',
    solverId: 'solver-1',
    inputs: { k: 0.2, T0: 95 },
    stateKey: STATE_1,
    requestedAt: '2026-09-17T10:00:00.000Z',
    ...overrides,
  };
}

test('a plan request carries only fields a margin can see', () => {
  const result = validateSolverPlanRequest(planRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Exactly the client-visible surface. A margin has no reply hash, grant or policy.
  assert.deepEqual(Object.keys(result.value).sort(),
    ['blockId', 'inputs', 'replyVersionId', 'schema', 'solverId', 'stateKey'].sort());
});

test('host-private fields sent by a margin are dropped, not honoured', () => {
  const smuggled = planRequest({
    replyHash: HASH_A, sourceHash: HASH_B, grantId: 'grant-1', policyKey: HASH_C,
    limits: { timeoutMs: 1, maxOutputBytes: 1 },
  });
  const result = validateSolverPlanRequest(smuggled);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const field of ['replyHash', 'sourceHash', 'grantId', 'policyKey', 'limits']) {
    assert.equal(Object.hasOwn(result.value, field), false, `${field} must never be taken from a margin`);
  }
});

test('a malformed plan request is rejected, never repaired', () => {
  const cases: [string, unknown][] = [
    ['not an object', 'please recompute'],
    ['wrong schema', planRequest({ schema: 'marginalia.solver-plan-request.v2' })],
    ['unsafe reply id', planRequest({ replyVersionId: '../../etc' })],
    ['missing block', planRequest({ blockId: undefined })],
    ['non finite input', planRequest({ inputs: { k: Number.NaN, T0: 95 } })],
    ['empty state key', planRequest({ stateKey: '' })],
    ['raw renderer state key instead of its digest', planRequest({ stateKey: 'x'.repeat(16_385) })],
  ];
  for (const [name, value] of cases) {
    assert.equal(validateSolverPlanRequest(value).ok, false, `${name} should be rejected`);
  }
});

test('an execute request must echo a well formed plan token and a real timestamp', () => {
  assert.equal(validateSolverExecuteRequest(executeRequest()).ok, true);
  const cases: [string, unknown][] = [
    ['wrong schema', executeRequest({ schema: SOLVER_PLAN_REQUEST_SCHEMA })],
    ['short token', executeRequest({ planToken: 'abc' })],
    ['non hex token', executeRequest({ planToken: 'z'.repeat(64) })],
    ['missing token', executeRequest({ planToken: undefined })],
    ['unsafe plan id', executeRequest({ planId: '../escape' })],
    ['unsafe request id', executeRequest({ requestId: '../escape' })],
    ['unparseable timestamp', executeRequest({ requestedAt: 'yesterday' })],
    ['input that is not a number', executeRequest({ inputs: { k: '0.2' } })],
  ];
  for (const [name, value] of cases) {
    assert.equal(validateSolverExecuteRequest(value).ok, false, `${name} should be rejected`);
  }
});

// ---------------------------------------------------------------------------
// Content identity
// ---------------------------------------------------------------------------

const IDENTITY_BINDING = { workspaceGeneration: 'gen-1', solverSha256: HASH_A };

function identityFields(overrides: Partial<SolverRecomputeRequest> = {}): SolverIdentityFields {
  const value = request(overrides);
  return {
    replyVersionId: value.replyVersionId, replyHash: value.replyHash, threadId: value.threadId,
    sourceVersionId: value.sourceVersionId, sourceHash: value.sourceHash, blockId: value.blockId,
    solverId: value.solverId, inputs: value.inputs, stateKey: value.stateKey,
    grantId: value.grantId, limits: value.limits,
  };
}

test('request identity is content, not the id or the policy the margin claims', () => {
  const base = solverRequestIdentity(identityFields(), IDENTITY_BINDING);
  assert.match(base, /^[a-f0-9]{64}$/);
  // Two clicks that ask the same question are one recompute, whatever they are called.
  assert.equal(solverRequestIdentity(identityFields({ requestId: 'req-2' }), IDENTITY_BINDING), base);
  assert.equal(solverRequestIdentity(identityFields({ policyKey: HASH_A }), IDENTITY_BINDING), base);
  assert.equal(solverRequestIdentity(identityFields({ requestedAt: '2030-01-01T00:00:00.000Z' }), IDENTITY_BINDING), base);
  // Key order is not content.
  assert.equal(solverRequestIdentity(identityFields({ inputs: { T0: 95, k: 0.2 } }), IDENTITY_BINDING), base);
});

test('every field that changes the answer changes the request identity', () => {
  const base = solverRequestIdentity(identityFields(), IDENTITY_BINDING);
  const moved: [string, string][] = [
    ['inputs', solverRequestIdentity(identityFields({ inputs: { k: 0.3, T0: 95 } }), IDENTITY_BINDING)],
    ['reply version', solverRequestIdentity(identityFields({ replyVersionId: 'reply-2' }), IDENTITY_BINDING)],
    ['reply hash', solverRequestIdentity(identityFields({ replyHash: HASH_B }), IDENTITY_BINDING)],
    ['source hash', solverRequestIdentity(identityFields({ sourceHash: HASH_C }), IDENTITY_BINDING)],
    ['thread', solverRequestIdentity(identityFields({ threadId: 'thread-2' }), IDENTITY_BINDING)],
    ['block', solverRequestIdentity(identityFields({ blockId: 'derived-1' }), IDENTITY_BINDING)],
    ['state key', solverRequestIdentity(identityFields({ stateKey: STATE_2 }), IDENTITY_BINDING)],
    ['grant', solverRequestIdentity(identityFields({ grantId: 'grant-2' }), IDENTITY_BINDING)],
    ['limits', solverRequestIdentity(identityFields({ limits: { timeoutMs: 6_000, maxOutputBytes: 65_536 } }), IDENTITY_BINDING)],
    ['generation', solverRequestIdentity(identityFields(), { ...IDENTITY_BINDING, workspaceGeneration: 'gen-2' })],
    ['solver bytes', solverRequestIdentity(identityFields(), { ...IDENTITY_BINDING, solverSha256: HASH_B })],
    ['interpreter bytes', solverRequestIdentity(identityFields(), { ...IDENTITY_BINDING, runtimeSha256: HASH_C })],
  ];
  const seen = new Set([base]);
  for (const [name, digest] of moved) {
    assert.equal(seen.has(digest), false, `${name} must change the request identity`);
    seen.add(digest);
  }
});

test('a principal is the whole triple, so one tab cannot read another', () => {
  const reader: SolverPrincipal = { siteOrigin: 'https://example.test', threadId: 'thread-1', sessionId: 'session-1' };
  assert.equal(sameSolverPrincipal(reader, { ...reader }), true);
  for (const field of ['siteOrigin', 'threadId', 'sessionId'] as const) {
    assert.equal(sameSolverPrincipal(reader, { ...reader, [field]: 'other' }), false, `${field} must be compared`);
  }
});
