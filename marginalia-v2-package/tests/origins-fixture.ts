import type { CandidateReply } from '../contracts/reply.ts';
import { replyOriginParts } from '../contracts/reply-origins.ts';

/** Test authors explicitly declare synthetic fixture content. Never imported by
 * production admission and never used to repair provider output. */
export function withFixtureOrigins(reply: CandidateReply): CandidateReply {
  reply.origins = { version: 1, parts: Object.fromEntries(replyOriginParts(reply).map(part => [part.path,
    { kind: 'authored', description: 'Synthetic content authored for this test fixture.' }])) };
  return reply;
}

