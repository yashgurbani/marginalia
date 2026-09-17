import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrate, type Model } from '../kernel/integrate.ts';
import { growthAt } from '../kernel/growth.ts';

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
