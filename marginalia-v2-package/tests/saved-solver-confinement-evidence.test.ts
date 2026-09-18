import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOLVER_EXECUTE_SCHEMA, SOLVER_PLAN_REQUEST_SCHEMA, solverStateKeyFrom, type SolverPlan } from '../contracts/solver.ts';
import { REPLY_SCHEMA, type CandidateReply } from '../contracts/reply.ts';
import { digestReply } from '../contracts/host-checks.ts';
import { PINNED_CODEX_VERSION, createCodexPolicy, type Platform } from '../daemon/codex-policy.ts';
import {
  PROBE_SENTINEL_PREFIX,
  confinementProbeCommand,
  createConfinementEvidenceCollector,
  readProbeSentinel,
} from '../daemon/solver/confinement-evidence.ts';
import { SolverExecutionService, type SolverRecomputeContext } from '../daemon/solver/service.ts';
import { SolverPolicyError, type SolverCommandObservation, type SolverCommandRequest, type SolverCommandTransport, type SolverExecOptions } from '../daemon/solver/transport.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const stream = (text: string) => ({
  text, bytes: Buffer.byteLength(text), capReached: false, hostBoundReached: false,
});

function exited(probe: 'filesystem-write' | 'loopback-network', outcome: 'denied' | 'not-denied' | 'inconclusive'): SolverCommandObservation {
  return { status: 'exited', exitCode: 0, stdout: stream(`${PROBE_SENTINEL_PREFIX}${probe}=${outcome}\n`), stderr: stream(''), streamed: true };
}

async function paths() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'marginalia-confinement-test-')));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function policy(platform: Platform) {
  const sep = platform === 'win32' ? '\\' : '/';
  const base = platform === 'win32' ? 'C:\\Marginalia' : platform === 'darwin' ? '/Users/reader/Marginalia' : '/var/lib/marginalia';
  const result = createCodexPolicy({
    version: PINNED_CODEX_VERSION, platform, adapter: 'app-server', auditId: 'audit-1',
    workspace: `${base}${sep}workspace`, codexHome: `${base}${sep}codex-home`, operation: 'saved-solver',
    executable: platform === 'win32' ? 'C:\\Node\\node.exe' : '/usr/bin/node',
    solverPath: `${base}${sep}workspace${sep}solver.js`, inputPath: `${base}${sep}workspace${sep}input.json`,
    writesWorkspace: false, timeoutMs: 5_000,
  });
  if (result.operation !== 'saved-solver') throw new Error('unreachable');
  return result;
}

type Outcome = 'denied' | 'not-denied' | 'inconclusive';

function transportFor(outcomes: Partial<Record<'filesystem-write' | 'loopback-network', Outcome | SolverCommandObservation>> = {}) {
  const requests: SolverCommandRequest[] = [];
  const dispatches: SolverExecOptions[] = [];
  const transport: SolverCommandTransport = {
    enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: 60_000 },
    async exec(request, options) {
      requests.push(request);
      dispatches.push(options);
      const probe = request.command[2].includes('filesystem-write') ? 'filesystem-write' : 'loopback-network';
      const scripted = outcomes[probe] ?? 'denied';
      return typeof scripted === 'string' ? exited(probe, scripted) : scripted;
    },
  };
  return { transport, requests, dispatches };
}

function collector(root: string, platform: Platform, outcomes = {}, status = 'ready') {
  const fake = transportFor(outcomes);
  const methods: string[] = [];
  const evidence = createConfinementEvidenceCollector({
    transport: fake.transport, probeRoot: root, newAttemptId: () => `${platform}-${fake.requests.length + 1}`,
    rpc: { async request(method) { methods.push(method); if (method !== 'windowsSandbox/readiness') throw new Error(`Unexpected RPC: ${method}`); return { status }; } },
  });
  return { ...fake, methods, evidence };
}

test('collect() returns no policy evidence on win32, linux or darwin, even when every probe is denied', async (t) => {
  const fix = await paths();
  t.after(fix.cleanup);
  for (const platform of ['win32', 'linux', 'darwin'] as const) {
    const { evidence } = collector(fix.root, platform);
    assert.equal(await evidence.collect(policy(platform), 'dispatch'), undefined);
    assert.equal(evidence.readiness()?.confinementObserved, false);
  }
});

test('a denied write probe leaves the verdict unverified and names why', async (t) => {
  const fix = await paths(); t.after(fix.cleanup);
  const { evidence } = collector(fix.root, 'linux');
  const readiness = await evidence.observe(policy('linux'));
  assert.equal(readiness.verdict, 'unverified');
  assert.ok(readiness.issues.includes('confinement-unobservable:linux'));
  assert.equal(readiness.issues.some(issue => issue.startsWith('confinement-falsified:')), false);
});

test('a write that succeeds outside the writable roots falsifies confinement', async (t) => {
  const fix = await paths(); t.after(fix.cleanup);
  const { evidence } = collector(fix.root, 'linux', { 'filesystem-write': 'not-denied' });
  const targetPolicy = policy('linux');
  const readiness = await evidence.observe(targetPolicy);
  assert.equal(readiness.verdict, 'not-confined');
  assert.ok(readiness.issues.includes('confinement-falsified:filesystem-write'));
  assert.equal(await evidence.collect(targetPolicy, 'dispatch'), undefined);
});

test("every probe runs at the policy's own sandbox, workspace and executable", async (t) => {
  const fix = await paths(); t.after(fix.cleanup);
  const targetPolicy = policy('linux');
  const { evidence, requests, dispatches } = collector(fix.root, 'linux');
  await evidence.observe(targetPolicy);
  for (const request of requests) {
    assert.deepEqual(request.sandboxPolicy, targetPolicy.sandboxPolicy);
    assert.equal(request.cwd, targetPolicy.commandExec.params.cwd);
    assert.equal(request.command[0], targetPolicy.commandExec.params.command[0]);
  }
  assert.deepEqual(requests[0].command, [
    ...confinementProbeCommand(targetPolicy, 'filesystem-write'), fix.root, dispatches[0].executionAttemptId,
  ]);
  assert.equal(dispatches.every(dispatch => dispatch.signal instanceof AbortSignal), true);
});

test('Windows readiness is reported and never repaired', async (t) => {
  const fix = await paths(); t.after(fix.cleanup);
  const { evidence, methods } = collector(fix.root, 'win32', {}, 'notConfigured');
  const readiness = await evidence.observe(policy('win32'));
  assert.ok(readiness.issues.includes('windows-sandbox-not-ready:notConfigured'));
  assert.deepEqual(methods, ['windowsSandbox/readiness']);
});

test('a missing rpc handle makes the Windows probe not-run, never passed', async (t) => {
  const fix = await paths(); t.after(fix.cleanup);
  const fake = transportFor();
  const evidence = createConfinementEvidenceCollector({ transport: fake.transport, probeRoot: fix.root });
  const readiness = await evidence.observe(policy('win32'));
  assert.equal(readiness.probes.find(result => result.probe === 'windows-sandbox-readiness')?.outcome, 'not-run');
  assert.ok(readiness.issues.includes('confinement-probe-not-run:windows-sandbox-readiness'));
  assert.equal(readiness.verdict, 'unverified');
});

test('Linux and macOS expose no readiness surface and the collector says so', async (t) => {
  const fix = await paths(); t.after(fix.cleanup);
  for (const platform of ['linux', 'darwin'] as const) {
    const { evidence, methods } = collector(fix.root, platform);
    const readiness = await evidence.observe(policy(platform));
    assert.deepEqual(readiness.probes.find(result => result.probe === 'windows-sandbox-readiness'), {
      probe: 'windows-sandbox-readiness', outcome: 'not-run',
      detail: 'This platform exposes no sandbox-readiness method in Codex 0.153.4.',
    });
    assert.ok(readiness.issues.includes(`confinement-unobservable:${platform}`));
    assert.deepEqual(methods, []);
  }
});

test('an unknown observation or a missing sentinel is inconclusive, never a denial', async (t) => {
  const fix = await paths(); t.after(fix.cleanup);
  const unknown: SolverCommandObservation = {
    status: 'unknown', reason: 'connection closed before the final response', terminationRequested: false,
    terminationHandoff: 'none', processStopConfirmed: false,
  };
  const missing: SolverCommandObservation = { status: 'exited', exitCode: 9, stdout: stream(''), stderr: stream(''), streamed: true };
  assert.equal(readProbeSentinel('filesystem-write', unknown).outcome, 'inconclusive');
  assert.equal(readProbeSentinel('loopback-network', missing).outcome, 'inconclusive');
  const { evidence } = collector(fix.root, 'linux', { 'filesystem-write': unknown, 'loopback-network': missing });
  const readiness = await evidence.observe(policy('linux'));
  assert.deepEqual(readiness.probes.slice(0, 2).map(result => result.outcome), ['inconclusive', 'inconclusive']);
  assert.ok(readiness.issues.includes('confinement-probe-inconclusive:filesystem-write'));
  assert.equal(readiness.verdict, 'unverified');
});

test('a model-turn policy cannot be probed', async (t) => {
  const fix = await paths(); t.after(fix.cleanup);
  const definition = createCodexPolicy({
    version: PINNED_CODEX_VERSION, platform: 'linux', adapter: 'app-server', auditId: 'audit-1',
    workspace: '/var/lib/marginalia/workspace', codexHome: '/var/lib/marginalia/codex-home',
    operation: 'definition', model: 'gpt-5', outputSchema: { type: 'object' },
  });
  const { evidence } = collector(fix.root, 'linux');
  await assert.rejects(() => evidence.observe(definition), SolverPolicyError);
  assert.throws(() => confinementProbeCommand(definition, 'filesystem-write'), SolverPolicyError);
});

test("the collector's issues reach the reader through the existing unavailable outcome", async (t) => {
  if (process.platform !== 'win32') { t.skip('This fixture exercises the requested win32 reader state.'); return; }
  const fix = await paths(); t.after(fix.cleanup);
  await Promise.all(['workspace', 'codex-home', 'probes'].map(name => mkdir(join(fix.root, name))));
  const workspace = await realpath(join(fix.root, 'workspace'));
  const codexHome = await realpath(join(fix.root, 'codex-home'));
  const probeRoot = await realpath(join(fix.root, 'probes'));
  const source = 'process.stdout.write("");';
  await writeFile(join(workspace, 'solver.js'), source, 'utf8');
  const reply: CandidateReply = {
    schema: REPLY_SCHEMA, intent: 'simulate', status: 'complete', title: 'Solver', summary: 'Saved solver.',
    sourceBindings: [], parameters: [{ name: 'x', label: 'X', default: 1, min: 0, max: 2, unit: '' }], assumptions: [], limitations: [],
    requiredCapabilities: ['solver'], blocks: [
      { id: 'out', type: 'derived', name: 'out', expression: 'x', label: 'Output', unit: '' },
      { id: 'solver', type: 'solver', path: 'solver.js', inputNames: ['x'], outputBlocks: ['out'] },
    ], checks: [], staticFallback: 'Unavailable.',
  };
  const context: SolverRecomputeContext = {
    reply, replyHash: digestReply(reply), threadId: 'thread-1', sourceVersionId: 'source-1', sourceHash: 'b'.repeat(64),
    binding: { jobId: 'job-1', attemptId: 'attempt-1', workspace, workspaceGeneration: 'gen-1', solverRelativePath: 'solver.js',
      solverSha256: createHash('sha256').update(source).digest('hex'), runtimeExecutable: await realpath(process.execPath),
      runtimeIdentity: process.release.name, runtimeVersion: process.version,
      runtimeSha256: createHash('sha256').update(await readFile(process.execPath)).digest('hex') },
    capabilities: ['solver'], limits: { timeoutMs: 5_000, maxOutputBytes: 4096 },
  };
  const fake = transportFor();
  const evidence = createConfinementEvidenceCollector({ transport: fake.transport, probeRoot });
  const service = new SolverExecutionService({
    context: { async resolve() { return context; } },
    authority: { async authorize(input) { return { decision: 'allowed', authorization: {
      grantId: 'grant-1', grantRevision: 1, reservationId: 'reservation-1', sitePermissionEpoch: 1,
      permissionFingerprint: 'fingerprint-1', expiresAt: '2099-01-01T00:00:00.000Z',
      ...(input.policyFingerprint ? { policyFingerprint: input.policyFingerprint } : {}),
    } }; } },
    gate: { durableAtMostOnce: false, async prepareCommit() { throw new Error('evidence refusal must precede commit'); } },
    evidence, transport: fake.transport, codexHome, auditId: 'audit-1', platform: 'win32',
  });
  const stateKey = solverStateKeyFrom('{"x":1}');
  const planned = await service.prepare({ schema: SOLVER_PLAN_REQUEST_SCHEMA, replyVersionId: 'reply-1', blockId: 'out', solverId: 'solver', inputs: { x: 1 }, stateKey },
    { siteOrigin: 'https://example.test', threadId: 'thread-1', sessionId: 'session-1' });
  assert.equal(planned.status, 'planned');
  if (planned.status !== 'planned') return;
  const plan = planned.plan as SolverPlan;
  const outcome = await service.request({ schema: SOLVER_EXECUTE_SCHEMA, requestId: 'req-1', planId: plan.planId, planToken: plan.planToken,
    replyVersionId: plan.replyVersionId, blockId: plan.blockId, solverId: plan.solverId, inputs: { x: 1 }, stateKey,
    requestedAt: '2026-09-18T10:00:00.000Z' }, { siteOrigin: 'https://example.test', threadId: 'thread-1', sessionId: 'session-1' });
  assert.equal(outcome.status, 'unavailable');
  if (outcome.status === 'unavailable') {
    assert.equal(outcome.code, 'isolation-evidence-unavailable');
    assert.ok(outcome.issues?.includes('confinement-unobservable:win32'));
  }
});
