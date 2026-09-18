import type { CandidateReply, PartOrigin } from '../contracts/reply.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

export const instantiateSource = 'A carton contains 24 samples divided equally among 6 trays.';
const authored = (description: string): PartOrigin => ({ kind: 'authored', description });
const computed = (description: string): PartOrigin => ({ kind: 'computed', description });

export function instantiateReply(): CandidateReply {
  const reply = withFixtureOrigins({
    schema: 'marginalia.reply.v1',
    intent: 'instantiate',
    status: 'complete',
    title: 'Samples per tray',
    summary: 'A worked arithmetic example using the quantities in the passage.',
    sourceBindings: [{ name: 'carton-quantities', meaning: 'The carton, sample, and tray quantities', relation: 'quoted', selector: { exact: instantiateSource } }],
    parameters: [
      { name: 'samples', label: 'samples', default: 24, min: 0, max: 48, unit: 'samples' },
      { name: 'trays', label: 'trays', default: 6, min: 0, max: 12, unit: 'trays' },
    ],
    assumptions: [{ id: 'equal-groups', text: 'Each tray receives an equal whole or fractional share.', editable: false }],
    limitations: ['This arithmetic example does not establish how the samples were measured.'],
    blocks: [
      { id: 'setup', type: 'text', md: 'Use the passage quantities as the starting values: 24 samples and 6 trays.' },
      { id: 'working', type: 'steps', steps: [
        { id: 'identify', text: 'Identify the two captured quantities: 24 samples and 6 trays.' },
        { id: 'divide', text: 'Divide the total by the number of equal groups.', tex: '\\frac{24}{6}=4' },
      ] },
      { id: 'values', type: 'table', columns: [
        { key: 'quantity', label: 'Quantity' }, { key: 'value', label: 'Value' }, { key: 'unit', label: 'Unit' },
      ], rows: [
        { quantity: 'Total', value: 24, unit: 'samples' },
        { quantity: 'Groups', value: 6, unit: 'trays' },
        { quantity: 'Per group', value: 4, unit: 'samples per tray' },
      ] },
      { id: 'per-tray', type: 'derived', name: 'perTray', expression: 'samples / trays', unit: 'samples', label: 'Samples per tray' },
    ],
    checks: [],
    staticFallback: 'Twenty-four samples divided among six trays gives four samples per tray.',
  });
  const origins = reply.origins!.parts;
  origins['/sourceBindings/0'] = { kind: 'source-page', binding: 'carton-quantities' };
  origins['/blocks/0'] = authored('A restatement of the captured quantities for the worked example.');
  origins['/blocks/1'] = authored('An authored sequence for the arithmetic example.');
  origins['/blocks/1/steps/0'] = authored('The starting values are restated from the captured passage.');
  origins['/blocks/1/steps/1'] = computed('Arithmetic division of the stated quantities.');
  origins['/blocks/2'] = authored('A tabular presentation of the worked example.');
  origins['/blocks/2/rows/2/value'] = computed('The quotient of 24 and 6.');
  origins['/blocks/3'] = computed('A bounded local expression using the declared inputs.');
  return reply;
}
