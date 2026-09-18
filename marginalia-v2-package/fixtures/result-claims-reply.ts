import { growthReply } from './growth-reply.ts';
import { illustrationOrigins } from './illustration-origins.ts';
import type { CandidateReply } from '../contracts/reply.ts';

export const unsupportedConclusion = 'This model settles at 999 °C.';
/** Deliberately hostile authored copy, never recorded scientific evidence. */
export function resultClaimsReply(typed = false): CandidateReply {
  const reply = structuredClone(growthReply);
  reply.title = unsupportedConclusion;
  reply.summary = unsupportedConclusion;
  reply.blocks.push({ id: 'unsupported-text', type: 'text', md: unsupportedConclusion });
  const classification = reply.blocks.find(block => block.type === 'classification')!;
  if (classification.type === 'classification') classification.labels = { settles: unsupportedConclusion };
  if (typed) reply.resultClaims = [
    { target: 'title', classification: 'growth-classification' },
    { target: 'summary', classification: 'growth-classification' },
    { target: 'text', block: 'unsupported-text', classification: 'growth-classification' },
  ];
  reply.origins = illustrationOrigins(reply);
  return reply;
}
