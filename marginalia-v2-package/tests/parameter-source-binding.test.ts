import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReply, type CandidateReply, type SourceBinding } from '../contracts/reply.ts';
import { dom } from './t05-dom.ts';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.css')) return { url: 'parameter-source-binding:css', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'parameter-source-binding:css') return { format: 'module', source: '', shortCircuit: true };
    return next(url, context);
  },
});

const { mountReply } = await import('../renderer/index.ts');

const sourceText = 'The stretching rate controls how quickly the spiral thins.';
const sourceBinding: SourceBinding = {
  name: 'stretching-rate', meaning: 'stretching rate', relation: 'interpreted',
  selector: { exact: 'stretching rate', prefix: 'The ', suffix: ' controls' },
};

function fixture(binding?: SourceBinding): CandidateReply {
  return {
    schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Spiral', summary: 'A local illustration.',
    sourceBindings: [], parameters: [{ name: 'rate', label: 'stretching rate', default: 0.5, min: 0, max: 1, unit: '1/s', ...(binding ? { sourceBinding: binding } : {}) }],
    assumptions: [], limitations: [], blocks: [{ id: 'copy', type: 'text', md: 'The curve changes locally.' }], checks: [], staticFallback: 'Local illustration.',
  };
}

test('a parameter source binding uses the exact source selector and rejects an absent span', () => {
  assert.equal(validateReply(fixture(sourceBinding), { sourceText }).ok, true);
  const invalid = fixture(structuredClone(sourceBinding)); invalid.parameters[0]!.sourceBinding!.selector.exact = 'absent phrase';
  const result = validateReply(invalid, { sourceText });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /\$\.parameters\[0\]\.sourceBinding\.selector: selector does not match/);
});

test('the published parameter schema admits only the optional source binding field', () => {
  const schema = JSON.parse(readFileSync(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.$defs.parameter.additionalProperties, false);
  assert.deepEqual(schema.$defs.parameter.properties.sourceBinding, { $ref: '#/$defs/sourceBinding' });
});

test('bound parameter controls highlight and keep fine keyboard changes local', t => {
  const { root } = dom(t);
  const highlights: (SourceBinding | null)[] = [];
  const requests: string[] = [];
  const navigate = t.mock.fn();
  const mounted = mountReply(root as unknown as HTMLElement, fixture(sourceBinding), {
    sourceText,
    onSourceHighlight: value => highlights.push(value),
    onSourceNavigate: navigate,
    onFollowup: () => { requests.push('followup'); },
    onRecompute: () => { requests.push('recompute'); },
  });
  t.after(() => mounted.destroy());

  const row = root.querySelector('.mr-parameter'); assert.ok(row, root.textContent);
  const label = row.querySelector('label')!;
  const inputs = row.querySelectorAll('input');
  const number = inputs.find(node => node.type === 'number')!;
  const slider = inputs.find(node => node.type === 'range')!;
  assert.equal(label.getAttribute('tabindex'), '0');
  for (const node of [label, number, slider]) assert.equal(node.getAttribute('role'), null);
  assert.equal(slider.getAttribute('aria-label'), 'stretching rate (1/s) slider');

  label.fire('pointerenter'); assert.deepEqual(highlights.at(-1), sourceBinding);
  label.fire('pointerleave'); assert.equal(highlights.at(-1), null);
  label.fire('focus'); assert.deepEqual(highlights.at(-1), sourceBinding);
  label.fire('blur'); assert.equal(highlights.at(-1), null);
  number.fire('focus'); assert.deepEqual(highlights.at(-1), sourceBinding);
  number.fire('blur'); assert.equal(highlights.at(-1), null);
  slider.fire('pointerenter'); assert.deepEqual(highlights.at(-1), sourceBinding);
  slider.fire('pointerleave'); assert.equal(highlights.at(-1), null);
  slider.fire('focus'); assert.deepEqual(highlights.at(-1), sourceBinding);
  slider.fire('blur'); assert.equal(highlights.at(-1), null);

  // The DOM fixture has no native valueAsNumber; reflect the range's current value.
  Object.defineProperty(slider, 'valueAsNumber', {
    get: () => slider.value === '' ? NaN : Number(slider.value),
    set: (value: number) => { slider.value = String(value); },
  });
  const key = slider.fire('keydown', { key: 'ArrowRight' });
  assert.equal(key.defaultPrevented, true, 'The fine Arrow increment replaces the coarser native step-any increment.');
  assert.equal(mounted.getState().parameters.rate, 0.501);
  assert.equal(slider.value, '0.501'); assert.equal(number.value, '0.501');
  assert.equal(slider.fire('keydown', { key: 'ArrowLeft' }).defaultPrevented, true);
  assert.equal(mounted.getState().parameters.rate, 0.5);
  for (const nativeKey of ['Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Enter']) {
    assert.equal(slider.fire('keydown', { key: nativeKey }).defaultPrevented, false, nativeKey);
  }
  slider.click(); assert.equal(navigate.mock.callCount(), 0);
  slider.value = '0.75'; Object.assign(slider, { valueAsNumber: 0.75 }); slider.fire('input');
  assert.equal(mounted.getState().parameters.rate, 0.75);
  assert.deepEqual(requests, []);
});

test('an unbound parameter keeps the current row semantics', t => {
  const { root } = dom(t);
  const highlights: (SourceBinding | null)[] = [];
  const reply = fixture(); const validation = validateReply(reply, { sourceText });
  assert.equal(validation.ok, true, validation.ok ? '' : validation.errors.join('\n'));
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText, onSourceHighlight: value => highlights.push(value) });
  t.after(() => mounted.destroy());
  const row = root.querySelector('.mr-parameter'); assert.ok(row, root.textContent);
  assert.equal(row.querySelector('label')!.getAttribute('tabindex'), null);
  assert.equal(row.querySelector('input')!.getAttribute('role'), null);
  row.querySelector('label')!.fire('pointerenter');
  assert.deepEqual(highlights, []);
});
