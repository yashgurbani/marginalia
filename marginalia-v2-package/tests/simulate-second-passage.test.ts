import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeIndependentChecks, validateReply } from '../contracts/reply.ts';
import { classificationViews, runHostChecks } from '../contracts/host-checks.ts';
import { calculateReply } from '../renderer/state.ts';
import { secondPassageDefaultParameters, secondPassageReply, secondPassageSourceText } from '../fixtures/second-passage-reply.ts';

test('authored second-passage simulation validates against only its own captured passage', () => {
  const validated = validateReply(secondPassageReply, { sourceText: secondPassageSourceText, capabilities: ['samples'], requireOrigins: true });
  assert.equal(validated.ok, true, validated.ok ? '' : validated.errors.join('\n'));
  for (const binding of secondPassageReply.sourceBindings) {
    assert.ok(secondPassageSourceText.includes(binding.selector.exact), binding.selector.exact);
  }
});

test('second-passage cooling criterion matches the closed form and interpreter probe', () => {
  const [check] = computeIndependentChecks(secondPassageReply, secondPassageDefaultParameters);
  assert.equal(check.status, 'pass');
  assert.equal(check.outcome?.kind, 'cooling');
  assert.ok(check.outcome && 'value' in check.outcome && Math.abs(check.outcome.value - (20 + 60 * Math.exp(-3))) < 1e-12);

  const report = runHostChecks(secondPassageReply, secondPassageDefaultParameters);
  assert.deepEqual(classificationViews(secondPassageReply, secondPassageDefaultParameters, report), [{
    blockId: 'cooling-classification',
    state: 'verified',
    label: 'At 10 min, this model gives 22.9872 °C. No conclusion beyond the shown interval.',
  }]);

  for (const mutation of ['equation', 'unit'] as const) {
    const altered = structuredClone(secondPassageReply);
    const alteredModel = altered.blocks.find(block => block.type === 'model');
    if (alteredModel?.type !== 'model' || alteredModel.kind !== 'ode') assert.fail();
    if (mutation === 'equation') alteredModel.rhs.temp = 'k*(temp-ambient)';
    else altered.parameters[0].unit = '1/s';
    assert.equal(computeIndependentChecks(altered, secondPassageDefaultParameters)[0].status, 'fail');
    assert.equal(classificationViews(altered, secondPassageDefaultParameters, report)[0].state, 'withheld');
  }

  const calculation = calculateReply(secondPassageReply, secondPassageDefaultParameters);
  const model = calculation.models.get('cooling-model');
  assert.equal(model?.ok, true, model && !model.ok ? model.reason : '');
  if (model?.ok) assert.ok(model.value.rows.flat().every(Number.isFinite));
  const derived = calculation.derived.get('initial-gap');
  assert.equal(derived?.ok, true, derived && !derived.ok ? derived.reason : '');
  if (derived?.ok) assert.ok(Number.isFinite(derived.value));
});
