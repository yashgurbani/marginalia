import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isSolverStateKey, solverStateKeyFrom as solverStateKeyFromContract,
  SOLVER_STATE_KEY_INPUT_MAX_BYTES, validateSolverExecuteRequest, validateSolverPlanRequest,
  type SolverExecuteRequest, type SolverOutcome, type SolverPlan,
  type SolverPlanOutcome, type SolverPlanRequest, type SolverRejectionCode, type SolverResult,
} from '../contracts/solver.ts';
import type { RecomputeRequest } from '../renderer/index.ts';
import {
  createSolverRecompute, RECOMPUTE_PATHS, renderRecomputeOutcome, solverStateKeyFrom,
  type SolverRecomputeTransport,
} from '../ui/solver-recompute.ts';
import { deferred, dom, until } from './t05-dom.ts';

const plan = (changes: Partial<SolverPlan> = {}): SolverPlan => ({
  schema: 'marginalia.solver-plan.v1', planId: 'plan-1', planToken: 'f'.repeat(64),
  limits: { timeoutMs: 1_000, maxOutputBytes: 1_024 }, expiresAt: '2026-09-18T01:00:00.000Z',
  modelTurns: 0, replyVersionId: 'reply-1', blockId: 'block-1', solverId: 'solver-1', ...changes,
});

const request = (changes: Partial<RecomputeRequest> = {}): RecomputeRequest => ({
  parameters: { a: 1 }, view: {}, blockId: 'block-1', solverId: 'solver-1', reason: 'changed',
  requestId: 'renderer-1', stateKey: '{"canonical":1}', ...changes,
});

const result = (stateKey: string): SolverResult => ({ requestId: 'renderer-1', stateKey,
  replyVersionId: 'reply-1', outputs: {}, record: {} }) as SolverResult;

function fakeTransport() {
  const calls = { prepare: [] as SolverPlanRequest[], execute: [] as SolverExecuteRequest[], result: [] as string[] };
  type Prepare = (payload: SolverPlanRequest, signal?: AbortSignal) => Promise<SolverPlanOutcome>;
  type Execute = (payload: SolverExecuteRequest, signal?: AbortSignal) => Promise<SolverOutcome>;
  type Result = (requestId: string, signal?: AbortSignal) => Promise<SolverOutcome | null>;
  let prepareImpl: Prepare = async () => ({ status: 'planned', plan: plan() });
  let executeImpl: Execute = async () => ({ status: 'outcome_unknown', reason: 'unknown' });
  let resultImpl: Result = async () => null;
  const transport: SolverRecomputeTransport = {
    async prepare(payload, signal) { calls.prepare.push(payload); return prepareImpl(payload, signal); },
    async execute(payload, signal) { calls.execute.push(payload); return executeImpl(payload, signal); },
    async result(id, signal) { calls.result.push(id); return resultImpl(id, signal); },
  };
  return { calls, transport,
    prepareWith(value: Prepare) { prepareImpl = value; },
    executeWith(value: Execute) { executeImpl = value; },
    resultWith(value: Result) { resultImpl = value; } };
}

const adapter = (transport: SolverRecomputeTransport) => createSolverRecompute({ transport,
  replyVersionId: 'reply-1', now: () => '2026-09-18T00:00:00.000Z' });

test('the browser state key equals the contract digest of the same canonical string', async () => {
  for (const canonical of ['plain ASCII', 'non-BMP: 🧭𝄞', 'a'.repeat(200 * 1024)]) {
    const actual = await solverStateKeyFrom(canonical);
    assert.equal(actual, solverStateKeyFromContract(canonical));
    assert.equal(isSolverStateKey(actual), true);
  }
});

test('an empty or oversized canonical string is refused before any helper call', async () => {
  const fake = fakeTransport(), recompute = adapter(fake.transport);
  await assert.rejects(solverStateKeyFrom(''), TypeError);
  await assert.rejects(solverStateKeyFrom('a'.repeat(SOLVER_STATE_KEY_INPUT_MAX_BYTES + 1)), RangeError);
  await assert.rejects(recompute.run(request({ stateKey: '' })), TypeError);
  await assert.rejects(recompute.run(request({ stateKey: 'a'.repeat(SOLVER_STATE_KEY_INPUT_MAX_BYTES + 1) })), RangeError);
  assert.deepEqual(Object.values(fake.calls).map(value => value.length), [0, 0, 0]);
});

test('nothing is sent until the reader runs a recompute', (t) => {
  const fake = fakeTransport(), recompute = adapter(fake.transport);
  const view = recompute.idle();
  const { document } = dom(t);
  renderRecomputeOutcome(document as unknown as Document, view);
  assert.deepEqual(Object.values(fake.calls).map(value => value.length), [0, 0, 0]);
  assert.equal(view.state, 'idle');
  assert.match(view.detail, /reopening/); assert.match(view.detail, /reconnecting/);
});

test('a second click on the same inputs reuses the first request id', async () => {
  const fake = fakeTransport(), recompute = adapter(fake.transport);
  await recompute.run(request({ requestId: 'first-renderer-id' }));
  await recompute.run(request({ requestId: 'second-renderer-id' }));
  assert.equal(fake.calls.execute.length, 2);
  assert.equal(fake.calls.execute[0].requestId, 'first-renderer-id');
  assert.equal(fake.calls.execute[1].requestId, fake.calls.execute[0].requestId);
});

test('a changed input tuple gets its own request id', async () => {
  const fake = fakeTransport(), recompute = adapter(fake.transport);
  await recompute.run(request({ requestId: 'request-a', stateKey: '{"a":1}' }));
  await recompute.run(request({ requestId: 'request-b', stateKey: '{"a":2}', parameters: { a: 2 } }));
  assert.notEqual(fake.calls.execute[0].stateKey, fake.calls.execute[1].stateKey);
  assert.notEqual(fake.calls.execute[0].requestId, fake.calls.execute[1].requestId);
});

test('a retry after an unconfirmed outcome reads the earlier result instead of running again', async () => {
  const fake = fakeTransport(), recompute = adapter(fake.transport);
  await recompute.run(request());
  const stateKey = fake.calls.execute[0].stateKey;
  fake.resultWith(async () => ({ status: 'succeeded', origin: 'execution', result: result(stateKey) }));
  const view = await recompute.run(request({ requestId: 'new-renderer-id' }));
  assert.equal(view.state, 'succeeded'); assert.equal(fake.calls.execute.length, 1); assert.equal(fake.calls.result.length, 1);
});

test('two concurrent clicks are one run', async () => {
  const fake = fakeTransport(), pending = deferred<SolverOutcome>();
  fake.executeWith(() => pending.promise);
  const recompute = adapter(fake.transport);
  const first = recompute.run(request()), second = recompute.run(request({ requestId: 'renderer-2' }));
  await until(() => fake.calls.execute.length === 1);
  pending.resolve({ status: 'outcome_unknown', reason: 'unknown' });
  const [left, right] = await Promise.all([first, second]);
  assert.strictEqual(left, right); assert.equal(fake.calls.prepare.length, 1); assert.equal(fake.calls.execute.length, 1);
});

test('a refused plan never executes', async () => {
  const fake = fakeTransport();
  fake.prepareWith(async () => ({ status: 'rejected', code: 'authorization-refused', reason: 'private' }));
  const view = await adapter(fake.transport).run(request());
  assert.equal(view.state, 'denied'); assert.equal(fake.calls.execute.length, 0);
});

test('a plan for a different block or solver never executes', async () => {
  for (const changed of [{ blockId: 'block-2' }, { solverId: 'solver-2' }, { modelTurns: 1 }] as const) {
    const fake = fakeTransport();
    fake.prepareWith(async () => ({ status: 'planned', plan: plan(changed as Partial<SolverPlan>) }));
    const view = await adapter(fake.transport).run(request());
    assert.equal(view.state, 'denied'); assert.equal(fake.calls.execute.length, 0);
  }
});

test('the complete declared parameter tuple is sent unfiltered', async () => {
  const fake = fakeTransport(), parameters = { a: 1, b: -0, c: 2.5 };
  await adapter(fake.transport).run(request({ parameters }));
  assert.deepEqual(fake.calls.prepare[0].inputs, parameters); assert.deepEqual(fake.calls.execute[0].inputs, parameters);
  assert.equal(validateSolverPlanRequest(fake.calls.prepare[0]).ok, true);
  assert.equal(validateSolverExecuteRequest(fake.calls.execute[0]).ok, true);
});

test('unconfirmed confinement is reported as unverified', async () => {
  const fake = fakeTransport();
  fake.prepareWith(async () => ({ status: 'unavailable', code: 'isolation-evidence-unavailable',
    reason: 'The isolated environment could not be confirmed, so no saved solver was run.', issues: ['policy-drift:cwd'] }));
  const view = await adapter(fake.transport).run(request()), copy = view.headline + view.detail;
  assert.equal(view.state, 'unconfirmed-confinement'); assert.match(copy, /Nothing ran/);
  assert.match(copy, /Asking for confinement is not proof/); assert.doesNotMatch(copy, /policy-drift|cwd/);
});

test('a refusal never echoes the helper reason text', async () => {
  const codes = ['invalid-request', 'unknown-reply', 'unknown-solver', 'reply-changed', 'artifact-unknown',
    'artifact-modified', 'manifest-required', 'path-unsafe', 'inputs-invalid', 'limits-invalid', 'unsupported-capability',
    'authorization-refused', 'authorization-expired', 'policy-mismatch', 'handoff-refused', 'output-invalid',
    'plan-unknown', 'plan-expired', 'request-identity-mismatch', 'generation-drift'] as const satisfies readonly SolverRejectionCode[];
  for (const code of codes) {
    const fake = fakeTransport();
    fake.prepareWith(async () => ({ status: 'rejected', code, reason: 'C:\\Users\\reader\\workspace\\attempt-9 leaked' }));
    const view = await adapter(fake.transport).run(request()), copy = view.headline + view.detail;
    assert.equal(view.state, 'denied'); assert.doesNotMatch(copy, /C:\\Users|attempt-9/);
  }
});

test('a missing legacy manifest renders the bounded positive refusal and keeps raw helper text private', async t => {
  const fake = fakeTransport(); let executions = 0;
  fake.prepareWith(async () => ({ status: 'rejected', code: 'manifest-required', reason: 'C:\\private\\raw-error' }));
  fake.executeWith(async () => { executions++; throw new Error('A manifestless solver must not execute.'); });
  const view = await adapter(fake.transport).run(request()), rendered = renderRecomputeOutcome(dom(t).document as unknown as Document, view);
  assert.equal(view.state, 'denied'); assert.equal(executions, 0);
  assert.match(rendered.textContent, /This saved solver needs a manifest before it can run\. Your saved reply remains available to read\./);
  assert.doesNotMatch(rendered.textContent, /private|raw-error/);
});

test('a result for a changed view is discarded rather than painted', async () => {
  const fake = fakeTransport();
  fake.executeWith(async () => ({ status: 'succeeded', origin: 'execution', result: result('0'.repeat(64)) }));
  const view = await adapter(fake.transport).run(request());
  assert.equal(view.state, 'unknown'); assert.equal(view.result, undefined); assert.match(view.headline, /inputs changed/);
});

test('a cached success is named as a cache, not as a fresh run', async () => {
  const run = async (origin: 'cache' | 'execution') => {
    const fake = fakeTransport();
    fake.executeWith(async payload => ({ status: 'succeeded', origin, result: result(payload.stateKey) }));
    return adapter(fake.transport).run(request());
  };
  const cached = await run('cache'), executed = await run('execution');
  assert.equal(cached.state, 'succeeded'); assert.ok(cached.result); assert.notEqual(cached.headline, executed.headline);
  assert.equal(cached.modelTurns, 0); assert.equal(executed.modelTurns, 0);
  assert.match(cached.detail, /No model turn was made/); assert.match(executed.detail, /No model turn was made/);
});

test('the rendered outcome names the saved-solver path and denies the other three', (t) => {
  const { document } = dom(t), view = adapter(fakeTransport().transport).idle();
  const rendered = renderRecomputeOutcome(document as unknown as Document, view);
  assert.equal(rendered.dataset.path, 'saved-solver'); assert.equal(rendered.dataset.state, view.state);
  for (const copy of Object.values(RECOMPUTE_PATHS)) assert.match(rendered.textContent ?? '', new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(rendered.textContent ?? '', /Path used:/); assert.match(rendered.textContent ?? '', /Not used:/);
});

test('the adapter imports nothing Node-only and nothing from the daemon', () => {
  const source = readFileSync(new URL('../ui/solver-recompute.ts', import.meta.url), 'utf8');
  assert.equal(source.split(/\r?\n/).some(line => /from ['"]node:/.test(line)), false);
  assert.equal(/daemon\//.test(source), false);
  for (const line of source.split(/\r?\n/).filter(line => line.includes("from '../contracts/"))) {
    if (line.includes("from '../contracts/digest.ts'")) assert.match(line, /^import \{ isDigest \}/);
    else assert.match(line, /^import type/);
  }
});

