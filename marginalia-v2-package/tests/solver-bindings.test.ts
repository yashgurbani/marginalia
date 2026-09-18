import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../daemon/store.ts';
import { JobStore, packetDigest } from '../daemon/jobs/store.ts';
import { commitSucceededReplyWithSolverBindings, createJobSolverArtifactBindings } from '../daemon/jobs/solver-bindings.ts';
import { createStoreSolverContextSource, unavailableSolverEvidence, unavailableSolverExecutionGate } from '../daemon/solver/adapters.ts';
import { SolverExecutionService } from '../daemon/solver/service.ts';
import type { CandidateReply } from '../contracts/reply.ts';
import type { FrozenJobContext, JobConsentAuthority, StartJobInput } from '../contracts/jobs.ts';
import type { ProviderHandle } from '../contracts/job-runner.ts';

const SOURCE = 'A source passage.';
const SOLVER_SOURCE = 'process.stdout.write(JSON.stringify({schema:"marginalia.solver-output.v1",values:{answer:2}}));\n';

function candidate(withSolver = true): CandidateReply {
  return { schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Saved computation', summary: 'Saved computation.',
    sourceBindings: [], parameters: [{ name: 'x', label: 'Input', default: 1, min: 0, max: 10, unit: '' }],
    assumptions: [], limitations: [], ...(withSolver ? { requiredCapabilities: ['solver' as const] } : {}),
    blocks: withSolver ? [
      { id: 'answer', type: 'derived', name: 'answer', expression: 'x + 1', unit: '', label: 'Answer' },
      { id: 'solver-1', type: 'solver', path: 'solver/main.js', inputNames: ['x'], outputBlocks: ['answer'] },
    ] : [{ id: 'text', type: 'text', md: 'No executable artifact.' }],
    checks: [], staticFallback: 'Saved computation.' };
}

const authority = {
  withResultAcceptance: <T>(_job: unknown, _attemptId: string, commit: () => T) => commit(),
} as unknown as JobConsentAuthority;

async function fixture(withSolver = true) {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-solver-binding-'));
  const workspace = join(root, 'job-1');
  await mkdir(join(workspace, 'solver'), { recursive: true });
  if (withSolver) await writeFile(join(workspace, 'solver', 'main.js'), SOLVER_SOURCE, 'utf8');
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
    assert.match(binding.workspaceGeneration, /^directory:\d+:\d+$/);
    assert.match(binding.solverSha256, /^[a-f0-9]{64}$/);
    const context = await createStoreSolverContextSource({ replies: f.reader, jobs: f.store,
      bindings: createJobSolverArtifactBindings(f.store), limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 } })
      .resolve('job-1-reply', 'solver-1');
    assert.equal(context?.binding.solverSha256, binding.solverSha256);
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
