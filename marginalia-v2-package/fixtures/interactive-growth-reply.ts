import { growthReply } from './growth-reply.ts';
import { illustrationOrigins } from './illustration-origins.ts';

/** Synthetic test passage. Never present this as a quotation from the public demo page. */
export { growthSourceText as interactiveGrowthSourceText } from './growth-reply.ts';
export const interactiveGrowthReply = structuredClone(growthReply);
interactiveGrowthReply.summary = 'Move damping to see how it changes the rise of this illustrative amplitude.';
interactiveGrowthReply.parameters.forEach((parameter, index) => {
  parameter.sourceBinding = structuredClone(interactiveGrowthReply.sourceBindings[index]);
});
interactiveGrowthReply.assumptions[0] = {
  id: 'bounded-damping', text: 'Damping stays constant during each run. Change its value to compare curves.',
  editable: true, binding: { parameter: 'gamma', min: 0.25, max: 1 },
};
interactiveGrowthReply.staticFallback = 'A scalar illustration compares self-amplifying growth with damping. It does not reproduce the fluid equations or the paper result.';
interactiveGrowthReply.origins = illustrationOrigins(interactiveGrowthReply);
