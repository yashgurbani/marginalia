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
