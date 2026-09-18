import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConsentPreview, ConsentGrant } from '../contracts/consent.ts';
import type { PreparedJobPlan, JobSnapshot } from '../contracts/jobs.ts';
import { capabilitiesForIntent, type CandidateReply, type SolverBlock } from '../contracts/reply.ts';
import type { AskingSelection } from '../ui/asking-host.ts';
import { growthReply, growthSourceText } from '../fixtures/growth-reply.ts';
import { journey, keepMutation, pollJob } from './journey-harness.ts';
import { storage, asHost } from './t05-harness.ts';
import { dom, button, until, replaceGlobals } from './t05-dom.ts';
import { createSolverRecompute } from '../ui/solver-recompute.ts';
import { withFixtureOrigins } from './origins-fixture.ts';
const { mountMargin } = await import('../ui/margin.ts');
const { mountReply } = await import('../renderer/index.ts');

function gridReply(): CandidateReply {
  const reply = structuredClone(growthReply);
  reply.requiredCapabilities = ['samples'];
  reply.blocks.push({ id: 'grid', type: 'samples', model: 'growth-model',
    envelope: { axes: [{ name: 'gamma', min: 0, max: 1, count: 2 }], fixedInputs: { f: 0.07, y0: 0 },
      interpolation: 'linear', errorEvidence: 'Fixture endpoints only.', forbiddenRegions: [] },
    samples: [{ at: { gamma: 0 }, values: { y: 0 } }, { at: { gamma: 1 }, values: { y: 1 } }] });
  return reply;
}
const solver: SolverBlock = { id: 'saved-solver', type: 'solver', path: 'solver/main.js', inputNames: ['gamma', 'f', 'y0'], outputBlocks: ['grid'] };

test('Stage 0 selection, Move it, reviewed explicit send, saved grid, local slider and explicit solver preparation', async t => {
  const localFetch = globalThis.fetch;
  const e = { ...dom(t), ...storage(t) }, namespace = crypto.randomUUID();
  replaceGlobals(t, { fetch: localFetch });
  Object.assign(e.document, { createElementNS(_namespace: string, tag: string) { return e.document.createElement(tag); } });
  const trip = await journey('stage0', ['samples', 'solver']);
  const mutation = keepMutation('stage0-thread', 'stage0-keep', growthSourceText);
  mutation.anchor = { start: 0, end: growthSourceText.length, exact: growthSourceText, prefix: '', suffix: '' };
  const api = await mountMargin(asHost(e.root), { capture: mutation.capture, storageName: namespace, allowHelper: false });
  let mounted: ReturnType<typeof mountReply> | undefined;
  try {
    const daemon = await trip.start('stage0');
    api.select(mutation.anchor); button(e.root, 'Ask').click(); button(e.root, 'Move it').click(); await api.drain();
    const draft = [...e.data(namespace)].find(([key]) => key.startsWith('question:draft:'))![1] as AskingSelection;
    assert.equal(draft.intent, 'simulate'); assert.deepEqual(draft.anchor, mutation.anchor);
    assert.equal((await trip.calls()).length, 0);
    assert.equal((await daemon.request('POST', '/api/change', mutation)).status, 200);
    const reply = gridReply(); reply.blocks.push(solver); reply.requiredCapabilities!.push('solver');
    withFixtureOrigins(reply);
    await trip.script({ 'stage0-job': { behaviour: 'reply', reply, savedSolver: true } });
    const prepared = await daemon.request('POST', '/api/jobs/prepare', { id: 'stage0-job', idempotencyKey: 'stage0-key',
      threadId: mutation.threadId, intent: draft.intent, question: draft.question });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const submission = prepared.body as unknown as { preview: ConsentPreview; job: PreparedJobPlan };
    const packet = JSON.parse(submission.preview.outgoing.find(part => part.label === 'Bounded reading packet')!.text);
    assert.equal(packet.question, draft.question); assert.equal(packet.selection.exact, growthSourceText);
    assert.deepEqual(packet.availableCapabilities, capabilitiesForIntent('simulate'));
    assert.equal((await trip.calls()).length, 0, 'review does not send');
    const decision = await daemon.request('POST', '/api/consent/decision', { previewId: submission.preview.id,
      expectedRevision: submission.preview.revision, choice: 'this-time' });
    assert.equal(decision.status, 200); assert.equal((await trip.calls()).length, 0);
    const grant = decision.body.grant as ConsentGrant;
    const sent = await daemon.request('POST', '/api/jobs', { ...submission.job, grantId: grant.id });
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const job = await pollJob(daemon, (sent.body as unknown as JobSnapshot).id, job => ['succeeded', 'failed'].includes(job.state));
    assert.equal(job.state, 'succeeded', JSON.stringify(job));
    const bundle = await daemon.request('GET', `/api/replies?threadId=${mutation.threadId}`);
    const saved = (bundle.body.replies as { reply: CandidateReply }[])[0].reply;
    assert.equal((await trip.calls()).filter(call => call.kind === 'start').length, 1);
    const canvas = e.document.createElement('div'); e.document.body.append(canvas);
    const recomputes: unknown[] = [];
    assert.deepEqual(saved.blocks.find(block => block.type === 'solver'), solver);
    const recompute = createSolverRecompute({ replyVersionId: 'stage0-saved-reply', transport: {
      async prepare(request) { recomputes.push(request); return { status: 'unavailable', code: 'not-configured', reason: 'Fixture has no execution runtime.' }; },
      async execute() { throw new Error('Unavailable solver cannot execute'); }, async result() { return null; },
    } });
    mounted = mountReply(asHost(canvas), saved, { sourceText: growthSourceText, capabilities: capabilitiesForIntent('simulate'),
      onRecompute: async request => { await recompute.run(request); } });
    const grid = canvas.querySelector('[data-block="grid"]')!; assert.ok(grid);
    const details = grid.querySelector('details')!; details.open = true; details.fire('toggle');
    assert.ok(details.querySelector('table'), 'recorded grid renders');
    const slider = canvas.querySelectorAll('input').find(input => input.type === 'range')!;
    slider.value = '1.5'; Object.assign(slider, { valueAsNumber: 1.5 }); slider.fire('input');
    assert.equal(mounted.getState().parameters.gamma, 1.5);
    await until(() => grid.textContent.includes('Recompute with these inputs'));
    assert.deepEqual(recomputes, []); assert.equal((await trip.calls()).filter(call => call.kind === 'start').length, 1);
    assert.equal(button(grid, 'Recompute with these inputs').disabled, false);
    button(grid, 'Recompute with these inputs').click();
    await until(() => recomputes.length === 1);
    assert.equal(recomputes.length, 1);
    assert.equal((recomputes[0] as { inputs: { gamma: number } }).inputs.gamma, 1.5);
    assert.equal((await trip.calls()).filter(call => call.kind === 'start').length, 1, 'recompute starts no model turn');
  } finally { mounted?.destroy(); api.destroy(); await api.drain(); await trip.dispose(); }
});

test('an already saved solver sends one recompute preparation only on the explicit renderer click', async t => {
  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_namespace: string, tag: string) { return document.createElement(tag); } });
  const reply = gridReply(); reply.blocks.push(solver); reply.requiredCapabilities!.push('solver');
  withFixtureOrigins(reply);
  const calls: unknown[] = [];
  const recompute = createSolverRecompute({ replyVersionId: 'saved-reply', transport: {
    async prepare(request) { calls.push(request); return { status: 'unavailable', code: 'not-configured', reason: 'Fixture has no execution runtime.' }; },
    async execute() { throw new Error('Unavailable solver cannot execute'); }, async result() { return null; },
  } });
  const mounted = mountReply(asHost(root), reply, { sourceText: growthSourceText, capabilities: ['samples', 'solver'],
    onRecompute: async request => { await recompute.run(request); } });
  try {
    const slider = root.querySelectorAll('input').find(input => input.type === 'range')!;
    slider.value = '1.5'; Object.assign(slider, { valueAsNumber: 1.5 }); slider.fire('input');
    assert.deepEqual(calls, []);
    button(root.querySelector('[data-block="saved-solver"]')!, 'Recompute with these inputs').click();
    await until(() => calls.length === 1); assert.equal(calls.length, 1);
    assert.equal((calls[0] as { inputs: { gamma: number } }).inputs.gamma, 1.5);
  } finally { mounted.destroy(); }
});

