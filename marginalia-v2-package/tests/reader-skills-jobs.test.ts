import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../daemon/store.ts';
import { JobStore } from '../daemon/jobs/store.ts';
import { JobService } from '../daemon/jobs/service.ts';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import type { AuthorizedRuntimeFactory, JobHostHooks } from '../daemon/jobs/runtime.ts';
import type { ProviderHandle, ProviderRequest } from '../contracts/job-runner.ts';
import type { JobSnapshot } from '../contracts/jobs.ts';
import { withFixtureOrigins } from './origins-fixture.ts';
import { READER_SKILL_TIMEOUT_MS, skillOutputHash } from '../daemon/reader-skills.ts';

const policyKey = 'a'.repeat(64), selection = { name: 'last30days', catalogRevision: 'b'.repeat(64) };
const catalog = { schema: 'marginalia.reader-skills.v1' as const, status: 'ready' as const, revision: selection.catalogRevision, skills: [{ name: selection.name, description: 'Recent discussion' }] };
const reply = withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'unsure', status: 'complete', title: 'Skill answer', summary: 'Descriptive answer',
  sourceBindings: [], parameters: [], assumptions: [], limitations: [], checks: [], staticFallback: 'Answer', blocks: [{ type: 'text', id: 'answer', md: 'Answer' }] });
async function fixture(mode: 'workspace-files' | 'structured-final' = 'workspace-files') {
  const root = await mkdtemp(join(tmpdir(), 'v1-skills-')), database = join(root, 'reader.sqlite'), reader = new ReaderStore(database);
  reader.apply({ id: 'keep', kind: 'keep', threadId: 'thread', capture: { url: 'https://example.org/page', title: 'Page', pageType: 'article', text: 'Selected passage and page context.', capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' }, anchor: { exact: 'Selected passage', prefix: '', suffix: '', start: 0, end: 16 } });
  const consent = new ConsentSessionService({ db: reader.db });
  let deliver: (request: ProviderRequest, handle: ProviderHandle, hooks: JobHostHooks) => Promise<ProviderHandle> = async (_r, h) => h;
  let starts = 0;
  const runtime: AuthorizedRuntimeFactory = { dispatchReady: true, consent, readerSkills: async () => catalog,
    create: async (_job, _attempt, _workspace, hooks) => ({ close() {}, runner: {
      capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
      start: async request => {
        starts++;
        const handle = hooks.finalizeSend(request, { jobId: request.jobId, workspace: request.workspace, policyKey, mode: request.mode, model: request.model, provider: 'app-server', providerInstanceId: 'fixture', threadId: 'provider-' + starts, state: 'starting', tombstone: false });
        return deliver(request, handle, hooks);
      }, resume: async () => { throw Error('unexpected resume'); }, inspect: async h => h, cancel: async h => h,
    } }) };
  const jobs = new JobService({ reader, workspaceRoot: join(root, 'jobs'), runtimeFactory: runtime, timeoutMs: 600_000,
    library: { modelFor: () => ({ model: 'test-model', settingsRevision: 1, compatibilityKey: 'test' }), continuationIdentity: () => 'c'.repeat(64) },
    defaults: { provider: 'app-server', mode, policyKey, capabilities: ['samples', 'network.citations', 'network.shelf'] } });
  async function prepared(id = 'job', skill = true) {
    return jobs.prepare({ id, idempotencyKey: id + '-key', threadId: 'thread', intent: 'unsure', question: 'Use this passage.', ...(skill ? { readerSkill: selection } : {}) });
  }
  function grant(p: Awaited<ReturnType<typeof prepared>>) {
    const preview = consent.prepare(p.consent);
    return consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'this-time' }, { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' });
  }
  async function wait(id = 'job') {
    for (let i = 0; i < 3000; i++) {
      const job = jobs.get(id);
      if (job && ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(job.state)) return job;
      await new Promise<void>(r => setTimeout(r, 2));
    }
    throw Error('Job did not settle: ' + jobs.get(id)?.state + ':' + jobs.get(id)?.reason);
  }
  return { root, database, reader, consent, runtime, jobs, prepared, grant, wait, starts: () => starts,
    setDeliver: (fn: typeof deliver) => { deliver = fn; },
    close: async () => { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); } };
}
test('skill binds exact host wrapper and selection; ordinary unsure scope/capabilities stay unchanged', async () => {
  const f = await fixture();
  try {
    const p = await f.prepared(), ordinary = await f.prepared('ordinary', false);
    assert.equal(p.consent.scope, 'open-session'); assert.equal(ordinary.consent.scope, 'cloud-inference');
    assert.deepEqual(p.job.readerSkill, selection); assert.deepEqual(p.job.capabilities, ['samples', 'network.citations', 'network.shelf']);
    assert.deepEqual(ordinary.job.capabilities, ['samples']); assert.equal(f.starts(), 0);
    assert.match(p.consent.outgoing.map(x => x.text).join('\n'), /Installed skill contents are unpinned/);
    assert.match(p.consent.outgoing[0].text, /Selected passage/);
    assert.deepEqual(JSON.parse(p.consent.outgoing[0].text).readerSkill, { ...selection, execution: 'requested' });
    const g = f.grant(p);
    await assert.rejects(f.jobs.create({ ...p.job, readerSkill: { ...selection, name: 'other' }, grantId: g.id }), /changed|unavailable/);
    await assert.rejects(f.jobs.prepare({ ...p.job, intent: 'define' }), /Invalid reader skill/);
    const wrongPlan = await f.prepared('wrong');
    const wrong = f.grant({ ...wrongPlan, consent: { ...wrongPlan.consent, scope: 'cloud-inference' } });
    await f.jobs.create({ ...wrongPlan.job, grantId: wrong.id });
    assert.equal((await f.wait('wrong')).state, 'failed'); assert.equal(f.starts(), 0);
  } finally { await f.close(); }
});
for (const mode of ['workspace-files', 'structured-final'] as const) test('unformatted output stays failed, byte-preserved and outside accepted replies: ' + mode, async () => {
  const f = await fixture(mode), raw = '  Raw skill output\r\n<script>still text</script> 🙂  ';
  try {
    f.setDeliver(async (request, handle, hooks) => {
      if (mode === 'workspace-files') await writeFile(join(request.workspace, 'reply.json'), raw);
      const terminal: ProviderHandle = mode === 'workspace-files' ? { ...handle, state: 'completed' } : { ...handle, state: 'failed', reason: 'invalid-or-missing-final-output', rawFinalOutput: hooks.captureFinalOutput!(JSON.stringify({ replyJson: raw }), handle) };
      return await hooks.checkpoint(terminal) as ProviderHandle;
    });
    const p = await f.prepared(), g = f.grant(p), before = Date.now(); await f.jobs.create({ ...p.job, grantId: g.id });
    const result = await f.wait();
    assert.equal(result.state, 'failed'); assert.equal(result.replyVersionId, undefined);
    assert.equal(result.unformatted?.text, raw, result.reason); assert.equal(result.unformatted?.sha256, skillOutputHash(raw));
    assert.equal(result.attempts[0].providerHandle?.rawFinalOutput, undefined);
    assert.equal((f.reader.db.prepare('SELECT count(*) AS n FROM job_skill_pending').get() as { n: number }).n, 0);
    assert.equal(f.reader.replies('thread').length, 0);
    assert.ok(Date.parse(result.attempts[0].deadlineAt!) >= before + READER_SKILL_TIMEOUT_MS);
    const audit = f.reader.db.prepare('SELECT acceptedAt,outcome FROM consent_attempt_authorizations WHERE attemptId=?').get(result.latestAttemptId) as { acceptedAt: string | null; outcome: string };
    assert.deepEqual(audit, { acceptedAt: null, outcome: 'unformatted' });
    f.consent.recordOutcome(result.latestAttemptId!, 'failed');
    assert.equal(f.consent.egress('job')[0].outcome, 'unformatted');
    const reopened = new ReaderStore(f.database);
    try { assert.deepEqual(new JobStore(reopened).get('job')?.unformatted, result.unformatted); } finally { reopened.close(); }
    await assert.rejects(f.jobs.prepareFollowup('job', { id: 'child', idempotencyKey: 'child', question: 'Continue' }), /confirmed completed reply/);
    assert.throws(() => f.jobs.store.createAttempt('job'), /new reviewed request/);
    assert.equal(f.jobs.get('job')?.unformatted?.text, raw);
    const retry = await f.jobs.prepareRetry('job', { id: 'retry', idempotencyKey: 'retry-key' });
    assert.deepEqual(retry.job.readerSkill, selection);
    const expired = f.reader.db.prepare('SELECT expiresAt FROM job_preparations WHERE jobId=?').get('retry') as { expiresAt: string };
    assert.ok(Date.parse(expired.expiresAt) < Date.now() + READER_SKILL_TIMEOUT_MS);
  } finally { await f.close(); }
});
test('accepted skill reply preserves authored candidate and host provenance; explicit follow-up forks', async () => {
  const f = await fixture();
  try {
    f.setDeliver(async (request, handle, hooks) => { await writeFile(join(request.workspace, 'reply.json'), JSON.stringify(reply)); return await hooks.checkpoint({ ...handle, state: 'completed' }) as ProviderHandle; });
    const p = await f.prepared(); await f.jobs.create({ ...p.job, grantId: f.grant(p).id }); const result = await f.wait();
    assert.equal(result.state, 'succeeded', result.reason); assert.equal(result.unformatted, undefined);
    const saved = f.reader.reply(result.replyVersionId!)!; assert.deepEqual(saved.reply, reply);
    assert.deepEqual(saved.readerSkill, { ...selection, execution: 'requested' });
    const followup = await f.jobs.prepareFollowup('job', { id: 'followup', idempotencyKey: 'followup-key', question: 'Continue' });
    assert.deepEqual(followup.job.readerSkill, selection);
    assert.notEqual(followup.job.preparedPayloadDigest, p.job.preparedPayloadDigest);
  } finally { await f.close(); }
});
for (const action of ['cancel', 'revoke', 'delete', 'timeout', 'provider-failure'] as const) test('no raw fallback after ' + action, async () => {
  const f = await fixture();
  try {
    f.setDeliver(async (request, handle, hooks) => {
      await writeFile(join(request.workspace, 'reply.json'), 'Raw final');
      if (action === 'cancel') await f.jobs.cancel('job');
      if (action === 'revoke') f.consent.revokeGrant(f.jobs.get('job')!.grantId, 1);
      if (action === 'delete') f.reader.apply({ id: 'remove', kind: 'remove', threadId: 'thread', removed: true, expectedRevision: f.reader.get('thread')!.revision });
      if (action === 'timeout') f.jobs.store.markTimedOut('job', request.jobId);
      if (action === 'provider-failure') return await hooks.checkpoint({ ...handle, state: 'failed', reason: 'provider-turn-failed' }) as ProviderHandle;
      return await hooks.checkpoint({ ...handle, state: 'completed' }) as ProviderHandle;
    });
    const p = await f.prepared(); await f.jobs.create({ ...p.job, grantId: f.grant(p).id }); const result = await f.wait();
    assert.equal(result.unformatted, undefined); assert.equal(result.replyVersionId, undefined);
    assert.equal((f.reader.db.prepare('SELECT count(*) AS n FROM job_skill_outputs').get() as { n: number }).n, 0);
  } finally { await f.close(); }
});

test('unformatted save and audit roll back together when the commit callback throws', async () => {
  const f = await fixture();
  try {
    const original = f.jobs.store.saveUnformatted.bind(f.jobs.store);
    f.jobs.store.saveUnformatted = (...args) => { original(...args); throw Error('rollback-fixture'); };
    f.setDeliver(async (request, handle, hooks) => { await writeFile(join(request.workspace, 'reply.json'), 'Raw'); return await hooks.checkpoint({ ...handle, state: 'completed' }) as ProviderHandle; });
    const p = await f.prepared(); await f.jobs.create({ ...p.job, grantId: f.grant(p).id }); const result = await f.wait();
    assert.equal(result.state, 'failed'); assert.equal(result.unformatted, undefined);
    assert.equal((f.reader.db.prepare('SELECT count(*) AS n FROM job_skill_outputs').get() as { n: number }).n, 0);
    const audit = f.reader.db.prepare('SELECT acceptedAt,outcome FROM consent_attempt_authorizations WHERE attemptId=?').get(result.latestAttemptId) as { acceptedAt: string | null; outcome: string };
    assert.equal(audit.acceptedAt, null); assert.notEqual(audit.outcome, 'unformatted'); assert.notEqual(audit.outcome, 'accepted');
  } finally { await f.close(); }
});
test('revocation after asynchronous commit review is caught by the final transactional fence', async () => {
  const f = await fixture();
  try {
    const original = f.consent.revalidate.bind(f.consent);
    f.consent.revalidate = async (job, stage) => {
      const decision = await original(job, stage);
      if (stage === 'commit') { await Promise.resolve(); f.consent.revokeGrant(job.grantId, 1); }
      return decision;
    };
    f.setDeliver(async (request, handle, hooks) => { await writeFile(join(request.workspace, 'reply.json'), 'Raw'); return await hooks.checkpoint({ ...handle, state: 'completed' }) as ProviderHandle; });
    const p = await f.prepared(); await f.jobs.create({ ...p.job, grantId: f.grant(p).id }); const result = await f.wait();
    assert.equal(result.unformatted, undefined); assert.equal(result.replyVersionId, undefined);
    assert.notEqual(f.consent.egress('job')[0].outcome, 'unformatted');
  } finally { await f.close(); }
});
test('skill restart retains its original persisted deadline instead of granting another fifteen minutes', async () => {
  const f = await fixture();
  let restored: JobService | undefined;
  try {
    f.setDeliver(async (_request, handle, hooks) => await hooks.checkpoint({ ...handle, state: 'running' }) as ProviderHandle);
    const p = await f.prepared(); await f.jobs.create({ ...p.job, grantId: f.grant(p).id });
    for (let i = 0; i < 1000 && f.jobs.get('job')?.state !== 'running'; i++) await new Promise<void>(r => setTimeout(r, 2));
    assert.equal(f.jobs.get('job')?.state, 'running');
    const deadline = f.jobs.get('job')!.attempts[0].deadlineAt;
    await f.jobs.close();
    restored = new JobService({ reader: f.reader, workspaceRoot: join(f.root, 'jobs'), runtimeFactory: f.runtime, timeoutMs: 1000,
      library: { modelFor: () => ({ model: 'test-model', settingsRevision: 1, compatibilityKey: 'test' }), continuationIdentity: () => 'c'.repeat(64) },
      defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: ['samples', 'network.citations', 'network.shelf'] } });
    await restored.recover(); assert.equal(restored.get('job')!.attempts[0].deadlineAt, deadline);
    assert.equal(restored.get('job')!.state, 'running');
  } finally { await restored?.close(); await f.close(); }
});
test('unsafe or oversized workspace final bytes never become fallback text', async () => {
  for (const raw of [Buffer.from([0xff, 0xfe]), Buffer.alloc(256 * 1024 + 1, 65)]) {
    const f = await fixture();
    try {
      f.setDeliver(async (request, handle, hooks) => { await writeFile(join(request.workspace, 'reply.json'), raw); return await hooks.checkpoint({ ...handle, state: 'completed' }) as ProviderHandle; });
      const p = await f.prepared(); await f.jobs.create({ ...p.job, grantId: f.grant(p).id }); const result = await f.wait();
      assert.equal(result.unformatted, undefined); assert.equal(result.replyVersionId, undefined);
    } finally { await f.close(); }
  }
});

for (const fence of ['revoke', 'delete', 'deadline', 'cancel'] as const) test('pending structured raw text never enters public snapshots across ' + fence, async () => {
  const f = await fixture('structured-final'), canary = 'PRIVATE_RAW_CANARY_' + fence;
  let checked = false;
  try {
    const original = f.consent.revalidate.bind(f.consent);
    f.consent.revalidate = async (job, stage) => {
      if (stage === 'commit') {
        checked = true;
        assert.equal(f.jobs.store.pendingSkillOutput(job.latestAttemptId!), canary);
        assert.ok(!JSON.stringify(f.jobs.get('job')).includes(canary));
        assert.ok(!JSON.stringify(f.jobs.list()).includes(canary));
        const stored = f.reader.db.prepare('SELECT providerHandle FROM job_attempts WHERE id=?').get(job.latestAttemptId) as { providerHandle: string };
        assert.ok(!stored.providerHandle.includes(canary));
        if (fence === 'revoke') f.consent.revokeGrant(job.grantId, 1);
        if (fence === 'delete') f.reader.apply({ id: 'remove-pending', kind: 'remove', threadId: 'thread', removed: true, expectedRevision: f.reader.get('thread')!.revision });
        if (fence === 'deadline') f.jobs.store.markTimedOut('job', job.latestAttemptId!);
        if (fence === 'cancel') await f.jobs.cancel('job');
      }
      return original(job, stage);
    };
    f.setDeliver(async (_request, handle, hooks) => await hooks.checkpoint({ ...handle, state: 'failed', reason: 'invalid-or-missing-final-output',
      rawFinalOutput: hooks.captureFinalOutput!(JSON.stringify({ replyJson: canary }), handle) }) as ProviderHandle);
    const p = await f.prepared(); await f.jobs.create({ ...p.job, grantId: f.grant(p).id }); const result = await f.wait();
    assert.equal(checked, true); assert.equal(result.unformatted, undefined);
    assert.ok(!JSON.stringify(result).includes(canary)); assert.ok(!JSON.stringify(f.jobs.list()).includes(canary));
    assert.equal((f.reader.db.prepare('SELECT count(*) AS n FROM job_skill_pending').get() as { n: number }).n, 0);
    const reopened = new ReaderStore(f.database);
    try { assert.ok(!JSON.stringify(new JobStore(reopened).get('job')).includes(canary)); } finally { reopened.close(); }
  } finally { await f.close(); }
});

test('internal raw observation survives restart for authorized settlement without a public leak', async () => {
  const f = await fixture('structured-final'), canary = 'RECOVERY_RAW_CANARY';
  let recovered: JobService | undefined;
  try {
    f.setDeliver(async (_request, handle, hooks) => await hooks.checkpoint({ ...handle, state: 'running' }) as ProviderHandle);
    const p = await f.prepared(); await f.jobs.create({ ...p.job, grantId: f.grant(p).id });
    for (let i = 0; i < 1000 && f.jobs.get('job')?.state !== 'running'; i++) await new Promise<void>(r => setTimeout(r, 2));
    await f.jobs.close();
    const prior = f.jobs.get('job')!, attempt = prior.attempts[0];
    f.jobs.store.checkpoint(attempt.id, { ...attempt.providerHandle!, state: 'failed', reason: 'invalid-or-missing-final-output', rawFinalOutput: canary });
    assert.ok(!JSON.stringify(f.jobs.get('job')).includes(canary));
    recovered = new JobService({ reader: f.reader, workspaceRoot: join(f.root, 'jobs'), runtimeFactory: f.runtime,
      library: { modelFor: () => ({ model: 'test-model', settingsRevision: 1, compatibilityKey: 'test' }), continuationIdentity: () => 'c'.repeat(64) },
      defaults: { provider: 'app-server', mode: 'structured-final', policyKey, capabilities: ['samples', 'network.citations', 'network.shelf'] } });
    await recovered.recover(); const result = recovered.get('job')!;
    assert.equal(result.state, 'failed'); assert.equal(result.unformatted?.text, canary); assert.equal(f.starts(), 1);
    assert.equal(result.attempts[0].providerHandle?.rawFinalOutput, undefined);
    assert.equal((f.reader.db.prepare('SELECT count(*) AS n FROM job_skill_pending').get() as { n: number }).n, 0);
  } finally { await recovered?.close(); await f.close(); }
});
test('valid structured skill admission clears duplicate pending raw observation', async () => {
  const f = await fixture('structured-final');
  try {
    f.setDeliver(async (_request, handle, hooks) => {
      const output = JSON.stringify({ replyJson: JSON.stringify(reply) });
      assert.equal(await hooks.validateOutput(output, handle, undefined), true);
      return await hooks.checkpoint({ ...handle, state: 'completed', output, rawFinalOutput: hooks.captureFinalOutput!(output, handle) }) as ProviderHandle;
    });
    const p = await f.prepared(); await f.jobs.create({ ...p.job, grantId: f.grant(p).id }); const result = await f.wait();
    assert.equal(result.state, 'succeeded'); assert.deepEqual(f.reader.reply(result.replyVersionId!)?.reply, reply);
    assert.equal(result.attempts[0].providerHandle?.rawFinalOutput, undefined);
    assert.equal((f.reader.db.prepare('SELECT count(*) AS n FROM job_skill_pending').get() as { n: number }).n, 0);
  } finally { await f.close(); }
});
