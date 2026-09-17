import type { SamplesBlock } from '../contracts/reply.ts';
import { compileExpression, validName } from './expression.ts';

export type SamplesInterpolationResult =
  | { ok: true; values: Record<string, number>; interpolation: 'nearest' | 'linear'; errorEvidence: string }
  | { ok: false; reason: string };

type AxisPosition = { lower: number; upper: number; fraction: number; exact: boolean };
const failure = (reason: string): SamplesInterpolationResult => ({ ok: false, reason });
const gridKey = (indices: number[]) => indices.join(',');

/** Interpolates a complete rectilinear grid without extrapolation. */
export function interpolateSamples(block: SamplesBlock, parameters: Readonly<Record<string, number>>): SamplesInterpolationResult {
  const { axes, interpolation, forbiddenRegions, errorEvidence } = block.envelope;
  if (!errorEvidence.trim()) return failure('Interpolation is unavailable because recorded error evidence is missing.');
  if (!axes.length || axes.length > 6 || new Set(axes.map(axis => axis.name)).size !== axes.length) return failure('The sample envelope has invalid or duplicate axes.');
  if (!['nearest', 'linear'].includes(interpolation)) return failure('The sample interpolation method is unsupported.');

  let gridSize = 1;
  const positions: AxisPosition[] = [];
  const coordinates: number[][] = [];
  for (const axis of axes) {
    if (!validName(axis.name) || ['pi', 'e'].includes(axis.name) || !Number.isFinite(axis.min) || !Number.isFinite(axis.max) || axis.min >= axis.max || !Number.isInteger(axis.count) || axis.count < 2 || axis.count > 200) return failure(`The sample axis ${axis.name} is invalid or conflicts with a mathematical constant.`);
    gridSize *= axis.count;
    if (gridSize > 500) return failure('The sample grid exceeds the supported size.');
    const value = parameters[axis.name];
    if (!Number.isFinite(value)) return failure(`A finite value is required for sample axis ${axis.name}.`);
    if (value < axis.min || value > axis.max) return failure(`The requested value for ${axis.name} is outside the sampled envelope; recomputation is required.`);
    const levels = [...new Set(block.samples.map(sample => sample.at[axis.name]))].sort((a, b) => a - b);
    if (levels.length !== axis.count || levels.some(v => !Number.isFinite(v) || v < axis.min || v > axis.max) || levels[0] !== axis.min || levels.at(-1) !== axis.max) return failure(`The recorded coordinates for ${axis.name} do not cover the declared axis and count.`);
    coordinates.push(levels);
    const exactIndex = levels.indexOf(value);
    const exact = exactIndex !== -1;
    const upper = exact ? exactIndex : levels.findIndex(v => v > value);
    const lower = exact ? exactIndex : upper - 1;
    positions.push({ lower, upper, fraction: exact ? 0 : (value - levels[lower]) / (levels[upper] - levels[lower]), exact });
  }

  const expectedOutputNames = new Set<string>();
  const grid = new Map<string, SamplesBlock['samples'][number]>();
  for (const sample of block.samples) {
    const indices: number[] = [];
    for (const [axisIndex, axis] of axes.entries()) {
      const value = sample.at[axis.name];
      if (!Number.isFinite(value)) return failure(`A sample is missing the ${axis.name} grid coordinate.`);
      const index = coordinates[axisIndex].indexOf(value);
      if (index < 0) return failure(`A sample for ${axis.name} is outside the recorded grid.`);
      indices.push(index);
    }
    if (Object.keys(sample.at).some(name => !axes.some(axis => axis.name === name))) return failure('A sample contains an undeclared axis.');
    const names = Object.keys(sample.values).sort();
    if (!names.length || names.some(name => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) || !Object.values(sample.values).every(Number.isFinite)) return failure('A sample has invalid output values.');
    if (!expectedOutputNames.size) names.forEach(name => expectedOutputNames.add(name));
    else if (names.length !== expectedOutputNames.size || names.some(name => !expectedOutputNames.has(name))) return failure('Every sample must contain the same output values.');
    const key = gridKey(indices);
    if (grid.has(key)) return failure('The sample grid contains a duplicate coordinate.');
    grid.set(key, sample);
  }
  if (grid.size !== gridSize) return failure('The sample grid is incomplete; interpolation requires full rectilinear-grid coverage.');

  let forbiddenChecks: { test: (values: Record<string, number>) => number; reason: string }[];
  try {
    forbiddenChecks = forbiddenRegions.map(region => ({ test: compileExpression(region.expression, axes.map(axis => axis.name)), reason: region.reason }));
  } catch {
    return failure('A forbidden-region expression is invalid.');
  }
  const query = Object.fromEntries(axes.map(axis => [axis.name, parameters[axis.name]]));
  try {
    for (const region of forbiddenChecks) if (region.test(query) !== 0) return failure(`The requested point is forbidden: ${region.reason}`);
  } catch {
    return failure('A forbidden-region expression is undefined at the requested point.');
  }

  const exactIndices = positions.map(position => position.exact ? position.lower : -1);
  if (exactIndices.every(index => index >= 0)) {
    const sample = grid.get(gridKey(exactIndices));
    return sample ? { ok: true, values: { ...sample.values }, interpolation, errorEvidence } : failure('The exact sample is missing from the grid.');
  }

  // Neither nearest nor linear selection may bridge an unproven forbidden region.
  if (forbiddenChecks.length) return failure('Interpolation across a declared forbidden region cannot be proven safe; recomputation is required.');

  if (interpolation === 'nearest') {
    const indices = positions.map(position => position.fraction <= 0.5 ? position.lower : position.upper);
    const sample = grid.get(gridKey(indices));
    if (!sample) return failure('The nearest sample is missing from the grid.');
    try {
      for (const region of forbiddenChecks) if (region.test(sample.at) !== 0) return failure(`The nearest sample is forbidden: ${region.reason}`);
    } catch {
      return failure('A forbidden-region expression is undefined at the nearest sample.');
    }
    return { ok: true, values: { ...sample.values }, interpolation, errorEvidence };
  }

  const varying = positions.flatMap((position, axis) => position.exact ? [] : [axis]);
  const values = Object.fromEntries([...expectedOutputNames].map(name => [name, 0]));
  const corners = 1 << varying.length;
  for (let mask = 0; mask < corners; mask++) {
    let weight = 1;
    const indices = positions.map(position => position.lower);
    for (let bit = 0; bit < varying.length; bit++) {
      const axis = varying[bit];
      const upper = (mask & (1 << bit)) !== 0;
      indices[axis] = upper ? positions[axis].upper : positions[axis].lower;
      weight *= upper ? positions[axis].fraction : 1 - positions[axis].fraction;
    }
    const sample = grid.get(gridKey(indices));
    if (!sample) return failure('An interpolation corner is missing from the grid.');
    for (const name of expectedOutputNames) values[name] += weight * sample.values[name];
  }
  if (!Object.values(values).every(Number.isFinite)) return failure('Interpolation produced a non-finite value.');
  return { ok: true, values, interpolation, errorEvidence };
}
