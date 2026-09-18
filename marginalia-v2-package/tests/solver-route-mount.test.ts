import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../daemon/server.ts';
import type { CandidateReply } from '../contracts/reply.ts';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packetDigest } from '../daemon/jobs/store.ts';
import { commitSucceededReplyWithSolverBindings } from '../daemon/jobs/solver-bindings.ts';
import type { FrozenJobContext, JobConsentAuthority, StartJobInput } from '../contracts/jobs.ts';
import type { ProviderHandle } from '../contracts/job-runner.ts';
import { PROBE_SENTINEL_PREFIX, type SolverCommandTransport } from '../daemon/solver/index.ts';

const ORIGIN = 'chrome-extension://' + 'a'.repeat(32);
const OTHER_ORIGIN = 'chrome-extension://' + 'b'.repeat(32);
const STATE_KEY = 'e'.repeat(64);

function reply(title: string): CandidateReply {
  return { schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title, summary: title,
    sourceBindings: [], parameters: [], assumptions: [], limitations: [], blocks: [{ id: 'text', type: 'text', md: title }],
    checks: [], staticFallback: title };
}

async function fixture(solver?: { transport: SolverCommandTransport; probeRoot: string }) {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }),
    ...(solver ? { solverTransport: solver.transport, solverProbeRoot: solver.probeRoot } : {}) });
  for (const suffix of ['one', 'two']) {
    helper.store.apply({ id: `keep-${suffix}`, kind: 'keep', threadId: `thread-${suffix}`,
      capture: { url: `https://${suffix}.example/article`, title: suffix, pageType: 'article', text: `Passage ${suffix}.`,
        capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' },
      anchor: { exact: `Passage ${suffix}.`, prefix: '', suffix: '', start: 0, end: 12 } });
    helper.store.commitReply({ id: `reply-${suffix}`, threadId: `thread-${suffix}`, reply: reply(suffix) });
  }
  const pair = (origin = ORIGIN) => helper.pairing.exchange(helper.pairing.issue(), origin);
  const token = pair();
  const headers = (value = token, origin = ORIGIN) => ({ Origin: origin, Authorization: `Bearer ${value}`, 'Content-Type': 'application/json' });
  const prepare = (replyVersionId: string, value = token) => fetch(helper.origin + '/api/solver/prepare', {
    method: 'POST', headers: headers(value), body: JSON.stringify({ schema: 'marginalia.solver-plan-request.v1',
      replyVersionId, blockId: 'text', solverId: 'solver-1', inputs: {}, stateKey: STATE_KEY }) });
  return { helper, pair, token, headers, prepare };
}

test('mounted solver routes require pairing and expose truthful status only to an origin-bound token', async () => {
  const { helper, token, headers } = await fixture();
  try {
    assert.equal((await fetch(helper.origin + '/api/solver/status', { headers: { Origin: ORIGIN } })).status, 401);
    assert.equal((await fetch(helper.origin + '/api/solver/status', { headers: headers(token, OTHER_ORIGIN) })).status, 401);
    assert.equal((await fetch(helper.origin + '/api/solver/status', { headers: { ...headers(), Origin: 'https://hostile.example' } })).status, 403);
    const response = await fetch(helper.origin + '/api/solver/status', { headers: headers() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: false,
      reason: 'No saved-solver command transport is available.',
      modelTurns: 0, durableAtMostOnce: true });
  } finally { await helper.close(); }
});

test('one paired session can prepare replies from two host-resolved threads', async () => {
  const { helper, prepare } = await fixture();
  try {
    const first = await prepare('reply-one');
    assert.equal(first.status, 200);
    assert.equal((await first.json() as { outcome: { status: string } }).outcome.status, 'unavailable');
    const second = await prepare('reply-two');
    assert.equal(second.status, 200);
    assert.equal((await second.json() as { outcome: { status: string } }).outcome.status, 'unavailable');
    assert.equal((await prepare('unknown-reply')).status, 404);
  } finally { await helper.close(); }
});

test('a second paired session cannot read a result held for the first session principal', async () => {
  const { helper, pair, token, headers, prepare } = await fixture();
  try {
    await prepare('reply-one', token);
    const firstSession = helper.pairing.session(token, ORIGIN)!;
    const second = pair();
    await prepare('reply-one', second);
    helper.solver.result = async (_requestId, principal) => principal.sessionId === firstSession.sessionId
      ? { status: 'cancelled', reason: 'first-session-only' } : undefined;
    const read = (value: string) => fetch(helper.origin + '/api/solver/result?requestId=request-1', { headers: headers(value) });
    const owned = await read(token), other = await read(second);
    assert.equal((await owned.json() as { outcome: { reason: string } }).outcome.reason, 'first-session-only');
    assert.deepEqual(await other.json(), { outcome: null, inFlight: false });
  } finally { await helper.close(); }
});

test('unmounted execution dependencies fail closed without egress or grant consumption', async () => {
  const { helper, headers, prepare } = await fixture();
  try {
    const beforeEgress = (helper.store.db.prepare('SELECT count(*) AS n FROM egress_events').get() as { n: number }).n;
    const beforeConsumed = (helper.store.db.prepare('SELECT count(*) AS n FROM consent_grant_state WHERE consumedAttemptId IS NOT NULL').get() as { n: number }).n;
    const response = await prepare('reply-one');
    const payload = await response.json() as { outcome: { status: string; code: string; reason: string } };
    assert.equal(payload.outcome.status, 'unavailable');
    assert.equal(payload.outcome.code, 'not-configured');
    assert.equal(payload.outcome.reason, 'No saved-solver command transport is available.');
    const recompute = await fetch(helper.origin + '/api/solver/recompute', { method: 'POST', headers: headers(),
      body: JSON.stringify({ schema: 'marginalia.solver-execute.v1', requestId: 'request-1', planId: 'plan-1',
        planToken: 'f'.repeat(64), replyVersionId: 'reply-one', blockId: 'text', solverId: 'solver-1', inputs: {},
        stateKey: STATE_KEY, requestedAt: '2026-09-18T00:00:00.000Z' }) });
    const recomputePayload = await recompute.json() as { outcome: { status: string; code: string } };
    assert.deepEqual(recomputePayload.outcome, { status: 'rejected', code: 'plan-unknown',
      reason: 'This recompute plan is not available. Prepare the recompute again.' });
    assert.equal((helper.store.db.prepare('SELECT count(*) AS n FROM egress_events').get() as { n: number }).n, beforeEgress);
    assert.equal((helper.store.db.prepare('SELECT count(*) AS n FROM consent_grant_state WHERE consumedAttemptId IS NOT NULL').get() as { n: number }).n, beforeConsumed);
  } finally { await helper.close(); }
});

test('the mounted collector surfaces a loopback confinement falsification and no transport keeps the placeholder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-solver-mount-'));
  const workspace = join(root, 'workspace'), probeRoot = join(root, 'probes');
  await mkdir(join(workspace, 'solver'), { recursive: true });
  await mkdir(probeRoot);
  const source = 'process.stdout.write(JSON.stringify({schema:"marginalia.solver-output.v1",values:{answer:2}}));\n';
  await writeFile(join(workspace, 'solver', 'main.js'), source, 'utf8');
  const stream = (text: string) => ({ text, bytes: Buffer.byteLength(text), capReached: false, hostBoundReached: false });
  const transport: SolverCommandTransport = {
    enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: 10_000 },
    async exec(request) {
      const probe = request.command.join(' ').includes('loopback-network') ? 'loopback-network' : 'filesystem-write';
      const outcome = probe === 'loopback-network' ? 'not-denied' : 'denied';
      return { status: 'exited', exitCode: 0, stdout: stream(`${PROBE_SENTINEL_PREFIX}${probe}=${outcome}\n`),
        stderr: stream(''), streamed: true };
    },
  };
  const mounted = await fixture({ transport, probeRoot });
  try {
    const localToken = mounted.pair(mounted.helper.origin);
    const localHeaders = mounted.headers(localToken, mounted.helper.origin);
    const thread = mounted.helper.store.get('thread-one')!;
    const sourceVersion = mounted.helper.store.sourceVersion(thread.sourceVersionId)!;
    const policyKey = 'a'.repeat(64), bindingDigest = 'b'.repeat(64);
    const preview = mounted.helper.consent.prepare({ requestId: 'job-solver', bindingDigest, sourceUrl: mounted.helper.origin,
      scope: 'cloud-inference', recipient: 'openai-codex', recipientLabel: 'OpenAI Codex', provider: 'app-server', policyKey,
      outgoing: [{ label: 'Reviewed packet', text: sourceVersion.text,
        sha256: createHash('sha256').update(sourceVersion.text).digest('hex') }] });
    const grant = mounted.helper.consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'always-site' },
      { surface: 'localhost-settings', pairingId: 'pair', origin: mounted.helper.origin });
    const input: StartJobInput = { id: 'job-solver', idempotencyKey: 'solver-key', threadId: thread.id, intent: 'simulate',
      question: 'Compute.', provider: 'app-server', model: 'test-model', mode: 'workspace-files', policyKey,
      grantId: grant.id, preparedPayloadDigest: bindingDigest, capabilities: ['solver'] };
    const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: sourceVersion.id, sourceUrl: thread.sourceUrl,
      sourceTitle: thread.sourceTitle, sourcePageType: sourceVersion.pageType, sourceCapturedAt: sourceVersion.capturedAt,
      sourceHash: sourceVersion.hash, sourceText: sourceVersion.text, passage: thread.anchor, question: input.question,
      intent: input.intent, preparedPayloadDigest: bindingDigest, modelSettingsRevision: 1, modelCompatibilityKey: 'test',
      outgoing: {} as FrozenJobContext['outgoing'] };
    const jobs = mounted.helper.jobs.store;
    jobs.create(input, context, packetDigest({ input, context }), packetDigest(input));
    const attempt = jobs.createAttempt(input.id);
    const handle: ProviderHandle = { jobId: attempt.id, workspace, policyKey, model: input.model, mode: input.mode,
      provider: input.provider, providerInstanceId: 'provider-1', state: 'completed', tombstone: false, revision: 1, output: '{}' };
    mounted.helper.store.db.prepare(`UPDATE job_attempts SET state='validating',revision=1,dispatchClaimed=1,handoffMarked=1,
      workspacePrepared=1,providerHandle=? WHERE id=?`).run(JSON.stringify(handle), attempt.id);
    mounted.helper.store.db.prepare("UPDATE jobs SET state='validating' WHERE id=?").run(input.id);
    const solverReply: CandidateReply = { schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete',
      title: 'Solver', summary: 'Solver', sourceBindings: [],
      parameters: [{ name: 'x', label: 'X', default: 1, min: 0, max: 2, unit: '' }], assumptions: [], limitations: [],
      requiredCapabilities: ['solver'], blocks: [
        { id: 'answer', type: 'derived', name: 'answer', expression: 'x + 1', label: 'Answer', unit: '' },
        { id: 'solver-1', type: 'solver', path: 'solver/main.js', inputNames: ['x'], outputBlocks: ['answer'] },
      ], checks: [], staticFallback: 'Unavailable.' };
    const resultAuthority = { withResultAcceptance: <T>(_job: unknown, _attemptId: string, commit: () => T) => commit() } as unknown as JobConsentAuthority;
    await commitSucceededReplyWithSolverBindings({ store: jobs, authority: resultAuthority, job: jobs.get(input.id)!,
      attemptId: attempt.id, expectedRevision: 1, reply: solverReply, workspace });

    const plannedResponse = await fetch(mounted.helper.origin + '/api/solver/prepare', { method: 'POST', headers: localHeaders,
      body: JSON.stringify({ schema: 'marginalia.solver-plan-request.v1', replyVersionId: 'job-solver-reply',
        blockId: 'answer', solverId: 'solver-1', inputs: { x: 1 }, stateKey: STATE_KEY }) });
    const planned = await plannedResponse.json() as { outcome: { status: string; plan: Record<string, unknown> } };
    assert.equal(planned.outcome.status, 'planned', JSON.stringify(planned));
    const recompute = await fetch(mounted.helper.origin + '/api/solver/recompute', { method: 'POST', headers: localHeaders,
      body: JSON.stringify({ ...planned.outcome.plan, schema: 'marginalia.solver-execute.v1', requestId: 'request-1',
        inputs: { x: 1 }, stateKey: STATE_KEY, requestedAt: '2026-09-18T00:00:00.000Z' }) });
    const payload = await recompute.json() as { outcome: { status: string; code: string; issues?: string[] } };
    assert.equal(payload.outcome.status, 'unavailable', JSON.stringify(payload));
    assert.equal(payload.outcome.code, 'isolation-evidence-unavailable');
    assert.ok(payload.outcome.issues?.includes('confinement-falsified:loopback-network'));

    const unmounted = await fixture();
    try {
      const status = await fetch(unmounted.helper.origin + '/api/solver/status', { headers: unmounted.headers() });
      assert.equal((await status.json() as { reason: string }).reason, 'No saved-solver command transport is available.');
    } finally { await unmounted.helper.close(); }
  } finally {
    await mounted.helper.close();
    await rm(root, { recursive: true, force: true });
  }
});
