import type { CandidateReply, PartOrigin } from '../contracts/reply.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

export const deriveSource = 'Subtract the same amount from both sides, then divide both sides by two.';
const authored = (description: string): PartOrigin => ({ kind: 'authored', description });

export function deriveReply(): CandidateReply {
  const reply = withFixtureOrigins({
    schema: 'marginalia.reply.v1',
    intent: 'derive',
    status: 'complete',
    title: 'Follow the stated operations',
    summary: 'The steps unpack the two operations named in the captured sentence.',
    sourceBindings: [
      { name: 'subtract-operation', meaning: 'The subtraction operation', relation: 'quoted', selector: { exact: 'Subtract the same amount from both sides' } },
      { name: 'divide-operation', meaning: 'The division operation', relation: 'quoted', selector: { exact: 'divide both sides by two' } },
    ],
    parameters: [],
    assumptions: [{ id: 'starting-equation', text: 'The starting equation is 2x + 6 = 14 for this authored walkthrough.', editable: false }],
    limitations: ['The selected sentence does not supply a starting equation, so the equation here is illustrative.'],
    blocks: [
      { id: 'scope', type: 'text', md: 'The source names subtraction first and division second. This walkthrough keeps that order.' },
      { id: 'derivation', type: 'steps', steps: [
        { id: 'start', text: 'Start with the illustrative equation.', tex: '2x+6=14' },
        { id: 'subtract', text: 'Apply “Subtract the same amount from both sides” by subtracting 6.', tex: '2x=8' },
        { id: 'divide', text: 'Apply “divide both sides by two” to isolate x.', tex: 'x=4' },
      ] },
    ],
    checks: [],
    staticFallback: 'For 2x + 6 = 14, subtract 6 from both sides and divide both sides by 2 to get x = 4.',
  });
  const origins = reply.origins!.parts;
  origins['/sourceBindings/0'] = { kind: 'source-page', binding: 'subtract-operation' };
  origins['/sourceBindings/1'] = { kind: 'source-page', binding: 'divide-operation' };
  origins['/blocks/0'] = authored('An authored description of the captured operation order.');
  origins['/blocks/1'] = { kind: 'analogy', description: 'An illustrative derivation using an equation absent from the passage.' };
  origins['/blocks/1/steps/0'] = { kind: 'analogy', description: 'The starting equation is supplied only for illustration.' };
  origins['/blocks/1/steps/1'] = { kind: 'computed', description: 'An authored algebraic transformation tied to the subtraction wording.' };
  origins['/blocks/1/steps/2'] = { kind: 'computed', description: 'An authored algebraic transformation tied to the division wording.' };
  return reply;
}
