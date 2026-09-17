import type { CandidateReply, CitationsBlock } from '../../../contracts/reply.ts';
import type { ConsentScope, FetchedResourceRecord } from '../../../contracts/consent.ts';

/**
 * T14 Evidence host reconciliation.
 *
 * The model authors a `citations` block: claim, support, source, a declared date and a
 * self-reported `fetched` flag. That flag is a model claim, not proof. This module is the
 * host-authority layer (the same shape as contracts/host-checks.ts for classifications): it
 * binds each claim to the exact broker retrieval records the host observed, decides which
 * claims resolve to a real fetch, and withholds the evidence headline when nothing does.
 *
 * It performs no IO. Retrieval already happened in the trusted daemon through
 * daemon/retrieval/broker.ts; the caller passes the observed records here. A plausible URL or
 * a model citation is never accepted as a fetched source.
 */

export const EVIDENCE_TRANSFORM = 'marginalia.transform.evidence.v1' as const;

/** Host-supplied identity of the captured source version a reply was generated against. */
export type BoundSourceVersion = { id: string; hash: string; capturedAt: string | null };

/**
 * Host observations. Never parsed from reply JSON. `observed` are the exact broker records for
 * this session. `retrievalComplete` is the host confinement truth: false means another route
 * could have fetched, so the log is not authoritative and must not be treated as complete.
 */
export type EvidenceObservations = {
  sessionScope: ConsentScope;
  retrievalComplete: boolean;
  observed: readonly FetchedResourceRecord[];
  boundSourceVersion: BoundSourceVersion;
  /** When present and different from the bound version, the claim binding is stale. */
  currentSourceVersion?: BoundSourceVersion;
};

export type CitationAttribution =
  | 'observed-fetch'          // fetch claimed and a real fetched record backs the URL
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
  id: string;
  claim: string;
  support: string;
  source: string;
  dates: EvidenceDates;
  fetchedClaimed: boolean;
  fetchedObserved: boolean;
  attribution: CitationAttribution;
  /** The bound observed record when a fetch resolves; null otherwise. */
  record: FetchedResourceRecord | null;
  /** Page-text containment ("the fetched page contains the attributed text") is a separate step. */
  textVerified: false;
  notes: readonly string[];
};

export type EvidenceVerdict = 'supported' | 'insufficient' | 'refused';

export type EvidenceAssessment = {
  transform: typeof EVIDENCE_TRANSFORM;
  verdict: EvidenceVerdict;
  reason: string;
  sessionScope: ConsentScope;
  retrievalComplete: boolean;
  sourceStale: boolean;
  boundSourceVersion: BoundSourceVersion;
  entries: readonly EvidenceEntryAssessment[];
  observedFetchCount: number;
  /** Host-authority summary. Null (withheld) unless at least one claim resolves to a fetch. */
  headline: string | null;
  issues: readonly string[];
};

/** Canonical origin+path+query with a lowercased host, or null when the URL is unusable. */
function normalizeUrl(input: string | undefined): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 8192) return null;
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}${url.pathname}${url.search}`;
}

/** Find the observed record whose requested or final URL matches, preferring a fetched outcome. */
function matchRecord(url: string | undefined, observed: readonly FetchedResourceRecord[]): FetchedResourceRecord | null {
  const target = normalizeUrl(url);
  if (target === null) return null;
  let fallback: FetchedResourceRecord | null = null;
  for (const record of observed) {
    if (normalizeUrl(record.requestedUrl) === target || normalizeUrl(record.finalUrl) === target) {
      if (record.outcome === 'fetched') return record;
      if (fallback === null) fallback = record;
    }
  }
  return fallback;
}

function citationEntries(reply: CandidateReply): CitationsBlock['entries'] {
  const entries: CitationsBlock['entries'] = [];
  for (const block of reply.blocks) if (block.type === 'citations') entries.push(...block.entries);
  return entries;
}

/**
 * Reconcile an evidence reply against observed host retrieval. Pure and deterministic:
 * the same reply and observations always yield the same assessment.
 */
export function reconcileEvidence(reply: CandidateReply, observations: EvidenceObservations): EvidenceAssessment {
  const issues: string[] = [];
  const scope = observations.sessionScope;
  const closed = scope === 'cloud-inference';
  const current = observations.currentSourceVersion;
  const sourceStale = current !== undefined &&
    (current.id !== observations.boundSourceVersion.id || current.hash !== observations.boundSourceVersion.hash);
  if (sourceStale) issues.push('source-version-changed-since-generation');

  const entries = citationEntries(reply);
  const assessed: EvidenceEntryAssessment[] = entries.map((entry) => {
    const notes: string[] = [];
    const claimed = entry.fetched === true;
    let attribution: CitationAttribution = 'author-supplied';
    let record: FetchedResourceRecord | null = null;
    let fetchedObserved = false;

    if (!claimed) {
      notes.push('Offered as reasoning or local context, not a host-fetched source.');
    } else if (closed) {
      attribution = 'unsupported-fetch-claim';
      notes.push('A closed session cannot fetch, so this fetch claim is not host-observed.');
      issues.push(`entry ${entry.id}: fetch claimed inside a closed session`);
    } else {
      const matched = matchRecord(entry.url, observations.observed);
      if (matched === null) {
        attribution = 'unsupported-fetch-claim';
        notes.push(entry.url
          ? 'No observed retrieval record matches this URL. A cited URL is not a fetched source.'
          : 'No URL was supplied, so no retrieval record can back this fetch claim.');
        issues.push(`entry ${entry.id}: unattributable fetch claim`);
      } else if (matched.outcome !== 'fetched') {
        attribution = 'unsupported-fetch-claim';
        record = matched;
        notes.push(`The retrieval for this URL ended as "${matched.outcome}", so it produced no source bytes.`);
        issues.push(`entry ${entry.id}: retrieval outcome was ${matched.outcome}`);
      } else {
        record = matched;
        fetchedObserved = true;
        if (!observations.retrievalComplete) {
          attribution = 'unresolved';
          notes.push('The retrieval log is incomplete, so this fetch cannot be certified as the whole story.');
        } else if (sourceStale) {
          attribution = 'unresolved';
          notes.push('The source version changed since generation, so this binding is stale.');
        } else {
          attribution = 'observed-fetch';
        }
      }
    }

    const dates: EvidenceDates = {
      claimedSourceDate: entry.date,
      claimedSourceDateVerified: false,
      retrievalDate: record !== null && record.outcome === 'fetched' ? record.fetchedAt : null,
    };

    return {
      id: entry.id,
      claim: entry.claim,
      support: entry.support,
      source: entry.source,
      dates,
      fetchedClaimed: claimed,
      fetchedObserved,
      attribution,
      record,
      textVerified: false,
      notes,
    };
  });

  const observedFetchCount = assessed.filter((entry) => entry.attribution === 'observed-fetch').length;

  let verdict: EvidenceVerdict;
  let reason: string;
  let headline: string | null = null;

  if (closed && observations.observed.length > 0) {
    verdict = 'refused';
    reason = 'A closed session must perform no retrieval, but retrieval records were observed for it.';
    issues.push('closed-session-produced-retrieval-records');
  } else if (assessed.length === 0) {
    verdict = 'insufficient';
    reason = 'No citations were offered, so there is no attributable support.';
  } else if (observedFetchCount > 0) {
    verdict = 'supported';
    reason = 'At least one claim resolves to an observed host retrieval.';
    headline = `${observedFetchCount} of ${assessed.length} claim(s) resolve to an observed retrieval.`;
  } else {
    verdict = 'insufficient';
    reason = 'No claim resolves to an observed host retrieval; support is author-supplied, incomplete or unattributable.';
  }

  return {
    transform: EVIDENCE_TRANSFORM,
    verdict,
    reason,
    sessionScope: scope,
    retrievalComplete: observations.retrievalComplete,
    sourceStale,
    boundSourceVersion: observations.boundSourceVersion,
    entries: assessed,
    observedFetchCount,
    headline,
    issues,
  };
}
