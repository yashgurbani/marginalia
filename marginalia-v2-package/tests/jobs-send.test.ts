import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderStore } from '../daemon/store.ts';
import { JobStore } from '../daemon/jobs/store.ts';
import { JobService } from '../daemon/jobs/service.ts';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import { prepareSendCheckpoint } from '../daemon/jobs/send-checkpoint.ts';
import { isPreparationAuthorization } from '../daemon/providers/preparation-authority.ts';
import { startServer } from '../daemon/server.ts';
import type { FrozenJobContext, StartJobInput } from '../contracts/jobs.ts';
import type { ProviderHandle, ProviderRequest } from '../contracts/job-runner.ts';
import type { AuthorizedRuntimeFactory } from '../daemon/jobs/runtime.ts';

const policyKey = 'a'.repeat(64), digest = 'd'.repeat(64);
const keep = { id: 'keep-send', kind: 'keep' as const, threadId: 'thread-send',
  capture: { url: 'https://example.org/article', title: 'Article', pageType: 'article', text: 'Start here.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' },
  anchor: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5 } };
const library = { modelFor: () => ({ model: 'test-model', settingsRevision: 1, compatibilityKey: 'test' }), continuationIdentity: () => 'b'.repeat(64) };
function fixture() {
  const reader = new ReaderStore(':memory:'); reader.apply(keep);
  const store = new JobStore(reader), consent = new ConsentSessionService(reader);
  const thread = reader.get(keep.threadId)!, source = reader.sourceVersion(thread.sourceVersionId)!;
  const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: source.id, sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle,
    sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt, sourceHash: source.hash, sourceText: source.text,
    passage: thread.anchor, question: 'Explain', intent: 'define', preparedPayloadDigest: digest, modelSettingsRevision: 1, modelCompatibilityKey: 'test',
    outgoing: { schema: 'marginalia.job-packet.v1', intent: 'define', question: 'Explain',
      source: { url: thread.sourceUrl, title: thread.sourceTitle, pageType: source.pageType, capturedAt: source.capturedAt, sourceHash: source.hash, sourceVersionId: source.id },
      selection: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5, originalEnd: 5, omittedCharacters: 0 },
      adjacentContext: { before: '', after: '', basis: 'bounded-character-context' }, availableCapabilities: [], omissions: [] } };
  const preview = consent.prepare({ requestId: 'send-job', bindingDigest: digest, sourceUrl: thread.sourceUrl, scope: 'cloud-inference',
    recipient: 'openai-codex', recipientLabel: 'OpenAI Codex', provider: 'app-server', policyKey,
    outgoing: [{ label: 'Reviewed packet', text: 'Start here.', sha256: createHash('sha256').update('Start here.').digest('hex') }] });
  const grant = consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'this-time' },
    { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' });
  const input: StartJobInput = { id: 'send-job', idempotencyKey: 'send-key', threadId: thread.id, intent: 'define', question: 'Explain',
    provider: 'app-server', model: 'test-model', mode: 'structured-final', policyKey, grantId: grant.id, preparedPayloadDigest: digest };
  store.create(input, context, 'packet-digest', 'request-digest'); const attempt = store.createAttempt(input.id);
  store.setDeadline(input.id, attempt.id, new Date(Date.now() + 60_000).toISOString()); store.markPreparing(input.id, attempt.id); store.markWorkspacePrepared(input.id, attempt.id);
  const request: ProviderRequest = { jobId: attempt.id, workspace: process.cwd(), policyKey, model: input.model, mode: input.mode,
    prompt: 'Explain the saved passage', outputSchema: { type: 'object' } };
  const handle: ProviderHandle = { jobId: attempt.id, provider: 'app-server', workspace: request.workspace, policyKey, model: input.model,
    mode: input.mode, state: 'starting', tombstone: false, providerInstanceId: 'instance', threadId: 'provider-thread' };
  return { reader, store, consent, grant, request, handle, current: () => store.get(input.id)! };
}
function effects(f: ReturnType<typeof fixture>) {
  const db = f.reader.db, attempt = f.current().attempts.find(a => a.id === f.request.jobId)!;
  return {
    consumed: (db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(f.grant.id) as { consumedAttemptId: string | null }).consumedAttemptId,
    authorizations: (db.prepare('SELECT count(*) n FROM consent_attempt_authorizations').get() as { n: number }).n,
    egress: (db.prepare('SELECT count(*) n FROM egress_events').get() as { n: number }).n,
    handoff: attempt.handoffMarked, checkpoint: attempt.dispatchClaimed,
    outbox: (db.prepare("SELECT count(*) n FROM events WHERE kind IN ('egress-approved','egress-dispatched')").get() as { n: number }).n,
  };
}
const none = { consumed: null, authorizations: 0, egress: 0, handoff: false, checkpoint: false, outbox: 0 };
async function prepare(f: ReturnType<typeof fixture>, admit?: () => boolean) {
  const expected = f.current(), eligibility = await f.consent.revalidate(expected, 'dispatch');
  return prepareSendCheckpoint(f.store, expected, f.request, f.consent, eligibility.eligibilityFingerprint!, admit);
}

for (const scenario of ['cancel', 'revoke', 'site-epoch', 'pairing', 'payload', 'context', 'attempt', 'deadline', 'request', 'handle'] as const) {
  test(`current final send rejects ${scenario} after asynchronous preparation with no consumed grant or egress`, async () => {
    const f = fixture(); let paired = true, writes = 0;
    try {
      const checkpoint = await prepare(f, () => paired); await Promise.resolve();
      let request = f.request, handle = f.handle;
      if (scenario === 'cancel') f.store.requestCancel(f.current().id);
      if (scenario === 'revoke') f.consent.revokeGrant(f.grant.id, f.grant.revision);
      if (scenario === 'site-epoch') { const e = f.consent.setExclusion(f.current().context.sourceUrl, true); f.consent.setExclusion(e.site, false, e.revision); }
      if (scenario === 'pairing') paired = false;
      if (scenario === 'payload') f.reader.db.prepare('UPDATE jobs SET preparedPayloadDigest=? WHERE id=?').run('e'.repeat(64), f.current().id);
      if (scenario === 'context') f.reader.db.prepare('UPDATE jobs SET context=? WHERE id=?').run(JSON.stringify({ ...f.current().context, sourceText: 'Changed' }), f.current().id);
      if (scenario === 'attempt') f.reader.db.prepare("UPDATE jobs SET latestAttemptId='different' WHERE id=?").run(f.current().id);
      if (scenario === 'deadline') f.reader.db.prepare("UPDATE job_attempts SET deadlineAt='2000-01-01T00:00:00Z' WHERE id=?").run(f.request.jobId);
      if (scenario === 'request') request = { ...request, prompt: 'not reviewed' };
      if (scenario === 'handle') handle = { ...handle, providerInstanceId: undefined };
      assert.throws(() => { checkpoint.finalize(request, handle); writes++; }); assert.equal(writes, 0); assert.deepEqual(effects(f), none);
      assert.throws(() => checkpoint.finalize(f.request, f.handle), /already finalized/);
    } finally { f.reader.close(); }
  });
}

test('initial checkpoint failure rolls back grant, egress, handoff and their outbox', async () => {
  const f = fixture();
  try {
    const checkpoint = await prepare(f);
    f.reader.db.exec("CREATE TRIGGER fail_send_checkpoint BEFORE UPDATE OF dispatchClaimed ON job_attempts WHEN NEW.dispatchClaimed=1 BEGIN SELECT RAISE(ABORT,'injected checkpoint failure'); END;");
    assert.throws(() => checkpoint.finalize(f.request, f.handle), /injected checkpoint failure/);
    assert.deepEqual(effects(f), none); assert.equal(f.current().attempts[0].revision, 0);
  } finally { f.reader.close(); }
});

test('one successful finalization atomically commits and competing finalizers cannot consume/send again', async () => {
  const f = fixture(); let paired = true;
  try {
    const a = await prepare(f, () => paired), b = await prepare(f, () => paired);
    const canonical = a.finalize(f.request, f.handle);
    assert.equal(canonical.revision, 1); assert.equal(f.current().state, 'sending'); assert.equal(f.reader.db.inTransaction, false);
    const committed = { consumed: f.request.jobId, authorizations: 1, egress: 1, handoff: true, checkpoint: true, outbox: 2 };
    assert.deepEqual(effects(f), committed);
    assert.throws(() => b.finalize(f.request, f.handle)); assert.throws(() => a.finalize(f.request, f.handle), /already finalized/);
    paired = false; assert.equal(f.current().cancelRequested, false); assert.deepEqual(effects(f), committed);
    // Distinct durable attempt under the same request cannot reuse its already consumed once grant.
    f.store.createAttempt(f.current().id);
    await assert.rejects(f.consent.revalidate(f.current(), 'dispatch'), /already used/);
    assert.deepEqual(effects(f), committed);
  } finally { f.reader.close(); }
});

test('non-consuming provider preparation is async-local, expires, and cannot masquerade as dispatched evidence', async () => {
  const f = fixture();
  try {
    const job = f.current(); assert.throws(() => f.consent.currentAuthorization(job, f.request.jobId, true));
    await f.consent.withProviderPreparation(job, f.request.jobId, async () => {
      await Promise.resolve(); const a = f.consent.currentAuthorization(job, f.request.jobId, true);
      assert.equal(isPreparationAuthorization(a), true); assert.equal('id' in a, false); assert.equal('egressEventId' in a, false); assert.equal('dispatchedAt' in a, false);
      assert.equal(isPreparationAuthorization(structuredClone(a)), false); assert.deepEqual(effects(f), none);
      f.consent.revokeGrant(f.grant.id, f.grant.revision); assert.throws(() => f.consent.currentAuthorization(job, f.request.jobId, true));
    });
    assert.throws(() => f.consent.currentAuthorization(job, f.request.jobId, true)); assert.deepEqual(effects(f), none);
  } finally { f.reader.close(); }
});

for (const cancel of [false, true]) {
  test(`JobService retains the original principal fence across provider preparation (cancel=${cancel})`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 't06-native-')), reader = new ReaderStore(':memory:'); reader.apply(keep);
    const consent = new ConsentSessionService(reader); let paired = true, sends = 0, enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; }), released = new Promise<void>(r => { release = r; });
    // Test-only boundary double, not a Codex runtime or an acceptance receipt.
    const factory: AuthorizedRuntimeFactory = { consent, dispatchReady: true, async create(_j, _id, _w, hooks) { return { close() {}, runner: {
      capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
      async start(request) { enter(); await released; const { jobId, workspace, policyKey, model, mode } = request;
        const handle = hooks.finalizeSend(request, { jobId, workspace, policyKey, model, mode, provider: 'app-server', providerInstanceId: 'test', state: 'starting', tombstone: false }); sends++; return handle; },
      async resume() { throw new Error('No resume'); }, async inspect() { throw new Error('No inspect'); }, async cancel(handle) { return handle; },
    } }; } };
    const jobs = new JobService({ reader, workspaceRoot: join(dir, 'jobs'), library, runtimeFactory: factory,
      defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] } });
    try {
      const p = await jobs.prepare({ id: 'public', idempotencyKey: 'public-key', threadId: keep.threadId, intent: 'simulate', question: 'Explain' });
      const preview = consent.prepare(p.consent), grant = consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'this-time' }, { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' });
      const job = await jobs.create({ ...p.job, grantId: grant.id }, () => paired); await entered;
      if (cancel) await jobs.cancel(job.id); else paired = false;
      release(); await jobs.close();
      assert.equal(sends, 0); assert.equal(jobs.get(job.id)!.state, cancel ? 'cancelled' : 'failed');
      assert.equal(jobs.get(job.id)!.attempts[0].handoffMarked, false); assert.equal(consent.egress().length, 0);
    } finally { release(); await jobs.close(); reader.close(); await rm(dir, { recursive: true, force: true }); }
  });
}

test('HTTP preparation rechecks pairing after the service resolves; optional diagnostics cannot hide storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't06-http-'));
  const helper = await startServer({ database: ':memory:', port: 0, jobWorkspaceRoot: join(dir, 'jobs'), diagnostics: async () => { throw new Error('unavailable diagnostic'); },
    runtimeFactoryBuilder: async ({ consent }) => ({ consent, dispatchReady: false, jobDefaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: [] }, async create() { throw new Error('No provider should launch'); } }) });
  try {
    const origin = 'chrome-extension://' + 'a'.repeat(32);
    const health = await fetch(helper.origin + '/health'); assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ready', storage: 'ready' });
    const paired = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ challenge: helper.challenge }) });
    const { token, codex } = await paired.json() as { token: string; codex: unknown }; assert.equal(paired.status, 200); assert.deepEqual(codex, { status: 'unavailable', login: 'unknown' });
    helper.store.apply(keep);
    const original = helper.jobs.prepare.bind(helper.jobs);
    helper.jobs.prepare = async (...args) => { const prepared = await original(...args); helper.pairing.revoke(token); return prepared; };
    const result = await fetch(helper.origin + '/api/jobs/prepare', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: 'stale-http', idempotencyKey: 'stale-http-key', threadId: keep.threadId, intent: 'simulate', question: 'Explain' }) });
    assert.equal(result.status, 401); assert.equal(helper.jobs.list().length, 0);
    assert.equal((helper.store.db.prepare('SELECT count(*) n FROM consent_previews').get() as { n: number }).n, 0);
    assert.equal(helper.jobs.configured, true); assert.equal(helper.jobs.available, false);
  } finally { await helper.close(); await rm(dir, { recursive: true, force: true }); }
});


test('active restart recovery rejects a workspace outside the configured root before creating a provider', async () => {
  const f = fixture(), root = await mkdtemp(join(tmpdir(), 't06-recovery-'));
  let creates = 0;
  const jobs = new JobService({ reader: f.reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'structured-final', policyKey, capabilities: [] },
    runtimeFactory: { consent: f.consent, dispatchReady: true, async create() { creates++; throw new Error('Must not create a provider for an unbound workspace'); } } });
  try {
    const checkpoint = await prepare(f); checkpoint.finalize(f.request, f.handle);
    const first = jobs.recover(); assert.equal(jobs.recover(), first);
    await first;
    assert.equal(creates, 0); assert.equal(jobs.get('send-job')!.state, 'outcome_unknown');
    await jobs.recover(); assert.equal(creates, 0);
    assert.equal(effects(f).consumed, f.request.jobId); // Unknown dispatch is not refunded.
  } finally { await jobs.close(); f.reader.close(); await rm(root, { recursive: true, force: true }); }
});


test('definition preparation pins installed instructions in the prompt, preview and digest without sending', async () => {
  const root = await mkdtemp(join(tmpdir(), 't06-definition-')), reader = new ReaderStore(':memory:'); reader.apply(keep);
  const consent = new ConsentSessionService(reader);
  const jobs = new JobService({ reader, workspaceRoot: root, library,
    defaults: { provider: 'app-server', mode: 'structured-final', policyKey, capabilities: [] },
    runtimeFactory: { consent, dispatchReady: false, async create() { throw new Error('No inference for preparation'); } } });
  try {
    const result = await jobs.prepare({ id: 'definition', idempotencyKey: 'definition-key', threadId: keep.threadId, intent: 'define', question: 'Define Start in context' });
    const instructions = result.consent.outgoing.find(part => part.label === 'Pinned definition instructions');
    assert.ok(instructions); assert.ok(instructions.text.includes('Keep the contextual explanation at most 60 words'));
    assert.equal(instructions.sha256, createHash('sha256').update(instructions.text).digest('hex'));
    assert.ok(result.consent.outgoing.find(part => part.label === 'Adapter prompt')!.text.startsWith(instructions.text));
    assert.ok(result.consent.outgoing.reduce((bytes, part) => bytes + Buffer.byteLength(part.text), 0) <= 60 * 1024);
    assert.equal(result.consent.bindingDigest, result.job.preparedPayloadDigest);
    assert.equal(jobs.list().length, 0); assert.equal(consent.egress().length, 0);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});


test('malformed optional runtime defaults cannot make saved reading unavailable', async () => {
  const helper = await startServer({ database: ':memory:', port: 0,
    runtimeFactoryBuilder: async ({ consent }) => ({ consent, dispatchReady: true, jobDefaults: {} as never,
      async create() { throw new Error('Invalid runtime defaults must never dispatch'); } }) });
  try {
    helper.store.apply(keep); assert.ok(helper.store.get(keep.threadId));
    assert.equal(helper.jobs.configured, false); assert.equal(helper.jobs.available, false);
    const health = await fetch(helper.origin + '/health'); assert.equal(health.status, 200);
  } finally { await helper.close(); }
});
