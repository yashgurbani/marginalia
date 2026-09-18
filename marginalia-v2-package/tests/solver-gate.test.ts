import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../daemon/store.ts';
import { JobConflictError, JobStore, packetDigest } from '../daemon/jobs/store.ts';
import { commitSucceededReplyWithSolverBindings } from '../daemon/jobs/solver-bindings.ts';
import { createJobSolverExecutionGate, uncollectedSolverConfinement,
  type SolverCommitAuthorityReader, type SolverConfinementSource } from '../daemon/jobs/solver-gate.ts';
import type { CandidateReply } from '../contracts/reply.ts';
import { withFixtureOrigins } from './origins-fixture.ts';
import type { FrozenJobContext, JobConsentAuthority, StartJobInput } from '../contracts/jobs.ts';
import type { ProviderHandle } from '../contracts/job-runner.ts';
import type { SolverAuthorization, SolverFinalizationInput } from '../daemon/solver/service.ts';

const SOURCE = 'A source passage.';
const SOLVER_SOURCE = 'process.stdout.write(JSON.stringify({schema:"marginalia.solver-output.v1",values:{answer:2}}));\n';

const reply: CandidateReply = withFixtureOrigins({
  schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Saved computation', summary: 'Saved computation.',
  sourceBindings: [], parameters: [{ name: 'x', label: 'Input', default: 1, min: 0, max: 10, unit: '' }],
  assumptions: [], limitations: [], requiredCapabilities: ['solver'],
  blocks: [
    { id: 'answer', type: 'derived', name: 'answer', expression: 'x + 1', unit: '', label: 'Answer' },
    { id: 'solver-1', type: 'solver', path: 'solver/main.js', inputNames: ['x'], outputBlocks: ['answer'] },
  ],
  checks: [], staticFallback: 'Saved computation.',
});

const resultAuthority = {
  withResultAcceptance: <T>(_job: unknown, _attemptId: string, commit: () => T) => commit(),
} as unknown as JobConsentAuthority;

const authorization: SolverAuthorization = {
  grantId: 'grant-1', grantRevision: 1, reservationId: 'reservation-1', sitePermissionEpoch: 1,
  permissionFingerprint: 'permission-1', policyFingerprint: 'policy-1', expiresAt: '2099-01-01T00:00:00.000Z',
};

const allowedAuthority: SolverCommitAuthorityReader = {
  reread() { return { decision: 'allowed', authorization }; },
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-solver-gate-'));
  const workspace = join(root, 'job-1');
  await mkdir(join(workspace, 'solver'), { recursive: true });
  await writeFile(join(workspace, 'solver', 'main.js'), SOLVER_SOURCE, 'utf8');
  const reader = new ReaderStore(':memory:');
  reader.apply({ id: 'keep-1', kind: 'keep', threadId: 'thread-1',
    capture: { url: 'https://example.test/article', title: 'Article', pageType: 'article', text: SOURCE,
      capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' },
    anchor: { exact: SOURCE, prefix: '', suffix: '', start: 0, end: SOURCE.length } });
  const thread = reader.get('thread-1')!;
  const source = reader.sourceVersion(thread.sourceVersionId)!;
  const store = new JobStore(reader);
  const start: StartJobInput = { id: 'job-1', idempotencyKey: 'job-key-1', threadId: thread.id, intent: 'simulate', question: 'Compute.',
    provider: 'app-server', model: 'test-model', mode: 'workspace-files', policyKey: 'a'.repeat(64), grantId: 'grant-1',
    preparedPayloadDigest: 'b'.repeat(64), capabilities: ['solver'] };
  const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: source.id, sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle,
    sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt, sourceHash: source.hash, sourceText: source.text,
    passage: thread.anchor, question: start.question, intent: start.intent, preparedPayloadDigest: start.preparedPayloadDigest,
    modelSettingsRevision: 1, modelCompatibilityKey: 'test', outgoing: {} as FrozenJobContext['outgoing'] };
  store.create(start, context, packetDigest({ start, context }), packetDigest(start));
  const attempt = store.createAttempt(start.id);
  const handle: ProviderHandle = { jobId: attempt.id, workspace, policyKey: start.policyKey, model: start.model, mode: start.mode,
    provider: start.provider, providerInstanceId: 'provider-1', state: 'completed', tombstone: false, revision: 1, output: '{}' };
  reader.db.prepare(`UPDATE job_attempts SET state='validating',revision=1,dispatchClaimed=1,handoffMarked=1,workspacePrepared=1,providerHandle=? WHERE id=?`)
    .run(JSON.stringify(handle), attempt.id);
  reader.db.prepare("UPDATE jobs SET state='validating' WHERE id=?").run(start.id);
  await commitSucceededReplyWithSolverBindings({ store, authority: resultAuthority, job: store.get(start.id)!, attemptId: attempt.id,
    expectedRevision: 1, reply, workspace });
  const binding = store.solverArtifactBinding('job-1-reply', 'solver-1')!;
  const input: SolverFinalizationInput = {
    request: { schema: 'marginalia.solver-recompute.v1', requestId: 'request-1', replyVersionId: 'job-1-reply', replyHash: 'reply-hash',
      threadId: thread.id, sourceVersionId: source.id, sourceHash: source.hash, blockId: 'answer', solverId: 'solver-1', inputs: { x: 1 },
      stateKey: 'c'.repeat(64), grantId: start.grantId, policyKey: start.policyKey, limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 },
      requestedAt: '2026-09-18T00:00:00.000Z' },
    context: { reply, replyHash: 'reply-hash', threadId: thread.id, sourceVersionId: source.id, sourceHash: source.hash,
      binding, capabilities: ['solver'], limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 } },
    principal: { siteOrigin: 'https://example.test', threadId: thread.id, sessionId: 'session-1' },
    requestIdentity: 'request-identity-1', executionAttemptId: 'execution-attempt-1', policyFingerprint: 'policy-1',
    evidenceScope: 'evidence-1', profileManifestSha256: 'd'.repeat(64), workspaceGeneration: binding.workspaceGeneration,
    solverSha256: binding.solverSha256, inputDigest: 'e'.repeat(64),
    source: { threadId: thread.id, sourceVersionId: source.id, sourceHash: source.hash },
    reservationId: 'reservation-1', work: 'local-recompute', modelTurns: 0,
  };
  return { reader, store, input, binding, attemptId: attempt.id,
    close: async () => { reader.close(); await rm(root, { recursive: true, force: true }); } };
}

function observedConfinement(reference = 'test:confinement'): SolverConfinementSource {
  return { async observe(evidenceScope) {
    return { status: 'observed', platform: process.platform, evidenceScope, reference };
  } };
}

function observedGate(store: JobStore, reference = 'test:confinement') {
  return createJobSolverExecutionGate({ store, confinement: observedConfinement(reference), authority: allowedAuthority,
    now: () => Date.parse('2026-09-18T00:00:00.000Z'), clock: () => '2026-09-18T00:00:00.000Z',
    newLeaseId: () => 'lease-1', newHandoffToken: () => 'f'.repeat(64) });
}

test('the gate denies a recompute when this platform has no confinement evidence collector', async () => {
  const f = await fixture();
  try {
    const gate = createJobSolverExecutionGate({ store: f.store,
      confinement: uncollectedSolverConfinement('No collector is installed.'), authority: allowedAuthority });
    const decision = (await gate.prepareCommit(f.input)).commit();
    assert.equal(decision.decision, 'refused');
    if (decision.decision === 'refused') {
      assert.match(decision.reason, new RegExp(process.platform));
      assert.match(decision.reason, /confinement evidence/i);
    }
    assert.equal((f.reader.db.prepare('SELECT count(*) AS n FROM solver_execution_claims').get() as { n: number }).n, 0);
    assert.deepEqual(f.store.solverGateDecisions().map(row => ({ decision: row.decision, reasonCode: row.reasonCode,
      confinement: row.confinement, modelTurns: row.modelTurns })), [
      { decision: 'denied', reasonCode: 'confinement-evidence-uncollected', confinement: 'uncollected', modelTurns: 0 },
    ]);
  } finally { await f.close(); }
});

test('an observed confinement commit writes one durable claim and its decision in a single transaction', async () => {
  const f = await fixture();
  try {
    const reference = 'test:observed-confinement';
    const gate = observedGate(f.store, reference);
    const decision = (await gate.prepareCommit(f.input)).commit();
    assert.equal(gate.durableAtMostOnce, true);
    assert.equal(decision.decision, 'committed');
    if (decision.decision !== 'committed') return;
    assert.equal(decision.attemptClaim, 'durable-host-journal');
    assert.equal(decision.lease.workspaceGeneration, f.binding.workspaceGeneration);
    assert.equal(decision.lease.profileManifestSha256, f.input.profileManifestSha256);
    assert.ok(Date.parse(decision.lease.expiresAt) > Date.parse('2026-09-18T00:00:00.000Z'));
    const claims = f.reader.db.prepare('SELECT state FROM solver_execution_claims').all() as Array<{ state: string }>;
    assert.deepEqual(claims, [{ state: 'dispatched' }]);
    const decisions = f.store.solverGateDecisions();
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision, 'allowed');
    assert.equal(decisions[0].confinement, 'observed');
    assert.equal(decisions[0].confinementReference, reference);
  } finally { await f.close(); }
});

test('a second commit for the same request identity is already-claimed and dispatches nothing', async () => {
  const f = await fixture();
  try {
    const gate = observedGate(f.store);
    assert.equal((await gate.prepareCommit(f.input)).commit().decision, 'committed');
    const secondInput = { ...f.input, executionAttemptId: 'execution-attempt-2' };
    const second = (await gate.prepareCommit(secondInput)).commit();
    assert.deepEqual(second, { decision: 'already-claimed', state: 'dispatched',
      reason: 'This saved-solver recompute is already dispatched.' });
    const claims = f.reader.db.prepare('SELECT executionAttemptId FROM solver_execution_claims').all() as Array<{ executionAttemptId: string }>;
    assert.deepEqual(claims, [{ executionAttemptId: f.input.executionAttemptId }]);
    assert.equal(f.store.solverGateDecisions().at(-1)?.decision, 'already-claimed');
  } finally { await f.close(); }
});

test('a solver binding that moved after the plan is refused before any claim is written', async () => {
  const f = await fixture();
  try {
    const gate = observedGate(f.store);
    f.reader.db.prepare("UPDATE solver_artifact_bindings SET workspaceGeneration='directory:9:9' WHERE replyVersionId=? AND solverId=?")
      .run(f.input.request.replyVersionId, f.input.request.solverId);
    const moved = (await gate.prepareCommit(f.input)).commit();
    assert.equal(moved.decision, 'refused');
    if (moved.decision === 'refused') assert.match(moved.reason, /saved solver workspace moved/i);
    assert.equal((f.reader.db.prepare('SELECT count(*) AS n FROM solver_execution_claims').get() as { n: number }).n, 0);
    assert.equal(f.store.solverGateDecisions().at(-1)?.reasonCode, 'binding-moved');

    f.reader.db.prepare('UPDATE solver_artifact_bindings SET workspaceGeneration=? WHERE replyVersionId=? AND solverId=?')
      .run(f.binding.workspaceGeneration, f.input.request.replyVersionId, f.input.request.solverId);
    f.reader.db.prepare("UPDATE jobs SET state='failed' WHERE id=?").run(f.binding.jobId);
    const failed = (await gate.prepareCommit({ ...f.input, executionAttemptId: 'execution-attempt-2' })).commit();
    assert.equal(failed.decision, 'refused');
    assert.equal(f.store.solverGateDecisions().at(-1)?.reasonCode, 'job-not-succeeded');
    assert.equal((f.reader.db.prepare('SELECT count(*) AS n FROM solver_execution_claims').get() as { n: number }).n, 0);
  } finally { await f.close(); }
});

test('the gate evidences a zero-model decision without touching any other table', async () => {
  const f = await fixture();
  try {
    const tableNames = () => (f.reader.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map(row => row.name);
    const counts = () => Object.fromEntries(tableNames().map(name => [name,
      (f.reader.db.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n]));
    const namesBefore = tableNames();
    const countsBefore = counts();

    const deniedGate = createJobSolverExecutionGate({ store: f.store,
      confinement: uncollectedSolverConfinement('No collector is installed.'), authority: allowedAuthority });
    assert.equal((await deniedGate.prepareCommit(f.input)).commit().decision, 'refused');
    const gate = observedGate(f.store);
    const committed = (await gate.prepareCommit(f.input)).commit();
    assert.equal(committed.decision, 'committed');
    if (committed.decision !== 'committed') return;
    const released = gate.releaseClaim!({ requestIdentity: f.input.requestIdentity, executionAttemptId: f.input.executionAttemptId,
      handoffToken: committed.handoffToken, leaseId: committed.lease.leaseId, reason: 'Transport handoff did not begin.' });
    assert.deepEqual(released, { decision: 'released' });
    assert.equal((f.reader.db.prepare('SELECT state FROM solver_execution_claims').get() as { state: string }).state, 'released');
    assert.ok(f.store.solverGateDecisions().some(row => row.decision === 'released'));
    assert.ok(f.store.solverGateDecisions().every(row => row.modelTurns === 0));
    assert.throws(() => gate.releaseClaim!({ requestIdentity: f.input.requestIdentity, executionAttemptId: f.input.executionAttemptId,
      handoffToken: committed.handoffToken, leaseId: committed.lease.leaseId, reason: 'Repeat release.' }), JobConflictError);

    assert.deepEqual(tableNames(), namesBefore);
    const countsAfter = counts();
    for (const name of namesBefore) {
      if (name.startsWith('sqlite_') || name === 'solver_execution_claims' || name === 'solver_gate_decisions') continue;
      assert.equal(countsAfter[name], countsBefore[name], `${name} row count changed`);
    }
    assert.equal(countsAfter.solver_execution_claims, 1);
    assert.equal(countsAfter.solver_gate_decisions, 3);
  } finally { await f.close(); }
});
