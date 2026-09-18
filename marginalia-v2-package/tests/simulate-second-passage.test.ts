import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeIndependentChecks, validateReply } from '../contracts/reply.ts';
import { classificationViews, runHostChecks } from '../contracts/host-checks.ts';
import { calculateReply } from '../renderer/state.ts';
import { secondPassageDefaultParameters, secondPassageReply, secondPassageSourceText } from '../fixtures/second-passage-reply.ts';

test('authored second-passage simulation validates against only its own captured passage', () => {
  const validated = validateReply(secondPassageReply, { sourceText: secondPassageSourceText, capabilities: ['samples'] });
  assert.equal(validated.ok, true, validated.ok ? '' : validated.errors.join('\n'));
  for (const binding of secondPassageReply.sourceBindings) {
    assert.ok(secondPassageSourceText.includes(binding.selector.exact), binding.selector.exact);
  }
});

test('uninstalled second-passage criterion stays unsupported and its finite local model has no headline', () => {
  assert.deepEqual(computeIndependentChecks(secondPassageReply, secondPassageDefaultParameters), [{
    requestId: 'check-cooling',
    criterion: 'cooling-v1',
    model: 'cooling-model',
    classification: 'cooling-classification',
    status: 'unsupported',
    reason: 'No independent implementation is installed for cooling-v1.',
  }]);

  const report = runHostChecks(secondPassageReply, secondPassageDefaultParameters);
  assert.deepEqual(classificationViews(secondPassageReply, secondPassageDefaultParameters, report), [{
    blockId: 'cooling-classification',
    state: 'withheld',
    reason: 'This classification is not declared as a headline.',
  }]);

  const calculation = calculateReply(secondPassageReply, secondPassageDefaultParameters);
  const model = calculation.models.get('cooling-model');
  assert.equal(model?.ok, true, model && !model.ok ? model.reason : '');
  if (model?.ok) assert.ok(model.value.rows.flat().every(Number.isFinite));
  const derived = calculation.derived.get('initial-gap');
  assert.equal(derived?.ok, true, derived && !derived.ok ? derived.reason : '');
  if (derived?.ok) assert.ok(Number.isFinite(derived.value));
});
