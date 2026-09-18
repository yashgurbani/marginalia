import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPosture, renderAssumes } from '../ui/posture/posture.ts';
import { FakePostureTransport } from '../ui/posture/transport.ts';
import { dom, until } from './t05-dom.ts';

test('posture is one control with the whitepaper choices and saves through its fake transport', async t => {
  const d = dom(t), fake = new FakePostureTransport('balanced');
  const mount = mountPosture(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  await until(() => d.root.textContent.includes('Put short definitions first'));
  assert.equal(d.root.querySelectorAll('fieldset').length, 1);
  assert.ok(d.root.textContent.includes('Flow. Put short definitions first and keep extra help light.'));
  assert.ok(d.root.textContent.includes('Balanced. Keep definitions and questions in balance as you read.'));
  assert.ok(d.root.textContent.includes('Learning. Put questions and critiques first and offer more help as you read.'));
  assert.equal((d.root.querySelectorAll('input').find(input => input.value === 'balanced') as unknown as HTMLInputElement).checked, true);
  const learning = d.root.querySelectorAll('input').find(input => input.value === 'learning'); assert.ok(learning);
  (learning as unknown as HTMLInputElement).checked = true; learning.fire('change');
  await until(() => d.root.textContent.includes('Reading posture saved.'));
  assert.equal(fake.saved.length, 1);
  assert.equal(fake.saved[0].expectedRevision, 0);
  assert.equal(fake.saved[0].enabled, false);
  assert.equal(fake.saved[0].posture, 'learning');
});

test('assumptions render only for a nonempty list', t => {
  const d = dom(t);
  assert.equal(renderAssumes([]), null);
  const assumes = renderAssumes(['Continuum model', 'Incompressible flow']); assert.ok(assumes);
  d.root.append(assumes as unknown as typeof d.root);
  assert.equal(d.root.querySelector('h4')?.textContent, 'Assumes:');
  assert.deepEqual(d.root.querySelectorAll('li').map(item => item.textContent), ['Continuum model', 'Incompressible flow']);
});
