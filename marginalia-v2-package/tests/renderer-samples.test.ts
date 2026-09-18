import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SamplesBlock } from '../contracts/reply.ts';
import { interpolateSamples } from '../kernel/samples.ts';

function grid(overrides: Partial<SamplesBlock> = {}): SamplesBlock {
  return {
    id: 'samples', type: 'samples', model: 'model',
    envelope: {
      axes: [{ name: 'x', min: 0, max: 2, count: 3 }, { name: 'y', min: 0, max: 1, count: 2 }],
      interpolation: 'linear', errorEvidence: 'Maximum held-out error was 0 for this affine fixture.', forbiddenRegions: [],
    },
    samples: [
      { at: { x: 0, y: 0 }, values: { z: 0 } }, { at: { x: 1, y: 0 }, values: { z: 1 } }, { at: { x: 2, y: 0 }, values: { z: 2 } },
      { at: { x: 0, y: 1 }, values: { z: 2 } }, { at: { x: 1, y: 1 }, values: { z: 3 } }, { at: { x: 2, y: 1 }, values: { z: 4 } },
    ],
    ...overrides,
  };
}

test('samples perform multilinear and nearest interpolation only inside a full regular grid', () => {
  const linear = interpolateSamples(grid(), { x: 0.5, y: 0.25, unrelated: 99 });
  assert.deepEqual(linear, { ok: true, values: { z: 1 }, interpolation: 'linear', errorEvidence: 'Maximum held-out error was 0 for this affine fixture.' });

  const nearestBlock = grid();
  nearestBlock.envelope.interpolation = 'nearest';
  assert.deepEqual(interpolateSamples(nearestBlock, { x: 1.6, y: 0.8 }), {
    ok: true, values: { z: 4 }, interpolation: 'nearest', errorEvidence: nearestBlock.envelope.errorEvidence,
  });

  const outside = interpolateSamples(grid(), { x: 2.01, y: 0.5 });
  assert.equal(outside.ok, false);
  if (!outside.ok) assert.match(outside.reason, /outside.*recomputation/i);

  const incomplete = grid();
  incomplete.samples = incomplete.samples.slice(0, -1);
  const missing = interpolateSamples(incomplete, { x: 0.5, y: 0.5 });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.reason, /incomplete/i);
});

test('samples require error evidence and fail closed around forbidden regions', () => {
  const noEvidence = grid();
  noEvidence.envelope.errorEvidence = '   ';
  const absent = interpolateSamples(noEvidence, { x: 1, y: 0 });
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.match(absent.reason, /error evidence/i);

  const guarded = grid();
  guarded.envelope.forbiddenRegions = [{ expression: 'x > 0.9 && x < 1.1', reason: 'singular strip' }];
  const forbidden = interpolateSamples(guarded, { x: 1, y: 0 });
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.match(forbidden.reason, /singular strip/);

  const crossing = interpolateSamples(guarded, { x: 0.25, y: 0.25 });
  assert.equal(crossing.ok, false);
  if (!crossing.ok) assert.match(crossing.reason, /cannot be proven safe/i);

  const exact = interpolateSamples(guarded, { x: 0, y: 0 });
  assert.deepEqual(exact, { ok: true, values: { z: 0 }, interpolation: 'linear', errorEvidence: guarded.envelope.errorEvidence });
});

// Opt in with T18_CHROMIUM=/path/to/chromium. Absence is a reported skip,
// never evidence that browser focus/readiness was verified.
test('bounded T18 browser regressions', { skip: !process.env.T18_CHROMIUM, timeout: 90_000 }, async t => {
  const { runBrowserRegressions } = await import('../renderer/testing/browser.ts');
  const { runHostChecks } = await import('../contracts/host-checks.ts');
  const reply = classificationFixture();
  const reports = [0.07, 0.2].map(f => runHostChecks(reply, { gamma: 0.5, f, y0: 0 }));
  const results = await runBrowserRegressions(process.env.T18_CHROMIUM!, { reply, reports });
  assert.equal(results.length, 9, 'Every browser regression must report a result.');
  for (const result of results) await t.test(result.name, () => assert.equal(result.error, undefined, result.error));
});

import { plotCoordinate, plotTick } from '../renderer/plot-coordinates.ts';
import { sampleReadinessMessage } from '../renderer/sample-copy.ts';
import { deriveSamplesBinding, validateSamplesInterpolationReadiness, type SampleGenerationRecord } from '../contracts/sample-provenance.ts';
import type { CandidateReply } from '../contracts/reply.ts';

test('finite extreme plot endpoints keep endpoint and midpoint geometry without overflowing ticks', () => {
  const bounds = [-1e308, 1e308] as const;
  assert.equal(plotCoordinate(bounds[0], bounds, 62, 478), 62);
  assert.equal(plotCoordinate(0, bounds, 62, 478), 301);
  assert.equal(plotCoordinate(bounds[1], bounds, 62, 478), 540);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => plotTick(bounds, i)), [-1e308, -5e307, 0, 5e307, 1e308]);
  assert.equal(plotCoordinate(1, [1, 2], 230, -205), 230);
  assert.equal(plotCoordinate(2, [1, 2], 230, -205), 25);
});

test('unrepresentable plot coordinates are declined, not clipped or replaced with invented data', () => {
  assert.equal(plotCoordinate(1e308, [0, Number.MIN_VALUE], 62, 478), undefined);
  assert.equal(plotCoordinate(Number.MAX_VALUE, [Number.MAX_VALUE, Infinity], 62, 478), undefined);
  assert.equal(plotCoordinate(1, [1, 1], 62, 478), undefined);
  assert.equal(plotCoordinate(NaN, [0, 1], 62, 478), undefined);
  assert.equal(plotCoordinate(Number.MIN_VALUE, [0, Number.MIN_VALUE], 62, 478), 540);
});

test('real readiness failures map to plain historical, mismatch and invalid notices without echoing diagnostics', async () => {
  const block = grid(); block.envelope.fixedInputs = {};
  const reply: CandidateReply = {
    schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Affine grid', summary: 'Saved affine values.', sourceBindings: [],
    parameters: [{ name: 'x', label: 'x', min: 0, max: 2, default: 1, unit: '' }, { name: 'y', label: 'y', min: 0, max: 1, default: 0.5, unit: '' }],
    assumptions: [], limitations: [], requiredCapabilities: ['samples'], checks: [], staticFallback: 'Original grid.',
    blocks: [{ id: 'model', type: 'model', kind: 'map', state: ['z'], next: { z: 'z' }, initial: { z: '0' }, iterations: 1 }, block],
  };
  const valid: SampleGenerationRecord = { schema: 'marginalia.samples-generation.v1', origin: 'imported', blockId: block.id, ...await deriveSamplesBinding(reply, block) };
  const examples = [
    { record: undefined, state: 'historical' },
    { record: { ...valid, blockId: 'wrong' }, state: 'mismatch' },
    { record: { ...valid, schema: 'future-schema-with-provenance-digest' } as unknown as SampleGenerationRecord, state: 'invalid' },
  ];
  const messages = new Set<string>();
  for (const { record, state } of examples) {
    const result = await validateSamplesInterpolationReadiness(reply, block, { x: 1, y: 0.5 }, record);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('Bad evidence unexpectedly admitted.');
    assert.equal(result.state, state);
    const message = sampleReadinessMessage(result.state); messages.add(message);
    assert.doesNotMatch(message, /\b(schema|provenance|digest|binding|MCP|sandbox|ledger)\b/i);
    assert.match(message, /original grid is still available/i);
    assert.match(message, /recompute/i);
  }
  assert.equal(messages.size, 3, 'Distinct failure classes should not lose their meaning.');
});

function classificationFixture(): CandidateReply {
  return {
    schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete',
    title: 'This model settles at zero.', summary: 'The current result is settling, not divergence.',
    illustration: { value: true, statement: 'Synthetic scalar illustration for renderer authority tests.' },
    resultClaims: [{ target: 'title', classification: 'classification' }, { target: 'summary', classification: 'classification' }],
    sourceBindings: [], assumptions: [{ id: 'forcing', text: 'Forcing range', editable: true, binding: { parameter: 'f', min: 0, max: 1 } }], limitations: [], staticFallback: 'Original description.',
    parameters: [
      { name: 'gamma', label: 'Damping', default: 0.5, min: 0, max: 2, unit: '1/s' },
      { name: 'f', label: 'Forcing', default: 0.07, min: 0, max: 1, unit: '1/s^2' },
      { name: 'y0', label: 'Start', default: 0, min: -2, max: 2, unit: '1/s' },
    ],
    blocks: [
      { id: 'model', type: 'model', kind: 'ode', state: ['y'], rhs: { y: 'y^2-gamma*y+f' }, initial: { y: 'y0' }, horizon: 8, method: 'rk45', maxSteps: 2000 },
      { id: 'classification', type: 'classification', model: 'model', headline: true, rule: 'growth-v1', check: 'growth', labels: {} },
    ],
    checks: [{ id: 'growth', criterion: 'growth-v1', model: 'model', classification: 'classification', inputs: { gamma: 'gamma', f: 'f', y0: 'y0' } }],
  };
}


test('classification authority still rejects missing, stale and altered reports', async () => {
  const { runHostChecks } = await import('../contracts/host-checks.ts');
  const { classificationsFromHost } = await import('../renderer/host-authority.ts');
  const { calculateReply } = await import('../renderer/state.ts');
  const reply = classificationFixture(), parameters = { gamma: 0.5, f: 0.07, y0: 0 };
  const checks = calculateReply(reply, parameters).checks, report = runHostChecks(reply, parameters);
  assert.equal((await classificationsFromHost(reply, parameters, checks))[0].state, 'withheld');
  assert.equal((await classificationsFromHost(reply, parameters, checks, report))[0].label, report.results[0].headline);
  const changed = { ...parameters, f: 0.2 };
  assert.equal((await classificationsFromHost(reply, changed, calculateReply(reply, changed).checks, report))[0].state, 'withheld');
  const altered = structuredClone(report); altered.results[0].headline = reply.title;
  assert.equal((await classificationsFromHost(reply, parameters, checks, altered))[0].state, 'withheld');
  const editedReply = { ...reply, title: 'Another unchecked result' };
  assert.equal((await classificationsFromHost(editedReply, parameters, checks, report))[0].state, 'withheld');
});
