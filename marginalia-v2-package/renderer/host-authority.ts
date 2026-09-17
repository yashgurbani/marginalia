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
