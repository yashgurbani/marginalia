import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../daemon/store.ts';
import { JobService } from '../daemon/jobs/service.ts';
import { JobStore } from '../daemon/jobs/store.ts';
import { prepareContinuationWorkspace, prepareWorkspace, restoreCompletedWorkspace } from '../daemon/jobs/workspace.ts';
import { JOB_WORKSPACE_INSTRUCTIONS } from '../daemon/jobs/envelope.ts';
import type { AuthorizedRuntimeFactory } from '../daemon/jobs/runtime.ts';
import type { FrozenJobContext, StartJobInput } from '../contracts/jobs.ts';
import { ProviderNotSentError } from '../contracts/job-runner.ts';
import type { CandidateReply } from '../contracts/reply.ts';

const policyKey = 'a'.repeat(64);
function fixture(sourceText = 'Start with this passage.') {
  const reader = new ReaderStore(':memory:');
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

test('preparation reports the shared result shape and bounds duplicated UTF-8 content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture('Start' + '😀'.repeat(12_000));
  const jobs = new JobService({ reader, workspaceRoot: root, library, defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] },
    runtimeFactory: factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' })) });
  try {
    const prepared = await jobs.prepare({ id: 'large-job', idempotencyKey: 'large-key', threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    assert.equal(prepared.consent.bindingDigest, prepared.job.preparedPayloadDigest);
    assert.ok(prepared.consent.outgoing.reduce((sum, part) => sum + Buffer.byteLength(part.text), 0) <= 64 * 1024);
    assert.match(prepared.consent.outgoing[0].text, /64 KiB UTF-8/);
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
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const jobs = new JobService({ reader, workspaceRoot: root, library, timeoutMs: 1000,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] },
    runtimeFactory: factory(async () => { await waiting; return { grantId: 'grant', policyKey, auditScope: 'scope' }; }) });
  try {
    const prepared = await jobs.prepare({ id: 'cancel-job', idempotencyKey: 'cancel-key', threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    const created = await jobs.create({ ...prepared.job, grantId: 'grant' });
    assert.ok(created.latestAttemptId);
    assert.equal((await jobs.cancel(created.id)).state, 'cancelled');
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(jobs.get(created.id)?.state, 'cancelled');
    assert.equal(jobs.get(created.id)?.attempts[0].handoffMarked, false);
  } finally { release(); await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('only a matching current provider-not-sent error classifies a handed-off attempt as failed', async () => {
  for (const [suffix, provider, expected] of [['matching', 'app-server', 'failed'], ['mismatch', 'mcp-server', 'outcome_unknown']] as const) {
    const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
    const reader = fixture();
    const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
    const runtimeFactory: AuthorizedRuntimeFactory = { ...base,
      create: async () => ({ close: () => undefined, runner: {
        capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
        start: async request => { throw new ProviderNotSentError(provider, request.jobId, new Error('authorization')); },
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
      for (let i = 0; i < 20 && !['failed', 'outcome_unknown'].includes(jobs.get(`not-sent-${suffix}`)!.state); i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(jobs.get(`not-sent-${suffix}`)?.state, expected);
      assert.equal(jobs.get(`not-sent-${suffix}`)?.attempts[0].dispatchClaimed, false);
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
    for (let i = 0; i < 20 && jobs.get('prep-failure')?.state !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(jobs.get('prep-failure')?.state, 'failed');
    assert.equal(jobs.get('prep-failure')?.attempts[0].handoffMarked, false);
    assert.equal(finalized, 0);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('runner uncertainty after handoff stays unknown with one finalization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture();
  let finalized = 0, starts = 0;
  const base = factory(async () => ({ grantId: 'grant', policyKey, auditScope: 'scope' }));
  const runtimeFactory: AuthorizedRuntimeFactory = { ...base,
    consent: { ...base.consent, finalizeDispatch: (...args) => { finalized++; return base.consent.finalizeDispatch(...args); } },
    create: async () => ({ close: () => undefined, runner: {
      capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
      start: async () => { starts++; throw new Error('send outcome unconfirmed'); },
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
    for (let i = 0; i < 20 && jobs.get('uncertain-job')?.state !== 'outcome_unknown'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(jobs.get('uncertain-job')?.state, 'outcome_unknown');
    assert.equal(jobs.get('uncertain-job')?.attempts[0].handoffMarked, true);
    assert.equal(finalized, 1);
    assert.equal(starts, 1);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('retry keeps frozen source lineage while declaring current host capabilities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-jobs-'));
  const reader = fixture();
  const unavailable = factory(async () => { throw new Error('No current consent.'); });
  const first = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] }, runtimeFactory: unavailable });
  try {
    const prepared = await first.prepare({ id: 'retry-parent', idempotencyKey: 'retry-parent-key',
      threadId: 'thread-job-test', intent: 'explore', question: 'Explain.' });
    await first.create({ ...prepared.job, grantId: 'grant' });
    for (let i = 0; i < 20 && first.get('retry-parent')?.state !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(first.get('retry-parent')?.state, 'failed');
  } finally { await first.close(); }
  const next = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: ['samples'] }, runtimeFactory: unavailable });
  try {
    const retry = await next.prepareRetry('retry-parent', { id: 'retry-child', idempotencyKey: 'retry-child-key' });
    const packet = JSON.parse(retry.consent.outgoing[0].text) as { availableCapabilities: string[]; source: { sourceHash: string } };
    assert.deepEqual(packet.availableCapabilities, ['samples']);
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
    const reply = { schema: 'marginalia.reply.v1', intent: 'explore', status: 'complete', title: 'Explanation',
      summary: 'A short explanation.', sourceBindings: [], parameters: [], assumptions: [], limitations: [],
      blocks: [{ id: 'text', type: 'text', md: 'Start with this passage.' }], checks: [], staticFallback: 'A short explanation.' };
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
      for (let i = 0; i < 20 && jobs.get(input.id)?.state !== 'succeeded'; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(jobs.get(input.id)?.state, 'succeeded');
      assert.ok(jobs.get(input.id)?.replyVersionId);
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
