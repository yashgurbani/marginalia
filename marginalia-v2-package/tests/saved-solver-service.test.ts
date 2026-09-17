import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  SOLVER_EXECUTE_SCHEMA,
  SOLVER_OUTPUT_SCHEMA,
  SOLVER_PLAN_REQUEST_SCHEMA,
  digestSolverInputs,
  solverPolicyFingerprint,
  solverStateKeyFrom,
  type SolverArtifactBinding,
  type SolverLimits,
  type SolverOutcome,
  type SolverPlan,
  type SolverPlanOutcome,
  type SolverPrincipal,
} from '../contracts/solver.ts';
import { REPLY_SCHEMA, type CandidateReply } from '../contracts/reply.ts';
import { digestReply } from '../contracts/host-checks.ts';
import {
  PINNED_CODEX_VERSION,
  auditCodexPolicy,
  createCodexPolicy,
  type CodexPolicy,
  type Observation,
  type Platform,
  type PolicyEvidence,
} from '../daemon/codex-policy.ts';
import { RECOMPUTE_DIRECTORY } from '../daemon/solver/artifacts.ts';
import { SolverResultCache } from '../daemon/solver/cache.ts';
import {
  SolverExecutionService,
  type SolverAuthorizationDecision,
  type SolverAuthorizationInput,
  type SolverClaimRelease,
  type SolverClaimReleaseResult,
  type SolverFinalizationDecision,
  type SolverFinalizationInput,
  type SolverGenerationLease,
  type SolverRecomputeContext,
} from '../daemon/solver/service.ts';
import type {
  SolverCommandObservation,
  SolverCommandRequest,
  SolverCommandTransport,
  SolverExecOptions,
  SolverStreamObservation,
} from '../daemon/solver/transport.ts';
import { createSolverRoutes } from '../daemon/solver/route.ts';

const runFile = promisify(execFile);

/**
 * The reviewed policy profile is portable since T13's integration: every one of
 * win32, linux and darwin has a reviewed backend. These tests run on the host
 * platform and assert the same behaviour on each; none of them asserts that
 * Linux or macOS must fail. Genuine runtime evidence is still a product
 * requirement, and the fixtures below prove nothing about any real sandbox.
 */
const HOST_PLATFORM = process.platform as Platform;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseReply(): CandidateReply {
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
      { id: 'derived-1', type: 'derived', name: 'halfLife', expression: 'ln(2)/k', unit: 'min', label: 'Half life' },
      { id: 'solver-1', type: 'solver', path: 'solver/main.js', inputNames: ['k', 'T0'], outputBlocks: ['derived-1'] },
    ],
    checks: [],
    staticFallback: 'The cup cools toward room temperature.',
  };
}

const SOURCE_HASH = 'b'.repeat(64);
const DEFAULT_LIMITS: SolverLimits = { timeoutMs: 5_000, maxOutputBytes: 65_536 };
const DEFAULT_INPUTS = { k: 0.2, T0: 95 };
// The margin sends the digest of its renderer state, never the canonical string itself.
const STATE_1 = solverStateKeyFrom('{"parameters":{"T0":95,"k":0.2},"reply":{"id":"reply-1"}}');
const STATE_2 = solverStateKeyFrom('{"parameters":{"T0":21,"k":0.2},"reply":{"id":"reply-1"}}');

/** The reader's session, resolved by the host. A margin never sends this. */
const READER: SolverPrincipal = { siteOrigin: 'https://example.test', threadId: 'thread-1', sessionId: 'session-1' };
/** A second tab of the same thread. It is a different principal. */
const OTHER_TAB: SolverPrincipal = { ...READER, sessionId: 'session-2' };

/**
 * A solver that reads its input tuple and prints the declared output. It is an
 * ordinary script written by this test; nothing here is model authored.
 */
const SOLVER_SOURCE = `import { readFileSync } from 'node:fs';
const index = process.argv.indexOf('--input');
const input = JSON.parse(readFileSync(process.argv[index + 1], 'utf8'));
process.stdout.write(JSON.stringify({
  schema: '${SOLVER_OUTPUT_SCHEMA}',
  requestId: input.requestId,
  outputs: { 'derived-1': { kind: 'values', values: { halfLife: Math.log(2) / input.inputs.k } } },
}));
`;

type Fixture = {
  workspace: string;
  codexHome: string;
  runtime: string;
  binding: SolverArtifactBinding;
  cleanup: () => Promise<void>;
};

async function fixture(): Promise<Fixture> {
  // realpath, because the host re-resolves every path and a temp directory can be
  // a link (notably /var on macOS).
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'marginalia-t20-ws-')));
  const codexHome = await realpath(await mkdtemp(join(tmpdir(), 'marginalia-t20-home-')));
  const runtime = await realpath(process.execPath);
  await mkdir(join(workspace, 'solver'), { recursive: true });
  await writeFile(join(workspace, 'solver', 'main.js'), SOLVER_SOURCE, 'utf8');
  return {
    workspace,
    codexHome,
    runtime,
    binding: {
      jobId: 'job-1', attemptId: 'attempt-1',
      workspace, workspaceGeneration: 'gen-1',
      solverRelativePath: 'solver/main.js',
      solverSha256: createHash('sha256').update(SOLVER_SOURCE, 'utf8').digest('hex'),
      runtimeExecutable: runtime,
    },
    cleanup: async () => {
      await rm(workspace, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
    },
  };
}

function contextFor(fix: Fixture, reply = baseReply(), limits: SolverLimits = DEFAULT_LIMITS): SolverRecomputeContext {
  return {
    reply,
    replyHash: digestReply(reply),
    threadId: 'thread-1',
    sourceVersionId: 'source-1',
    sourceHash: SOURCE_HASH,
    binding: fix.binding,
    capabilities: ['solver'],
    limits,
  };
}

/**
 * The fingerprint a correct host computes for this fixture, built here from the
 * public policy and contract functions rather than read back from the service.
 * No request is constructed from it: the margin cannot compute this value, and
 * since the prepare/execute handshake it no longer needs to. It is used only as
 * an independent expectation for what the host recorded.
 */
function policyFingerprintFor(fix: Fixture, limits: SolverLimits, inputs: Record<string, number>): string {
  const policy = createCodexPolicy({
    version: PINNED_CODEX_VERSION,
    platform: HOST_PLATFORM,
    adapter: 'app-server',
    workspace: fix.workspace,
    codexHome: fix.codexHome,
    auditId: 'audit-1',
    operation: 'saved-solver',
    executable: fix.runtime,
    solverPath: join(fix.workspace, 'solver', 'main.js'),
    inputPath: join(fix.workspace, RECOMPUTE_DIRECTORY, 'req-1.token', 'input.json'),
    writesWorkspace: false,
    timeoutMs: limits.timeoutMs,
  });
  if (policy.operation !== 'saved-solver') throw new Error('unreachable');
  // argv is [interpreter, solver, '--input', input]; only the last element is
  // attempt specific.
  const command = policy.commandExec.params.command.map((argument, index) => (index === 3 ? '<attempt-input>' : argument));
  return solverPolicyFingerprint({
    policyVersion: policy.policyVersion,
    codexVersion: policy.version,
    platform: policy.platform,
    adapter: policy.adapter,
    profileManifestSha256: policy.reviewedProfile.manifestSha256,
    runtimeBackend: policy.reviewedProfile.runtimeBackend,
    sandboxPolicy: policy.sandboxPolicy,
    command,
    cwd: policy.commandExec.params.cwd,
    timeoutMs: policy.commandExec.params.timeoutMs,
    outputBytesCapPerStream: limits.maxOutputBytes + 1,
    workspaceGeneration: fix.binding.workspaceGeneration,
    solverSha256: fix.binding.solverSha256,
    runtimeSha256: fix.binding.runtimeSha256 ?? null,
    inputDigest: digestSolverInputs(inputs),
  });
}

/**
 * Exactly what a margin can send to `POST /api/solver/prepare`: the reply it is
 * displaying, the block the reader is looking at, the numbers in the inputs and
 * its own view state key. There is no hash, grant or policy here.
 */
function planRequestFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SOLVER_PLAN_REQUEST_SCHEMA,
    replyVersionId: 'reply-1',
    blockId: 'derived-1',
    solverId: 'solver-1',
    inputs: DEFAULT_INPUTS,
    stateKey: STATE_1,
    ...overrides,
  };
}

/** What the margin sends when the reader clicks: the plan it was given, echoed. */
function executeFor(plan: SolverPlan, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SOLVER_EXECUTE_SCHEMA,
    requestId: 'req-1',
    planId: plan.planId,
    planToken: plan.planToken,
    replyVersionId: plan.replyVersionId,
    blockId: plan.blockId,
    solverId: plan.solverId,
    inputs: DEFAULT_INPUTS,
    stateKey: STATE_1,
    requestedAt: '2026-09-17T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Evidence fixture
// ---------------------------------------------------------------------------

function nest(overrides: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [dotted, value] of Object.entries(overrides)) {
    const parts = dotted.split('.');
    let cursor = values;
    for (const part of parts.slice(0, -1)) {
      if (typeof cursor[part] !== 'object' || cursor[part] === null) cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return values;
}

/**
 * A complete, internally consistent evidence set for exactly this policy, on
 * whichever platform the policy names. It shows the audit gate accepts consistent
 * evidence. It is not a claim that any host was isolated: real collection is an
 * integration dependency (T13).
 */
function evidenceFor(policy: CodexPolicy): PolicyEvidence {
  const observe = <T>(source: string, value: T): Observation<T> =>
    ({ scope: policy.evidenceScope, source, reference: `test-fixture:${source}`, complete: true, value });
  const keys = [...policy.reviewedProfile.inheritedEnvironmentKeys].slice(0, 2);
  const digests: Record<string, string> = {};
  for (const key of keys) digests[key] = createHash('sha256').update(`value-of-${key}`).digest('hex');
  return {
    authentication: observe('account/read', { available: true, dedicatedHome: true, accountReference: 'account-1' }),
    config: observe('config/read', { values: nest(policy.configOverrides), layersReviewed: true }),
    requirements: observe('configRequirements/read', { compatible: true, unresolved: [] }),
    mcp: observe('mcpServerStatus/list', []),
    skills: observe('skills/list', []),
    capabilities: observe('host-capability-audit', [{ name: 'command/exec', enabled: true, origin: 'builtin' as const }]),
    instructions: observe('thread-instruction-audit', []),
    environment: observe('host-environment-audit', {
      serverCwd: policy.workspace, codexHome: policy.codexHome, dedicatedHome: true,
      credentialsCopied: false, normalSettingsChanged: false,
      inheritedEnvironmentKeys: keys,
      environmentReviewed: true, inheritedEnvironmentValueDigests: digests,
      ...(policy.platform === 'win32' ? { windowsKeyCasingReviewed: true } : {}),
      executableResolutionReviewed: true,
    }),
    runtime: observe('controlled-sandbox-probe', {
      version: PINNED_CODEX_VERSION, adapter: policy.adapter, platform: policy.platform,
      sandboxPolicy: policy.sandboxPolicy,
      backend: policy.reviewedProfile.runtimeBackend, providerInstanceId: 'provider-1',
      profileManifestSha256: policy.reviewedProfile.manifestSha256,
      modelReachableReadProbe: 'passed' as const, filesystemWriteProbe: 'passed' as const,
      closedToolNetworkProbe: 'passed' as const, modelTrafficDistinguished: true,
    }),
  };
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

type StreamFlags = { capReached?: boolean; hostBoundReached?: boolean };

function stream(text: string, flags: StreamFlags = {}): SolverStreamObservation {
  return {
    text,
    bytes: Buffer.byteLength(text, 'utf8'),
    capReached: flags.capReached ?? false,
    hostBoundReached: flags.hostBoundReached ?? false,
  };
}

function exited(
  stdout: string,
  overrides: { exitCode?: number; stderr?: string; flags?: StreamFlags; stderrFlags?: StreamFlags } = {},
): SolverCommandObservation {
  return {
    status: 'exited',
    exitCode: overrides.exitCode ?? 0,
    stdout: stream(stdout, overrides.flags ?? {}),
    stderr: stream(overrides.stderr ?? '', overrides.stderrFlags ?? {}),
    streamed: true,
  };
}

type Harness = {
  service: SolverExecutionService;
  calls: SolverCommandRequest[];
  dispatches: SolverExecOptions[];
  authorizations: SolverAuthorizationInput[];
  finalizations: SolverFinalizationInput[];
  log: string[];
  setObservation: (observation: SolverCommandObservation | (() => Promise<SolverCommandObservation>)) => void;
  cache: SolverResultCache;
  /** Claims the gate committed and has not been asked to withdraw. */
  claims: Map<string, 'dispatched' | 'settled'>;
  releases: SolverClaimRelease[];
};

type HarnessOptions = {
  context?: SolverRecomputeContext | (() => SolverRecomputeContext | undefined);
  enforces?: { timeout: boolean; outputBytes: boolean; memoryBytes: false; maxTimeoutMs: number };
  evidence?: (policy: CodexPolicy) => PolicyEvidence | undefined;
  decide?: (input: SolverAuthorizationInput) => SolverAuthorizationDecision;
  /** Runs inside the gate's async `prepareCommit`, before the synchronous commit. */
  onPrepare?: (input: SolverFinalizationInput) => void | Promise<void>;
  /** Overrides the synchronous commit decision. May return a thenable to test the boundary. */
  commit?: (input: SolverFinalizationInput) => SolverFinalizationDecision | Promise<SolverFinalizationDecision>;
  lease?: (input: SolverFinalizationInput) => SolverGenerationLease;
  /** When true the gate reports durable at-most-once and remembers claims across attempts. */
  durable?: boolean;
  /**
   * How this gate withdraws a claim it committed for a handoff that never happened.
   * `'none'` is a gate that offers no release at all.
   */
  release?: 'none' | 'ok' | 'no-op' | 'throws' | 'thenable-resolves' | 'thenable-rejects';
  transport?: SolverCommandTransport | null;
  realExecution?: boolean;
  now?: () => number;
  planTtlMs?: number;
};

function authorization(overrides: Record<string, unknown> = {}) {
  return {
    grantId: 'grant-1', grantRevision: 4, reservationId: 'reservation-1',
    sitePermissionEpoch: 7, permissionFingerprint: 'fingerprint-1',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function leaseFor(input: SolverFinalizationInput): SolverGenerationLease {
  return {
    leaseId: 'lease-1',
    workspaceGeneration: input.workspaceGeneration,
    profileManifestSha256: input.profileManifestSha256,
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

function harness(fix: Fixture, options: HarnessOptions = {}): Harness {
  const calls: SolverCommandRequest[] = [];
  const dispatches: SolverExecOptions[] = [];
  const authorizations: SolverAuthorizationInput[] = [];
  const finalizations: SolverFinalizationInput[] = [];
  const releases: SolverClaimRelease[] = [];
  // Stands in for T06's durable at-most-once table. A committed claim is
  // remembered by request identity so a second attempt is refused, not dispatched.
  const claims = new Map<string, 'dispatched' | 'settled'>();
  const log: string[] = [];
  let observation: SolverCommandObservation | (() => Promise<SolverCommandObservation>) = exited('');

  const fake: SolverCommandTransport = {
    enforces: options.enforces ?? { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: 30_000 },
    async exec(request, execOptions) {
      log.push('exec');
      calls.push(request);
      dispatches.push(execOptions);
      if (options.realExecution) {
        // An unsandboxed local harness. It proves only the `solver --input file`
        // protocol and the JSON round trip. It is NOT the product execution path
        // and it demonstrates no isolation whatsoever.
        const [executable, ...args] = request.command;
        const { stdout } = await runFile(executable, args, { cwd: request.cwd, maxBuffer: 1024 * 1024 });
        return exited(stdout);
      }
      return typeof observation === 'function' ? observation() : observation;
    },
  };

  // A getter lets a test move the reply, the generation or the source after the
  // plan was issued, which is the whole point of re-resolving at the click.
  const given = options.context;
  const resolveContext: () => SolverRecomputeContext | undefined =
    typeof given === 'function' ? given : () => given ?? contextFor(fix);

  const cache = new SolverResultCache();
  const service = new SolverExecutionService({
    context: { async resolve() { return resolveContext(); } },
    authority: {
      async authorize(input) {
        log.push(`authorize:${input.stage}`);
        authorizations.push(input);
        if (options.decide) return options.decide(input);
        return { decision: 'allowed', authorization: authorization({ policyFingerprint: input.policyFingerprint }) };
      },
    },
    gate: {
      durableAtMostOnce: options.durable ?? false,
      async prepareCommit(input) {
        // Every await the commit depends on happens here, before the synchronous
        // commit below.
        log.push('prepareCommit');
        finalizations.push(input);
        if (options.onPrepare) await options.onPrepare(input);
        return {
          commit(): SolverFinalizationDecision {
            log.push('commit');
            // A commit override may deliberately return a thenable to exercise the
            // service's synchronous-boundary guard; the cast simulates a gate that
            // violates the interface at runtime.
            if (options.commit) return options.commit(input) as SolverFinalizationDecision;
            if (options.durable) {
              const seen = claims.get(input.requestIdentity);
              if (seen) return { decision: 'already-claimed', reason: 'A durable claim already exists for this recompute.', state: seen };
              claims.set(input.requestIdentity, 'dispatched');
            }
            return {
              decision: 'committed',
              handoffToken: 'handoff-1',
              authorization: authorization({ policyFingerprint: input.policyFingerprint }),
              lease: options.lease ? options.lease(input) : leaseFor(input),
              attemptClaim: options.durable ? 'durable-host-journal' : 'process-local',
            };
          },
        };
      },
      // A gate that can withdraw a claim it wrote. `'none'` omits the method
      // entirely, which is how a host with no release path is declared.
      ...(options.release && options.release !== 'none' ? {
        releaseClaim(release: SolverClaimRelease): SolverClaimReleaseResult {
          log.push('releaseClaim');
          releases.push(release);
          if (options.release === 'throws') throw new Error('the claim table would not give the row back');
          if (options.release === 'no-op') return undefined as unknown as SolverClaimReleaseResult;
          if (options.release === 'thenable-resolves') {
            return Promise.resolve({ decision: 'released' }) as unknown as SolverClaimReleaseResult;
          }
          if (options.release === 'thenable-rejects') {
            return Promise.reject(new Error('async release failed')) as unknown as SolverClaimReleaseResult;
          }
          claims.delete(release.requestIdentity);
          return { decision: 'released' };
        },
      } : {}),
    },
    evidence: {
      async collect(policy) { return options.evidence ? options.evidence(policy) : evidenceFor(policy); },
    },
    ...(options.transport === null ? {} : { transport: options.transport ?? fake }),
    codexHome: fix.codexHome,
    auditId: 'audit-1',
    cache,
    ...(options.now ? { now: options.now } : {}),
    ...(options.planTtlMs ? { planTtlMs: options.planTtlMs } : {}),
  });
  return { service, calls, dispatches, authorizations, finalizations, log, cache, claims, releases, setObservation: (value) => { observation = value; } };
}

function successfulStdout(requestId = 'req-1'): string {
  return JSON.stringify({
    schema: SOLVER_OUTPUT_SCHEMA,
    requestId,
    outputs: { 'derived-1': { kind: 'values', values: { halfLife: Math.log(2) / 0.2 } } },
  });
}

/** Fails with the outcome's own reason, which reads better than a bare status mismatch. */
function expectStatus(outcome: SolverOutcome, status: SolverOutcome['status']): void {
  if (outcome.status !== status) {
    assert.fail(`expected ${status} but got ${outcome.status}: ${JSON.stringify(outcome)}`);
  }
}

function expectPlan(outcome: SolverPlanOutcome): SolverPlan {
  if (outcome.status !== 'planned') assert.fail(`expected a plan but got ${outcome.status}: ${JSON.stringify(outcome)}`);
  return outcome.plan;
}

/** A refused plan reads as the same outcome the click would have produced. */
function planFailure(outcome: SolverPlanOutcome): SolverOutcome {
  if (outcome.status === 'planned') assert.fail('expected the plan to be refused');
  return outcome;
}

/**
 * The whole margin-visible flow: prepare, then click. Neither call carries a
 * hash, a grant or a policy identity.
 */
async function recompute(
  runner: Harness,
  options: { plan?: Record<string, unknown>; execute?: Record<string, unknown>; principal?: SolverPrincipal } = {},
): Promise<SolverOutcome> {
  const principal = options.principal ?? READER;
  const planned = await runner.service.prepare(planRequestFor(options.plan), principal);
  if (planned.status !== 'planned') return planFailure(planned);
  return runner.service.request(executeFor(planned.plan, options.execute), principal);
}

function stages(runner: Harness): string[] {
  return runner.authorizations.map((input) => input.stage);
}

// ---------------------------------------------------------------------------
// The handshake
// ---------------------------------------------------------------------------

test('a margin prepares and clicks using only fields it can see, and gets validated output', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));

  const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
  assert.match(plan.planId, /^[\w-]{1,100}$/);
  assert.match(plan.planToken, /^[a-f0-9]{64}$/);
  assert.equal(plan.modelTurns, 0);
  assert.deepEqual(plan.limits, DEFAULT_LIMITS, 'the host states the limits; the margin does not choose them');
  // The plan carries no host-private value the browser could pass off as its own.
  assert.deepEqual(Object.keys(plan).sort(), [
    'blockId', 'expiresAt', 'limits', 'modelTurns', 'planId', 'planToken', 'replyVersionId', 'schema', 'solverId',
  ]);

  const outcome = await runner.service.request(executeFor(plan), READER);
  expectStatus(outcome, 'succeeded');
  if (outcome.status !== 'succeeded') return;

  assert.equal(outcome.origin, 'execution');
  assert.equal(outcome.result.requestId, 'req-1');
  assert.equal(outcome.result.stateKey, STATE_1);
  const derived = outcome.result.outputs['derived-1'];
  assert.equal(derived.kind, 'values');
  // Independent expectation: ln(2)/0.2 = 3.4657359027997265.
  if (derived.kind === 'values') assert.ok(Math.abs(derived.values.halfLife - 3.4657359027997265) < 1e-12);

  const record = outcome.result.record;
  assert.equal(record.origin, 'host-execution');
  assert.equal(record.modelTurns, 0);
  assert.equal(record.solverSha256, fix.binding.solverSha256);
  assert.equal(record.runtimeExecutable, fix.runtime);
  assert.equal(record.workspaceGeneration, 'gen-1');
  assert.equal(record.grantId, 'grant-1');
  assert.equal(record.grantRevision, 4);
  assert.equal(record.policyFingerprint, policyFingerprintFor(fix, DEFAULT_LIMITS, DEFAULT_INPUTS));
  assert.equal(record.policyKey, record.policyFingerprint);
  assert.equal(record.handoffToken, 'handoff-1');
  assert.match(record.requestIdentity, /^[a-f0-9]{64}$/);
  assert.equal(record.generationLeaseId, 'lease-1');
  assert.match(record.executionAttemptId, /[0-9a-f-]{16,}/);
  assert.notEqual(record.executionAttemptId, record.executionId);
  assert.equal(record.permissionFingerprint, 'fingerprint-1');
  assert.equal(record.exitCode, 0);
  assert.equal(record.streamed, true);
  assert.ok(record.evidenceScope.length > 0);
  assert.deepEqual(record.enforced, { timeout: true, outputBytes: true, memoryBytes: false });

  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0].sandboxPolicy.networkAccess, false);
  assert.deepEqual(stages(runner), ['plan', 'dispatch', 'accept']);
  // No model turn and no inference grant is ever asked for, at any stage.
  for (const input of runner.authorizations) {
    assert.equal(input.work, 'local-recompute');
    assert.equal(input.modelTurns, 0);
  }
  assert.equal(runner.finalizations.length, 1);
  assert.equal(runner.finalizations[0].modelTurns, 0);
  assert.equal(runner.finalizations[0].work, 'local-recompute');
});

test('preparing a plan dispatches nothing, commits nothing and writes nothing', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);

  expectPlan(await runner.service.prepare(planRequestFor(), READER));
  assert.equal(runner.calls.length, 0, 'no process starts while preparing');
  assert.equal(runner.finalizations.length, 0, 'nothing is committed and no grant is spent');
  assert.deepEqual(stages(runner), ['plan'], 'preparation asks only for eligibility');
  await assert.rejects(readdir(join(fix.workspace, RECOMPUTE_DIRECTORY)), 'no attempt directory is created');
});

test('a margin cannot invent, guess or borrow a plan', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));

  const invented = await runner.service.request(executeFor({ ...plan, planId: 'plan-made-up' }), READER);
  expectStatus(invented, 'rejected');
  if (invented.status === 'rejected') assert.equal(invented.code, 'plan-unknown');

  const forgedToken = await runner.service.request(executeFor({ ...plan, planToken: 'a'.repeat(64) }), READER);
  expectStatus(forgedToken, 'rejected');
  if (forgedToken.status === 'rejected') assert.equal(forgedToken.code, 'plan-unknown');

  // A second tab of the same thread holds its own state and cannot spend this tab's plan.
  const borrowed = await runner.service.request(executeFor(plan), OTHER_TAB);
  expectStatus(borrowed, 'rejected');
  if (borrowed.status === 'rejected') assert.equal(borrowed.code, 'plan-unknown');

  assert.equal(runner.calls.length, 0);
  assert.equal(runner.finalizations.length, 0);
});

test('a plan that waited too long expires instead of running', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  let clock = 1_000_000;
  const runner = harness(fix, { now: () => clock, planTtlMs: 60_000 });
  const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
  assert.equal(plan.expiresAt, new Date(1_060_000).toISOString());

  clock += 60_001;
  const outcome = await runner.service.request(executeFor(plan), READER);
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'plan-expired');
  assert.equal(runner.calls.length, 0);
});

test('a plan buys one dispatch and cannot be replayed', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
  expectStatus(await runner.service.request(executeFor(plan), READER), 'succeeded');

  // A different request id on the same plan is a replay, not a new question.
  const replay = await runner.service.request(executeFor(plan, { requestId: 'req-2' }), READER);
  expectStatus(replay, 'rejected');
  if (replay.status === 'rejected') assert.equal(replay.code, 'plan-unknown');
  assert.equal(runner.calls.length, 1);
});

test('changing the inputs, block or reply after preparing refuses the plan', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));

  for (const changed of [
    { inputs: { k: 0.9, T0: 95 } },
    { stateKey: STATE_2 },
    { blockId: 'derived-9' },
    { replyVersionId: 'reply-9' },
    { solverId: 'solver-9' },
  ]) {
    const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
    const outcome = await runner.service.request(executeFor(plan, changed), READER);
    expectStatus(outcome, 'rejected');
    if (outcome.status === 'rejected') {
      assert.equal(outcome.code, 'request-identity-mismatch', `changing ${Object.keys(changed)[0]}`);
    }
  }
  assert.equal(runner.calls.length, 0, 'none of the altered clicks ran a solver');
});

test('a request id cannot be reused for different content', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  expectStatus(await recompute(runner), 'succeeded');

  // Same id, genuinely different question. Returning the first answer here would
  // show the reader numbers for inputs they did not ask about.
  const other = await recompute(runner, { plan: { inputs: { k: 0.5, T0: 95 } }, execute: { inputs: { k: 0.5, T0: 95 } } });
  expectStatus(other, 'rejected');
  if (other.status === 'rejected') assert.equal(other.code, 'request-identity-mismatch');
  assert.equal(runner.calls.length, 1);

  // The same id for the same content is still idempotent and runs nothing again.
  const repeat = await recompute(runner);
  expectStatus(repeat, 'succeeded');
  assert.equal(runner.calls.length, 1);
});

test('permission, grant, generation or reply movement between prepare and click stops the run', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  // Permission epoch moved.
  {
    let prepared = false;
    const runner = harness(fix, {
      decide: (input) => {
        const epoch = prepared ? 8 : 7;
        if (input.stage === 'plan') prepared = true;
        return { decision: 'allowed', authorization: authorization({ sitePermissionEpoch: epoch, policyFingerprint: input.policyFingerprint }) };
      },
    });
    const outcome = await recompute(runner);
    expectStatus(outcome, 'rejected');
    if (outcome.status === 'rejected') assert.equal(outcome.code, 'authorization-refused');
    assert.equal(runner.calls.length, 0);
  }

  // The grant was replaced.
  {
    let prepared = false;
    const runner = harness(fix, {
      decide: (input) => {
        const grantId = prepared ? 'grant-9' : 'grant-1';
        if (input.stage === 'plan') prepared = true;
        return { decision: 'allowed', authorization: authorization({ grantId, policyFingerprint: input.policyFingerprint }) };
      },
    });
    const outcome = await recompute(runner);
    expectStatus(outcome, 'rejected');
    if (outcome.status === 'rejected') assert.equal(outcome.code, 'authorization-refused');
  }

  // The grant was revoked outright.
  {
    let prepared = false;
    const runner = harness(fix, {
      decide: (input) => {
        if (prepared) return { decision: 'refused', reason: 'The reader withdrew permission.' };
        if (input.stage === 'plan') prepared = true;
        return { decision: 'allowed', authorization: authorization({ policyFingerprint: input.policyFingerprint }) };
      },
    });
    const outcome = await recompute(runner);
    expectStatus(outcome, 'rejected');
    if (outcome.status === 'rejected') assert.equal(outcome.code, 'authorization-refused');
    assert.equal(runner.calls.length, 0);
  }

  // The workspace was rebuilt.
  {
    let generation = 'gen-1';
    const runner = harness(fix, {
      context: () => ({ ...contextFor(fix), binding: { ...fix.binding, workspaceGeneration: generation } }),
    });
    const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
    generation = 'gen-2';
    const outcome = await runner.service.request(executeFor(plan), READER);
    expectStatus(outcome, 'rejected');
    if (outcome.status === 'rejected') assert.equal(outcome.code, 'generation-drift');
    assert.equal(runner.calls.length, 0);
  }

  // The reply's source moved.
  {
    let sourceHash = SOURCE_HASH;
    const runner = harness(fix, { context: () => ({ ...contextFor(fix), sourceHash }) });
    const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
    sourceHash = 'd'.repeat(64);
    const outcome = await runner.service.request(executeFor(plan), READER);
    expectStatus(outcome, 'rejected');
    if (outcome.status === 'rejected') assert.equal(outcome.code, 'reply-changed');
  }
});

test('a solver rewritten between prepare and click is refused as artifact-modified', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
  await writeFile(join(fix.workspace, 'solver', 'main.js'), 'process.stdout.write("{}")\n', 'utf8');
  const outcome = await runner.service.request(executeFor(plan), READER);
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'artifact-modified');
  assert.equal(runner.calls.length, 0);
});

// ---------------------------------------------------------------------------
// The commit point
// ---------------------------------------------------------------------------

test('the commit happens once, before dispatch, and carries the prepared policy', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  expectStatus(await recompute(runner), 'succeeded');

  // The gate is the single commit point, and the solver runs immediately after it.
  assert.deepEqual(runner.log, ['authorize:plan', 'authorize:dispatch', 'prepareCommit', 'commit', 'exec', 'authorize:accept']);
  const finalization = runner.finalizations[0];
  assert.equal(finalization.policyFingerprint, policyFingerprintFor(fix, DEFAULT_LIMITS, DEFAULT_INPUTS));
  assert.equal(finalization.inputDigest, digestSolverInputs(DEFAULT_INPUTS));
  assert.equal(finalization.solverSha256, fix.binding.solverSha256);
  assert.equal(finalization.workspaceGeneration, 'gen-1');
  assert.equal(finalization.reservationId, 'reservation-1');
  assert.deepEqual(finalization.principal, READER);
  assert.match(finalization.requestIdentity, /^[a-f0-9]{64}$/);
  assert.deepEqual(finalization.source, { threadId: 'thread-1', sourceVersionId: 'source-1', sourceHash: SOURCE_HASH });
  assert.ok(finalization.profileManifestSha256.length > 0);
  assert.ok(finalization.evidenceScope.length > 0);
});

test('the input file and the policy exist before the commit decision is taken', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  let preparedAtCommit: string[] = [];
  const runner = harness(fix, {
    onPrepare: async () => {
      preparedAtCommit = await readdir(join(fix.workspace, RECOMPUTE_DIRECTORY));
    },
  });
  runner.setObservation(exited(successfulStdout()));
  expectStatus(await recompute(runner), 'succeeded');
  assert.equal(preparedAtCommit.length, 1, 'the attempt input directory exists when the gate decides');
  assert.match(preparedAtCommit[0], /^req-1\./);
});

test('an authorization that is not bound to the prepared policy is refused', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, {
    commit: (input) => ({
      decision: 'committed', handoffToken: 'handoff-1',
      authorization: authorization({ policyFingerprint: 'a'.repeat(64) }),
      lease: leaseFor(input),
      attemptClaim: 'process-local',
    }),
  });
  runner.setObservation(exited(successfulStdout()));
  const outcome = await recompute(runner);
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'policy-mismatch');
  assert.equal(runner.calls.length, 0);
});

test('a refused or unknown handoff never dispatches and never becomes a success', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  const refused = harness(fix, { commit: () => ({ decision: 'refused', reason: 'The job attempt moved on.' }) });
  const refusal = await recompute(refused);
  expectStatus(refusal, 'rejected');
  if (refusal.status === 'rejected') assert.equal(refusal.code, 'handoff-refused');
  assert.equal(refused.calls.length, 0);

  const lapsed = harness(fix, { commit: () => ({ decision: 'expired', reason: 'The grant lapsed during preparation.' }) });
  const expiry = await recompute(lapsed);
  expectStatus(expiry, 'rejected');
  if (expiry.status === 'rejected') assert.equal(expiry.code, 'authorization-expired');

  const silent = harness(fix, { commit: () => ({ decision: 'unknown', reason: 'The transaction result was not observed.' }) });
  const unknown = await recompute(silent);
  expectStatus(unknown, 'outcome_unknown');
  assert.equal(silent.calls.length, 0);
  assert.equal(silent.cache.size, 0);
});

test('a commit that does not settle synchronously is refused, never dispatched', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  // The at-most-once claim and the handoff must be one synchronous transaction. A
  // gate whose commit returns a thenable reopens the window between the claim and
  // the dispatch, so the service refuses it rather than awaiting it and handing a
  // process off against a claim it cannot know settled.
  const runner = harness(fix, {
    commit: (input) => Promise.resolve({
      decision: 'committed', handoffToken: 'handoff-1',
      authorization: authorization({ policyFingerprint: input.policyFingerprint }),
      lease: leaseFor(input),
      attemptClaim: 'process-local',
    }),
  });
  runner.setObservation(exited(successfulStdout()));
  const outcome = await recompute(runner);
  expectStatus(outcome, 'outcome_unknown');
  assert.match((outcome as { reason: string }).reason, /did not settle synchronously/);
  assert.equal(runner.calls.length, 0, 'no process is handed off against an unsettled claim');
  assert.equal(runner.cache.size, 0);
  // The commit ran to the point of returning; only the boundary, not the gate, refused it.
  assert.deepEqual(runner.log, ['authorize:plan', 'authorize:dispatch', 'prepareCommit', 'commit']);
});

test('permission that moves between the reservation and the commit stops the run', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, {
    commit: (input) => ({
      decision: 'committed', handoffToken: 'handoff-1',
      authorization: authorization({ policyFingerprint: input.policyFingerprint, sitePermissionEpoch: 8 }),
      lease: leaseFor(input),
      attemptClaim: 'process-local',
    }),
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'authorization-refused');
  assert.equal(runner.calls.length, 0, 'no solver runs once permission moved');
});

// ---------------------------------------------------------------------------
// The generation lease
// ---------------------------------------------------------------------------

test('a lease that does not cover what was hashed refuses the attempt', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  const wrongGeneration = harness(fix, {
    lease: (input) => ({ ...leaseFor(input), workspaceGeneration: 'gen-other' }),
  });
  const drifted = await recompute(wrongGeneration);
  expectStatus(drifted, 'rejected');
  if (drifted.status === 'rejected') assert.equal(drifted.code, 'generation-drift');
  assert.equal(wrongGeneration.calls.length, 0, 'nothing runs without a lease on the hashed generation');

  const wrongManifest = harness(fix, {
    lease: (input) => ({ ...leaseFor(input), profileManifestSha256: 'c'.repeat(64) }),
  });
  const manifest = await recompute(wrongManifest);
  expectStatus(manifest, 'rejected');
  if (manifest.status === 'rejected') assert.equal(manifest.code, 'generation-drift');
  assert.equal(wrongManifest.calls.length, 0);
});

/**
 * The window between the commit and the handoff.
 *
 * `commit()` writes the durable claim and mints the lease; the service then makes its
 * last synchronous checks and can still refuse. A workspace rebuilt between preparing
 * the plan and committing is the reachable case: the gate mints a lease on the current
 * generation, which is not the one this attempt hashed. Before this regression the
 * service answered a clean `generation-drift` rejection and walked away from a claim
 * that was already durable, so every later recompute of the same content came back as
 * `already-claimed` — telling the reader a dispatch happened when none ever did.
 */
test('a durable claim committed for a handoff that never happened is withdrawn', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  let rebuilt = true;
  const runner = harness(fix, {
    durable: true,
    release: 'ok',
    lease: (input) => ({ ...leaseFor(input), workspaceGeneration: rebuilt ? 'gen-rebuilt' : input.workspaceGeneration }),
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'generation-drift');
  assert.equal(runner.calls.length, 0, 'nothing is dispatched');
  assert.equal(runner.releases.length, 1, 'the committed claim is withdrawn');
  assert.equal(runner.releases[0].requestIdentity, runner.finalizations[0].requestIdentity);
  assert.equal(runner.releases[0].handoffToken, 'handoff-1');
  assert.equal(runner.releases[0].leaseId, 'lease-1');
  assert.match(runner.releases[0].reason, /generation lease/);
  assert.equal(runner.claims.size, 0, 'the identity is free to be asked for again');
  assert.deepEqual(
    runner.log.filter((entry) => entry === 'commit' || entry === 'releaseClaim' || entry === 'exec'),
    ['commit', 'releaseClaim'],
    'the release runs after the commit and instead of the handoff',
  );

  // This is the observable reason release confirmation matters: after the host
  // confirms exact removal, the same content identity can be claimed and dispatched
  // by a later request once the generation is stable.
  rebuilt = false;
  runner.setObservation(exited(successfulStdout('req-2')));
  const retried = await recompute(runner, { execute: { requestId: 'req-2' } });
  expectStatus(retried, 'succeeded');
  assert.equal(runner.calls.length, 1, 'the confirmed release made a real retry dispatchable');
});

test('an unconfirmed no-op release leaves the claim standing and the retry cleanly refuses', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  const runner = harness(fix, {
    durable: true,
    release: 'no-op',
    lease: (input) => ({ ...leaseFor(input), workspaceGeneration: 'gen-rebuilt' }),
  });
  const first = await recompute(runner);
  expectStatus(first, 'outcome_unknown');
  if (first.status === 'outcome_unknown') assert.match(first.reason, /did not confirm removal of the exact/);
  assert.equal(runner.claims.size, 1, 'undefined is not confirmation and cannot clear the durable claim');

  const second = await recompute(runner, { execute: { requestId: 'req-2' } });
  expectStatus(second, 'outcome_unknown');
  if (second.status === 'outcome_unknown') assert.match(second.reason, /not dispatched again/);
  assert.equal(runner.calls.length, 0, 'neither the refused attempt nor its already-claimed retry dispatches');
  assert.equal(runner.releases.length, 1, 'the already-claimed retry does not pretend to release another owner’s claim');
});

test('an unreleasable durable claim is reported as unknown, not as a clean refusal', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  // A gate that writes durable claims but offers no way to withdraw one. The refusal
  // is real, but the host is not back where it started, so it must not read that way.
  const runner = harness(fix, {
    durable: true,
    release: 'none',
    lease: (input) => ({ ...leaseFor(input), workspaceGeneration: 'gen-rebuilt' }),
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'outcome_unknown');
  if (outcome.status === 'outcome_unknown') {
    assert.match(outcome.reason, /generation lease/, 'it still says why the recompute was refused');
    assert.match(outcome.reason, /cannot withdraw the attempt claim/);
  }
  assert.equal(runner.calls.length, 0, 'nothing is dispatched');
  assert.equal(runner.claims.size, 1, 'the claim is still standing, which is what the reader is told');
});

test('a release that fails leaves the outcome unknown rather than reporting success', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  const runner = harness(fix, {
    durable: true,
    release: 'throws',
    lease: (input) => ({ ...leaseFor(input), profileManifestSha256: 'c'.repeat(64) }),
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'outcome_unknown');
  if (outcome.status === 'outcome_unknown') {
    assert.match(outcome.reason, /Withdrawing the committed attempt claim failed/);
    assert.match(outcome.reason, /would not give the row back/, 'the host reason is carried, not swallowed');
  }
  assert.equal(runner.calls.length, 0);
  assert.equal(runner.releases.length, 1, 'the withdrawal was attempted');
});

test('thenable release results are refused synchronously and rejected thenables are observed', async (t) => {
  for (const release of ['thenable-resolves', 'thenable-rejects'] as const) {
    const fix = await fixture();
    t.after(fix.cleanup);
    const runner = harness(fix, {
      durable: true,
      release,
      lease: (input) => ({ ...leaseFor(input), workspaceGeneration: 'gen-rebuilt' }),
    });
    const outcome = await recompute(runner, { execute: { requestId: `req-${release}` } });
    expectStatus(outcome, 'outcome_unknown');
    if (outcome.status === 'outcome_unknown') assert.match(outcome.reason, /did not settle synchronously/);
    assert.equal(runner.calls.length, 0);
    assert.equal(runner.claims.size, 1, 'an asynchronous answer cannot confirm synchronous removal');
  }
  // Let the rejected promise's microtask run. The service attached its rejection
  // handler in the same stack, so the test process must remain free of an unhandled
  // rejection while reaching this assertion.
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test('a process-local claim needs no withdrawal and still refuses cleanly', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  // Nothing outside this process recorded the attempt, so a refusal really does
  // leave the host where it started.
  const runner = harness(fix, {
    durable: false,
    release: 'ok',
    lease: (input) => ({ ...leaseFor(input), workspaceGeneration: 'gen-rebuilt' }),
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'generation-drift');
  assert.equal(runner.releases.length, 0, 'no durable claim exists to withdraw');
  assert.equal(runner.calls.length, 0);
});

test('a lease that lapses while the solver runs is not accepted afterwards', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  let clock = Date.parse('2026-09-17T10:00:00.000Z');
  const runner = harness(fix, {
    now: () => clock,
    lease: (input) => ({ ...leaseFor(input), expiresAt: '2026-09-17T10:00:30.000Z' }),
  });
  runner.setObservation(async () => {
    clock += 45_000; // the solver outlived the lease
    return exited(successfulStdout());
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') {
    assert.equal(outcome.code, 'generation-drift');
    assert.match(outcome.reason, /lapsed/);
  }
  assert.equal(runner.calls.length, 1, 'the solver did run; its result is what is refused');
  assert.equal(runner.cache.size, 0);
});

// ---------------------------------------------------------------------------
// Idempotency and durability
// ---------------------------------------------------------------------------

test('without a durable journal the record says at-most-once is process local only', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  assert.equal(runner.service.durableAtMostOnce, false);
  const outcome = await recompute(runner);
  expectStatus(outcome, 'succeeded');
  if (outcome.status === 'succeeded') assert.equal(outcome.result.record.atMostOnce, 'process-local');
});

test('a durable claim answers inside the commit and is what the record names', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, { durable: true });
  runner.setObservation(exited(successfulStdout()));
  assert.equal(runner.service.durableAtMostOnce, true);

  const first = await recompute(runner);
  expectStatus(first, 'succeeded');
  if (first.status === 'succeeded') assert.equal(first.result.record.atMostOnce, 'durable-host-journal');

  // The bounded in-memory result cache is what would normally answer a repeat.
  // Clearing it is what a restart or an eviction does. The durable claim the gate
  // wrote inside the commit must answer instead and stop a second dispatch.
  runner.service.invalidateGrant('grant-1');
  const second = await recompute(runner, { execute: { requestId: 'req-2' } });
  expectStatus(second, 'outcome_unknown');
  assert.match((second as { reason: string }).reason, /not dispatched again/);
  assert.equal(runner.calls.length, 1, 'the durable claim, not the cache, prevented the second dispatch');
});

test('a repeated click on the same content returns the same outcome without running again', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  const first = await recompute(runner);
  const second = await recompute(runner);
  assert.deepEqual(first, second);
  assert.equal(runner.calls.length, 1);
  assert.deepEqual(await runner.service.result('req-1', READER), first);
});

test('an unknown outcome is remembered and never silently retried', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation({ status: 'unknown', reason: 'the adapter disconnected', terminationRequested: false, terminationHandoff: 'none', processStopConfirmed: false });
  const first = await recompute(runner);
  expectStatus(first, 'outcome_unknown');

  runner.setObservation(exited(successfulStdout()));
  const second = await recompute(runner);
  expectStatus(second, 'outcome_unknown');
  assert.equal(runner.calls.length, 1, 'the same request identity is not run a second time');
});

// ---------------------------------------------------------------------------
// Reading a settled outcome
// ---------------------------------------------------------------------------

test('reading a settled outcome is re-checked against current authority', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  let revoked = false;
  const runner = harness(fix, {
    decide: (input) => (revoked && input.stage === 'result-read'
      ? { decision: 'refused', reason: 'The reader withdrew permission.' }
      : { decision: 'allowed', authorization: authorization({ policyFingerprint: input.policyFingerprint }) }),
  });
  runner.setObservation(exited(successfulStdout()));
  expectStatus(await recompute(runner), 'succeeded');

  const allowed = await runner.service.result('req-1', READER);
  assert.ok(allowed);
  expectStatus(allowed, 'succeeded');
  assert.equal(stages(runner).at(-1), 'result-read', 'every poll takes a fresh decision');

  revoked = true;
  const refused = await runner.service.result('req-1', READER);
  assert.ok(refused);
  expectStatus(refused, 'rejected');
  if (refused.status === 'rejected') assert.equal(refused.code, 'authorization-refused');
});

test('a settled outcome whose authorization has expired is not handed back', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  let lapsed = false;
  const runner = harness(fix, {
    decide: (input) => ({
      decision: 'allowed',
      authorization: authorization({
        policyFingerprint: input.policyFingerprint,
        ...(lapsed ? { expiresAt: '2020-01-01T00:00:00.000Z' } : {}),
      }),
    }),
  });
  runner.setObservation(exited(successfulStdout()));
  expectStatus(await recompute(runner), 'succeeded');

  lapsed = true;
  const outcome = await runner.service.result('req-1', READER);
  assert.ok(outcome);
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'authorization-expired');
});

test('a settled outcome is invisible to another tab and to another thread', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  expectStatus(await recompute(runner), 'succeeded');

  assert.equal(await runner.service.result('req-1', OTHER_TAB), undefined);
  assert.equal(runner.service.inFlight('req-1', OTHER_TAB), false);
  const otherThread = await runner.service.result('req-1', { ...READER, threadId: 'thread-2' });
  assert.equal(otherThread, undefined);
});

test('a plan for another thread is refused before anything is prepared', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  const outcome = planFailure(await runner.service.prepare(planRequestFor(), { ...READER, threadId: 'thread-2' }));
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'authorization-refused');
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

test('a cache hit is distinguishable, spends no grant and starts no process', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  const first = await recompute(runner);
  expectStatus(first, 'succeeded');

  runner.setObservation(exited(successfulStdout('req-2')));
  const second = await recompute(runner, { execute: { requestId: 'req-2' } });
  expectStatus(second, 'succeeded');
  if (first.status !== 'succeeded' || second.status !== 'succeeded') return;

  assert.equal(second.origin, 'cache');
  assert.equal(runner.calls.length, 1, 'a cache hit does not run the solver again');
  // The commit point is where a once-grant would be spent. A cache read never reaches it.
  assert.equal(runner.finalizations.length, 1, 'a cache read never commits a second consumption');
  assert.deepEqual(stages(runner), ['plan', 'dispatch', 'accept', 'plan', 'dispatch', 'cache-read']);
  const cacheRead = runner.authorizations[5];
  assert.equal(cacheRead.policyFingerprint, policyFingerprintFor(fix, DEFAULT_LIMITS, DEFAULT_INPUTS));
  // The cached record still names the execution that actually produced the numbers.
  assert.equal(second.result.record.executionId, first.result.record.executionId);
  assert.equal(second.result.record.requestId, 'req-1');
  assert.equal(second.result.requestId, 'req-2');
});

test('a cache hit is refused when authority no longer allows it', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  let revoked = false;
  const runner = harness(fix, {
    decide: (input) => (revoked && input.stage === 'cache-read'
      ? { decision: 'refused', reason: 'The reader withdrew permission.' }
      : { decision: 'allowed', authorization: authorization({ policyFingerprint: input.policyFingerprint }) }),
  });
  runner.setObservation(exited(successfulStdout()));
  expectStatus(await recompute(runner), 'succeeded');

  revoked = true;
  const second = await recompute(runner, { execute: { requestId: 'req-2' } });
  expectStatus(second, 'rejected');
  if (second.status === 'rejected') assert.equal(second.code, 'authorization-refused');
  assert.equal(runner.calls.length, 1);
});

test('revoking a grant clears the cached work it authorized', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  expectStatus(await recompute(runner), 'succeeded');
  assert.equal(runner.service.invalidateGrant('grant-1'), 1);

  runner.setObservation(exited(successfulStdout('req-2')));
  const second = await recompute(runner, { execute: { requestId: 'req-2' } });
  expectStatus(second, 'succeeded');
  if (second.status === 'succeeded') assert.equal(second.origin, 'execution');
  assert.equal(runner.calls.length, 2);
  assert.equal(runner.finalizations.length, 2, 'a real second execution commits again');
});

// ---------------------------------------------------------------------------
// Output limits
// ---------------------------------------------------------------------------

test('an error, over-limit, unknown or invalid result never becomes a cache entry', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  const cases: [string, SolverCommandObservation, SolverOutcome['status']][] = [
    ['non zero exit', exited('', { exitCode: 3, stderr: 'traceback' }), 'failed'],
    ['unreadable adapter reply', { status: 'unknown', reason: 'the adapter reply could not be read', terminationRequested: false, terminationHandoff: 'none', processStopConfirmed: false }, 'outcome_unknown'],
    ['server truncated stdout', exited(successfulStdout(), { flags: { capReached: true } }), 'rejected'],
    ['host stopped holding stdout', exited(successfulStdout(), { flags: { hostBoundReached: true } }), 'rejected'],
    ['not json', exited('almost json'), 'rejected'],
    ['wrong block', exited(JSON.stringify({ schema: SOLVER_OUTPUT_SCHEMA, requestId: 'req-1', outputs: { 'other-1': { kind: 'values', values: { x: 1 } } } })), 'rejected'],
  ];

  for (const [name, observation, status] of cases) {
    const runner = harness(fix);
    runner.setObservation(observation);
    const outcome = await recompute(runner);
    expectStatus(outcome, status);
    assert.equal(runner.cache.size, 0, `${name} must not be cached`);
  }
});

test('a stderr overrun is refused, not reported as a within-limit success', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  // maxOutputBytes is documented per stream, so a solver that floods stderr has
  // exceeded its limit even when stdout is small and valid.
  const cases: [string, SolverCommandObservation][] = [
    ['the server truncated stderr', exited(successfulStdout(), { stderr: 'warning', stderrFlags: { capReached: true } })],
    ['the host stopped holding stderr', exited(successfulStdout(), { stderr: 'warning', stderrFlags: { hostBoundReached: true } })],
    ['stderr exceeded the byte limit', exited(successfulStdout(), { stderr: 'x'.repeat(65_537) })],
  ];

  for (const [name, observation] of cases) {
    const runner = harness(fix);
    runner.setObservation(observation);
    const outcome = await recompute(runner);
    expectStatus(outcome, 'rejected');
    if (outcome.status === 'rejected') {
      assert.equal(outcome.code, 'output-invalid', name);
      assert.match(outcome.reason, /stderr/, `${name} names the stream that overran`);
    }
    assert.equal(runner.cache.size, 0, `${name} must not be cached`);
  }
});

test('a valid stdout with quiet stderr still succeeds', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout(), { stderr: 'a progress note' }));
  const outcome = await recompute(runner);
  expectStatus(outcome, 'succeeded');
  if (outcome.status === 'succeeded') assert.equal(outcome.result.record.outputBytes, Buffer.byteLength(successfulStdout()));
});

test('an overrun of the time limit is reported without claiming the process was stopped', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  let clock = 1_000;
  const runner = harness(fix, { now: () => clock });
  runner.setObservation(async () => {
    clock += 5_000; // at the 5000 ms limit
    return exited('', { exitCode: 143, stderr: '' });
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'failed');
  if (outcome.status !== 'failed') return;
  assert.match(outcome.reason, /did not finish inside its 5000 ms limit/);
  assert.match(outcome.reason, /not confirmed/);
  // There is no timeout field in CommandExecResponse and no proof of a kill, so
  // the product must not tell the reader the work "was stopped".
  assert.equal(/was stopped/.test(outcome.reason), false);
  assert.equal(runner.cache.size, 0);
});

test('an ordinary solver error is not dressed up as a timeout', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  let clock = 1_000;
  const runner = harness(fix, { now: () => clock });
  runner.setObservation(async () => { clock += 12; return exited('', { exitCode: 1, stderr: 'boom' }); });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'failed');
  if (outcome.status !== 'failed') return;
  assert.equal(outcome.exitCode, 1);
  assert.equal(/limit/.test(outcome.reason), false);
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

test('cancelling fences the attempt, discards its late result and cleans up', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  let release: (value: SolverCommandObservation) => void = () => {};
  let dispatched: () => void = () => {};
  const running = new Promise<void>((resolve) => { dispatched = resolve; });
  runner.setObservation(() => {
    dispatched();
    return new Promise<SolverCommandObservation>((resolve) => { release = resolve; });
  });

  const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
  const pending = runner.service.request(executeFor(plan), READER);
  await running; // cancel only once the solver is actually running
  assert.equal(runner.service.inFlight('req-1', READER), true);
  assert.deepEqual(runner.service.cancel('req-1', READER), { cancelled: true, processStopConfirmed: false });
  const dispatch = runner.dispatches[0];
  assert.ok(dispatch?.signal, 'the attempt reached the command adapter with a fence');
  assert.equal(dispatch.signal.aborted, true, 'the running attempt is signalled to stop');

  release(exited(successfulStdout()));
  const outcome = await pending;
  expectStatus(outcome, 'cancelled');
  if (outcome.status === 'cancelled') assert.match(outcome.reason, /stop was not confirmed/);
  assert.equal(runner.cache.size, 0);
  assert.equal(runner.service.inFlight('req-1', READER), false);
  // The attempt input directory is removed even though the attempt was cancelled.
  assert.deepEqual(await readdir(join(fix.workspace, RECOMPUTE_DIRECTORY)), []);
});

test('another tab cannot cancel this reader\'s recompute', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  let release: (value: SolverCommandObservation) => void = () => {};
  let dispatched: () => void = () => {};
  const running = new Promise<void>((resolve) => { dispatched = resolve; });
  runner.setObservation(() => { dispatched(); return new Promise<SolverCommandObservation>((resolve) => { release = resolve; }); });

  const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
  const pending = runner.service.request(executeFor(plan), READER);
  await running;
  assert.deepEqual(runner.service.cancel('req-1', OTHER_TAB), { cancelled: false, processStopConfirmed: false });
  release(exited(successfulStdout()));
  expectStatus(await pending, 'succeeded');
});

test('cancelling an identity that is not running reports no confirmed stop', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  assert.deepEqual(runner.service.cancel('req-unknown', READER), { cancelled: false, processStopConfirmed: false });
});

// ---------------------------------------------------------------------------
// Authority and evidence
// ---------------------------------------------------------------------------

test('authority refusal and expiry are separate calm outcomes and run nothing', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  const refused = harness(fix, { decide: () => ({ decision: 'refused', reason: 'This site has no saved-solver grant.' }) });
  const refusal = await recompute(refused);
  expectStatus(refusal, 'rejected');
  if (refusal.status === 'rejected') assert.equal(refusal.code, 'authorization-refused');
  assert.equal(refused.calls.length, 0);
  assert.equal(refused.finalizations.length, 0);

  const stale = harness(fix, { decide: () => ({ decision: 'expired', reason: 'The grant lapsed.' }) });
  const expiry = await recompute(stale);
  expectStatus(expiry, 'rejected');
  if (expiry.status === 'rejected') assert.equal(expiry.code, 'authorization-expired');
  assert.equal(stale.calls.length, 0);
});

test('an authorization whose own expiry has passed is rejected as expired', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, { decide: () => ({ decision: 'allowed', authorization: authorization({ expiresAt: '2020-01-01T00:00:00.000Z' }) }) });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'authorization-expired');
  assert.equal(runner.calls.length, 0);
});

test('an authorization for a different grant cannot stand in for this request', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, { decide: () => ({ decision: 'allowed', authorization: authorization({ grantId: 'grant-9' }) }) });
  const outcome = await recompute(runner);
  // The plan itself binds whatever grant the plan stage named, so this refuses at
  // the click, when the grant no longer matches the one the plan recorded.
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'authorization-refused');
  assert.equal(runner.calls.length, 0);
});

test('missing isolation evidence returns unavailable rather than running anyway', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, { evidence: () => undefined });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'unavailable');
  if (outcome.status === 'unavailable') assert.equal(outcome.code, 'isolation-evidence-unavailable');
  assert.equal(runner.calls.length, 0);
  assert.equal(runner.finalizations.length, 0, 'nothing is committed without evidence');
});

test('partial isolation evidence is refused and reports its issues', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, {
    evidence: (policy) => { const evidence = evidenceFor(policy); delete evidence.runtime; return evidence; },
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'unavailable');
  if (outcome.status === 'unavailable') {
    assert.ok(outcome.issues && outcome.issues.some((issue) => issue.startsWith('evidence-missing:runtime')));
  }
  assert.equal(runner.calls.length, 0);
});

test('evidence collected for a different policy epoch is stale, not reusable', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, {
    evidence: (policy) => evidenceFor({ ...policy, evidenceScope: '0'.repeat(64) } as CodexPolicy),
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'unavailable');
  assert.equal(runner.calls.length, 0);
});

test('runtime evidence must name this platform and its reviewed backend', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  // Evidence from a different platform's backend is not evidence about this host.
  const otherBackend = HOST_PLATFORM === 'win32' ? 'linux-landlock-seccomp' : 'windows-native';
  const runner = harness(fix, {
    evidence: (policy) => {
      const evidence = evidenceFor(policy);
      if (evidence.runtime) evidence.runtime = { ...evidence.runtime, value: { ...evidence.runtime.value, backend: otherBackend } };
      return evidence;
    },
  });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'unavailable');
  if (outcome.status === 'unavailable') {
    assert.ok(outcome.issues?.some((issue) => issue.startsWith('runtime-evidence-unresolved')));
  }
  assert.equal(runner.calls.length, 0);
});

test('the reviewed policy is portable: consistent evidence is accepted on all three platforms', () => {
  // This asserts the shape of the T13 contract on win32, linux and darwin. It is
  // no claim that any sandbox was verified on any of them.
  const cases: [Platform, { workspace: string; codexHome: string; executable: string }][] = [
    ['win32', { workspace: 'C:\\Marginalia\\jobs\\one', codexHome: 'C:\\Marginalia\\codex-home', executable: 'C:\\Python\\python.exe' }],
    ['linux', { workspace: '/var/marginalia/jobs/one', codexHome: '/var/marginalia/codex-home', executable: '/usr/bin/python3' }],
    ['darwin', { workspace: '/Users/reader/jobs/one', codexHome: '/Users/reader/codex-home', executable: '/usr/bin/python3' }],
  ];
  const expectedBackends: Record<Platform, string> = {
    win32: 'windows-native', linux: 'linux-landlock-seccomp', darwin: 'macos-seatbelt',
  };

  for (const [platform, paths] of cases) {
    const separator = platform === 'win32' ? '\\' : '/';
    const policy = createCodexPolicy({
      version: PINNED_CODEX_VERSION, platform, adapter: 'app-server',
      workspace: paths.workspace, codexHome: paths.codexHome, auditId: 'audit-1',
      operation: 'saved-solver', executable: paths.executable,
      solverPath: `${paths.workspace}${separator}solver${separator}main.py`,
      inputPath: `${paths.workspace}${separator}${RECOMPUTE_DIRECTORY}${separator}req-1.token${separator}input.json`,
      writesWorkspace: false, timeoutMs: 5_000,
    });
    assert.equal(policy.reviewedProfile.runtimeBackend, expectedBackends[platform]);

    const decision = auditCodexPolicy(policy, evidenceFor(policy), 'dispatch');
    assert.equal(decision.decision, 'evidence-consistent', `${platform}: ${JSON.stringify(decision.issues)}`);
    assert.equal(decision.dispatchPolicySatisfied, true);
    // The module reports consistency of supplied evidence, never verification.
    assert.equal(decision.runtimeVerifiedHere, false);

    // Evidence that names another platform's backend is refused on every platform.
    const evidence = evidenceFor(policy);
    if (evidence.runtime) evidence.runtime = { ...evidence.runtime, value: { ...evidence.runtime.value, backend: 'windows-native', platform: 'win32' } };
    const wrong = auditCodexPolicy(policy, evidence, 'dispatch');
    assert.equal(wrong.decision === 'evidence-consistent', platform === 'win32');
  }
});

// ---------------------------------------------------------------------------
// Configuration and context
// ---------------------------------------------------------------------------

test('no configured command adapter means unavailable, never a local shell fallback', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, { transport: null });
  assert.equal(runner.service.configured, false);
  const outcome = planFailure(await runner.service.prepare(planRequestFor(), READER));
  expectStatus(outcome, 'unavailable');
  if (outcome.status === 'unavailable') assert.equal(outcome.code, 'not-configured');
});

test('a limit the adapter cannot enforce is refused rather than quietly dropped', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);

  // The limits are the host's own record, so this is a host configuration the
  // adapter cannot honour, not something a margin asked for.
  const memoryLimits: SolverLimits = { timeoutMs: 5_000, maxOutputBytes: 65_536, maxMemoryBytes: 64 * 1024 * 1024 };
  const noMemory = harness(fix, { context: contextFor(fix, baseReply(), memoryLimits) });
  const memory = planFailure(await noMemory.service.prepare(planRequestFor(), READER));
  expectStatus(memory, 'unavailable');
  if (memory.status === 'unavailable') assert.equal(memory.code, 'limit-enforcement-unavailable');

  const noTimeout = harness(fix, { enforces: { timeout: false, outputBytes: true, memoryBytes: false, maxTimeoutMs: 30_000 } });
  const timeout = planFailure(await noTimeout.service.prepare(planRequestFor(), READER));
  expectStatus(timeout, 'unavailable');
  if (timeout.status === 'unavailable') assert.equal(timeout.code, 'limit-enforcement-unavailable');
  assert.equal(noTimeout.calls.length, 0);

  // A solver limit longer than the adapter's own deadline is refused up front
  // rather than failing halfway through a run.
  const shortDeadline = harness(fix, { enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: 2_000 } });
  const tooLong = planFailure(await shortDeadline.service.prepare(planRequestFor(), READER));
  expectStatus(tooLong, 'unavailable');
  if (tooLong.status === 'unavailable') assert.equal(tooLong.code, 'limit-enforcement-unavailable');
  assert.equal(shortDeadline.calls.length, 0);
});

test('a stored reply that does not match its own hash is refused', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const tampered = baseReply();
  tampered.summary = 'Edited after the reply was committed.';
  const runner = harness(fix, { context: { ...contextFor(fix), reply: tampered } });
  const outcome = planFailure(await runner.service.prepare(planRequestFor(), READER));
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'unknown-reply');
});

test('a reply version the host does not hold is refused as unknown-reply', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const missing = new SolverExecutionService({
    context: { async resolve() { return undefined; } },
    authority: { async authorize() { return { decision: 'allowed', authorization: authorization() }; } },
    gate: { durableAtMostOnce: false, async prepareCommit() { return { commit() { return { decision: 'refused', reason: 'never called' }; } }; } },
    evidence: { async collect(policy) { return evidenceFor(policy); } },
    transport: {
      enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: 30_000 },
      async exec() { return { status: 'unknown', reason: 'never called', terminationRequested: false, terminationHandoff: 'none', processStopConfirmed: false }; },
    },
    codexHome: fix.codexHome,
    auditId: 'audit-1',
  });
  const outcome = planFailure(await missing.prepare(planRequestFor(), READER));
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'unknown-reply');
});

test('a reply without the solver capability cannot be recomputed', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, { context: { ...contextFor(fix), capabilities: ['samples'] } });
  const outcome = planFailure(await runner.service.prepare(planRequestFor(), READER));
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'unsupported-capability');
});

test('a solver block that does not name the recorded artifact is refused', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const renamed = baseReply();
  const block = renamed.blocks.find((candidate) => candidate.id === 'solver-1');
  if (!block || block.type !== 'solver') { assert.fail('solver block missing'); return; }
  block.path = 'solver/other.js';
  const runner = harness(fix, { context: { ...contextFor(fix, renamed), replyHash: digestReply(renamed) } });
  const outcome = planFailure(await runner.service.prepare(planRequestFor(), READER));
  expectStatus(outcome, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.code, 'artifact-unknown');
});

test('the attempt input file is removed after the recompute settles', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  let seen: string | undefined;
  runner.setObservation(async () => {
    seen = runner.calls[0].command[3];
    const payload = JSON.parse(await readFile(seen, 'utf8'));
    assert.equal(payload.requestId, 'req-1');
    assert.deepEqual(payload.inputs, DEFAULT_INPUTS);
    return exited(successfulStdout());
  });
  expectStatus(await recompute(runner), 'succeeded');
  assert.ok(seen);
  await assert.rejects(readFile(seen, 'utf8'));
});

test('the saved solver reads the prepared input and prints the declared output', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  // This case runs the solver through an unsandboxed local child process. It
  // proves the `solver --input <file>` protocol and the JSON round trip only.
  // It is not the product execution path and it proves no isolation.
  const runner = harness(fix, { realExecution: true });
  const outcome = await recompute(runner);
  expectStatus(outcome, 'succeeded');
  if (outcome.status !== 'succeeded') return;
  const derived = outcome.result.outputs['derived-1'];
  assert.equal(derived.kind, 'values');
  if (derived.kind === 'values') assert.ok(Math.abs(derived.values.halfLife - 3.4657359027997265) < 1e-9);
  assert.equal(outcome.result.record.modelTurns, 0);
});

// ---------------------------------------------------------------------------
// The route boundary
// ---------------------------------------------------------------------------

test('a reader completes a recompute through the route with only client-visible fields', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  runner.setObservation(exited(successfulStdout()));
  const handle = createSolverRoutes(runner.service);

  const prepared = await handle({ method: 'POST', pathname: '/api/solver/prepare', body: planRequestFor(), principal: READER });
  assert.equal(prepared?.status, 200);
  const plan = expectPlan((prepared?.body as { outcome: SolverPlanOutcome }).outcome);
  assert.equal(runner.calls.length, 0, 'nothing is dispatched while the reader is still deciding');

  const clicked = await handle({ method: 'POST', pathname: '/api/solver/recompute', body: executeFor(plan), principal: READER });
  assert.equal(clicked?.status, 200);
  const outcome = (clicked?.body as { outcome: SolverOutcome }).outcome;
  expectStatus(outcome, 'succeeded');
  assert.equal(runner.calls.length, 1);

  const read = await handle({
    method: 'GET', pathname: '/api/solver/result',
    search: new URLSearchParams({ requestId: 'req-1' }), principal: READER,
  });
  assert.equal((read?.body as { outcome: SolverOutcome }).outcome.status, 'succeeded');

  // Another tab polls the same identity and sees nothing.
  const other = await handle({
    method: 'GET', pathname: '/api/solver/result',
    search: new URLSearchParams({ requestId: 'req-1' }), principal: OTHER_TAB,
  });
  assert.deepEqual(other?.body, { outcome: null, inFlight: false });
});

test('the route refuses every recompute action without a paired session', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  const handle = createSolverRoutes(runner.service);

  for (const call of [
    { method: 'POST', pathname: '/api/solver/prepare', body: planRequestFor() },
    { method: 'POST', pathname: '/api/solver/recompute', body: {} },
    { method: 'POST', pathname: '/api/solver/cancel', body: { requestId: 'req-1' } },
    { method: 'GET', pathname: '/api/solver/result', search: new URLSearchParams({ requestId: 'req-1' }) },
  ]) {
    assert.equal((await handle(call))?.status, 401, call.pathname);
  }
  assert.equal(runner.calls.length, 0);
});

test('the route boundary exposes status, prepare, recompute, cancel and result', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix, { transport: null });
  const handle = createSolverRoutes(runner.service);

  assert.equal(await handle({ method: 'GET', pathname: '/api/reader/state' }), undefined);

  const status = await handle({ method: 'GET', pathname: '/api/solver/status' });
  assert.equal(status?.status, 200);
  assert.deepEqual(status?.body, {
    available: false,
    reason: 'No isolated command-execution adapter is configured.',
    modelTurns: 0,
    durableAtMostOnce: false,
  });

  const prepared = await handle({ method: 'POST', pathname: '/api/solver/prepare', body: planRequestFor(), principal: READER });
  assert.equal(prepared?.status, 200);
  assert.equal((prepared?.body as { outcome: SolverPlanOutcome }).outcome.status, 'unavailable');

  assert.equal((await handle({ method: 'GET', pathname: '/api/solver/prepare', principal: READER }))?.status, 405);
  assert.equal((await handle({ method: 'GET', pathname: '/api/solver/recompute', principal: READER }))?.status, 405);
  assert.equal((await handle({ method: 'POST', pathname: '/api/solver/cancel', body: { requestId: '../escape' }, principal: READER }))?.status, 400);
  assert.deepEqual((await handle({ method: 'POST', pathname: '/api/solver/cancel', body: { requestId: 'req-9' }, principal: READER }))?.body,
    { cancelled: false, processStopConfirmed: false });

  // An unconfigured service never reached an attempt, so it holds no settled
  // outcome: the identity stays free for a later, properly configured run.
  const result = await handle({ method: 'GET', pathname: '/api/solver/result', search: new URLSearchParams({ requestId: 'req-1' }), principal: READER });
  assert.equal(result?.status, 200);
  assert.deepEqual(result?.body, { outcome: null, inFlight: false });

  assert.equal((await handle({ method: 'GET', pathname: '/api/solver/result', search: new URLSearchParams({ requestId: '../escape' }), principal: READER }))?.status, 400);
  assert.equal((await handle({ method: 'GET', pathname: '/api/solver/nonsense', principal: READER }))?.status, 404);
});

test('a closing service accepts no new recompute', async (t) => {
  const fix = await fixture();
  t.after(fix.cleanup);
  const runner = harness(fix);
  const plan = expectPlan(await runner.service.prepare(planRequestFor(), READER));
  runner.service.close();

  const outcome = await runner.service.request(executeFor(plan), READER);
  expectStatus(outcome, 'unavailable');
  if (outcome.status === 'unavailable') assert.equal(outcome.code, 'not-configured');

  const planned = planFailure(await runner.service.prepare(planRequestFor(), READER));
  expectStatus(planned, 'unavailable');
});
