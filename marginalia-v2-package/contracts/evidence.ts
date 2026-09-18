import type { CandidateReply } from './reply.ts';
import type { ConsentScope, FetchedResourceRecord } from './consent.ts';

export const EVIDENCE_TRANSFORM = 'marginalia.transform.evidence.v1' as const;

/** Host-supplied identity of the captured source version a reply was generated against. */
export type BoundSourceVersion = { id: string; hash: string; capturedAt: string | null };

/**
 * Host observations. Never parsed from reply JSON. `observed` are the exact broker records for
 * this attempt. The caller must validate the reply, bind it to the same attempt's egress
 * record and frozen source, and pass the validated final or partial reply distinctly.
 * `retrievalComplete` is the host confinement truth: false means another route
 * could have fetched, so the log is not authoritative and must not be treated as complete.
 */
export type EvidenceRetrieval = {
  sessionScope: ConsentScope;
  retrievalComplete: boolean;
  observed: readonly FetchedResourceRecord[];
};

export type EvidenceObservations = EvidenceRetrieval & {
  boundSourceVersion: BoundSourceVersion;
  /** Immutable host capture, never candidate-supplied source text. */
  boundSourceText?: string;
  boundSourceUrl?: string;
  /** When present and different from the bound version, the claim binding is stale. */
  currentSourceVersion?: BoundSourceVersion;
};

export type CitationAttribution =
  | 'observed-fetch'          // fetch claimed and a real fetched record matches the URL
  | 'author-supplied'         // support offered with no fetch claim: reasoning or local context
  | 'unsupported-fetch-claim' // fetch claimed but no fetched record backs it
  | 'unresolved';             // fetch observed, but the log is incomplete or the source is stale

export type EvidenceDates = {
  /** The publication date the model declared. The host cannot verify it from a fetch. */
  claimedSourceDate: string;
  claimedSourceDateVerified: false;
  /** The date the host observed the fetch, or null when no fetch was observed. */
  retrievalDate: string | null;
};

export type EvidenceEntryAssessment = {
  blockId: string;
  id: string;
  /** Exact quotation in the immutable page; does not assess semantic support. */
  sourceQuote: { start: number; end: number } | null;
  claim: string;
  support: string;
  source: string;
  dates: EvidenceDates;
  fetchedClaimed: boolean;
  fetchedObserved: boolean;
  attribution: CitationAttribution;
  /** The bound observed record when a fetch resolves; null otherwise. */
  record: FetchedResourceRecord | null;
  /** Which broker URL matched the model's citation; a redirect may yield a different resource. */
  citationUrlMatch: 'requested' | 'final' | 'both' | null;
  /** Page-text containment ("the fetched page contains the attributed text") is a separate step. */
  textVerified: false;
  notes: readonly string[];
};

export type EvidenceVerdict = 'unverified' | 'insufficient' | 'refused';

export type EvidenceAssessment = {
  transform: typeof EVIDENCE_TRANSFORM;
  verdict: EvidenceVerdict;
  replyStatus: CandidateReply['status'];
  reason: string;
  sessionScope: ConsentScope;
  retrievalComplete: boolean;
  sourceStale: boolean;
  boundSourceVersion: BoundSourceVersion;
  entries: readonly EvidenceEntryAssessment[];
  observedFetchCount: number;
  /** Semantic headline is withheld: a retrieved URL cannot verify a claim. */
  headline: string | null;
  issues: readonly string[];
};

