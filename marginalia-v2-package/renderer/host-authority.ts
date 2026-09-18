import { assessShelf, type ExploreAssessment } from '../contracts/explore.ts';
import { canonicalReplyData, type CandidateReply, type IndependentCheckResult, type ReplyParameterState } from '../contracts/reply.ts';
import type { ClassificationView, HostCheckReport } from '../contracts/host-checks.ts';

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalReplyData(value));
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Verifies a report received through a trusted host boundary; never seals a report.
 * Digests bind content, not sender identity. Host transport authenticates the sender.
 * Browser runtime deliberately has no import of the host's node:crypto implementation.
 */
export async function classificationsFromHost(
  reply: CandidateReply,
  parameters: ReplyParameterState,
  localChecks: IndependentCheckResult[],
  report?: HostCheckReport,
): Promise<ClassificationView[]> {
  let bound = false;
  try {
    if (report?.schema === 'marginalia.host-report.v1' && report.checkVersion === 'host-checks.v1' && Array.isArray(report.results)) {
      const [replyDigest, parameterDigest] = await Promise.all([digest(reply), digest(parameters)]);
      bound = report.replyDigest === replyDigest && report.parameterDigest === parameterDigest;
    }
  } catch { /* Missing WebCrypto or malformed data withholds authority. */ }
  return reply.blocks.filter(block => block.type === 'classification').map(block => {
    const withheld = (reason: string): ClassificationView => ({ blockId: block.id, state: 'withheld', reason });
    if (!block.headline) return withheld('This classification is not declared as a headline.');
    if (reply.status !== 'complete') return withheld('This reply is still provisional.');
    if (!bound) return withheld('No current host report is bound to this reply and parameter state.');
    const local = localChecks.find(check => check.requestId === block.check && check.model === block.model && check.classification === block.id);
    const host = report!.results.find(check => check && typeof check === 'object' && check.requestId === block.check && check.model === block.model && check.classification === block.id);
    if (!local || local.status !== 'pass' || !local.headline || !host || host.status !== 'pass' || host.criterion !== local.criterion || host.headline !== local.headline) return withheld(local?.reason ?? 'The host result and supported local criterion do not agree.');
    try {
      if (!host.outcome || canonicalReplyData(host.outcome) !== canonicalReplyData(local.outcome)) return withheld('The host result does not match the independently calculated current outcome.');
    } catch { return withheld('The host outcome is malformed.'); }
    return { blockId: block.id, state: 'verified', label: host.headline };
  });
}


/** Receipt keys include the block because entry identifiers are local to each block. */
export const citationReceiptKey = (blockId: string, entryId: string) => JSON.stringify([blockId, entryId]);

/** Local source containment only. Missing or malformed host receipts remain unverified. */
export async function citationQuotesFromHost(reply: CandidateReply, sourceText: string, report?: HostCheckReport): Promise<ReadonlySet<string>> {
  const quoted = new Set<string>();
  try {
    const evidence = report?.evidence;
    if (reply.intent !== 'evidence' || reply.status !== 'complete' || report?.schema !== 'marginalia.host-report.v1' || report.checkVersion !== 'host-checks.v1' ||
      evidence?.transform !== 'marginalia.transform.evidence.v1' || evidence.replyStatus !== 'complete' || evidence.sourceStale !== false ||
      evidence.headline !== null || !['unverified', 'insufficient'].includes(evidence.verdict) || !Array.isArray(evidence.entries)) return quoted;
    const [replyHash, sourceBytes] = await Promise.all([digest(reply), globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceText))]);
    const sourceHash = Array.from(new Uint8Array(sourceBytes), byte => byte.toString(16).padStart(2, '0')).join('');
    if (replyHash !== report.replyDigest || sourceHash !== evidence.boundSourceVersion?.hash) return quoted;
    for (const block of reply.blocks) {
      if (block.type !== 'citations') continue;
      for (const citation of block.entries) {
        const matches = evidence.entries.filter(value => value?.blockId === block.id && value.id === citation.id);
        if (matches.length !== 1) continue;
        const receipt = matches[0], quote = receipt.sourceQuote;
        if (!quote || receipt.claim !== citation.claim || receipt.support !== citation.support || receipt.source !== citation.source ||
          receipt.dates?.claimedSourceDate !== citation.date || receipt.fetchedClaimed !== false || citation.fetched ||
          receipt.attribution !== 'author-supplied' || receipt.textVerified !== false || !citation.support.trim() ||
          !Number.isSafeInteger(quote.start) || !Number.isSafeInteger(quote.end) || quote.start < 0 || quote.end > sourceText.length || quote.end <= quote.start ||
          sourceText.slice(quote.start, quote.end) !== citation.support) continue;
        const blockIndex = reply.blocks.indexOf(block), entryIndex = block.entries.indexOf(citation);
        const origin = reply.origins?.parts[`/blocks/${blockIndex}/entries/${entryIndex}/support`];
        if (origin?.kind !== 'source-page') continue;
        const binding = reply.sourceBindings.find(value => value.name === origin.binding);
        if (binding?.relation !== 'quoted' || binding.selector.exact !== citation.support ||
          !sourceText.slice(0, quote.start).endsWith(binding.selector.prefix ?? '') ||
          !sourceText.slice(quote.end).startsWith(binding.selector.suffix ?? '')) continue;
        quoted.add(citationReceiptKey(block.id, citation.id));
      }
    }
  } catch { /* A failed host/content binding leaves all citation labels unverified. */ return new Set(); }
  return quoted;
}


/** Recompute the pure navigation policy against the saved candidate, without opening it. */
export async function shelfFromHost(reply: CandidateReply, sourceText: string, report?: HostCheckReport): Promise<ExploreAssessment | undefined> {
  try {
    const assessment = report?.explore;
    if (reply.intent !== 'explore' || reply.status !== 'complete' || report?.schema !== 'marginalia.host-report.v1' || report.checkVersion !== 'host-checks.v1' ||
      !assessment?.returnTo.threadId || !assessment.returnTo.sourceHash || !assessment.returnTo.sourceVersionId || assessment.parked !== true) return;
    const [replyHash, bytes] = await Promise.all([digest(reply), globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceText))]);
    const sourceHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    if (report.replyDigest !== replyHash || assessment.returnTo.sourceHash !== sourceHash) return;
    const expected = assessShelf(reply, { sessionScope: assessment.sessionScope, returnTo: assessment.returnTo });
    if (canonicalReplyData(assessment) !== canonicalReplyData(expected)) return;
    return structuredClone(assessment);
  } catch { return undefined; }
}
