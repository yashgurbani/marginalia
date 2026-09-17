import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileExpression } from '../kernel/expression.ts';

test('bounded grammar handles mathematical precedence and short-circuit guards', () => {
  assert.equal(compileExpression('-2^2 + 2^3^2', [])({}), 508);
  assert.equal(compileExpression('f > 0 && sqrt(f) > 2', ['f'])({ f: -1 }), 0);
  const time = compileExpression('(pi/2 - atan((y0 - gamma/2)/sqrt(f - gamma^2/4))) / sqrt(f - gamma^2/4)', ['y0', 'gamma', 'f']);
  assert.ok(Math.abs(time({ gamma: 0.5, f: 0.07, y0: 0 }) - 32.42537076934207) < 1e-10);
});

test('code, property access, assignments, unknown names and resource abuse are refused', () => {
  for (const expression of ['globalThis', 'process.exit()', 'constructor(1)', 'x = 2', 'x[0]', 'fetch(1)', '1;2', 'Math.sin(0)', 'sqrt()', 'sqrt(1,2)', '1e999', '('.repeat(40) + '1' + ')'.repeat(40), '1+'.repeat(200) + '1']) {
    assert.throws(() => compileExpression(expression, ['x']), Error, expression);
  }
  assert.throws(() => compileExpression('sqrt(x)', ['x'])({ x: -1 }), /undefined/);
  assert.throws(() => compileExpression('x', ['x'])({}), /undefined/);
});
