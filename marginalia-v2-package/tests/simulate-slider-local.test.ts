import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHostChecks } from '../contracts/host-checks.ts';
import { growthDefaultParameters, growthReply, growthSourceText } from '../fixtures/growth-reply.ts';
import { dom, until, type TestElement } from './t05-dom.ts';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.css')) return { url: 'simulate-slider:css', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'simulate-slider:css') return { format: 'module', source: '', shortCircuit: true };
    return next(url, context);
  },
});

const { mountReply } = await import('../renderer/index.ts');

function inputOfType(root: TestElement, type: string, index = 0): TestElement {
  const found = root.querySelectorAll('input').filter(node => node.type === type)[index];
  if (!found) throw new Error(`Missing ${type} input ${index}.`);
  return found;
}

function setNumericInput(input: TestElement, value: number) {
  input.value = String(value);
  Object.assign(input, { valueAsNumber: value });
  input.fire('input');
}

test('number and range changes recompute locally without sending or requesting recomputation', async t => {
  const { document, root } = dom(t);
  Object.assign(document, {
    createElementNS(_namespace: string, tag: string) { return document.createElement(tag); },
  });
  const onFollowup = t.mock.fn(async () => {});
  const onRecompute = t.mock.fn(async () => {});
  const mounted = mountReply(root as unknown as HTMLElement, growthReply, {
    sourceText: growthSourceText,
    capabilities: ['samples'],
    hostReport: runHostChecks(growthReply, growthDefaultParameters),
    onFollowup,
    onRecompute,
  });
  t.after(() => mounted.destroy());

  const classification = root.querySelector('[data-block="growth-classification"]')!;
  await until(() => classification.textContent.includes('Still rising at 8 s. This model diverges at 32.4 s.'));
  const derived = root.querySelector('[data-block="threshold"]')!;
  const plot = root.querySelector('[data-block="growth-plot"]')!;
  const derivedBefore = derived.textContent;
  const pathBefore = plot.querySelector('path')?.getAttribute('d');

  setNumericInput(inputOfType(root, 'number'), 0.8);

  assert.notEqual(derived.textContent, derivedBefore);
  assert.notEqual(plot.querySelector('path')?.getAttribute('d'), pathBefore);
  assert.equal(root.querySelector('.mr-status')?.textContent, 'Updated locally. No model request was sent.');
  assert.equal(onFollowup.mock.callCount(), 0);
  assert.equal(onRecompute.mock.callCount(), 0);

  setNumericInput(inputOfType(root, 'range'), growthDefaultParameters.gamma);
  assert.equal(mounted.getState().parameters.gamma, growthDefaultParameters.gamma);
  assert.equal(root.querySelector('.mr-status')?.textContent, 'Updated locally. No model request was sent.');
  await until(() => classification.textContent.includes('Still rising at 8 s. This model diverges at 32.4 s.'));

  setNumericInput(inputOfType(root, 'number'), 3);
  assert.match(classification.textContent, /headline is withheld/i);
  assert.doesNotMatch(classification.textContent, /diverges at 32\.4 s/i);
  assert.equal(onFollowup.mock.callCount(), 0);
  assert.equal(onRecompute.mock.callCount(), 0);
});
