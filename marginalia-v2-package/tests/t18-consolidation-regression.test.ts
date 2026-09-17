import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CandidateReply, SamplesBlock } from '../contracts/reply.ts';
import { computeIndependentChecks } from '../contracts/reply.ts';
import { runHostChecks } from '../contracts/host-checks.ts';
import {
  deriveSamplesBinding,
  validateSamplesInterpolationReadiness,
  type SampleGenerationRecord,
} from '../contracts/sample-provenance.ts';
import { classificationsFromHost } from '../renderer/host-authority.ts';
import { interpolateSamples } from '../kernel/samples.ts';
import { growthDefaultParameters, growthReply } from '../fixtures/growth-reply.ts';

type Interpolation = SamplesBlock['envelope']['interpolation'];

/** Explicit contract data; these values are not output from a simulation. */
function savedSampleReply(interpolation: Interpolation = 'linear'): { reply: CandidateReply; block: SamplesBlock } {
  const block: SamplesBlock = {
    id: 'saved-samples',
    type: 'samples',
    model: 'saved-model',
    envelope: {
      axes: [{ name: 'x', min: 0, max: 2, count: 3 }],
      fixedInputs: { bias: 7 },
      interpolation,
      errorEvidence: 'Contract fixture: values are recorded at every declared x coordinate.',
      forbiddenRegions: [],
    },
    samples: [
      { at: { x: 0 }, values: { signal: 10 } },
      { at: { x: 1 }, values: { signal: 20 } },
      { at: { x: 2 }, values: { signal: 40 } },
    ],
  };
  const reply: CandidateReply = {
    schema: 'marginalia.reply.v1',
    intent: 'simulate',
    status: 'complete',
    title: 'Saved sample contract fixture',
    summary: 'A bounded grid used to test saved-range behavior.',
    sourceBindings: [],
    parameters: [
      { name: 'x', label: 'Axis', default: 1, min: -1, max: 3, unit: '' },
      { name: 'bias', label: 'Fixed input', default: 7, min: 0, max: 10, unit: '' },
    ],
    assumptions: [],
    limitations: ['Synthetic contract data; not a scientific result.'],
    requiredCapabilities: ['samples'],
    blocks: [
      { id: 'saved-model', type: 'model', kind: 'map', state: ['z'], next: { z: 'z+1' }, initial: { z: '0' }, iterations: 1 },
      block,
    ],
    checks: [],
    staticFallback: 'The recorded grid remains available as historical data.',
  };
  return { reply, block };
}

async function sampleRecord(reply: CandidateReply, block: SamplesBlock): Promise<SampleGenerationRecord> {
  return {
    schema: 'marginalia.samples-generation.v1',
    origin: 'imported',
    blockId: block.id,
    ...await deriveSamplesBinding(reply, block),
  };
}

test('saved samples include both envelope endpoints and reject changed fixed inputs', async () => {
  const { reply, block } = savedSampleReply();
  const record = await sampleRecord(reply, block);

  for (const [x, expectedSignal] of [[0, 10], [2, 40]] as const) {
    const readiness = await validateSamplesInterpolationReadiness(reply, block, { x, bias: 7 }, record);
    if (!readiness.ok) throw new Error(readiness.reason);
    assert.equal(readiness.ok, true);

    assert.deepEqual(interpolateSamples(readiness.block, readiness.parameters), {
      ok: true,
      values: { signal: expectedSignal },
      interpolation: 'linear',
      errorEvidence: 'Contract fixture: values are recorded at every declared x coordinate.',
    });
  }

  const fixedInputMismatch = await validateSamplesInterpolationReadiness(reply, block, { x: 1, bias: 7.25 }, record);
  assert.equal(fixedInputMismatch.ok, false);
  if (fixedInputMismatch.ok) throw new Error('A changed fixed input unexpectedly admitted the saved grid.');
  assert.equal(fixedInputMismatch.state, 'mismatch');
  assert.match(fixedInputMismatch.reason, /differs.*recomputation/i);

  for (const x of [-0.01, 2.01]) {
    const outside = await validateSamplesInterpolationReadiness(reply, block, { x, bias: 7 }, record);
    assert.equal(outside.ok, false);
    if (outside.ok) throw new Error(`The out-of-envelope value ${x} unexpectedly passed readiness.`);
    assert.equal(outside.state, 'mismatch');
    assert.match(outside.reason, /outside the generated grid.*recomputation/i);
  }
});

test('sample interpolation refuses extrapolation on both sides for every supported mode', () => {
  for (const interpolation of ['linear', 'nearest'] as const) {
    const { block } = savedSampleReply(interpolation);
    for (const x of [-0.01, 2.01]) {
      const result = interpolateSamples(block, { x, bias: 7 });
      assert.equal(result.ok, false, `${interpolation} interpolation extrapolated at x=${x}.`);
      if (result.ok) throw new Error('An out-of-envelope sample unexpectedly interpolated.');
      assert.match(result.reason, /outside the sampled envelope.*recomputation/i);
    }
  }
});

test('renderer host authority withholds a structurally bound but altered checked outcome', async () => {
  const localChecks = computeIndependentChecks(growthReply, growthDefaultParameters);
  const report = runHostChecks(growthReply, growthDefaultParameters);
  const expectedHeadline = 'Still rising at 8 s. This model diverges at 32.4 s.';

  assert.equal(localChecks[0]?.headline, expectedHeadline);
  assert.deepEqual(await classificationsFromHost(growthReply, growthDefaultParameters, localChecks, report), [{
    blockId: 'growth-classification',
    state: 'verified',
    label: expectedHeadline,
  }]);

  const altered = structuredClone(report);
  altered.results[0]!.outcome = { kind: 'diverges', time: 5.8 };
  altered.results[0]!.headline = 'This model diverges at 5.8 s.';
  const views = await classificationsFromHost(growthReply, growthDefaultParameters, localChecks, altered);
  assert.equal(views[0]?.state, 'withheld');
  assert.equal(views[0]?.label, undefined);
});
