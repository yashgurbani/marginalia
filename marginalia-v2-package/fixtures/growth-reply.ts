import type { CandidateReply } from '../contracts/reply.ts';
import { illustrationOrigins } from './illustration-origins.ts';

export const growthSourceText = 'The page compares damping and forcing in a toy amplitude model. The initial amplitude starts at zero.';

/** Honest prebuilt illustration used by the product fixture, not an all-block schema sample. */
export const growthReply: CandidateReply = {
  schema: 'marginalia.reply.v1',
  intent: 'simulate',
  status: 'complete',
  title: 'Self-amplifying growth against damping',
  summary: 'A bounded scalar illustration separates what is visible in the plot from the model’s exact long-term result.',
  illustration: {
    value: true,
    statement: 'Illustration of self-amplifying growth. Not the paper’s fluid model or a reproduction of its result.',
  },
  sourceBindings: [
    { name: 'gamma-source', meaning: 'damping rate', relation: 'interpreted', selector: { exact: 'damping', suffix: ' and forcing' } },
    { name: 'f-source', meaning: 'constant forcing', relation: 'interpreted', selector: { exact: 'forcing', prefix: 'damping and ' } },
    { name: 'y0-source', meaning: 'initial value', relation: 'interpreted', selector: { exact: 'starts at zero', prefix: 'amplitude ' } },
  ],
  parameters: [
    { name: 'gamma', label: 'damping', default: 0.5, min: 0, max: 2, unit: '1/s' },
    { name: 'f', label: 'forcing', default: 0.07, min: 0, max: 1, unit: '1/s²' },
    { name: 'y0', label: 'start', default: 0, min: -2, max: 2, unit: '1/s' },
  ],
  assumptions: [
    { id: 'constant-forcing', text: 'Forcing and damping stay constant over the shown interval.', editable: true },
    { id: 'scalar-analogy', text: 'One scalar stands in for the flow’s amplitude.', editable: false },
  ],
  limitations: ['No spatial structure, pressure, incompressibility or energy bound; this illustration makes no claim about the proof.'],
  blocks: [
    { id: 'explanation', type: 'text', md: 'The curve is locally integrated, while the headline comes from an independent closed-form criterion.' },
    { id: 'growth-equation', type: 'equation', tex: "y' = y^2 - \\gamma y + f" },
    { id: 'growth-model', type: 'model', kind: 'ode', state: ['y'], rhs: { y: 'y^2 - gamma*y + f' }, initial: { y: 'y0' }, horizon: 8, method: 'rk45', maxSteps: 20_000 },
    { id: 'growth-plot', type: 'plot', from: 'growth-model', x: 't', y: ['y'], yRange: [-1, 10], labels: { y: 'amplitude (1/s)' } },
    { id: 'threshold', type: 'derived', name: 'threshold', expression: 'gamma^2/4', unit: '1/s²', label: 'from-rest divergence threshold', model: 'growth-model' },
    {
      id: 'growth-classification', type: 'classification', model: 'growth-model', headline: true,
      rule: 'Renderer-owned growth-v1 exact analysis for the declared scalar equation.', check: 'check-growth',
      labels: { diverges: 'Diverges', settles: 'Settles', equilibrium: 'Stays steady' },
    },
  ],
  checks: [{
    id: 'check-growth', criterion: 'growth-v1', model: 'growth-model', classification: 'growth-classification',
    inputs: { gamma: 'gamma', f: 'f', y0: 'y0' },
  }],
  staticFallback: 'This example needs the packaged mathematical renderer. Its headline remains hidden until the host verifies the current parameters.',
};

export const growthDefaultParameters = { gamma: 0.5, f: 0.07, y0: 0 } as const;
growthReply.origins = illustrationOrigins(growthReply);
