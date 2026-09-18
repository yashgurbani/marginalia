import type { ExploreAssessment } from './explore.ts';
import type { EvidenceAssessment } from './evidence.ts';
import { createHash } from 'node:crypto';
import {
  canonicalReplyData,
  computeIndependentChecks,
  type CandidateReply,
  type ClassificationBlock,
  type IndependentCheckResult,
  type ReplyParameterState,
} from './reply.ts';

export const HOST_CHECK_VERSION = 'host-checks.v1' as const;
export const HOST_REPORT_SCHEMA = 'marginalia.host-report.v1' as const;

export type ParameterState = ReplyParameterState;
export type HostCheckResult = IndependentCheckResult;
export type HostCheckReport = {
  schema: typeof HOST_REPORT_SCHEMA;
  checkVersion: typeof HOST_CHECK_VERSION;
  replyDigest: string;
  parameterDigest: string;
  results: HostCheckResult[];
  /** Durable host reconciliation, absent on older saved replies. */
  evidence?: EvidenceAssessment;
  explore?: ExploreAssessment;
};

export type ClassificationView = {
  blockId: string;
  state: 'verified' | 'withheld';
  label?: string;
  reason?: string;
};

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalReplyData(value)).digest('hex');
}

export function digestReply(reply: CandidateReply): string {
  return sha256(reply);
}

export function digestParameterState(parameters: ParameterState): string {
  return sha256(parameters);
}

/** Host-only sealing step around the browser-safe independent computation. */
export function runHostChecks(reply: CandidateReply, parameters: ParameterState): HostCheckReport {
  return {
    schema: HOST_REPORT_SCHEMA,
    checkVersion: HOST_CHECK_VERSION,
    replyDigest: digestReply(reply),
    parameterDigest: digestParameterState(parameters),
    results: computeIndependentChecks(reply, parameters),
  };
}

export function hostReportMatches(reply: CandidateReply, parameters: ParameterState, report: HostCheckReport): boolean {
  return report.schema === HOST_REPORT_SCHEMA && report.checkVersion === HOST_CHECK_VERSION &&
    report.replyDigest === digestReply(reply) && report.parameterDigest === digestParameterState(parameters);
}

/**
 * Returns render authority for classification headlines. A missing, failed,
 * unsupported, stale or mismatched check withholds the headline.
 */
export function classificationViews(reply: CandidateReply, parameters: ParameterState, report?: HostCheckReport): ClassificationView[] {
  const bound = report !== undefined && hostReportMatches(reply, parameters, report);
  const local = computeIndependentChecks(reply, parameters);
  return reply.blocks.filter((block): block is ClassificationBlock => block.type === 'classification').map((block) => {
    if (!block.headline) return { blockId: block.id, state: 'withheld', reason: 'This classification is not declared as a headline.' };
    if (reply.status !== 'complete') return { blockId: block.id, state: 'withheld', reason: 'This reply is still provisional.' };
    if (!block.check) return { blockId: block.id, state: 'withheld', reason: 'No independent check was requested for this headline.' };
    if (!bound) return { blockId: block.id, state: 'withheld', reason: 'No current host report is bound to this reply and parameter state.' };
    const result = report.results.find((candidate) => candidate.requestId === block.check && candidate.classification === block.id && candidate.model === block.model);
    if (!result) return { blockId: block.id, state: 'withheld', reason: 'The host report has no matching result for this headline.' };
    if (result.status !== 'pass' || !result.headline) return { blockId: block.id, state: 'withheld', reason: result.reason };
    const expected = local.find(check => check.requestId === result.requestId && check.model === block.model && check.classification === block.id);
    if (!expected || expected.status !== 'pass' || !expected.headline || result.criterion !== expected.criterion || result.headline !== expected.headline || !result.outcome || canonicalReplyData(result.outcome) !== canonicalReplyData(expected.outcome)) return { blockId: block.id, state: 'withheld', reason: 'The host result does not match the installed criterion for the shown inputs.' };
    return { blockId: block.id, state: 'verified', label: result.headline };
  });
}
