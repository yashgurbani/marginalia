import type { CandidateReply } from '../contracts/reply.ts';
import { el } from './dom.ts';

/** Keep the existing disclosure and editable controls; empty replies have no header. */
export function assumptionDetails(doc: Document, assumptions: CandidateReply['assumptions']): HTMLDetailsElement {
  const details = el(doc, 'details');
  if (assumptions.length) details.append(el(doc, 'summary', 'Assumes:'));
  return details;
}
