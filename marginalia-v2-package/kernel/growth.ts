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

export function classifyGrowth(inputs: GrowthInputs): GrowthConclusion {
  validate(inputs);
  const { gamma, f, y0 } = inputs;
  const delta = f - gamma * gamma / 4;
  const z = y0 - gamma / 2;
  if (delta > 0) {
    const s = Math.sqrt(delta);
    return { kind: 'diverges', time: Math.atan2(s, z) / s };
  }
  if (delta === 0) {
    if (z > 0) return { kind: 'diverges', time: 1 / z };
    return z === 0 ? { kind: 'equilibrium', value: y0 } : { kind: 'settles', value: gamma / 2 };
  }
  const a = Math.sqrt(-delta);
  const lower = gamma / 2 - a;
  const upper = gamma / 2 + a;
  if (y0 === lower || y0 === upper) return { kind: 'equilibrium', value: y0 };
  if (y0 > upper) return { kind: 'diverges', time: Math.log1p(2 * a / (z - a)) / (2 * a) };
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
  const q = Math.exp(-2 * a * t);
  return gamma / 2 + a * ((z + a) * q + (z - a)) / ((z + a) * q - (z - a));
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
