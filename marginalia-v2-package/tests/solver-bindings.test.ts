import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, link, mkdir, mkdtemp, open, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveSolverArtifacts } from '../daemon/solver/artifacts.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../daemon/store.ts';
import { JobStore, packetDigest } from '../daemon/jobs/store.ts';
import { commitSucceededReplyWithSolverBindings, createJobSolverArtifactBindings } from '../daemon/jobs/solver-bindings.ts';
import { createStoreSolverContextSource, unavailableSolverEvidence, unavailableSolverExecutionGate } from '../daemon/solver/adapters.ts';
import { SolverExecutionService } from '../daemon/solver/service.ts';
import { createSolverRoutes } from '../daemon/solver/route.ts';
import type { CandidateReply } from '../contracts/reply.ts';
import { withFixtureOrigins } from './origins-fixture.ts';
import type { FrozenJobContext, JobConsentAuthority, StartJobInput } from '../contracts/jobs.ts';
import type { ProviderHandle } from '../contracts/job-runner.ts';
import { SOLVER_LIMITS, SOLVER_MANIFEST_SCHEMA } from '../contracts/solver.ts';

const SOURCE = 'A source passage.';
const SOLVER_SOURCE = 'process.stdout.write(JSON.stringify({schema:"marginalia.solver-output.v1",values:{answer:2}}));\n';

function candidate(withSolver = true): CandidateReply {
  return withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Saved computation', summary: 'Saved computation.',
    sourceBindings: [], parameters: [{ name: 'x', label: 'Input', default: 1, min: 0, max: 10, unit: '' }],
    assumptions: [], limitations: [], ...(withSolver ? { requiredCapabilities: ['solver' as const] } : {}),
    blocks: withSolver ? [
      { id: 'answer', type: 'derived', name: 'answer', expression: 'x + 1', unit: '', label: 'Answer' },
      { id: 'solver-1', type: 'solver', path: 'solver/main.js', inputNames: ['x'], outputBlocks: ['answer'] },
    ] : [{ id: 'text', type: 'text', md: 'No executable artifact.' }],
    checks: [], staticFallback: 'Saved computation.' });
}

const authority = {
  withResultAcceptance: <T>(_job: unknown, _attemptId: string, commit: () => T) => commit(),
} as unknown as JobConsentAuthority;

async function fixture(withSolver = true) {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-solver-binding-'));
  const workspace = join(root, 'job-1');
  await mkdir(join(workspace, 'solver'), { recursive: true });
  if (withSolver) {
    await writeFile(join(workspace, 'solver', 'main.js'), SOLVER_SOURCE, 'utf8');
    await writeFile(join(workspace, 'solver', 'manifest.json'), JSON.stringify({ schema: SOLVER_MANIFEST_SCHEMA,
      files: [{ path: 'solver/main.js', sha256: createHash('sha256').update(SOLVER_SOURCE).digest('hex') }],
      inputs: [{ name: 'x', min: 0, max: 10, default: 1, unit: '' }], outputs: ['answer'] }));
  }
  const reader = new ReaderStore(':memory:');
  reader.apply({ id: 'keep-1', kind: 'keep', threadId: 'thread-1',
    capture: { url: 'https://example.test/article', title: 'Article', pageType: 'article', text: SOURCE,
      capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' },
    anchor: { exact: SOURCE, prefix: '', suffix: '', start: 0, end: SOURCE.length } });
  const thread = reader.get('thread-1')!, source = reader.sourceVersion(thread.sourceVersionId)!;
  const store = new JobStore(reader);
  const input: StartJobInput = { id: 'job-1', idempotencyKey: 'job-key-1', threadId: thread.id, intent: 'simulate', question: 'Compute.',
    provider: 'app-server', model: 'test-model', mode: 'workspace-files', policyKey: 'a'.repeat(64), grantId: 'grant-1',
    preparedPayloadDigest: 'b'.repeat(64), capabilities: withSolver ? ['solver'] : [] };
  const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: source.id, sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle,
    sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt, sourceHash: source.hash, sourceText: source.text,
    passage: thread.anchor, question: input.question, intent: input.intent, preparedPayloadDigest: input.preparedPayloadDigest,
    modelSettingsRevision: 1, modelCompatibilityKey: 'test', outgoing: {} as FrozenJobContext['outgoing'] };
  store.create(input, context, packetDigest({ input, context }), packetDigest(input));
  const attempt = store.createAttempt(input.id);
  const handle: ProviderHandle = { jobId: attempt.id, workspace, policyKey: input.policyKey, model: input.model, mode: input.mode,
    provider: input.provider, providerInstanceId: 'provider-1', state: 'completed', tombstone: false, revision: 1, output: '{}' };
  reader.db.prepare(`UPDATE job_attempts SET state='validating',revision=1,dispatchClaimed=1,handoffMarked=1,workspacePrepared=1,providerHandle=? WHERE id=?`)
    .run(JSON.stringify(handle), attempt.id);
  reader.db.prepare("UPDATE jobs SET state='validating' WHERE id=?").run(input.id);
  return { root, workspace, reader, store, attemptId: attempt.id, reply: candidate(withSolver),
    close: async () => { reader.close(); await rm(root, { recursive: true, force: true }); } };
}

test('a solver binding is pinned in the reply commit and resolves through the real context source', async () => {
  const f = await fixture();
  try {
    const job = f.store.get('job-1')!;
    await commitSucceededReplyWithSolverBindings({ store: f.store, authority, job, attemptId: f.attemptId,
      expectedRevision: 1, reply: f.reply, workspace: f.workspace });
    const binding = await createJobSolverArtifactBindings(f.store).resolve('job-1-reply', 'solver-1');
    assert.ok(binding);
    assert.equal(binding.jobId, 'job-1');
    assert.equal(binding.attemptId, f.attemptId);
    assert.equal(binding.solverRelativePath, 'solver/main.js');
    assert.match(binding.workspaceGeneration, /^manifest-v1:directory:\d+:\d+$/);
    assert.match(binding.solverSha256, /^[a-f0-9]{64}$/);
    assert.equal(binding.runtimeIdentity, process.release.name);
    assert.equal(binding.runtimeVersion, process.version);
    assert.equal(binding.runtimeSha256, createHash('sha256').update(await readFile(process.execPath)).digest('hex'));
    const context = await createStoreSolverContextSource({ replies: f.reader, jobs: f.store,
      bindings: createJobSolverArtifactBindings(f.store), limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 } })
      .resolve('job-1-reply', 'solver-1');
    assert.equal(context?.binding.solverSha256, binding.solverSha256);
  } finally { await f.close(); }
});

test('a binding recorded under interpreter A is rejected under interpreter B and never executes', async () => {
  const f = await fixture();
  try {
    await commitSucceededReplyWithSolverBindings({ store: f.store, authority, job: f.store.get('job-1')!, attemptId: f.attemptId,
      expectedRevision: 1, reply: f.reply, workspace: f.workspace });
    f.reader.db.prepare('UPDATE solver_artifact_bindings SET runtimeVersion=? WHERE replyVersionId=? AND solverId=?')
      .run('interpreter-A', 'job-1-reply', 'solver-1');
    let executions = 0;
    const context = createStoreSolverContextSource({ replies: f.reader, jobs: f.store,
      bindings: createJobSolverArtifactBindings(f.store), limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 } });
    const service = new SolverExecutionService({ context,
      authority: { async authorize() { throw new Error('Interpreter drift must be detected before authority.'); } },
      gate: unavailableSolverExecutionGate('No execution gate in this binding test.'),
      evidence: unavailableSolverEvidence('No evidence collector in this binding test.'),
      transport: { enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: 10_000 },
        async exec() { executions++; throw new Error('A solver recorded under interpreter A must not execute under interpreter B.'); } },
      codexHome: join(f.root, 'codex-home'), auditId: 'binding-test' });
    try {
      const outcome = await service.prepare({ schema: 'marginalia.solver-plan-request.v1', replyVersionId: 'job-1-reply',
        blockId: 'answer', solverId: 'solver-1', inputs: { x: 1 }, stateKey: 'c'.repeat(64) },
      { siteOrigin: 'https://example.test', threadId: 'thread-1', sessionId: 'session-1' });
      assert.equal(outcome.status, 'rejected');
      if (outcome.status === 'rejected') {
        assert.equal(outcome.code, 'artifact-modified');
        assert.equal(outcome.reason, 'This saved solver was recorded for a different interpreter. Ask again to rebuild it with the current interpreter.');
      }
      assert.equal(executions, 0);
    } finally { service.close(); }
  } finally { await f.close(); }
});

test('same-path interpreter binary drift with unchanged daemon metadata refuses before authority and transport', async () => {
  const f = await fixture();
  try {
    await commitSucceededReplyWithSolverBindings({ store: f.store, authority, job: f.store.get('job-1')!, attemptId: f.attemptId,
      expectedRevision: 1, reply: f.reply, workspace: f.workspace });
    const executable = join(f.root, 'node-copy.exe');
    await copyFile(process.execPath, executable);
    // Redirect only the host-owned test binding to identical bytes outside the workspace.
    f.reader.db.prepare('UPDATE solver_artifact_bindings SET runtimeExecutable=?').run(executable);
    const binding = f.store.solverArtifactBinding('job-1-reply', 'solver-1')!;
    assert.equal((await resolveSolverArtifacts(binding)).ok, true);
    const file = await open(executable, 'r+');
    try { const byte = Buffer.alloc(1); await file.read(byte, 0, 1, 0); byte[0] ^= 1; await file.write(byte, 0, 1, 0); }
    finally { await file.close(); }
    assert.equal(binding.runtimeIdentity, process.release.name);
    assert.equal(binding.runtimeVersion, process.version);
    let authorizations = 0, executions = 0;
    const service = new SolverExecutionService({
      context: createStoreSolverContextSource({ replies: f.reader, jobs: f.store,
        bindings: createJobSolverArtifactBindings(f.store), limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 } }),
      authority: { async authorize() { authorizations++; throw new Error('Must reject before authority.'); } },
      gate: unavailableSolverExecutionGate('Test gate unavailable.'), evidence: unavailableSolverEvidence('Test evidence unavailable.'),
      transport: { enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: 10_000 },
        async exec() { executions++; throw new Error('Must not execute modified binary.'); } },
      codexHome: join(f.root, 'codex-home'), auditId: 'binary-drift' });
    try {
      const outcome = await service.prepare({ schema: 'marginalia.solver-plan-request.v1', replyVersionId: 'job-1-reply',
        blockId: 'answer', solverId: 'solver-1', inputs: { x: 1 }, stateKey: 'c'.repeat(64) },
        { siteOrigin: 'https://example.test', threadId: 'thread-1', sessionId: 'session-1' });
      assert.equal(outcome.status, 'rejected');
      if (outcome.status === 'rejected') { assert.equal(outcome.code, 'artifact-modified'); assert.match(outcome.reason, /interpreter.*pinned hash/); }
      assert.equal(authorizations, 0); assert.equal(executions, 0);
      assert.equal((await resolveSolverArtifacts({ ...binding, runtimeSha256: undefined })).ok, false);
    } finally { service.close(); }
  } finally { await f.close(); }
});

test('editing a solver after reply commit is rejected as artifact-modified by the real service', async () => {
  const f = await fixture();
  try {
    await commitSucceededReplyWithSolverBindings({ store: f.store, authority, job: f.store.get('job-1')!, attemptId: f.attemptId,
      expectedRevision: 1, reply: f.reply, workspace: f.workspace });
    await writeFile(join(f.workspace, 'solver', 'main.js'), 'process.stdout.write("changed");\n', 'utf8');
    const context = createStoreSolverContextSource({ replies: f.reader, jobs: f.store,
      bindings: createJobSolverArtifactBindings(f.store), limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 } });
    const service = new SolverExecutionService({ context,
      authority: { async authorize() { throw new Error('Artifact drift must be detected before authority.'); } },
      gate: unavailableSolverExecutionGate('No execution gate in this binding test.'),
      evidence: unavailableSolverEvidence('No evidence collector in this binding test.'),
      transport: { enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: 10_000 },
        async exec() { throw new Error('A modified artifact must never execute.'); } },
      codexHome: join(f.root, 'codex-home'), auditId: 'binding-test' });
    try {
      const outcome = await service.prepare({ schema: 'marginalia.solver-plan-request.v1', replyVersionId: 'job-1-reply',
        blockId: 'answer', solverId: 'solver-1', inputs: { x: 1 }, stateKey: 'c'.repeat(64) },
      { siteOrigin: 'https://example.test', threadId: 'thread-1', sessionId: 'session-1' });
      assert.equal(outcome.status, 'rejected');
      if (outcome.status === 'rejected') assert.equal(outcome.code, 'artifact-modified');
    } finally { service.close(); }
  } finally { await f.close(); }
});

test('a reply without a solver block commits no artifact binding rows', async () => {
  const f = await fixture(false);
  try {
    await commitSucceededReplyWithSolverBindings({ store: f.store, authority, job: f.store.get('job-1')!, attemptId: f.attemptId,
      expectedRevision: 1, reply: f.reply, workspace: f.workspace });
    const count = (f.reader.db.prepare('SELECT count(*) AS n FROM solver_artifact_bindings').get() as { n: number }).n;
    assert.equal(count, 0);
    assert.equal(f.store.get('job-1')?.state, 'succeeded');
  } finally { await f.close(); }
});

for (const manifestState of ['missing', 'linked', 'oversized'] as const) {
  test(`a persisted succeeded reply stays readable while its ${manifestState} manifest refuses before authority and execution`, async () => {
    const f = await fixture();
    try {
      await commitSucceededReplyWithSolverBindings({ store: f.store, authority, job: f.store.get('job-1')!,
        attemptId: f.attemptId, expectedRevision: 1, reply: f.reply, workspace: f.workspace });
      const saved = f.reader.reply('job-1-reply'); assert.ok(saved); assert.equal(f.store.get('job-1')?.state, 'succeeded');
      const manifestPath = join(f.workspace, 'solver', 'manifest.json');
      if (manifestState === 'missing') await unlink(manifestPath);
      if (manifestState === 'linked') await link(manifestPath, join(f.root, 'linked-saved-manifest'));
      if (manifestState === 'oversized') await writeFile(manifestPath, Buffer.alloc(SOLVER_LIMITS.maxManifestBytes + 1));
      let authorizations = 0, executions = 0;
      const service = new SolverExecutionService({
        context: createStoreSolverContextSource({ replies: f.reader, jobs: f.store,
          bindings: createJobSolverArtifactBindings(f.store), limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 } }),
        authority: { async authorize() { authorizations++; throw new Error('An invalid saved manifest must refuse before authority.'); } },
        gate: unavailableSolverExecutionGate('An invalid saved manifest must refuse before its gate.'),
        evidence: unavailableSolverEvidence('An invalid saved manifest must refuse before evidence collection.'),
        transport: { enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: 10_000 },
          async exec() { executions++; throw new Error('An invalid saved manifest must never execute.'); } },
        codexHome: join(f.root, 'codex-home'), auditId: `legacy-manifest-${manifestState}` });
      try {
        const response = await createSolverRoutes(service)({ method: 'POST', pathname: '/api/solver/prepare', body: {
          schema: 'marginalia.solver-plan-request.v1', replyVersionId: 'job-1-reply', blockId: 'answer', solverId: 'solver-1',
          inputs: { x: 1 }, stateKey: 'c'.repeat(64) }, principal: {
          siteOrigin: 'https://example.test', threadId: 'thread-1', sessionId: 'session-1' } });
        assert.equal(response?.status, 200); assert.deepEqual(response?.body, { outcome: { status: 'rejected', code: 'manifest-required',
          reason: 'This saved solver needs a manifest before it can run. Your saved reply remains available to read.' } });
        assert.equal(authorizations, 0); assert.equal(executions, 0);
        assert.equal(f.store.get('job-1')?.state, 'succeeded'); assert.deepEqual(f.reader.reply('job-1-reply'), saved);
        assert.ok(f.store.solverArtifactBinding('job-1-reply', 'solver-1'));
      } finally { service.close(); }
    } finally { await f.close(); }
  });
}

for (const scenario of ['extra file', 'extra root file', 'changed file', 'linked file', 'linked manifest', 'undeclared input',
  'changed range', 'wrong outputs', 'unknown manifest field', 'missing manifest', 'oversized solver', 'oversized manifest', 'ungranted authoring'] as const) {
  test(`solver authoring refuses ${scenario} before committing a reply or binding`, async () => {
    const f = await fixture();
    try {
      const solver = join(f.workspace, 'solver', 'main.js'), manifestPath = join(f.workspace, 'solver', 'manifest.json');
      if (scenario === 'extra file') await writeFile(join(f.workspace, 'solver', 'helper.js'), 'extra');
      if (scenario === 'extra root file') await writeFile(join(f.workspace, 'extra.txt'), 'extra');
      if (scenario === 'changed file') await writeFile(solver, 'changed');
      if (scenario === 'linked file') await link(solver, join(f.root, 'linked-solver'));
      if (scenario === 'linked manifest') await link(manifestPath, join(f.root, 'linked-manifest'));
      if (scenario === 'missing manifest') await unlink(manifestPath);
      if (scenario === 'oversized solver') await writeFile(solver, Buffer.alloc(SOLVER_LIMITS.maxSolverBytes + 1));
      if (scenario === 'oversized manifest') await writeFile(manifestPath, Buffer.alloc(SOLVER_LIMITS.maxManifestBytes + 1));
      if (['undeclared input', 'changed range', 'wrong outputs', 'unknown manifest field'].includes(scenario)) {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (scenario === 'undeclared input') manifest.inputs[0].name = 'hidden';
        if (scenario === 'changed range') manifest.inputs[0].max = 11;
        if (scenario === 'wrong outputs') manifest.outputs = ['solver-1'];
        if (scenario === 'unknown manifest field') manifest.execute = true;
        await writeFile(manifestPath, JSON.stringify(manifest));
      }
      const job = f.store.get('job-1')!;
      if (scenario === 'ungranted authoring') job.mode = 'structured-final';
      await assert.rejects(commitSucceededReplyWithSolverBindings({ store: f.store, authority, job,
        attemptId: f.attemptId, expectedRevision: 1, reply: f.reply, workspace: f.workspace }));
      assert.equal(f.store.get('job-1')?.state, 'validating');
      assert.equal(f.store.solverArtifactBinding('job-1-reply', 'solver-1'), undefined);
    } finally { await f.close(); }
  });
}

test('legacy pinned binding resolves without a manifest and retains all execution pins', async () => {
  const f = await fixture();
  try {
    await commitSucceededReplyWithSolverBindings({ store: f.store, authority, job: f.store.get('job-1')!,
      attemptId: f.attemptId, expectedRevision: 1, reply: f.reply, workspace: f.workspace });
    f.reader.db.prepare("UPDATE solver_artifact_bindings SET workspaceGeneration=replace(workspaceGeneration,'manifest-v1:','')").run();
    await unlink(join(f.workspace, 'solver', 'manifest.json'));
    const expected = f.store.solverArtifactBinding('job-1-reply', 'solver-1');
    assert.ok(expected);
    assert.deepEqual(await createJobSolverArtifactBindings(f.store).resolve('job-1-reply', 'solver-1'), expected);
    assert.match(expected.solverSha256, /^[a-f0-9]{64}$/);
    assert.match(expected.runtimeSha256!, /^[a-f0-9]{64}$/);
    assert.equal((await resolveSolverArtifacts(expected)).ok, true);
    const unsafe = await resolveSolverArtifacts({ ...expected, solverRelativePath: '../escape.js' });
    assert.equal(unsafe.ok, false);
    const runtimeDrift = await resolveSolverArtifacts({ ...expected, runtimeSha256: '0'.repeat(64) });
    assert.equal(runtimeDrift.ok, false);
    await writeFile(join(f.workspace, 'solver', 'main.js'), 'changed solver');
    const modified = await resolveSolverArtifacts(expected);
    assert.equal(modified.ok, false);
    if (!modified.ok) assert.equal(modified.code, 'artifact-modified');
  } finally { await f.close(); }
});
