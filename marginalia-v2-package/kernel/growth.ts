/** Exact analysis of the illustrative scalar model y' = y² - gamma*y + f. */
export type GrowthInputs = { gamma: number; f: number; y0: number };
export type GrowthConclusion =
  | { kind: 'diverges'; time: number }
  | { kind: 'equilibrium'; value: number }
  | { kind: 'settles'; value: number };

function validate({ gamma, f, y0 }: GrowthInputs) {
  if (![gamma, f, y0].every(Number.isFinite) || gamma < 0 || f < 0)
    throw new Error('Damping and forcing must be finite and non-negative; the starting value must be finite.');
}

function divergence(time: number): GrowthConclusion {
  if (!Number.isFinite(time) || time <= 0) throw new Error('The divergence time is outside the supported numeric range.');
  return { kind: 'diverges', time };
}

export function classifyGrowth(inputs: GrowthInputs): GrowthConclusion {
  validate(inputs);
  const { gamma, f, y0 } = inputs;
  const delta = f - gamma * gamma / 4;
  if (!Number.isFinite(delta)) throw new Error('The growth criterion exceeds the supported numeric range.');
  if (gamma > 0 && gamma * gamma / 4 === 0) throw new Error('The damping threshold is below the supported numeric range.');
  const z = y0 - gamma / 2;
  if (delta > 0) {
    const s = Math.sqrt(delta);
    return divergence(Math.atan2(s, z) / s);
  }
  if (delta === 0) {
    if (z > 0) return divergence(1 / z);
    return z === 0 ? { kind: 'equilibrium', value: y0 } : { kind: 'settles', value: gamma / 2 };
  }
  const a = Math.sqrt(-delta);
  const upper = gamma / 2 + a;
  // Rationalization preserves a small positive root when subtraction loses f.
  const lower = f / upper;
  if (f > 0 && lower === 0) throw new Error('The equilibrium is below the supported numeric range.');
  if (f > 0 && delta === -gamma * gamma / 4 && y0 === upper) throw new Error('The upper equilibrium cannot be distinguished at this numeric precision.');
  if (y0 === lower || y0 === upper) return { kind: 'equilibrium', value: y0 };
  if (y0 > upper) return divergence(Math.log1p(2 * a / (y0 - upper)) / (2 * a));
  return { kind: 'settles', value: lower };
}

/** Finite branch only: refuses to draw a solution beyond its singularity. */
export function growthAt(inputs: GrowthInputs, t: number): number {
  const conclusion = classifyGrowth(inputs);
  if (!Number.isFinite(t) || t < 0) throw new Error('Time must be finite and non-negative.');
  if (conclusion.kind === 'diverges' && t >= conclusion.time)
    throw new Error('The solution ends at its divergence time.');
  if (t === 0 || conclusion.kind === 'equilibrium') return inputs.y0;
  const { gamma, f, y0 } = inputs;
  const delta = f - gamma * gamma / 4;
  const z = y0 - gamma / 2;
  if (delta > 0) {
    const s = Math.sqrt(delta);
    return gamma / 2 + s * Math.tan(Math.atan(z / s) + s * t);
  }
  if (delta === 0) return gamma / 2 + z / (1 - z * t);
  const a = Math.sqrt(-delta);
  const upper = gamma / 2 + a;
  const lower = f / upper;
  const offset = y0 - lower;
  const q = Math.exp(-2 * a * t);
  return lower + (2 * a * offset * q) / (2 * a + offset * Math.expm1(-2 * a * t));
}

export function growthSentence(inputs: GrowthInputs, horizon: number): string {
  if (!Number.isFinite(horizon) || horizon <= 0) throw new Error('The shown interval must be positive.');
  const result = classifyGrowth(inputs);
  if (result.kind === 'diverges') return result.time > horizon
    ? `Still rising at ${horizon} s. This model diverges at ${result.time.toFixed(1)} s.`
    : `This model diverges at ${result.time.toFixed(1)} s.`;
  if (result.kind === 'equilibrium') return `Stays at ${result.value.toFixed(2)}.`;
  return `Settles near ${result.value.toFixed(2)}.`;
}
