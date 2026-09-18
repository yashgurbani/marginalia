import type { CandidateReply, PartOrigin, ReplyOrigins } from '../contracts/reply.ts';
import { replyOriginParts } from '../contracts/reply-origins.ts';

/** Authorship declaration for our two built-in scalar illustrations only.
 * This is fixture construction, never a migration or provider-output repair. */
export function illustrationOrigins(reply: CandidateReply): ReplyOrigins {
  const parts: Record<string, PartOrigin> = Object.fromEntries(replyOriginParts(reply).map(part => [part.path,
    { kind: 'authored', description: 'Written for this bounded scalar illustration; not a claim about the source result.' }]));
  reply.sourceBindings.forEach((binding, i) => { parts[`/sourceBindings/${i}`] = { kind: 'source-page', binding: binding.name }; });
  reply.blocks.forEach((block, i) => {
    if (block.type === 'equation' || block.type === 'model') parts[`/blocks/${i}`] = { kind: 'analogy', description: 'An illustrative scalar model, not a reproduction of the source.' };
    if (block.type === 'plot' || block.type === 'derived' || block.type === 'classification') parts[`/blocks/${i}`] = { kind: 'computed', description: 'Uses this illustration’s declared rule and current inputs. Checked conclusions require separate host assessment.' };
  });
  return { version: 1, parts };
}

