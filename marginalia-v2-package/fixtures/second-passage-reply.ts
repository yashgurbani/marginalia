/** Authored demonstration data, not a recorded live run. */
import type { CandidateReply } from '../contracts/reply.ts';
import { illustrationOrigins } from './illustration-origins.ts';

export const secondPassageSourceText = 'A warm cup starts at 80 degrees while the room stays at 20 degrees, and its temperature approaches the room over time.';

export const secondPassageReply: CandidateReply = {
  schema: 'marginalia.reply.v1',
  intent: 'simulate',
  status: 'complete',
  title: 'Cooling toward room temperature',
  summary: 'A local Newton-cooling illustration follows the temperature gap over ten minutes.',
  illustration: {
    value: true,
    statement: 'Authored illustration of a cooling law, not a measured run or a claim about the passage.',
  },
  sourceBindings: [
    { name: 'initial-temperature', meaning: 'initial cup temperature', relation: 'interpreted', selector: { exact: 'starts at 80 degrees' } },
    { name: 'room-temperature', meaning: 'ambient temperature', relation: 'interpreted', selector: { exact: 'room stays at 20 degrees' } },
    { name: 'cooling-direction', meaning: 'temperature approaches ambient', relation: 'interpreted', selector: { exact: 'temperature approaches the room over time' } },
  ],
  parameters: [
    { name: 'k', label: 'cooling rate', default: 0.3, min: 0.01, max: 1, unit: '1/min' },
    { name: 'ambient', label: 'room temperature', default: 20, min: 0, max: 40, unit: '°C' },
    { name: 'temp0', label: 'initial temperature', default: 80, min: 40, max: 100, unit: '°C' },
  ],
  assumptions: [
    { id: 'constant-room', text: 'The room temperature and cooling rate stay constant during the illustrated interval.', editable: true },
  ],
  limitations: ['This single-state model omits evaporation, changing airflow, the cup material and measurement error.'],
  blocks: [
    { id: 'cooling-explanation', type: 'text', md: 'The curve is computed locally from an authored cooling equation.' },
    { id: 'cooling-equation', type: 'equation', tex: "T' = -k(T-T_{room})" },
    {
      id: 'cooling-model', type: 'model', kind: 'ode', state: ['temp'],
      rhs: { temp: '-k*(temp-ambient)' }, initial: { temp: 'temp0' },
      horizon: 10, method: 'rk45', maxSteps: 2_000,
    },
    { id: 'cooling-plot', type: 'plot', from: 'cooling-model', x: 't', y: ['temp'], labels: { t: 'time (min)', temp: 'temperature (°C)' } },
    { id: 'initial-gap', type: 'derived', name: 'gap', expression: 'temp0-ambient', unit: '°C', label: 'initial temperature gap', model: 'cooling-model' },
    {
      id: 'cooling-classification', type: 'classification', model: 'cooling-model', headline: true,
      rule: 'Installed cooling-v1 exact solution with interpreter probe.', check: 'check-cooling',
      labels: { cooling: 'Cooling', warming: 'Warming' },
    },
  ],
  checks: [{
    id: 'check-cooling', criterion: 'cooling-v1', model: 'cooling-model', classification: 'cooling-classification',
    inputs: { rate: 'k', ambient: 'ambient', initial: 'temp0' },
  }],
  staticFallback: 'Authored cooling illustration. A checked conclusion requires a matching check for the displayed inputs.',
};

export const secondPassageDefaultParameters = { k: 0.3, ambient: 20, temp0: 80 } as const;
secondPassageReply.origins = illustrationOrigins(secondPassageReply);
