import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReply, type CandidateReply } from '../contracts/reply.ts';
import { runHostChecks } from '../contracts/host-checks.ts';
import { growthDefaultParameters, growthReply, growthSourceText } from '../fixtures/growth-reply.ts';
import { dom, until, type TestElement } from './t05-dom.ts';
import type { RendererState } from '../renderer/state.ts';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.css')) return { url: 'local-assumptions:css', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'local-assumptions:css') return { format: 'module', source: '', shortCircuit: true };
    return next(url, context);
  },
});

const { mountReply } = await import('../renderer/index.ts');

type AssumptionBinding = { parameter: string; min: number; max: number };

function boundReply(): CandidateReply {
  const reply = structuredClone(growthReply);
  const assumptions = reply.assumptions as Array<Record<string, unknown>>;
  assumptions[0] = {
    ...assumptions[0],
    id: 'bounded-damping',
    text: 'Damping may vary inside the local interval.',
    binding: { parameter: 'gamma', min: 0.25, max: 1 } satisfies AssumptionBinding,
  };
  assumptions[1] = {
    ...assumptions[1],
    id: 'structural-example',
    text: 'One scalar stands in for the flow amplitude.',
    editable: true,
  };
  return reply;
}

function multiBoundReply(): CandidateReply {
  const reply = boundReply();
  reply.assumptions.push({ id: 'bounded-damping-copy', text: 'The same damping range applies to this view.', editable: true, binding: { parameter: 'gamma', min: 0.25, max: 1 } });
  if (reply.origins) reply.origins.parts['/assumptions/2'] = structuredClone(reply.origins.parts['/assumptions/1']!);
  return reply;
}

function setNumericInput(input: TestElement, value: number) {
  input.value = String(value);
  Object.assign(input, { valueAsNumber: value });
  input.fire(input.type === 'range' ? 'input' : 'change');
}

function assumptionInput(root: TestElement, id: string): TestElement {
  const input = root.querySelector(`input[data-assumption-id="${id}"]`);
  if (!input) throw new Error(`Missing bound assumption input ${id}.`);
  return input;
}

function parameterInput(root: TestElement, suffix: string): TestElement {
  const input = root.querySelectorAll('input').find(node => node.id.endsWith(suffix));
  if (!input) throw new Error(`Missing parameter control ${suffix}.`);
  return input;
}

test('assumption bindings are optional, singular, bounded by their parameter, and reject invalid references', () => {
  const schema = JSON.parse(readFileSync(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8')) as {
    $defs: { assumption: { properties: { binding?: { $ref?: string } } } };
  };
  assert.equal(schema.$defs.assumption.properties.binding?.$ref, '#/$defs/assumptionBinding');

  const admitted = validateReply(boundReply(), { sourceText: growthSourceText });
  assert.equal(admitted.ok, true, admitted.ok ? '' : admitted.errors.join(' '));

  const invalidBindings: unknown[] = [
    { parameter: 'missing', min: 0.25, max: 1 },
    { parameter: 'gamma', min: -0.1, max: 1 },
    { parameter: 'gamma', min: 0.25, max: 2.1 },
    { parameter: 'gamma', min: 1, max: 0.25 },
    { parameter: 'gamma', min: 0.25, max: Number.POSITIVE_INFINITY },
    { parameter: 'gamma', min: 0.25, max: 1, extra: 'unknown' },
  ];
  for (const binding of invalidBindings) {
    const candidate = structuredClone(growthReply);
    const first = candidate.assumptions[0]! as unknown as Record<string, unknown>;
    (candidate.assumptions as unknown as Array<Record<string, unknown>>)[0] = { ...first, binding };
    const result = validateReply(candidate, { sourceText: growthSourceText });
    assert.equal(result.ok, false, JSON.stringify(binding));
  }
});

test('a bound editable assumption redraws locally, persists, reopens, and leaves structural assumptions on Ask again', async t => {
  const { document, root } = dom(t);
  Object.assign(document, {
    createElementNS(_namespace: string, tag: string) { return document.createElement(tag); },
  });
  const reply = boundReply();
  const saved: RendererState[] = [];
  const onStateChange = t.mock.fn((state: RendererState) => { saved.push(structuredClone(state)); });
  const onFollowup = t.mock.fn(async (_context: { text: string }) => {});
  const onRecompute = t.mock.fn(async () => {});
  const resolveHostReport = t.mock.fn(async (parameters: Readonly<Record<string, number>>) => runHostChecks(reply, parameters));
  const mounted = mountReply(root as unknown as HTMLElement, reply, {
    sourceText: growthSourceText,
    capabilities: ['samples'],
    hostReport: runHostChecks(reply, growthDefaultParameters),
    onStateChange,
    onFollowup,
    onRecompute,
    resolveHostReport,
  });
  t.after(() => mounted.destroy());

  const derived = root.querySelector('[data-block="threshold"]')!;
  const before = derived.textContent;
  const bounded = assumptionInput(root, 'bounded-damping');
  bounded.focus();
  setNumericInput(bounded, 0.8);

  await until(() => derived.textContent !== before && saved.length > 0);
  assert.equal(mounted.getState().parameters.gamma, 0.8);
  assert.equal(document.activeElement, bounded);
  assert.equal(root.querySelector('.mr-status')?.textContent, 'Updated locally. No model request was sent.');
  assert.equal(onFollowup.mock.callCount(), 0);
  assert.equal(onRecompute.mock.callCount(), 0);
  assert.equal(resolveHostReport.mock.callCount(), 0);
  assert.equal(saved.at(-1)?.parameters.gamma, 0.8);

  const derivedAfterAccepted = derived.textContent;
  const savesAfterAccepted = saved.length;
  setNumericInput(bounded, 1.5);
  assert.equal(mounted.getState().parameters.gamma, 0.8);
  assert.equal(derived.textContent, derivedAfterAccepted);
  assert.equal(saved.length, savesAfterAccepted);
  assert.match(root.querySelector(`#${bounded.getAttribute('aria-describedby')}`)?.textContent ?? '', /outside the assumption range/i);
  assert.match(root.textContent, /The previous value remains/);
  assert.equal(onFollowup.mock.callCount(), 0);
  assert.equal(onRecompute.mock.callCount(), 0);
  assert.equal(resolveHostReport.mock.callCount(), 0);

  const structural = root.querySelectorAll('textarea').find(node => node.getAttribute('aria-label')?.includes('One scalar stands'));
  assert.ok(structural, 'an unbound editable assumption keeps its text review control');
  structural!.value = 'A changed structural premise.';
  structural!.fire('input');
  const asks = root.querySelectorAll('button').filter(node => node.textContent === 'Ask again with this assumption');
  assert.equal(asks.length, 1);
  asks[0]!.click();
  await until(() => onFollowup.mock.callCount() === 1);
  assert.match(onFollowup.mock.calls[0]!.arguments[0].text, /structural-example/);
  assert.equal(onRecompute.mock.callCount(), 0);
  assert.equal(resolveHostReport.mock.callCount(), 0);

  const savedState = saved.at(-1)!;
  mounted.destroy();
  const reopened = dom(t);
  Object.assign(reopened.document, {
    createElementNS(_namespace: string, tag: string) { return reopened.document.createElement(tag); },
  });
  const reopenedMount = mountReply(reopened.root as unknown as HTMLElement, reply, {
    sourceText: growthSourceText,
    capabilities: ['samples'],
    initialState: savedState,
    hostReport: runHostChecks(reply, { ...growthDefaultParameters, gamma: 0.8 }),
    onFollowup,
    onRecompute,
    resolveHostReport,
  });
  t.after(() => reopenedMount.destroy());
  assert.equal(reopenedMount.getState().parameters.gamma, 0.8);
  assert.equal(assumptionInput(reopened.root, 'bounded-damping').value, '0.8');
  assert.equal(resolveHostReport.mock.callCount(), 0);
});

test('bound assumption controls synchronize both ways across multiple bindings while invalid drafts keep the accepted state', async t => {
  const { document, root } = dom(t);
  Object.assign(document, {
    createElementNS(_namespace: string, tag: string) { return document.createElement(tag); },
  });
  const reply = multiBoundReply();
  const saved: RendererState[] = [];
  const onStateChange = t.mock.fn((state: RendererState) => { saved.push(structuredClone(state)); });
  const onFollowup = t.mock.fn(async (_context: { text: string }) => {});
  const onRecompute = t.mock.fn(async () => {});
  const resolveHostReport = t.mock.fn(async () => undefined);
  const mounted = mountReply(root as unknown as HTMLElement, reply, {
    sourceText: growthSourceText,
    capabilities: ['samples'],
    hostReport: runHostChecks(reply, growthDefaultParameters),
    onStateChange,
    onFollowup,
    onRecompute,
    resolveHostReport,
  });
  t.after(() => mounted.destroy());

  const number = parameterInput(root, '-input-gamma');
  const slider = parameterInput(root, '-slider-gamma');
  const first = assumptionInput(root, 'bounded-damping');
  const mirror = assumptionInput(root, 'bounded-damping-copy');
  const controls = [number, slider, first, mirror];
  const assertControls = (value: string) => controls.forEach(control => assert.equal(control.value, value, control.id));

  number.focus(); number.value = '0.25'; Object.assign(number, { valueAsNumber: 0.25 }); number.fire('input');
  assert.equal(number.value, '0.25'); assert.equal(mounted.getState().parameters.gamma, growthDefaultParameters.gamma);
  number.fire('change'); await until(() => mounted.getState().parameters.gamma === 0.25);

  first.focus();
  setNumericInput(first, 0.8);
  await until(() => mounted.getState().parameters.gamma === 0.8 && saved.length > 0);
  assertControls('0.8');
  assert.equal(document.activeElement, first);
  assert.equal(slider.getAttribute('aria-valuetext'), '0.8 1/s');

  const edit = root.querySelectorAll('button').find(control => control.getAttribute('aria-label') === 'Edit damping (1/s)');
  assert.ok(edit); Object.assign(number, { select() {} }); edit.click();
  setNumericInput(number, 0.6);
  number.fire('blur');
  await until(() => mounted.getState().parameters.gamma === 0.6);
  assertControls('0.6');
  assert.equal(document.activeElement, number);

  slider.focus();
  setNumericInput(slider, 0.7);
  await until(() => mounted.getState().parameters.gamma === 0.7);
  assertControls('0.7');
  assert.equal(document.activeElement, slider);
  assert.equal(slider.getAttribute('aria-valuetext'), '0.7 1/s');

  const savesAfterAccepted = saved.length;
  first.focus();
  setNumericInput(first, 0.1);
  assert.equal(first.value, '0.1');
  assert.equal(first.getAttribute('aria-invalid'), 'true');
  assert.equal(mounted.getState().parameters.gamma, 0.7);
  assert.deepEqual([number.value, slider.value, mirror.value], ['0.7', '0.7', '0.7']);
  assert.equal(saved.length, savesAfterAccepted);

  number.focus();
  setNumericInput(number, 3);
  assert.equal(number.value, '3');
  assert.equal(number.getAttribute('aria-invalid'), 'true');
  assert.equal(mounted.getState().parameters.gamma, 0.7);
  assert.deepEqual([slider.value, first.value, mirror.value], ['0.7', '0.1', '0.7']);

  mirror.focus();
  setNumericInput(mirror, 0.9);
  await until(() => mounted.getState().parameters.gamma === 0.9);
  assertControls('0.9');
  assert.equal(document.activeElement, mirror);
  assert.equal(number.getAttribute('aria-invalid'), null);
  assert.equal(first.getAttribute('aria-invalid'), null);
  assert.equal(slider.getAttribute('aria-valuetext'), '0.9 1/s');
  assert.equal(onFollowup.mock.callCount(), 0);
  assert.equal(onRecompute.mock.callCount(), 0);
});
