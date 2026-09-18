import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ConsentGrant, ConsentPreview } from '../contracts/consent.ts';
import type { JobSnapshot, PreparedJobPlan } from '../contracts/jobs.ts';
import type { CandidateReply, Intent } from '../contracts/reply.ts';
import type { ReplyVersion, ReplyViewState, SourceVersion } from '../contracts/reader.ts';
import { journey, keepMutation, pollJob, type Daemon } from './journey-harness.ts';

type ReplyBundle = { replies: ReplyVersion[]; source: SourceVersion; views: ReplyViewState[] };

export type AcceptedReply = {
  trip: Awaited<ReturnType<typeof journey>>;
  daemon: Daemon;
  threadId: string;
  job: JobSnapshot;
  saved: ReplyVersion;
  source: SourceVersion;
  view: ReplyViewState;
};

export async function acceptP13Reply(t: TestContext, input: {
  name: string;
  intent: Extract<Intent, 'instantiate' | 'derive'>;
  question: string;
  sourceText: string;
  reply: CandidateReply;
}): Promise<AcceptedReply> {
  const trip = await journey(`p13-${input.name}`);
  t.after(() => trip.dispose());
  const daemon = await trip.start('initial');
  const threadId = `p13-${input.name}-thread`, jobId = `p13-${input.name}-job`;
  const mutation = keepMutation(threadId, `p13-${input.name}-keep`, input.sourceText);
  mutation.anchor = { exact: input.sourceText, prefix: '', suffix: '', start: 0, end: input.sourceText.length };
  const changed = await daemon.request('POST', '/api/change', mutation);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  const authoredSnapshot = JSON.stringify(input.reply);
  await trip.script({ [jobId]: { behaviour: 'reply', reply: input.reply } });
  const prepared = await daemon.request('POST', '/api/jobs/prepare', {
    id: jobId, idempotencyKey: `p13-${input.name}-key`, threadId, intent: input.intent, question: input.question,
  });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  const submission = prepared.body as unknown as { preview: ConsentPreview; job: PreparedJobPlan };
  const packetPart = submission.preview.outgoing.find(part => part.label === 'Bounded reading packet');
  assert.ok(packetPart);
  const packet = JSON.parse(packetPart.text) as { intent: string; question: string; selection: { exact: string } };
  assert.deepEqual({ intent: packet.intent, question: packet.question, exact: packet.selection.exact }, {
    intent: input.intent, question: input.question, exact: input.sourceText,
  });
  assert.deepEqual(await trip.calls(), [], 'preparation and exact review do not dispatch');

  const decision = await daemon.request('POST', '/api/consent/decision', {
    previewId: submission.preview.id, expectedRevision: submission.preview.revision, choice: 'this-time',
  });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));
  assert.deepEqual(await trip.calls(), [], 'approval alone does not dispatch');
  const grant = decision.body.grant as ConsentGrant;
  const started = await daemon.request('POST', '/api/jobs', { ...submission.job, grantId: grant.id });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const job = await pollJob(daemon, jobId, value => value.state === 'succeeded' || value.state === 'failed');
  assert.equal(job.state, 'succeeded', JSON.stringify(job));
  assert.equal(typeof job.replyVersionId, 'string');

  const response = await daemon.request('GET', `/api/replies?threadId=${encodeURIComponent(threadId)}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const bundle = response.body as unknown as ReplyBundle;
  assert.equal(bundle.replies.length, 1);
  assert.equal(bundle.views.length, 1);
  assert.equal(bundle.replies[0].id, job.replyVersionId);
  assert.equal(bundle.source.text, input.sourceText, 'the immutable source capture is unchanged');
  assert.equal(JSON.stringify(input.reply), authoredSnapshot, 'admission does not rewrite the authored fixture');
  assert.equal((await trip.calls()).filter(call => call.kind === 'start').length, 1);
  return { trip, daemon, threadId, job, saved: bundle.replies[0], source: bundle.source, view: bundle.views[0] };
}

export async function reopenP13Reply(accepted: AcceptedReply): Promise<AcceptedReply> {
  await accepted.daemon.stop();
  const daemon = await accepted.trip.start('reopen');
  const response = await daemon.request('GET', `/api/replies?threadId=${encodeURIComponent(accepted.threadId)}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const bundle = response.body as unknown as ReplyBundle;
  assert.equal(bundle.replies.length, 1);
  assert.equal(bundle.views.length, 1);
  assert.equal((await accepted.trip.calls()).filter(call => call.kind === 'start').length, 1, 'reopen starts no second model request');
  return { ...accepted, daemon, saved: bundle.replies[0], source: bundle.source, view: bundle.views[0] };
}

export async function saveP13View(accepted: AcceptedReply, id: string, state: { parameters: Record<string, number>; view: ReplyViewState['view'] }): Promise<void> {
  const response = await accepted.daemon.request('POST', '/api/reply-view', {
    id, threadId: accepted.threadId, replyVersionId: accepted.saved.id, expectedRevision: accepted.view.revision,
    parameters: state.parameters, view: state.view,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  accepted.view = response.body.view as ReplyViewState;
}
