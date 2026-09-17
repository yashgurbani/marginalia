import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrate, type Model } from '../kernel/integrate.ts';
import { runModel } from '../kernel/model.ts';
import { growthAt } from '../kernel/growth.ts';
import type { ModelBlock } from '../contracts/reply.ts';

const growth: Model = { kind: 'ode', state: ['y'], rhs: { y: 'y^2-gamma*y+f' }, initial: { y: 'y0' }, horizon: 8, method: 'rk45', maxSteps: 20000 };
test('adaptive integration agrees with the exact finite growth branch', () => {
  for (const inputs of [{ gamma: 0.5, f: 0.07, y0: 0 }, { gamma: 1, f: 0.2, y0: 0 }, { gamma: 1, f: 0.25, y0: 0 }]) {
    const result = integrate(growth, inputs);
    assert.equal(result.end, 'complete');
    assert.ok(result.rows.length > 20);
    for (const [t, y] of result.rows) assert.ok(Math.abs(y - growthAt(inputs, t)) < 1e-5);
  }
  assert.equal(integrate(growth, { gamma: 0.5, f: 0.2, y0: 0 }).end, 'limit');
});

test('RK4 supports coupled states and map updates are simultaneous', () => {
  const orbit = integrate({ kind: 'ode', state: ['x', 'v'], rhs: { x: 'v', v: '-x' }, initial: { x: '1', v: '0' }, horizon: Math.PI * 2, method: 'rk4', maxSteps: 20000 }, {});
  assert.equal(orbit.end, 'complete');
  assert.ok(Math.abs(orbit.rows.at(-1)![1] - 1) < 1e-5);
  const map = integrate({ kind: 'map', state: ['x', 'y'], rhs: { x: 'y', y: 'x' }, initial: { x: '1', y: '2' }, horizon: 2, maxSteps: 2 }, {});
  assert.deepEqual(map.rows, [[0, 1, 2], [1, 2, 1], [2, 1, 2]]);
});

test('singularities and exhausted resources yield finite partial curves, never settling claims', () => {
  assert.equal(integrate({ ...growth, maxSteps: 1 }, { gamma: 0.5, f: 0.07, y0: 0 }).end, 'limit');
  const undefinedCurve = integrate({ ...growth, rhs: { y: 'sqrt(-1)' } }, { gamma: 0.5, f: 0.07, y0: 0 });
  assert.equal(undefinedCurve.end, 'undefined');
  assert.deepEqual(undefinedCurve.rows, [[0, 0]]);
  assert.throws(() => integrate({ ...growth, state: ['gamma'] }, { gamma: 1 }), /state/);
});

test('ModelBlock adapter honors arbitrary initial expressions and the declared RK4 step', () => {
  const model: ModelBlock = {
    id: 'linear', type: 'model', kind: 'ode', state: ['y'], rhs: { y: 'rate' },
    initial: { y: 'offset+2' }, horizon: 1, method: 'rk4', step: 0.3, maxSteps: 8,
  };
  const result = runModel(model, { rate: 2, offset: 3 });
  assert.equal(result.end, 'complete');
  assert.deepEqual(result.rows.map(row => Number(row[0].toFixed(10))), [0, 0.3, 0.6, 0.9, 1]);
  assert.ok(Math.abs(result.rows.at(-1)![1] - 7) < 1e-12);
});

test('ModelBlock adapter runs maps with n and simultaneous updates', () => {
  const model: ModelBlock = {
    id: 'map', type: 'model', kind: 'map', state: ['x', 'y'],
    next: { x: 'y+n', y: 'x+n' }, initial: { x: '1', y: '2' }, iterations: 2,
  };
  const result = runModel(model, {});
  assert.deepEqual(result.columns, ['n', 'x', 'y']);
  assert.deepEqual(result.rows, [[0, 1, 2], [1, 2, 1], [2, 2, 3]]);
  assert.equal(result.end, 'complete');
});

test('terminal ODE events honor direction and report a finite numerical bracket', () => {
  const model: ModelBlock = {
    id: 'event-model', type: 'model', kind: 'ode', state: ['y'], rhs: { y: '1' },
    initial: { y: '-1' }, horizon: 3, method: 'rk4', step: 0.4, maxSteps: 20,
    events: [
      { id: 'wrong-way', when: 'y', direction: 'falling', terminal: true },
      { id: 'halfway', when: 'y+0.5', direction: 'rising', terminal: false },
      { id: 'zero-crossing', when: 'y', direction: 'rising', terminal: true },
    ],
  };
  const result = runModel(model, {});
  assert.equal(result.end, 'event');
  assert.deepEqual(result.events?.map(event => [event.id, event.terminal]), [['halfway', false], ['zero-crossing', true]]);
  assert.ok(Math.abs(result.events![1].time - 1) < 1e-12);
  assert.deepEqual(result.events![1].bracket.map(value => Number(value.toFixed(10))), [0.8, 1.2]);
  assert.match(result.message!, /finite event does not establish long-term behavior/i);
  assert.ok(Math.abs(result.rows.at(-1)![1]) < 1e-12);
});
