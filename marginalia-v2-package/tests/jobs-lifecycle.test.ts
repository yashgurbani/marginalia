import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../daemon/store.ts';
import { JobService } from '../daemon/jobs/service.ts';
import { JobStore } from '../daemon/jobs/store.ts';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import { prepareContinuationWorkspace, prepareWorkspace, restoreCompletedWorkspace } from '../daemon/jobs/workspace.ts';
import { JOB_WORKSPACE_INSTRUCTIONS } from '../daemon/jobs/envelope.ts';
import { directoryIdentity } from '../daemon/jobs/workspace-integrity.ts';
import type { AuthorizedRuntimeFactory } from '../daemon/jobs/runtime.ts';
import type { FrozenJobContext, JobSnapshot, StartJobInput } from '../contracts/jobs.ts';
import { ProviderNotSentError, type ProviderHandle, type ProviderRequest } from '../contracts/job-runner.ts';
import { capabilitiesForIntent, type ReplyCapability, type CandidateReply } from '../contracts/reply.ts';
import { SOLVER_MANIFEST_SCHEMA } from '../contracts/solver.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

const policyKey = 'a'.repeat(64);
function starting(request: ProviderRequest): ProviderHandle {
  const { jobId, workspace, policyKey, model, mode } = request;
  return { jobId, workspace, policyKey, model, mode, provider: 'app-server', providerInstanceId: 'test-provider', state: 'starting', tombstone: false };
}
function fixture(sourceText = 'Start with this passage.', database = ':memory:') {
  const reader = new ReaderStore(database);
  reader.apply({ id: 'keep-job-test', kind: 'keep', threadId: 'thread-job-test',
    capture: { url: 'https://example.org/article', title: 'Article', pageType: 'article', text: sourceText,
      capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' },
    anchor: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5 } });
  return reader;
}
const library = { modelFor: () => ({ model: 'test-model', settingsRevision: 1, compatibilityKey: 'test' }),
  continuationIdentity: () => 'b'.repeat(64) };
function factory(revalidate: AuthorizedRuntimeFactory['consent']['revalidate']): AuthorizedRuntimeFactory {
  return { dispatchReady: true, consent: { revalidate: async (job, stage) => ({ ...await revalidate(job, stage), ...(stage === 'dispatch' ? { eligibilityFingerprint: 'e'.repeat(64) } : {}) }),
    assertSharedDatabase: () => undefined, finalizeDispatch: (job, attemptId) => ({ id: 'authorization', jobId: job.id, attemptId,
      grantId: job.grantId, grantRevision: 1, sitePermissionEpoch: 0, site: 'https://example.org', scope: 'open-session', recipient: 'test',
      provider: job.provider, policyKey: job.policyKey, bindingDigest: job.preparedPayloadDigest, permissionFingerprint: 'f'.repeat(64), egressEventId: 'egress' }),
    withResultAcceptance: (_job, _attempt, commit) => commit(), recordOutcome: () => undefined },
     create: async () => { throw new Error('Provider must not start in this test.'); } };
}
function textOnlyReply(number: number): CandidateReply {
  return withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: `Follow-up ${number}`,
    summary: `Follow-up ${number}.`, sourceBindings: [], parameters: [], assumptions: [], limitations: [],
    blocks: [{ id: `follow-up-${number}`, type: 'text', md: `Follow-up ${number}.` }], checks: [], staticFallback: `Follow-up ${number}.` });
}
function solverReply(title = 'Saved computation'): CandidateReply {
  return withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title, summary: `${title}.`,
    sourceBindings: [], parameters: [{ name: 'x', label: 'Input', default: 1, min: 0, max: 10, unit: '',
      sourceBinding: { name: 'start', meaning: 'The starting value.', relation: 'interpreted', selector: { exact: 'Start' } } }], assumptions: [], limitations: [],
    requiredCapabilities: ['solver' as const], blocks: [
      { id: 'answer', type: 'derived', name: 'answer', expression: 'x + 1', unit: '', label: 'Answer' },
      { id: 'solver-1', type: 'solver', path: 'solver/main.js', inputNames: ['x'], outputBlocks: ['answer'] },
    ], checks: [], staticFallback: `${title}.` });
}
async function writeSolverArtifacts(workspace: string, source: string) {
  await mkdir(join(workspace, 'solver'), { recursive: true });
  await writeFile(join(workspace, 'solver', 'main.js'), source);
  const solverSha256 = createHash('sha256').update(source).digest('hex');
  await writeFile(join(workspace, 'solver', 'manifest.json'), JSON.stringify({ schema: SOLVER_MANIFEST_SCHEMA,
    files: [{ path: 'solver/main.js', sha256: solverSha256 }], inputs: [{ name: 'x', min: 0, max: 10, default: 1, unit: '' }], outputs: ['answer'] }));
  return solverSha256;
}

async function waitForCondition(
  condition: () => boolean,
  description: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForJob(
  jobs: JobService,
  id: string,
  predicate: (job: JobSnapshot) => boolean,
  description: string,
  timeoutMs = 10_000,
): Promise<JobSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let last: JobSnapshot | undefined;
  while (Date.now() < deadline) {
    last = jobs.get(id);
    if (last && predicate(last)) return last;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${description}; last state: ${last?.state ?? 'missing'}.`);
}

test('preparation reports the shared result shape and bounds duplicated UTF-8 content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture('Start' + '😀'.repeat(12_000));
  const jobs = new JobService({ reader, workspaceRoot: root, library, defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] },
    runtimeFactory: factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' })) });
  try {
    const prepared = await jobs.prepare({ id: 'large-job', idempotencyKey: 'large-key', threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    assert.equal(prepared.consent.bindingDigest, prepared.job.preparedPayloadDigest);
    assert.ok(prepared.consent.outgoing.reduce((sum, part) => sum + Buffer.byteLength(part.text), 0) <= 60 * 1024);
    assert.match(prepared.consent.outgoing[0].text, /UTF-8 preview budget/);
    assert.equal(prepared.job.mode, 'workspace-files');
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('a revoked principal after preparation awaits cannot persist a new reviewed request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture();
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] },
    runtimeFactory: factory(async () => ({ grantId: 'grant', policyKey })) });
  try {
    let current = true;
    const pending = jobs.prepare({ id: 'revoked-job', idempotencyKey: 'revoked-key', threadId: 'thread-job-test',
      intent: 'explore', question: 'Explain.' }, () => current);
    current = false;
    await assert.rejects(pending, /Pairing changed/);
    assert.equal(reader.db.prepare('SELECT 1 FROM job_preparations WHERE jobId=?').get('revoked-job'), undefined);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('cancel before handoff settles locally and cannot become a timeout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture();
  let release!: () => void;
  let dispatchRevalidationFinished = false;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const jobs = new JobService({ reader, workspaceRoot: root, library, timeoutMs: 1000,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] },
    runtimeFactory: factory(async () => {
      await waiting;
      dispatchRevalidationFinished = true;
      return { grantId: 'grant', policyKey, auditScope: 'scope' };
    }) });
  try {
    const prepared = await jobs.prepare({ id: 'cancel-job', idempotencyKey: 'cancel-key', threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    const created = await jobs.create({ ...prepared.job, grantId: 'grant' });
    assert.ok(created.latestAttemptId);
    assert.equal((await jobs.cancel(created.id)).state, 'cancelled');
    release();
    await waitForCondition(() => dispatchRevalidationFinished, 'cancelled dispatch revalidation');
    assert.equal(jobs.get(created.id)?.state, 'cancelled');
    assert.equal(jobs.get(created.id)?.attempts[0].handoffMarked, false);
    assert.equal(jobs.get(created.id)?.attempts[0].sentContent, undefined);
  } finally { release(); await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('pre-handoff refusals are not sent; a canonical handoff cannot be downgraded by an error label', async () => {
  for (const [suffix, provider, finalized, expected] of [
    ['matching', 'app-server', false, 'failed'], ['mismatch', 'mcp-server', false, 'failed'],
    ['post-handoff', 'app-server', true, 'outcome_unknown'],
  ] as const) {
    const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
    const reader = fixture();
    const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
    const runtimeFactory: AuthorizedRuntimeFactory = { ...base,
      create: async (_job, _attempt, _workspace, host) => ({ close: () => undefined, runner: {
        capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
        start: async request => { if (finalized) host.finalizeSend(request, starting(request)); throw new ProviderNotSentError(provider, request.jobId, new Error('authorization')); },
        resume: async () => { throw new Error('Unexpected resume.'); },
        inspect: async () => { throw new Error('Unexpected inspect.'); },
        cancel: async () => { throw new Error('Unexpected cancel.'); },
      } }) };
    const jobs = new JobService({ reader, workspaceRoot: root, library,
      defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] }, runtimeFactory });
    try {
      const prepared = await jobs.prepare({ id: `not-sent-${suffix}`, idempotencyKey: `not-sent-key-${suffix}`,
        threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
      await jobs.create({ ...prepared.job, grantId: 'grant' });
      const settled = await waitForJob(jobs, `not-sent-${suffix}`,
        job => job.state === 'failed' || job.state === 'outcome_unknown', `${suffix} pre-handoff settlement`);
      assert.equal(settled.state, expected);
      assert.equal(settled.attempts[0].dispatchClaimed, finalized);
      assert.equal(settled.attempts[0].handoffMarked, finalized);
    } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
  }
});

test('runtime preparation failure leaves the handoff and once-grant untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture();
  let finalized = 0;
  const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
  const runtimeFactory: AuthorizedRuntimeFactory = { ...base,
    consent: { ...base.consent, finalizeDispatch: (...args) => { finalized++; return base.consent.finalizeDispatch(...args); } },
    create: async () => { throw new Error('native runtime preparation failed'); } };
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] }, runtimeFactory });
  try {
    const prepared = await jobs.prepare({ id: 'prep-failure', idempotencyKey: 'prep-failure-key',
      threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    await jobs.create({ ...prepared.job, grantId: 'grant' });
    const failed = await waitForJob(jobs, 'prep-failure', job => job.state === 'failed', 'runtime preparation failure');
    assert.equal(failed.state, 'failed');
    assert.equal(failed.attempts[0].handoffMarked, false);
    assert.equal(finalized, 0);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('runner uncertainty after handoff stays unknown with one finalization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const database = join(root, 'reader.sqlite'), reader = fixture('Start with this passage.', database);
  let finalized = 0, starts = 0;
  const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
  const runtimeFactory: AuthorizedRuntimeFactory = { ...base,
    consent: { ...base.consent, finalizeDispatch: (...args) => { finalized++; return base.consent.finalizeDispatch(...args); } },
    create: async (_job, _attempt, _workspace, host) => ({ close: () => undefined, runner: {
      capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
      start: async request => { host.finalizeSend(request, starting(request)); starts++; throw new Error('send outcome unconfirmed'); },
      resume: async () => { throw new Error('Unexpected resume.'); },
      inspect: async () => { throw new Error('Unexpected inspect.'); },
      cancel: async () => { throw new Error('Unexpected cancel.'); },
    } }) };
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] }, runtimeFactory });
  try {
    const prepared = await jobs.prepare({ id: 'uncertain-job', idempotencyKey: 'uncertain-key',
      threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    await jobs.create({ ...prepared.job, grantId: 'grant' });
    const sent = await waitForJob(jobs, 'uncertain-job', job => job.state === 'outcome_unknown', 'uncertain provider outcome');
    assert.equal(sent.state, 'outcome_unknown');
    assert.equal(sent.attempts[0].handoffMarked, true);
    assert.deepEqual(sent.attempts[0].sentContent, prepared.consent.outgoing);
    assert.equal(sent.preparedPayloadDigest, prepared.consent.bindingDigest);
    assert.equal(finalized, 1);
    assert.equal(starts, 1);
    const reopened = new ReaderStore(database);
    try { assert.deepEqual(new JobStore(reopened).get(sent.id)?.attempts[0].sentContent, prepared.consent.outgoing); }
    finally { reopened.close(); }
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('real once grant stays spent and handoff marked after uncertain transport', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture(), consent = new ConsentSessionService({ db: reader.db });
  let starts = 0;
  const runtimeFactory: AuthorizedRuntimeFactory = { dispatchReady: true, consent,
    create: async (_job, _attempt, _workspace, host) => ({ close: () => undefined, runner: {
      capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
      start: async request => { host.finalizeSend(request, starting(request)); starts++; throw new Error('transport outcome unconfirmed'); },
      resume: async () => { throw new Error('Unexpected resume.'); },
      inspect: async () => { throw new Error('Unexpected inspect.'); },
      cancel: async () => { throw new Error('Unexpected cancel.'); },
    } }) };
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] }, runtimeFactory });
  try {
    const prepared = await jobs.prepare({ id: 'real-uncertain', idempotencyKey: 'real-uncertain-key',
      threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    const preview = consent.prepare(prepared.consent);
    const grant = consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'this-time' },
      { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' });
    await jobs.create({ ...prepared.job, grantId: grant.id });
    const current = await waitForJob(jobs, 'real-uncertain', job => job.state === 'outcome_unknown', 'real uncertain provider outcome');
    assert.equal(current.state, 'outcome_unknown');
    assert.equal(current.attempts[0].handoffMarked, true);
    assert.equal((reader.db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(grant.id) as { consumedAttemptId: string }).consumedAttemptId, current.latestAttemptId);
    assert.equal((reader.db.prepare('SELECT count(*) n FROM consent_attempt_authorizations WHERE attemptId=?').get(current.latestAttemptId) as { n: number }).n, 1);
    assert.equal((reader.db.prepare('SELECT count(*) n FROM egress_events WHERE attemptId=?').get(current.latestAttemptId) as { n: number }).n, 1);
    await jobs.recover();
    assert.equal(jobs.get('real-uncertain')?.state, 'outcome_unknown');
    assert.equal(starts, 1);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('real once grant survives asynchronous runtime preparation failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture(), consent = new ConsentSessionService({ db: reader.db });
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] },
    runtimeFactory: { dispatchReady: true, consent, create: async () => { throw new Error('runtime preparation failed'); } } });
  try {
    const prepared = await jobs.prepare({ id: 'real-prep-failure', idempotencyKey: 'real-prep-failure-key',
      threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    const preview = consent.prepare(prepared.consent);
    const grant = consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'this-time' },
      { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' });
    await jobs.create({ ...prepared.job, grantId: grant.id });
    const current = await waitForJob(jobs, 'real-prep-failure', job => job.state === 'failed', 'real runtime preparation failure');
    assert.equal(current.state, 'failed');
    assert.equal(current.attempts[0].handoffMarked, false);
    assert.equal((reader.db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(grant.id) as { consumedAttemptId: string | null }).consumedAttemptId, null);
    assert.equal((reader.db.prepare('SELECT count(*) n FROM consent_attempt_authorizations').get() as { n: number }).n, 0);
    assert.equal((reader.db.prepare('SELECT count(*) n FROM egress_events').get() as { n: number }).n, 0);
    const nextAttempt = jobs.store.createAttempt(current.id);
    const eligible = await consent.revalidate(jobs.get(current.id)!, 'dispatch');
    assert.equal(jobs.get(current.id)!.latestAttemptId, nextAttempt.id);
    assert.match(eligible.eligibilityFingerprint ?? '', /^[a-f0-9]{64}$/);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('retry keeps frozen source lineage and original capabilities when the ceiling expands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture();
  const unavailable = factory(async () => { throw new Error('No current consent.'); });
  const first = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] }, runtimeFactory: unavailable });
  try {
    const prepared = await first.prepare({ id: 'retry-parent', idempotencyKey: 'retry-parent-key',
      threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    await first.create({ ...prepared.job, grantId: 'grant' });
    const failed = await waitForJob(first, 'retry-parent', job => job.state === 'failed', 'retry parent failure');
    assert.equal(failed.state, 'failed');
  } finally { await first.close(); }
  const next = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: ['samples'] }, runtimeFactory: unavailable });
  try {
    const retry = await next.prepareRetry('retry-parent', { id: 'retry-child', idempotencyKey: 'retry-child-key' });
    const packet = JSON.parse(retry.consent.outgoing[0].text) as { availableCapabilities: string[]; source: { sourceHash: string } };
    assert.deepEqual(packet.availableCapabilities, []);
    (next as unknown as { assertHostPlan(input: typeof retry.job, previous: JobSnapshot): void }).assertHostPlan(retry.job, next.get('retry-parent')!);
    assert.equal(packet.source.sourceHash, next.get('retry-parent')?.context.sourceHash);
  } finally { await next.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('continuation verifies reviewed files before mutation and rejects undeclared artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const packet = { schema: 'marginalia.job-packet.v1' as const, intent: 'explore' as const, question: 'Question',
    source: { url: 'https://example.org', title: 'Example', pageType: null, capturedAt: null, sourceHash: 'hash', sourceVersionId: 'source' },
    selection: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5, originalEnd: 5, omittedCharacters: 0 },
    adjacentContext: { before: '', after: '', basis: 'bounded-character-context' as const }, availableCapabilities: [], omissions: [] };
  try {
    const workspace = await prepareWorkspace(root, 'attempt', packet, '{"type":"object"}');
    assert.equal(await restoreCompletedWorkspace(root, workspace, packet), workspace);
    await writeFile(join(workspace, 'reply.schema.json'), '{}');
    await assert.rejects(prepareContinuationWorkspace(workspace, 'attempt', packet, '{"type":"object"}'), /differs/);
    await writeFile(join(workspace, 'reply.schema.json'), '{"type":"object"}');
    await writeFile(join(workspace, 'SKILL.md'), JOB_WORKSPACE_INSTRUCTIONS);
    await writeFile(join(workspace, 'solver.py'), 'print(1)');
    await assert.rejects(prepareContinuationWorkspace(workspace, 'attempt', packet, '{"type":"object"}'), /Undeclared/);
    assert.equal((await readFile(join(workspace, 'packet.json'), 'utf8')).includes('Question'), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a follow-up preserves and resumes with the unchanged host-pinned solver', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p05-solver-followup-')), reader = fixture();
  const parent = await persistedSolverParent(root, reader); let starts = 0, resumes = 0;
  const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
  const runtimeFactory: AuthorizedRuntimeFactory = { ...base, create: async (_job, _attempt, _workspace, host) => ({ close: () => undefined, runner: {
    capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
    start: async () => { starts++; throw new Error('A continuation must resume.'); },
    resume: async (previous, request) => {
      if (!request) throw new Error('A continuation request is required.');
      resumes++; assert.equal(await readFile(join(request.workspace, 'solver', 'main.js'), 'utf8'), parent.solverSource);
      host.finalizeSend(request, { ...starting(request), threadId: previous.threadId }); throw new Error('resume outcome unconfirmed');
    },
    inspect: async () => { throw new Error('Unexpected inspect.'); }, cancel: async () => { throw new Error('Unexpected cancel.'); },
  } }) };
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: ['solver'], solverAuthoring: false }, runtimeFactory });
  try {
    const prepared = await jobs.prepareFollowup('solver-parent', { id: 'solver-followup', idempotencyKey: 'solver-followup-key', question: 'Continue.' });
    (jobs as unknown as { assertHostPlan(input: typeof prepared.job, previous: JobSnapshot): void }).assertHostPlan(prepared.job, jobs.get('solver-parent')!);
    await jobs.followup('solver-parent', { id: 'solver-followup', idempotencyKey: 'solver-followup-key', question: 'Continue.',
      grantId: 'grant', preparedPayloadDigest: prepared.job.preparedPayloadDigest });
    const settled = await waitForJob(jobs, 'solver-followup', job => ['outcome_unknown', 'failed'].includes(job.state), 'solver continuation resume');
    assert.equal(settled.state, 'outcome_unknown', settled.reason);
    assert.equal(settled.attempts[0].handoffMarked, true); assert.equal(starts, 0); assert.equal(resumes, 1);
    assert.equal(createHash('sha256').update(await readFile(join(parent.workspace, 'solver', 'main.js'))).digest('hex'), parent.solverSha256);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('two consecutive follow-ups retain an ancestor solver after a text-only reply', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p05-solver-followup-chain-')), reader = fixture();
  const parent = await persistedSolverParent(root, reader), manifestBefore = await readFile(join(parent.workspace, 'solver', 'manifest.json'));
  let starts = 0, resumes = 0;
  const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
  const runtimeFactory: AuthorizedRuntimeFactory = { ...base, create: async (_job, _attempt, _workspace, host) => ({ close: () => undefined, runner: {
    capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
    start: async () => { starts++; throw new Error('A saved-solver follow-up must resume.'); },
    resume: async (previous, request) => {
      if (!request) throw new Error('A continuation request is required.');
      resumes++;
      const sent = host.finalizeSend(request, { ...starting(request), threadId: previous.threadId });
      await writeFile(join(request.workspace, 'reply.json'), JSON.stringify(textOnlyReply(resumes)));
      const completed = await host.checkpoint({ ...sent, state: 'completed' });
      if (!completed) throw new Error('The fake provider did not checkpoint completion.');
      return completed;
    },
    inspect: async () => { throw new Error('Unexpected inspect.'); }, cancel: async () => { throw new Error('Unexpected cancel.'); },
  } }) };
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: ['solver'], solverAuthoring: false }, runtimeFactory });
  try {
    const firstPrepared = await jobs.prepareFollowup('solver-parent', { id: 'solver-chain-one', idempotencyKey: 'solver-chain-one-key', question: 'Continue once.' });
    await jobs.followup('solver-parent', { id: 'solver-chain-one', idempotencyKey: 'solver-chain-one-key', question: 'Continue once.',
      grantId: 'grant', preparedPayloadDigest: firstPrepared.job.preparedPayloadDigest });
    const first = await waitForJob(jobs, 'solver-chain-one', job => job.state === 'succeeded', 'first saved-solver follow-up');
    assert.ok(first.replyVersionId);
    assert.equal(reader.reply(first.replyVersionId!)!.reply.blocks.some(block => block.type === 'solver'), false);

    const secondPrepared = await jobs.prepareFollowup(first.id, { id: 'solver-chain-two', idempotencyKey: 'solver-chain-two-key', question: 'Continue twice.' });
    await jobs.followup(first.id, { id: 'solver-chain-two', idempotencyKey: 'solver-chain-two-key', question: 'Continue twice.',
      grantId: 'grant', preparedPayloadDigest: secondPrepared.job.preparedPayloadDigest });
    const second = await waitForJob(jobs, 'solver-chain-two', job => job.state === 'succeeded', 'second saved-solver follow-up');
    assert.ok(second.replyVersionId);
    assert.equal(reader.reply(second.replyVersionId!)!.reply.blocks.some(block => block.type === 'solver'), false);
    assert.equal(starts, 0); assert.equal(resumes, 2);
    assert.equal(await readFile(join(parent.workspace, 'solver', 'main.js'), 'utf8'), parent.solverSource);
    assert.equal((await readFile(join(parent.workspace, 'solver', 'manifest.json'))).toString(), manifestBefore.toString());
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('a newer explicitly authored solver survives a follow-up after the older reply is removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p05-solver-followup-newer-')), reader = fixture();
  const parent = await persistedSolverParent(root, reader), newerSource = 'process.stdout.write(JSON.stringify({answer:3}));\n';
  let starts = 0, resumes = 0;
  const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
  const runtimeFactory: AuthorizedRuntimeFactory = { ...base, create: async (_job, _attempt, _workspace, host) => ({ close: () => undefined, runner: {
    capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
    start: async () => { starts++; throw new Error('A compatible solver follow-up must resume.'); },
    resume: async (previous, request) => {
      if (!request) throw new Error('A continuation request is required.');
      resumes++;
      assert.equal(request.workspace, parent.workspace);
      if (resumes === 1) {
        const solverSha256 = await writeSolverArtifacts(request.workspace, newerSource);
        await writeFile(join(request.workspace, 'reply.json'), JSON.stringify(solverReply('Newer saved computation')));
        const sent = host.finalizeSend(request, { ...starting(request), threadId: previous.threadId });
        const completed = await host.checkpoint({ ...sent, state: 'completed' });
        if (!completed) throw new Error('The fake provider did not checkpoint the authored solver.');
        assert.equal(solverSha256, createHash('sha256').update(newerSource).digest('hex'));
        return completed;
      }
      assert.equal(await readFile(join(request.workspace, 'solver', 'main.js'), 'utf8'), newerSource);
      await writeFile(join(request.workspace, 'reply.json'), JSON.stringify(textOnlyReply(2)));
      const sent = host.finalizeSend(request, { ...starting(request), threadId: previous.threadId });
      const completed = await host.checkpoint({ ...sent, state: 'completed' });
      if (!completed) throw new Error('The fake provider did not checkpoint the follow-up.');
      return completed;
    },
    inspect: async () => { throw new Error('Unexpected inspect.'); }, cancel: async () => { throw new Error('Unexpected cancel.'); },
  } }) };
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: ['solver'], solverAuthoring: true }, runtimeFactory });
  try {
    const firstPrepared = await jobs.prepareFollowup('solver-parent', { id: 'solver-newer-one', idempotencyKey: 'solver-newer-one-key', question: 'Author a newer solver.' });
    await jobs.followup('solver-parent', { id: 'solver-newer-one', idempotencyKey: 'solver-newer-one-key', question: 'Author a newer solver.',
      grantId: 'grant', preparedPayloadDigest: firstPrepared.job.preparedPayloadDigest });
    const first = await waitForJob(jobs, 'solver-newer-one', job => job.state === 'succeeded', 'newer authored solver follow-up');
    assert.ok(first.replyVersionId);
    const newerBinding = jobs.store.solverArtifactBinding(first.replyVersionId!, 'solver-1');
    assert.ok(newerBinding);
    assert.notEqual(newerBinding.solverSha256, parent.solverSha256);
    const removed = reader.setReplyRemoved({ id: 'remove-older-solver-reply', replyVersionId: 'solver-parent-reply', removed: true, expectedRevision: 1 });
    assert.ok(removed.deletedAt);

    const secondPrepared = await jobs.prepareFollowup(first.id, { id: 'solver-newer-two', idempotencyKey: 'solver-newer-two-key', question: 'Continue after the newer solver.' });
    await jobs.followup(first.id, { id: 'solver-newer-two', idempotencyKey: 'solver-newer-two-key', question: 'Continue after the newer solver.',
      grantId: 'grant', preparedPayloadDigest: secondPrepared.job.preparedPayloadDigest });
    const second = await waitForJob(jobs, 'solver-newer-two', job => ['succeeded', 'failed'].includes(job.state), 'follow-up after newer solver');
    assert.equal(second.state, 'succeeded', second.reason);
    assert.equal(starts, 0); assert.equal(resumes, 2);
    assert.equal(await readFile(join(parent.workspace, 'solver', 'main.js'), 'utf8'), newerSource);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('a text-only fork to a fresh workspace does not inherit old solver authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p05-solver-followup-fork-')), reader = fixture();
  const parent = await persistedSolverParent(root, reader);
  let continuationIdentity = 'b'.repeat(64), starts = 0, resumes = 0, firstWorkspace: string | undefined;
  const forkLibrary = { modelFor: library.modelFor, continuationIdentity: () => continuationIdentity };
  const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
  const runtimeFactory: AuthorizedRuntimeFactory = { ...base, create: async (_job, _attempt, _workspace, host) => ({ close: () => undefined, runner: {
    capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
    start: async request => {
      starts++; firstWorkspace = request.workspace;
      assert.notEqual(request.workspace, parent.workspace);
      await assert.rejects(readFile(join(request.workspace, 'solver', 'main.js')));
      await writeFile(join(request.workspace, 'reply.json'), JSON.stringify(textOnlyReply(1)));
      const sent = host.finalizeSend(request, { ...starting(request), threadId: 'fresh-thread' });
      const completed = await host.checkpoint({ ...sent, state: 'completed' });
      if (!completed) throw new Error('The fake provider did not checkpoint the fresh fork.');
      return completed;
    },
    resume: async (previous, request) => {
      if (!request) throw new Error('A continuation request is required.');
      resumes++; assert.equal(request.workspace, firstWorkspace);
      await assert.rejects(readFile(join(request.workspace, 'solver', 'main.js')));
      await writeFile(join(request.workspace, 'reply.json'), JSON.stringify(textOnlyReply(2)));
      const sent = host.finalizeSend(request, { ...starting(request), threadId: previous.threadId });
      const completed = await host.checkpoint({ ...sent, state: 'completed' });
      if (!completed) throw new Error('The fake provider did not checkpoint the fresh follow-up.');
      return completed;
    },
    inspect: async () => { throw new Error('Unexpected inspect.'); }, cancel: async () => { throw new Error('Unexpected cancel.'); },
  } }) };
  const jobs = new JobService({ reader, workspaceRoot: root, library: forkLibrary,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: ['solver'], solverAuthoring: false }, runtimeFactory });
  try {
    const firstPrepared = await jobs.prepareFollowup('solver-parent', { id: 'solver-fork-one', idempotencyKey: 'solver-fork-one-key', question: 'Fork with text only.' });
    continuationIdentity = 'c'.repeat(64);
    await jobs.followup('solver-parent', { id: 'solver-fork-one', idempotencyKey: 'solver-fork-one-key', question: 'Fork with text only.',
      grantId: 'grant', preparedPayloadDigest: firstPrepared.job.preparedPayloadDigest });
    const first = await waitForJob(jobs, 'solver-fork-one', job => job.state === 'succeeded', 'text-only fresh fork');

    const secondPrepared = await jobs.prepareFollowup(first.id, { id: 'solver-fork-two', idempotencyKey: 'solver-fork-two-key', question: 'Continue the fresh fork.' });
    await jobs.followup(first.id, { id: 'solver-fork-two', idempotencyKey: 'solver-fork-two-key', question: 'Continue the fresh fork.',
      grantId: 'grant', preparedPayloadDigest: secondPrepared.job.preparedPayloadDigest });
    const second = await waitForJob(jobs, 'solver-fork-two', job => ['succeeded', 'failed'].includes(job.state), 'fresh fork second follow-up');
    assert.equal(second.state, 'succeeded', second.reason);
    assert.equal(starts, 1); assert.equal(resumes, 1);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('a replaced solver and manifest refuse a follow-up before workspace mutation or dispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p05-solver-refusal-')), reader = fixture();
  const parent = await persistedSolverParent(root, reader), changed = 'process.stdout.write(JSON.stringify({answer:999}));\n';
  await writeFile(join(parent.workspace, 'solver', 'main.js'), changed);
  const manifestPath = join(parent.workspace, 'solver', 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files[0].sha256 = createHash('sha256').update(changed).digest('hex'); await writeFile(manifestPath, JSON.stringify(manifest));
  const packetBefore = await readFile(join(parent.workspace, 'packet.json'), 'utf8'), replyBefore = await readFile(join(parent.workspace, 'reply.json'), 'utf8');
  let runtimeCreates = 0;
  const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: ['solver'], solverAuthoring: false },
    runtimeFactory: { ...base, create: async () => { runtimeCreates++; throw new Error('A modified solver must refuse before runtime creation.'); } } });
  try {
    const prepared = await jobs.prepareFollowup('solver-parent', { id: 'solver-refused-followup', idempotencyKey: 'solver-refused-key', question: 'Continue.' });
    await jobs.followup('solver-parent', { id: 'solver-refused-followup', idempotencyKey: 'solver-refused-key', question: 'Continue.',
      grantId: 'grant', preparedPayloadDigest: prepared.job.preparedPayloadDigest });
    const failed = await waitForJob(jobs, 'solver-refused-followup', job => job.state === 'failed', 'modified solver refusal');
    assert.match(failed.reason ?? '', /host-pinned binding/);
    assert.equal(failed.attempts[0].handoffMarked, false); assert.equal(runtimeCreates, 0);
    assert.equal(await readFile(join(parent.workspace, 'packet.json'), 'utf8'), packetBefore);
    assert.equal(await readFile(join(parent.workspace, 'reply.json'), 'utf8'), replyBefore);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('restart validates and commits the persisted completed workspace without starting a provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const database = join(root, 'reader.sqlite'), workspaces = join(root, 'jobs');
  const reader = new ReaderStore(database);
  reader.apply({ id: 'keep-restart', kind: 'keep', threadId: 'thread-restart',
    capture: { url: 'https://example.org/article', title: 'Article', pageType: 'article', text: 'Start with this passage.',
      capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' },
    anchor: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5 } });
  const thread = reader.get('thread-restart')!, source = reader.sourceVersion(thread.sourceVersionId)!;
  const packet = { schema: 'marginalia.job-packet.v1' as const, intent: 'explore' as const, question: 'Explain.',
    source: { url: thread.sourceUrl, title: thread.sourceTitle, pageType: source.pageType, capturedAt: source.capturedAt,
      sourceHash: source.hash, sourceVersionId: source.id },
    selection: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5, originalEnd: 5, omittedCharacters: 0 },
    adjacentContext: { before: '', after: ' with this passage.', basis: 'bounded-character-context' as const },
    availableCapabilities: [], omissions: [] };
  const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: source.id, sourceUrl: thread.sourceUrl,
    sourceTitle: thread.sourceTitle, sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt,
    sourceHash: source.hash, sourceText: source.text, passage: thread.anchor, question: 'Explain.', intent: 'explore',
    preparedPayloadDigest: 'd'.repeat(64), modelSettingsRevision: 1, modelCompatibilityKey: 'test', outgoing: packet };
  const input: StartJobInput = { id: 'restart-job', idempotencyKey: 'restart-key', threadId: thread.id, intent: 'explore',
    question: 'Explain.', provider: 'mcp-server', model: 'test-model', mode: 'workspace-files', policyKey,
    grantId: 'grant', preparedPayloadDigest: 'd'.repeat(64), capabilities: [] };
  try {
    const store = new JobStore(reader);
    store.create(input, context, 'packet-digest', 'request-digest');
    const attempt = store.createAttempt(input.id);
    const schema = await readFile(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8');
    const workspace = await prepareWorkspace(workspaces, input.id, packet, schema);
    const reply = withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'explore', status: 'complete', title: 'Explanation',
      summary: 'A short explanation.', sourceBindings: [], parameters: [], assumptions: [], limitations: [],
      blocks: [{ id: 'text', type: 'text', md: 'Start with this passage.' }], checks: [], staticFallback: 'A short explanation.' });
    await writeFile(join(workspace, 'reply.json'), JSON.stringify(reply));
    const handoff = (jobId: string, id: string) => {
      store.setDeadline(jobId, id, new Date(Date.now() + 60_000).toISOString());
      store.markPreparing(jobId, id);
      store.markWorkspacePrepared(jobId, id);
      store.withDispatchHandoff(store.get(jobId)!, id, { assertSharedDatabase: () => undefined }, () => undefined);
    };
    handoff(input.id, attempt.id);
    store.checkpoint(attempt.id, { jobId: attempt.id, provider: input.provider, workspace, policyKey, model: input.model,
      mode: input.mode, state: 'completed', tombstone: false, providerInstanceId: 'provider-1' });
    store.saveProvisional(input.id, attempt.id, { ...reply, status: 'partial' } as CandidateReply);
    assert.equal(store.get(input.id)?.state, 'validating');
    const timedInput = { ...input, id: 'timed-job', idempotencyKey: 'timed-key' };
    store.create(timedInput, context, 'packet-digest-2', 'request-digest-2');
    const timedAttempt = store.createAttempt(timedInput.id);
    handoff(timedInput.id, timedAttempt.id);
    const running = store.checkpoint(timedAttempt.id, { jobId: timedAttempt.id, provider: input.provider, workspace,
      policyKey, model: input.model, mode: input.mode, state: 'running', tombstone: false, providerInstanceId: 'provider-2' });
    store.markTimedOut(timedInput.id, timedAttempt.id);
    assert.equal(store.acknowledgeStopFence(timedAttempt.id, { ...running, tombstone: true, state: 'cancel_requested' })?.tombstone, true);
    assert.throws(() => store.checkpoint(timedAttempt.id, { ...running, tombstone: true, state: 'cancel_requested' }), /terminal/);
    const sendingInput = { ...input, id: 'sending-job', idempotencyKey: 'sending-key' };
    store.create(sendingInput, context, 'packet-digest-3', 'request-digest-3');
    const sendingAttempt = store.createAttempt(sendingInput.id);
    handoff(sendingInput.id, sendingAttempt.id);
    const starting = store.checkpoint(sendingAttempt.id, { jobId: sendingAttempt.id, provider: input.provider, workspace,
      policyKey, model: input.model, mode: input.mode, state: 'starting', tombstone: false, providerInstanceId: 'provider-3' });
    assert.equal(store.get(sendingInput.id)?.state, 'sending');
    store.checkpoint(sendingAttempt.id, { ...starting, state: 'running' });
    assert.equal(store.get(sendingInput.id)?.state, 'running');
    reader.close();
    const reopened = new ReaderStore(database);
    let releaseCommit!: () => void, sawCommit!: () => void;
    const commitGate = new Promise<void>(resolve => { releaseCommit = resolve; });
    const enteredCommit = new Promise<void>(resolve => { sawCommit = resolve; });
    let firstCommit = true;
    const jobs = new JobService({ reader: reopened, workspaceRoot: workspaces, library,
      defaults: { provider: 'mcp-server', mode: 'workspace-files', policyKey, capabilities: [] },
      runtimeFactory: factory(async (_job, stage) => {
        if (stage === 'commit' && firstCommit) { firstCommit = false; sawCommit(); await commitGate; }
        return { grantId: 'grant', policyKey };
      }) });
    try {
      const recovering = jobs.recover();
      await enteredCommit;
      const durable = jobs.get(input.id)!.attempts[0].providerHandle!;
      jobs.store.checkpoint(attempt.id, { ...durable, revision: durable.revision, state: 'completed' });
      releaseCommit();
      await recovering;
      const succeeded = await waitForJob(jobs, input.id, job => job.state === 'succeeded', 'recovered completed job');
      assert.equal(succeeded.state, 'succeeded');
      assert.ok(succeeded.replyVersionId);
      const followup = await jobs.prepareFollowup(input.id, { id: 'followup-job', idempotencyKey: 'followup-key', question: 'Continue.' });
      const reviewedPacket = JSON.parse(followup.consent.outgoing[0].text) as { parentReply?: { replyVersionId: string; attribution: string; excerpt: string } };
      assert.equal(reviewedPacket.parentReply?.replyVersionId, jobs.get(input.id)?.replyVersionId);
      assert.equal(reviewedPacket.parentReply?.attribution, 'Prior generated work, not source evidence.');
      assert.match(reviewedPacket.parentReply!.excerpt, /A short explanation/);
      assert.match(followup.consent.outgoing[1].text, /Prior generated work, not source evidence\./);
      const fork = await jobs.followup(input.id, { id: 'followup-job', idempotencyKey: 'followup-key', question: 'Continue.',
        grantId: 'grant', preparedPayloadDigest: followup.job.preparedPayloadDigest });
      assert.equal(fork.context.parentAttemptId, undefined);
      assert.equal(fork.attempts[0].predecessorAttemptId, undefined);
    } finally { releaseCommit(); await jobs.close(); reopened.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const intent of ['simulate', 'define', 'evidence'] as const) {
  test(`${intent} grants only intent capabilities within the configured ceiling`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'marginalia-capabilities-')), reader = fixture();
    const jobs = new JobService({ reader, workspaceRoot: root, library,
      defaults: { provider: 'app-server', mode: 'workspace-files', policyKey,
        capabilities: ['samples', 'solver', 'network.citations', 'network.shelf'] },
      runtimeFactory: factory(async () => ({ grantId: 'grant', policyKey })) });
    try {
      const prepared = await jobs.prepare({ id: 'intent-job', idempotencyKey: 'intent-key', threadId: 'thread-job-test', intent, question: 'Explain.' });
      const expected = capabilitiesForIntent(intent).filter(capability => capability !== 'solver');
      assert.deepEqual(prepared.job.capabilities, expected);
      assert.deepEqual(JSON.parse(prepared.consent.outgoing[0].text).availableCapabilities, expected);
      await jobs.create({ ...prepared.job, grantId: 'grant' });
      assert.deepEqual(jobs.store.capabilities('intent-job'), expected);
    } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
  });
}

async function persistedSolverParent(root: string, reader: ReaderStore) {
  const thread = reader.get('thread-job-test')!, source = reader.sourceVersion(thread.sourceVersionId)!;
  const packet = { schema: 'marginalia.job-packet.v1' as const, intent: 'simulate' as const, question: 'Compute.',
    source: { url: thread.sourceUrl, title: thread.sourceTitle, pageType: source.pageType, capturedAt: source.capturedAt,
      sourceHash: source.hash, sourceVersionId: source.id },
    selection: { ...thread.anchor, originalEnd: thread.anchor.end, omittedCharacters: 0 },
    adjacentContext: { before: '', after: '', basis: 'bounded-character-context' as const }, availableCapabilities: ['solver' as const], omissions: [] };
  const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: source.id, sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle,
    sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt, sourceHash: source.hash, sourceText: source.text,
    passage: thread.anchor, question: 'Compute.', intent: 'simulate', preparedPayloadDigest: 'd'.repeat(64),
    modelSettingsRevision: 1, modelCompatibilityKey: 'test', outgoing: packet };
  const input: StartJobInput = { id: 'solver-parent', idempotencyKey: 'solver-parent-key', threadId: thread.id, intent: 'simulate', question: 'Compute.',
    provider: 'app-server', model: 'test-model', mode: 'workspace-files', policyKey, grantId: 'grant',
    preparedPayloadDigest: 'd'.repeat(64), capabilities: ['solver'] };
  const store = new JobStore(reader); store.create(input, context, 'packet-digest', 'request-digest');
  const attempt = store.createAttempt(input.id), schema = await readFile(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8');
  const workspace = await prepareWorkspace(root, input.id, packet, schema), solverSource = 'process.stdout.write(JSON.stringify({answer:2}));\n';
  const solverSha256 = await writeSolverArtifacts(workspace, solverSource);
  const reply = solverReply();
  await writeFile(join(workspace, 'reply.json'), JSON.stringify(reply));
  store.setDeadline(input.id, attempt.id, new Date(Date.now() + 60_000).toISOString()); store.markPreparing(input.id, attempt.id);
  store.bindAuthorization(attempt.id, library.continuationIdentity());
  store.markWorkspacePrepared(input.id, attempt.id); store.withDispatchHandoff(store.get(input.id)!, attempt.id, { assertSharedDatabase: () => undefined }, () => undefined);
  const completed = store.checkpoint(attempt.id, { jobId: attempt.id, provider: input.provider, workspace, policyKey, model: input.model,
    mode: input.mode, state: 'completed', tombstone: false, providerInstanceId: 'provider-1', threadId: 'solver-thread-1' });
  const identity = await directoryIdentity(workspace);
  store.succeed(input.id, attempt.id, completed.revision!, reply, [{ solverId: 'solver-1', jobId: input.id, attemptId: attempt.id, workspace,
    workspaceDev: String(identity.dev), workspaceIno: String(identity.ino), workspaceGeneration: `directory:${identity.dev}:${identity.ino}`,
    solverRelativePath: 'solver/main.js', solverSha256, runtimeExecutable: process.execPath, runtimeIdentity: process.release.name,
    runtimeVersion: process.version, runtimeSha256: 'e'.repeat(64) }]);
  return { workspace, solverSource, solverSha256 };
}

test('solver authoring is a host-owned opt-in bound into preparation and cannot be added by the request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-solver-authoring-')), reader = fixture();
  const make = (solverAuthoring: boolean) => new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey,
      capabilities: ['samples', 'solver'], solverAuthoring },
    runtimeFactory: factory(async () => ({ grantId: 'grant', policyKey })) });
  let jobs = make(false);
  try {
    const ordinary = await jobs.prepare({ id: 'ordinary-simulate', idempotencyKey: 'ordinary-simulate-key', threadId: 'thread-job-test',
      intent: 'simulate', question: 'Write a solver even if the host did not select that mode.' });
    assert.deepEqual(ordinary.job.capabilities, ['samples']);
    assert.deepEqual(JSON.parse(ordinary.consent.outgoing[0].text).availableCapabilities, ['samples']);
    await assert.rejects(jobs.create({ ...ordinary.job, grantId: 'grant', capabilities: ['samples', 'solver'] }), /current host plan/);
    assert.equal(jobs.get('ordinary-simulate'), undefined);
    await jobs.close(); jobs = make(true);
    const authored = await jobs.prepare({ id: 'authored-simulate', idempotencyKey: 'authored-simulate-key', threadId: 'thread-job-test',
      intent: 'simulate', question: 'Show this with a saved solver.' });
    assert.deepEqual(authored.job.capabilities, ['samples', 'solver']);
    assert.deepEqual(JSON.parse(authored.consent.outgoing[0].text).availableCapabilities, ['samples', 'solver']);
    await jobs.create({ ...authored.job, grantId: 'grant' });
    assert.deepEqual(jobs.store.capabilities('authored-simulate'), ['samples', 'solver']);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('retry preparation and dispatch intersect original capabilities with reduced ceilings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-retry-capabilities-')), reader = fixture();
  const make = (capabilities: ReplyCapability[], solverAuthoring = false) => new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities, solverAuthoring },
    runtimeFactory: factory(async () => ({ grantId: 'grant', policyKey })) });
  let jobs = make(['samples', 'solver', 'network.citations'], true);
  try {
    const prepared = await jobs.prepare({ id: 'original', idempotencyKey: 'original-key', threadId: 'thread-job-test', intent: 'simulate', question: 'Explain.' });
    await jobs.create({ ...prepared.job, grantId: 'grant' }); await jobs.close();
    assert.equal(jobs.get('original')!.state, 'failed');
    const retry = { id: 'retry', idempotencyKey: 'retry-key' };
    const before = await makePreparation(['samples', 'solver']);
    jobs = make([]);
    const after = await jobs.prepareRetry('original', retry);
    assert.deepEqual(after.job.capabilities, []);
    assert.notDeepEqual(after.consent.outgoing, before.consent.outgoing);
    assert.notEqual(after.job.preparedPayloadDigest, before.job.preparedPayloadDigest);
    await assert.rejects(jobs.retry('original', { ...retry, grantId: 'grant', preparedPayloadDigest: before.job.preparedPayloadDigest }), /changed/);
    await jobs.retry('original', { ...retry, grantId: 'grant', preparedPayloadDigest: after.job.preparedPayloadDigest });
    assert.deepEqual(jobs.store.capabilities('retry'), []);
    async function makePreparation(ceiling: ReplyCapability[]) {
      const service = make(ceiling);
      try { return await service.prepareRetry('original', retry); } finally { await service.close(); }
    }
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('retry dispatch uses the exact outgoing content reviewed during retry preparation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-retry-content-')), reader = fixture();
  const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] },
    runtimeFactory: { ...base, create: async (_job, _attempt, _workspace, host) => ({ close: () => undefined, runner: {
      capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
      start: async request => { host.finalizeSend(request, starting(request)); throw new Error('send outcome unconfirmed'); },
      resume: async () => { throw new Error('Unexpected resume.'); }, inspect: async () => { throw new Error('Unexpected inspect.'); },
      cancel: async () => { throw new Error('Unexpected cancel.'); },
    } }) } });
  try {
    const first = await jobs.prepare({ id: 'retry-content-original', idempotencyKey: 'retry-content-original-key',
      threadId: 'thread-job-test', intent: 'explore', question: 'Keep this exact question.' });
    await jobs.create({ ...first.job, grantId: 'grant' });
    const original = await waitForJob(jobs, 'retry-content-original', job => job.state === 'outcome_unknown', 'retry content original outcome');
    const legacyContext = structuredClone(original.context);
    delete (legacyContext.outgoing as Partial<typeof legacyContext.outgoing>).question;
    reader.db.prepare('UPDATE jobs SET context=? WHERE id=?').run(JSON.stringify(legacyContext), original.id);

    const retryInput = { id: 'retry-content-next', idempotencyKey: 'retry-content-next-key' };
    const reviewed = await jobs.prepareRetry(original.id, retryInput);
    const retried = await jobs.retry(original.id, { ...retryInput, grantId: 'grant', preparedPayloadDigest: reviewed.job.preparedPayloadDigest });

    assert.equal(retried.preparedPayloadDigest, reviewed.job.preparedPayloadDigest);
    const retriedSent = await waitForJob(jobs, retried.id, job => !!job.attempts[0].sentContent, 'retry content dispatch');
    assert.deepEqual(retriedSent.attempts[0].sentContent, reviewed.consent.outgoing);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('retry dispatch rejects a question changed after retry preparation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-retry-question-')), reader = fixture();
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] },
    runtimeFactory: factory(async () => ({ grantId: 'grant', policyKey })) });
  try {
    const first = await jobs.prepare({ id: 'retry-question-original', idempotencyKey: 'retry-question-original-key',
      threadId: 'thread-job-test', intent: 'explore', question: 'Reviewed question.' });
    await jobs.create({ ...first.job, grantId: 'grant' });
    await waitForJob(jobs, 'retry-question-original', job => job.state === 'failed', 'retry question original failure');

    const retryInput = { id: 'retry-question-next', idempotencyKey: 'retry-question-next-key' };
    const reviewed = await jobs.prepareRetry(first.job.id, retryInput);
    const changed = jobs.get(first.job.id)!;
    changed.context.question = 'Changed after review.';
    reader.db.prepare('UPDATE jobs SET context=? WHERE id=?').run(JSON.stringify(changed.context), changed.id);

    await assert.rejects(
      jobs.retry(first.job.id, { ...retryInput, grantId: 'grant', preparedPayloadDigest: reviewed.job.preparedPayloadDigest }),
      /The reviewed outgoing content changed/,
    );
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});
