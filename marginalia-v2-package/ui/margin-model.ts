import { attachQuote, type QuoteAnchor, type SourceCapture, type Thread } from '../contracts/reader.ts';
import type { JobSnapshot } from '../contracts/jobs.ts';
import { findLiteralDefinitionEvidence, type LiteralDefinitionEvidence } from '../extension/lib/auto-assist/scorer.ts';

/** Handoff is evidence of a possible send, never proof of remote delivery. */
export function egressRecord(job: JobSnapshot) {
  const handedOff = job.attempts.some(a => a.handoffMarked || a.dispatchClaimed || a.providerHandle);
  const unsent = !handedOff && ['queued', 'preparing', 'cancelled', 'failed'].includes(job.state);
  const outcomes: Record<JobSnapshot['state'], string> = {
    queued: 'Waiting', preparing: 'Preparing', sending: 'Sending', running: 'Working', validating: 'Checking the reply',
    succeeded: 'Ready', failed: 'Failed', cancelled: 'Cancelled', timed_out: 'Outcome unconfirmed',
    outcome_unknown: 'Outcome unconfirmed', cancel_requested: 'Cancellation requested',
  };
  return {
    summary: unsent ? 'Nothing left this machine. This request never reached the provider handoff.'
      : 'This record describes the reviewed content. Provider handoff does not independently confirm delivery.',
    fields: [
      [unsent ? 'Intended recipient' : 'Recipient', `OpenAI Codex · ${job.provider} · ${job.model}`],
      ['Request recorded', job.createdAt],
      ...job.attempts.filter(a => a.startedAt).map(a => [`Attempt ${a.number} recorded by provider adapter`, a.startedAt!]),
      ['Last updated', job.updatedAt],
      ['Capabilities offered', job.context.outgoing.availableCapabilities.join(', ') || 'None'],
      ['Outcome', outcomes[job.state] + (job.reason ? `. ${job.reason}` : '')],
      ['Reviewed content digest (SHA-256)', job.preparedPayloadDigest || 'Not recorded'],
    ],
    retention: 'The full reviewed text is no longer stored in the request record. Its stored digest is shown above; the retained reading packet is shown below.',
    packet: job.context.outgoing,
  };
}

export function anchorAt(text: string, start: number, end: number): QuoteAnchor {
  return { exact: text.slice(start, end), start, end, prefix: text.slice(Math.max(0, start - 40), start), suffix: text.slice(end, end + 40) };
}
export function readingAnchorAt(text: string, position: number): QuoteAnchor | undefined {
  if (!text.length) return;
  const start = Math.max(0, Math.min(text.length - 1, position));
  return anchorAt(text, start, Math.min(text.length, start + 120));
}
export function orderedThreads(threads: Thread[], capture: SourceCapture): Thread[] {
  return threads.filter(thread => thread.sourceUrl === capture.url && !thread.deletedAt)
    .sort((a, b) => (displayPosition(a.anchor, capture) ?? Infinity) - (displayPosition(b.anchor, capture) ?? Infinity) || a.anchor.start - b.anchor.start || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export function displayPosition(anchor: QuoteAnchor, capture: SourceCapture): number | undefined {
  if (anchor.kind === 'whole-page') return 0;
  const attached = attachQuote(anchor, capture.text);
  return attached.state === 'exact' || attached.state === 'moved' ? attached.candidates[0]?.start : undefined;
}
export function outgoingPreview(capture: SourceCapture, anchor: QuoteAnchor, question: string, note?: { text: string; revision: number }, context = '') {
  // This is an explicit preview boundary, not an inference endpoint or grant.
  return { recipient: 'Your Codex', scope: 'This question only', page: { url: capture.url, title: capture.title, type: capture.pageType }, anchor: anchor.kind ?? 'quote', passage: anchor.exact, note: note ? { text: note.text, revision: note.revision } : null, question, context };
}
export function sourceLocation(thread: Thread, capture: SourceCapture) { return attachQuote(thread.anchor, capture.text); }

/** A captured-page quote, distinct from any generated definition result. */
export function pageDefinitionEvidence(term: string, text: string): LiteralDefinitionEvidence | undefined {
  return findLiteralDefinitionEvidence(text, term);
}

/** A conservative literal definition. Never invent a gloss or infer it from a paraphrase. */
export function pageDefinition(term: string, text: string): string | undefined {
  return pageDefinitionEvidence(term, text)?.quote;
}
