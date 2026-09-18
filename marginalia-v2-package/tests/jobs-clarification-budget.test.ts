import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../daemon/store.ts';
import { JobStore, ClarificationLimitError, CLARIFICATION_LIMIT_FALLBACK } from '../daemon/jobs/store.ts';
import { JobService } from '../daemon/jobs/service.ts';
import { prepareWorkspace } from '../daemon/jobs/workspace.ts';
import type { FrozenJobContext, StartJobInput } from '../contracts/jobs.ts';
import type { CandidateReply } from '../contracts/reply.ts';
import type { AuthorizedRuntimeFactory } from '../daemon/jobs/runtime.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

const policyKey = 'a'.repeat(64);
const library = { modelFor: () => ({ model: 'test-model', settingsRevision: 1, compatibilityKey: 'test' }), continuationIdentity: () => 'b'.repeat(64) };
function reply(prompt?: string): CandidateReply {
  return withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'define', status: 'complete', title: 'Explanation', summary: 'An explanation.',
    sourceBindings: [], parameters: [], assumptions: [], limitations: [], checks: [], staticFallback: 'An explanation.',
    blocks: prompt ? [{ id: 'clarify', type: 'question', prompt, answers: [], allowFreeText: true }]
      : [{ id: 'answer', type: 'text', md: 'An explanation.' }] });
}
function fixture(database = ':memory:') {
  const reader = new ReaderStore(database);
  reader.apply({ id: 'keep', kind: 'keep', threadId: 'thread', capture: { url: 'https://example.org/article', title: 'Article',
    pageType: 'article', text: 'Start here.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' },
    anchor: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5 } });
  return reader;
}
function create(store: JobStore, reader: ReaderStore, id: string, retryOfJobId?: string, mode: StartJobInput['mode'] = 'structured-final') {
  const thread = reader.get('thread')!, source = reader.sourceVersion(thread.sourceVersionId)!;
  const input: StartJobInput = { id, idempotencyKey: id, threadId: thread.id, intent: 'define', question: 'Explain.',
    provider: 'app-server', model: 'test-model', mode, policyKey, grantId: 'grant', preparedPayloadDigest: 'd'.repeat(64), capabilities: [] };
  const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: source.id, sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle,
    sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt, sourceHash: source.hash, sourceText: source.text,
    passage: thread.anchor, question: input.question, intent: input.intent, retryOfJobId, preparedPayloadDigest: input.preparedPayloadDigest,
    modelSettingsRevision: 1, modelCompatibilityKey: 'test', outgoing: { schema: 'marginalia.job-packet.v1', intent: input.intent, question: input.question,
      source: { url: thread.sourceUrl, title: thread.sourceTitle, pageType: source.pageType, capturedAt: source.capturedAt, sourceHash: source.hash, sourceVersionId: source.id },
      selection: { ...thread.anchor, originalEnd: 5, omittedCharacters: 0 }, adjacentContext: { before: '', after: ' here.', basis: 'bounded-character-context' },
      availableCapabilities: [], omissions: [] } };
  store.create(input, context, id, id);
  return store.createAttempt(id);
}
function complete(store: JobStore, id: string, value: CandidateReply, workspace = 'unused', state: 'running' | 'completed' = 'completed') {
  const job = store.get(id)!, attempt = job.attempts.at(-1)!;
  store.setDeadline(id, attempt.id, new Date(Date.now() + 60_000).toISOString());
  store.markPreparing(id, attempt.id);
  store.markWorkspacePrepared(id, attempt.id);
  store.withDispatchHandoff(store.get(id)!, attempt.id, { assertSharedDatabase: () => undefined }, () => undefined);
  const handle = store.checkpoint(attempt.id, { jobId: attempt.id, provider: job.provider, providerInstanceId: 'test-provider', workspace,
    threadId: `provider-${id}`,
    policyKey, model: job.model, mode: job.mode, state, tombstone: false, ...(state === 'completed' ? { output: JSON.stringify(value) } : {}) });
  return handle.revision!;
}
function runtime(): AuthorizedRuntimeFactory {
  return { dispatchReady: true, create: async () => { throw new Error('No inference expected.'); }, consent: {
    assertSharedDatabase() {}, revalidate: async () => ({ grantId: 'grant', policyKey }),
    finalizeDispatch() { throw new Error('No inference expected.'); },
    withResultAcceptance: (_job, _attempt, commit) => commit(), recordOutcome() {},
  } };
}

test('one question survives identical partial observations and final commit; a changed question is rejected', () => {
  const reader = fixture(), store = new JobStore(reader);
  try {
    const attempt = create(store, reader, 'build');
    const first = reply('Which scale?');
    store.saveProvisional('build', attempt.id, { ...first, status: 'partial' });
    store.saveProvisional('build', attempt.id, { ...first, status: 'partial' });
    assert.throws(() => store.saveProvisional('build', attempt.id, reply('Which boundary?')), ClarificationLimitError);
    assert.deepEqual(store.get('build')!.clarificationBudget, { buildId: 'build', limit: 1, used: 1 });
    const revision = complete(store, 'build', first);
    assert.throws(() => store.succeed('build', attempt.id, revision, reply('Which boundary?')), ClarificationLimitError);
    assert.equal(reader.reply('build-reply'), undefined);
    assert.equal(store.succeed('build', attempt.id, revision, first).state, 'succeeded');
  } finally { reader.close(); }
});

test('invalid, cancelled and stale candidates do not spend clarification budget', () => {
  const reader = fixture(), store = new JobStore(reader);
  try {
    const attempt = create(store, reader, 'build');
    store.saveProvisional('build', attempt.id, { ...reply('Which scale?'), schema: 'invalid' } as unknown as CandidateReply);
    store.saveProvisional('build', 'stale-attempt', reply('Which scale?'));
    store.requestCancel('build');
    store.saveProvisional('build', attempt.id, reply('Which scale?'));
    assert.equal(store.get('build')!.clarificationBudget!.used, 0);
  } finally { reader.close(); }
});

test('reopening and reading preserve the spent budget; retry chains share it without spending or resetting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-e35-'));
  const database = join(root, 'reader.sqlite');
  let reader = fixture(database);
  try {
    let store = new JobStore(reader);
    const attempt = create(store, reader, 'build');
    store.saveProvisional('build', attempt.id, reply('Which scale?'));
    store.setState('build', attempt.id, 'failed', 'provider-failed');
    reader.close(); reader = new ReaderStore(database); store = new JobStore(reader);
    assert.deepEqual(store.list()[0].clarificationBudget, { buildId: 'build', limit: 1, used: 1 });
    for (const [id, parent] of [['retry', 'build'], ['retry-again', 'retry']]) {
      const next = create(store, reader, id, parent);
      assert.deepEqual(store.get(id)!.clarificationBudget, { buildId: 'build', limit: 1, used: 1 });
      assert.throws(() => store.saveProvisional(id, next.id, reply('Which scale?')), ClarificationLimitError);
      store.setState(id, next.id, 'failed', 'provider-failed');
    }
    assert.deepEqual(reader.db.prepare('SELECT count(*) AS n FROM build_clarifications').get(), { n: 1 });
  } finally { reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('unused budget stays unused on retry and a question-free answer can finish after clarification', () => {
  const reader = fixture(), store = new JobStore(reader);
  try {
    const first = create(store, reader, 'build'); store.setState('build', first.id, 'failed', 'provider-failed');
    const retry = create(store, reader, 'retry', 'build');
    assert.equal(store.get('retry')!.clarificationBudget!.used, 0);
    store.saveProvisional('retry', retry.id, reply('Which scale?'));
    store.succeed('retry', retry.id, complete(store, 'retry', reply()), reply());
    assert.equal(store.get('retry')!.state, 'succeeded');
    assert.equal(store.get('build')!.clarificationBudget!.used, 1);
  } finally { reader.close(); }
});

for (const mode of ['structured-final', 'workspace-files'] as const) {
  test(`${mode}: recovery rejects a second clarification with a plain failure and no automatic model call`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'marginalia-e35-')), reader = fixture();
    let jobs: JobService | undefined;
    try {
      const store = new JobStore(reader), attempt = create(store, reader, 'build', undefined, mode);
      store.saveProvisional('build', attempt.id, reply('Which scale?'));
      let workspace = root;
      if (mode === 'workspace-files') {
        workspace = await prepareWorkspace(root, 'build', store.get('build')!.context.outgoing,
          await readFile(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8'));
        await writeFile(join(workspace, 'reply.json'), JSON.stringify(reply('Which boundary?')));
      }
      complete(store, 'build', reply('Which boundary?'), workspace);
      jobs = new JobService({ reader, workspaceRoot: root, library, runtimeFactory: runtime(),
        defaults: { provider: 'app-server', mode, policyKey, capabilities: [] } });
      await jobs.recover(); await jobs.recover();
      assert.equal(jobs.get('build')!.state, 'failed');
      assert.equal(jobs.get('build')!.reason, CLARIFICATION_LIMIT_FALLBACK);
      assert.equal(jobs.get('build')!.provisional, undefined);
      assert.equal(reader.reply('build-reply'), undefined);
      assert.equal(jobs.get('build')!.clarificationBudget!.used, 1);
    } finally { await jobs?.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
  });
}

test('an explicit follow-up still requires reviewed outgoing content and starts its own unspent build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-e35-')), reader = fixture(), store = new JobStore(reader);
  const first = create(store, reader, 'build');
  store.saveProvisional('build', first.id, reply('Which scale?'));
  store.succeed('build', first.id, complete(store, 'build', reply()), reply());
  const jobs = new JobService({ reader, workspaceRoot: root, library, runtimeFactory: runtime(),
    defaults: { provider: 'app-server', mode: 'structured-final', policyKey, capabilities: [] } });
  try {
    const input = { id: 'followup', idempotencyKey: 'followup', question: 'Explain a different example.' };
    const plan = await jobs.prepareFollowup('build', input);
    assert.equal(jobs.get('followup'), undefined);
    assert.equal(jobs.get('build')!.clarificationBudget!.used, 1);
    await assert.rejects(jobs.followup('build', { ...input, grantId: 'grant', preparedPayloadDigest: '0'.repeat(64) }), /Review it again/);
    const next = await jobs.followup('build', { ...input, grantId: 'grant', preparedPayloadDigest: plan.job.preparedPayloadDigest });
    assert.deepEqual(next.clarificationBudget, { buildId: 'followup', limit: 1, used: 0 });
    assert.equal(next.context.question, input.question);
    assert.equal(next.context.parentReplyId, 'build-reply');
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('upgrade reconstructs an already published legacy question without creating a fresh allowance', () => {
  const reader = fixture();
  try {
    let store = new JobStore(reader);
    const attempt = create(store, reader, 'build');
    store.succeed('build', attempt.id, complete(store, 'build', reply('Which scale?')), reply('Which scale?'));
    reader.db.exec('DROP TABLE build_clarifications');
    store = new JobStore(reader);
    assert.deepEqual(store.get('build')!.clarificationBudget, { buildId: 'build', limit: 1, used: 1 });
  } finally { reader.close(); }
});

test('live workspace polling rejects a changed second partial and disposes the runtime without retrying', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-e35-')), reader = fixture(), store = new JobStore(reader);
  let jobs: JobService | undefined, disposed = 0;
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5_000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(predicate(), 'expected durable job transition within 5 seconds');
  };
  try {
    create(store, reader, 'build', undefined, 'workspace-files');
    const workspace = await prepareWorkspace(root, 'build', store.get('build')!.context.outgoing,
      await readFile(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8'));
    complete(store, 'build', reply(), workspace, 'running');
    const factory = runtime();
    factory.create = async () => ({ close() { disposed++; }, runner: {
      capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
      async start() { throw new Error('Polling must not infer.'); }, async resume() { throw new Error('Polling must not infer.'); },
      async cancel() { throw new Error('No implicit cancel.'); }, async inspect(handle) { return handle; },
    } });
    jobs = new JobService({ reader, workspaceRoot: root, library, runtimeFactory: factory,
      defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] } });
    await jobs.recover();
    assert.equal(jobs.get('build')!.clarificationBudget!.used, 0);
    for (const prompt of ['Which scale?', 'Which boundary?']) {
      await writeFile(join(workspace, 'next.json'), JSON.stringify({ ...reply(prompt), status: 'partial' }));
      await rename(join(workspace, 'next.json'), join(workspace, 'reply.partial.json'));
      if (prompt === 'Which scale?') await waitFor(() => jobs!.get('build')!.clarificationBudget!.used === 1);
    }
    await waitFor(() => jobs!.get('build')!.state === 'failed' && disposed === 1);
    assert.equal(jobs.get('build')!.reason, CLARIFICATION_LIMIT_FALLBACK);
    assert.equal(jobs.get('build')!.provisional, undefined);
    assert.equal(jobs.get('build')!.attempts.length, 1);
  } finally { await jobs?.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});

test('failed final validation rolls back the question claim in the reply acceptance transaction', () => {
  const reader = fixture(), store = new JobStore(reader);
  try {
    const attempt = create(store, reader, 'build'), revision = complete(store, 'build', reply('Which scale?'));
    assert.throws(() => store.succeed('build', attempt.id, revision, { ...reply('Which scale?'), schema: 'invalid' } as unknown as CandidateReply));
    assert.equal(store.get('build')!.clarificationBudget!.used, 0);
    assert.equal(reader.reply('build-reply'), undefined);
  } finally { reader.close(); }
});
