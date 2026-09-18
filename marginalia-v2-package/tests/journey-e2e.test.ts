import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConsentGrant, ConsentPreview } from '../contracts/consent.ts';
import type { JobSnapshot, PreparedJobPlan } from '../contracts/jobs.ts';
import type { CandidateReply } from '../contracts/reply.ts';
import type { Daemon } from './journey-harness.ts';
import { journey, keepMutation, pollJob, scriptedReply } from './journey-harness.ts';

type Submission = { preview: ConsentPreview; job: PreparedJobPlan };

async function submit(daemon: Daemon, ids: { threadId: string; mutationId: string; jobId: string; idempotencyKey: string }): Promise<Submission> {
  const changed = await daemon.request('POST', '/api/change', keepMutation(ids.threadId, ids.mutationId));
  assert.equal(changed.status, 200);
  const prepared = await daemon.request('POST', '/api/jobs/prepare', { id: ids.jobId, idempotencyKey: ids.idempotencyKey,
    threadId: ids.threadId, intent: 'explore', question: 'Explain this passage.' });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  return prepared.body as unknown as Submission;
}

async function approve(daemon: Daemon, preview: ConsentPreview, choice: 'this-time' | 'never-site' = 'this-time'): Promise<ConsentGrant> {
  const decision = await daemon.request('POST', '/api/consent/decision', { previewId: preview.id, expectedRevision: preview.revision, choice });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));
  return decision.body.grant as ConsentGrant;
}

async function start(daemon: Daemon, submission: Submission, grant: ConsentGrant): Promise<JobSnapshot> {
  const started = await daemon.request('POST', '/api/jobs', { ...submission.job, grantId: grant.id });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  return started.body as unknown as JobSnapshot;
}

async function waitForRecovery(trip: Awaited<ReturnType<typeof journey>>, jobId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  let incompleteRecord: SyntaxError | undefined;
  while (Date.now() < deadline) {
    try {
      if ((await trip.calls()).some(call => call.lifetime === 'second' && call.kind === 'inspect' && call.jobId === jobId)) return;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      incompleteRecord = error;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Recovery did not inspect ${jobId}.`, { cause: incompleteRecord });
}

test('the reader journey completes end to end through the real daemon and saves the reply', async () => {
  const trip = await journey('complete');
  try {
    const daemon = await trip.start('complete'), title = 'Journey meaning';
    await trip.script({ 'job-complete': { behaviour: 'reply', reply: scriptedReply(title) } });
    const submission = await submit(daemon, { threadId: 'thread-complete', mutationId: 'keep-complete', jobId: 'job-complete', idempotencyKey: 'key-complete' });
    const grant = await approve(daemon, submission.preview);
    const created = await start(daemon, submission, grant);
    const completed = await pollJob(daemon, created.id, job => job.state === 'succeeded');
    if (typeof completed.replyVersionId !== 'string') throw new Error('Succeeded job has no reply version.');
    assert.ok(completed.replyVersionId.length > 0);
    const replies = await daemon.request('GET', `/api/replies?threadId=${encodeURIComponent(created.threadId)}`);
    assert.equal(replies.status, 200);
    const saved = (replies.body as unknown as { replies: Array<{ id: string; reply: CandidateReply }> }).replies;
    assert.equal(saved.length, 1); assert.equal(saved[0].id, completed.replyVersionId); assert.equal(saved[0].reply.title, title);
    assert.equal((await trip.calls()).filter(call => call.kind === 'start' && call.jobId === created.id).length, 1);
  } finally { await trip.dispose(); }
});

test('E30 real daemon declines new provider replies with missing or incomplete origins', async () => {
  const trip = await journey('origins-missing');
  try {
    const daemon = await trip.start('origins-missing');
    for (const kind of ['missing', 'incomplete'] as const) {
      const reply = scriptedReply();
      if (kind === 'missing') delete reply.origins;
      else delete reply.origins!.parts['/blocks/0'];
      const jobId = `job-origin-${kind}`, threadId = `thread-origin-${kind}`;
      await trip.script({ [jobId]: { behaviour: 'reply', reply } });
      const submission = await submit(daemon, { threadId, mutationId: `keep-origin-${kind}`, jobId, idempotencyKey: `key-origin-${kind}` });
      const grant = await approve(daemon, submission.preview);
      const created = await start(daemon, submission, grant);
      const failed = await pollJob(daemon, created.id, job => job.state === 'failed');
      assert.equal(failed.replyVersionId, undefined);
      const saved = await daemon.request('GET', `/api/replies?threadId=${threadId}`);
      assert.deepEqual(saved.body.replies, []);
    }
  } finally { await trip.dispose(); }
});

test('nothing reaches the runtime before the reader approves the exact request', async () => {
  const trip = await journey('before-consent');
  try {
    const daemon = await trip.start('before-consent');
    const submission = await submit(daemon, { threadId: 'thread-before', mutationId: 'keep-before', jobId: 'job-before', idempotencyKey: 'key-before' });
    assert.equal((await trip.calls()).length, 0);
    const grant = await approve(daemon, submission.preview);
    assert.equal((await trip.calls()).length, 0);
    await daemon.stop();
    trip.store(store => {
      assert.equal((store.db.prepare('SELECT count(*) AS count FROM egress_events').get() as { count: number }).count, 0);
      assert.equal((store.db.prepare('SELECT count(*) AS count FROM consent_attempt_authorizations').get() as { count: number }).count, 0);
      const state = store.db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(grant.id) as { consumedAttemptId: string | null } | undefined;
      assert.ok(state); assert.equal(state.consumedAttemptId, null);
    });
  } finally { await trip.dispose(); }
});

test('the runtime receives exactly the content the consent sheet showed', async () => {
  const trip = await journey('exact-content');
  try {
    const daemon = await trip.start('exact-content');
    await trip.script({ 'job-exact': { behaviour: 'reply', reply: scriptedReply() } });
    const submission = await submit(daemon, { threadId: 'thread-exact', mutationId: 'keep-exact', jobId: 'job-exact', idempotencyKey: 'key-exact' });
    const created = await start(daemon, submission, await approve(daemon, submission.preview));
    const completed = await pollJob(daemon, created.id, job => job.state === 'succeeded');
    const adapter = submission.preview.outgoing.find(part => part.label === 'Adapter prompt');
    const packet = submission.preview.outgoing.find(part => part.label === 'Bounded reading packet');
    assert.ok(adapter); assert.ok(packet);
    const starts = (await trip.calls()).filter(call => call.kind === 'start' && call.jobId === created.id);
    assert.equal(starts.length, 1); assert.equal(starts[0].prompt, adapter.text); assert.equal(starts[0].packetSha256, packet.sha256);
    assert.deepEqual(starts[0].requestKeys, ['jobId', 'mode', 'model', 'policyKey', 'prompt', 'workspace']);
    const attemptId = completed.latestAttemptId; assert.equal(typeof attemptId, 'string');
    await daemon.stop();
    trip.store(store => {
      const egress = store.db.prepare('SELECT recipient,policyKey FROM egress_events WHERE attemptId=?').get(attemptId) as { recipient: string; policyKey: string } | undefined;
      assert.ok(egress); assert.equal(egress.recipient, submission.preview.recipient); assert.equal(egress.policyKey, submission.preview.policyKey);
      const authorization = store.db.prepare('SELECT bindingDigest FROM consent_attempt_authorizations WHERE attemptId=?').get(attemptId) as { bindingDigest: string } | undefined;
      assert.ok(authorization); assert.equal(authorization.bindingDigest, submission.preview.bindingDigest);
    });
  } finally { await trip.dispose(); }
});

test('denying the site sends nothing and records no egress', async () => {
  const trip = await journey('deny');
  try {
    const daemon = await trip.start('deny');
    const submission = await submit(daemon, { threadId: 'thread-deny', mutationId: 'keep-deny', jobId: 'job-deny', idempotencyKey: 'key-deny' });
    const grant = await approve(daemon, submission.preview, 'never-site');
    assert.equal(grant.decision, 'deny-site'); assert.equal(grant.bindingDigest, undefined);
    assert.equal((await trip.calls()).length, 0);
    const jobs = await daemon.request('GET', `/api/jobs?thread=${encodeURIComponent(submission.job.threadId)}`);
    assert.equal(jobs.status, 200); assert.deepEqual(jobs.body.jobs, []);
    await daemon.stop();
    trip.store(store => {
      assert.equal((store.db.prepare('SELECT count(*) AS count FROM egress_events').get() as { count: number }).count, 0);
      assert.equal((store.db.prepare('SELECT count(*) AS count FROM consent_attempt_authorizations').get() as { count: number }).count, 0);
    });
  } finally { await trip.dispose(); }
});

test('cancelling in flight fences the job without a second dispatch', async () => {
  const trip = await journey('cancel');
  try {
    const daemon = await trip.start('cancel');
    await trip.script({ 'job-cancel': { behaviour: 'cancel' } });
    const submission = await submit(daemon, { threadId: 'thread-cancel', mutationId: 'keep-cancel', jobId: 'job-cancel', idempotencyKey: 'key-cancel' });
    const created = await start(daemon, submission, await approve(daemon, submission.preview));
    await pollJob(daemon, created.id, job => job.state === 'running');
    const cancellation = await daemon.request('POST', `/api/jobs/${encodeURIComponent(created.id)}/cancel`);
    assert.equal(cancellation.status, 200); assert.equal(cancellation.body.cancelRequested, true);
    const cancelled = await pollJob(daemon, created.id, job => job.state === 'cancelled');
    const calls = await trip.calls();
    assert.equal(calls.filter(call => call.kind === 'start' && call.jobId === created.id).length, 1);
    assert.equal(calls.filter(call => call.kind === 'cancel' && call.jobId === created.id).length, 1);
    assert.equal(cancelled.replyVersionId, undefined);
    const replies = await daemon.request('GET', `/api/replies?threadId=${encodeURIComponent(created.threadId)}`);
    assert.equal(replies.status, 200); assert.equal((replies.body.replies as unknown[]).length, 0);
  } finally { await trip.dispose(); }
});

test('an unconfirmed handoff stays outcome_unknown and is never resent', async () => {
  const trip = await journey('unknown');
  try {
    const daemon = await trip.start('unknown');
    await trip.script({ 'job-unknown': { behaviour: 'unknown-throw' } });
    const submission = await submit(daemon, { threadId: 'thread-unknown', mutationId: 'keep-unknown', jobId: 'job-unknown', idempotencyKey: 'key-unknown' });
    const created = await start(daemon, submission, await approve(daemon, submission.preview));
    const unknown = await pollJob(daemon, created.id, job => job.state === 'outcome_unknown');
    assert.equal(unknown.attempts[0].handoffMarked, true);
    assert.equal((await trip.calls()).filter(call => call.kind === 'start' && call.jobId === created.id).length, 1);
    const attemptId = unknown.latestAttemptId; assert.equal(typeof attemptId, 'string');
    await daemon.stop();
    trip.store(store => {
      const state = store.db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(unknown.grantId) as { consumedAttemptId: string | null } | undefined;
      assert.ok(state); assert.equal(state.consumedAttemptId, attemptId);
      const count = store.db.prepare('SELECT count(*) AS count FROM egress_events WHERE attemptId=?').get(attemptId) as { count: number };
      assert.equal(count.count, 1);
    });
  } finally { await trip.dispose(); }
});

test('restarting the daemon over an in-flight job reconnects without resending', async () => {
  const trip = await journey('restart');
  try {
    const first = await trip.start('first');
    await trip.script({ 'job-restart': { behaviour: 'hang' } });
    const submission = await submit(first, { threadId: 'thread-restart', mutationId: 'keep-restart', jobId: 'job-restart', idempotencyKey: 'key-restart' });
    const created = await start(first, submission, await approve(first, submission.preview));
    const running = await pollJob(first, created.id, job => job.state === 'running');
    await first.stop();
    const second = await trip.start('second');
    await waitForRecovery(trip, created.id);
    const recoveredResponse = await second.request('GET', `/api/jobs/${encodeURIComponent(created.id)}`);
    assert.equal(recoveredResponse.status, 200);
    const recovered = recoveredResponse.body as unknown as JobSnapshot;
    assert.equal(recovered.attempts[0].handoffMarked, true);
    assert.ok(['sending', 'running', 'outcome_unknown'].includes(recovered.state));
    const calls = await trip.calls();
    assert.equal(calls.filter(call => call.kind === 'start' && call.jobId === created.id).length, 1);
    assert.ok(calls.some(call => call.lifetime === 'second' && call.kind === 'create'));
    assert.ok(calls.some(call => call.lifetime === 'second' && call.kind === 'inspect'));
    const attemptId = running.latestAttemptId; assert.equal(typeof attemptId, 'string');
    await second.stop();
    trip.store(store => {
      const count = store.db.prepare('SELECT count(*) AS count FROM egress_events WHERE attemptId=?').get(attemptId) as { count: number };
      assert.equal(count.count, 1);
    });
  } finally { await trip.dispose(); }
});
