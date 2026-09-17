import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGrowth, growthAt, growthSentence } from '../kernel/growth.ts';

test('classification uses the analytic criterion, including divergence beyond the picture', () => {
  for (const [gamma, f, y0, time] of [[0.5, 0.07, 0, 32.42537076934207], [0.5, 0.2, 0, 5.835863499904764], [0, 0.01, 0, 15.707963267948966], [1, 0, 2, Math.log(2)]]) {
    const result = classifyGrowth({ gamma, f, y0 });
    assert.equal(result.kind, 'diverges');
    if (result.kind === 'diverges') assert.ok(Math.abs(result.time - time) < 1e-10);
  }
  assert.equal(growthSentence({ gamma: 0.5, f: 0.07, y0: 0 }, 8), 'Still rising at 8 s. This model diverges at 32.4 s.');
});

test('zero forcing, equality and changed initial conditions are classified honestly', () => {
  assert.deepEqual(classifyGrowth({ gamma: 1, f: 0, y0: 0 }), { kind: 'equilibrium', value: 0 });
  assert.deepEqual(classifyGrowth({ gamma: 1, f: 0.25, y0: 0 }), { kind: 'settles', value: 0.5 });
  assert.deepEqual(classifyGrowth({ gamma: 1, f: 0.25, y0: 0.5 }), { kind: 'equilibrium', value: 0.5 });
  assert.deepEqual(classifyGrowth({ gamma: 1, f: 0.25, y0: 1 }), { kind: 'diverges', time: 2 });
  assert.equal(classifyGrowth({ gamma: 1, f: 0.2, y0: -1 }).kind, 'settles');
  assert.equal(classifyGrowth({ gamma: 1, f: 0.2, y0: 1 }).kind, 'diverges');
});

test('closed form satisfies initial values and differential equation throughout finite branches', () => {
  for (const inputs of [{ gamma: 1, f: 0.2, y0: 0 }, { gamma: 1, f: 0, y0: 2 }, { gamma: 1, f: 0.25, y0: 0 }, { gamma: 0.5, f: 0.07, y0: 0 }, { gamma: 1, f: 0.2, y0: 0.5 }]) {
    assert.equal(growthAt(inputs, 0), inputs.y0);
    assert.ok(Math.abs(growthAt(inputs, 1e-8) - inputs.y0) < 1e-6, 'The finite branch must be continuous at its initial condition.');
    for (const t of [0.01, 0.1, 0.3]) {
      const h = 1e-6;
      const y = growthAt(inputs, t);
      const derivative = (growthAt(inputs, t + h) - growthAt(inputs, t - h)) / (2 * h);
      assert.ok(Math.abs(derivative - (y * y - inputs.gamma * y + inputs.f)) < 1e-5);
    }
  }
  assert.throws(() => growthAt({ gamma: 1, f: 0, y0: 2 }, 1), /divergence/);
  assert.throws(() => classifyGrowth({ gamma: NaN, f: 0, y0: 0 }), /finite/);
});
