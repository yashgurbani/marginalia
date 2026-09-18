import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../daemon/server.ts';
import type { CandidateReply } from '../contracts/reply.ts';

const ORIGIN = 'chrome-extension://' + 'a'.repeat(32);
const OTHER_ORIGIN = 'chrome-extension://' + 'b'.repeat(32);
const STATE_KEY = 'e'.repeat(64);

function reply(title: string): CandidateReply {
  return { schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title, summary: title,
    sourceBindings: [], parameters: [], assumptions: [], limitations: [], blocks: [{ id: 'text', type: 'text', md: title }],
    checks: [], staticFallback: title };
}

async function fixture() {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
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
      reason: 'Saved-solver execution has no mounted command transport or durable execution gate.',
      modelTurns: 0, durableAtMostOnce: false });
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
    assert.match(payload.outcome.reason, /no mounted command transport or durable execution gate/i);
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
