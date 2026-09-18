import type { CandidateReply } from '../../../contracts/reply.ts';
import type { FetchedResourceRecord } from '../../../contracts/consent.ts';

/**
 * T14 Evidence host reconciliation.
 *
 * The model authors a `citations` block: claim, support, source, a declared date and a
 * self-reported `fetched` flag. That flag is a model claim, not proof. This module is the
 * host reconciliation binds citations to broker retrieval records. It records retrieval
 * facts without deciding whether fetched text supports a claim; the headline is withheld.
 *
 * It performs no IO. Retrieval already happened in the trusted daemon through
 * daemon/retrieval/broker.ts; the caller passes the observed records here. A plausible URL or
 * a model citation is never accepted as a fetched source.
 */

export { EVIDENCE_TRANSFORM } from '../../../contracts/evidence.ts';
export type { BoundSourceVersion, EvidenceRetrieval, EvidenceObservations, CitationAttribution, EvidenceDates, EvidenceEntryAssessment, EvidenceVerdict, EvidenceAssessment } from '../../../contracts/evidence.ts';
import { EVIDENCE_TRANSFORM, type EvidenceObservations, type CitationAttribution, type EvidenceDates, type EvidenceEntryAssessment, type EvidenceVerdict, type EvidenceAssessment } from '../../../contracts/evidence.ts';

function privateIpv4(parts: readonly number[]): boolean {
  const [a, b, c, d] = parts;
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  return a === 0 || a === 10 || a === 127 || a === 192 && b === 168 ||
    a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
    a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19);
}

/** URL supplies canonical bracketed IPv6 hostnames, including mapped IPv4. */
function privateIpv6(host: string): boolean {
  const halves = host.slice(1, -1).split('::');
  const words = (part: string) => part ? part.split(':').map(word => Number.parseInt(word, 16)) : [];
  const left = words(halves[0]);
  const right = halves.length === 2 ? words(halves[1]) : [];
  const address = halves.length === 2 ? [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right] : left;
  if (address.length !== 8 || address.some(word => !Number.isInteger(word) || word < 0 || word > 0xffff)) return true;
  if (address.slice(0, 7).every(word => word === 0) && address[7] <= 1) return true;
  if ((address[0] & 0xfe00) === 0xfc00 || (address[0] & 0xffc0) === 0xfe80) return true;
  if (address.slice(0, 5).every(word => word === 0) && address[5] === 0xffff) {
    return privateIpv4([address[6] >>> 8, address[6] & 255, address[7] >>> 8, address[7] & 255]);
  }
  return false;
}

/** Citation matching is limited to public, credential-free HTTP(S) origins. */
export function isPublicHttpUrl(input: string | undefined): boolean {
  if (typeof input !== 'string' || input.length === 0 || input.length > 8192) return false;
  let url: URL;
  try { url = new URL(input); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  const name = host.replace(/\.$/u, '');
  if (name.length === 0 || name === 'localhost' || name.endsWith('.localhost') ||
      name.endsWith('.local') || name.endsWith('.internal')) return false;
  if (host.startsWith('[')) return !privateIpv6(host);
  if (/^\d+(?:\.\d+){3}$/u.test(host)) return !privateIpv4(host.split('.').map(Number));
  return true;
}

/** Canonical origin+path+query with a lowercased host, or null when the URL is unusable. */
function normalizeUrl(input: string | undefined): string | null {
  if (!isPublicHttpUrl(input)) return null;
  let url: URL;
  try { url = new URL(input as string); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}${url.pathname}${url.search}`;
}

/** Find a broker record and preserve which URL matched, preferring a fetched outcome. */
function matchRecord(url: string | undefined, observed: readonly FetchedResourceRecord[]): { record: FetchedResourceRecord; match: 'requested' | 'final' | 'both' } | null {
  const target = normalizeUrl(url);
  if (target === null) return null;
  let fallback: ReturnType<typeof matchRecord> = null;
  for (const record of observed) {
    const requested = normalizeUrl(record.requestedUrl) === target;
    const final = normalizeUrl(record.finalUrl) === target;
    if (requested || final) {
      const found = { record, match: requested && final ? 'both' : requested ? 'requested' : 'final' } as const;
      if (record.outcome === 'fetched') return found;
      if (fallback === null) fallback = found;
    }
  }
  return fallback;
}

function citationEntries(reply: CandidateReply) {
  return reply.blocks.flatMap((block, blockIndex) => block.type === 'citations'
    ? block.entries.map((entry, entryIndex) => ({ entry, blockId: block.id, blockIndex, entryIndex })) : []);
}

/** A local quotation proves containment only, never the truth of the surrounding claim. */
function sourceQuote(reply: CandidateReply, item: ReturnType<typeof citationEntries>[number], observations: EvidenceObservations, stale: boolean): EvidenceEntryAssessment['sourceQuote'] {
  const { entry, blockIndex, entryIndex } = item;
  const text = observations.boundSourceText;
  if (stale || reply.status !== 'complete' || entry.fetched || !entry.support.trim() || typeof text !== 'string') return null;
  const origin = reply.origins?.parts[`/blocks/${blockIndex}/entries/${entryIndex}/support`];
  if (origin?.kind !== 'source-page') return null;
  const binding = reply.sourceBindings.find(value => value.name === origin.binding);
  if (binding?.relation !== 'quoted' || binding.selector.exact !== entry.support) return null;
  if (entry.url && (normalizeUrl(entry.url) === null || normalizeUrl(entry.url) !== normalizeUrl(observations.boundSourceUrl))) return null;
  const { exact, prefix = '', suffix = '' } = binding.selector;
  let found: EvidenceEntryAssessment['sourceQuote'] = null;
  for (let start = text.indexOf(exact); start >= 0; start = text.indexOf(exact, start + 1)) {
    const end = start + exact.length;
    if (!text.slice(0, start).endsWith(prefix) || !text.slice(end).startsWith(suffix)) continue;
    if (found) return null;
    found = { start, end };
  }
  return found;
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
  const assessed: EvidenceEntryAssessment[] = entries.map((item) => {
    const { entry, blockId } = item;
    const notes: string[] = [];
    const claimed = entry.fetched === true;
    let attribution: CitationAttribution = 'author-supplied';
    let record: FetchedResourceRecord | null = null;
    let citationUrlMatch: EvidenceEntryAssessment['citationUrlMatch'] = null;
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
      } else if (matched.record.outcome !== 'fetched') {
        attribution = 'unsupported-fetch-claim';
        record = matched.record;
        citationUrlMatch = matched.match;
        notes.push(`The retrieval for this URL ended as "${record.outcome}", so it produced no source bytes.`);
        issues.push(`entry ${entry.id}: retrieval outcome was ${record.outcome}`);
      } else {
        record = matched.record;
        citationUrlMatch = matched.match;
        fetchedObserved = true;
        if (matched.match === 'requested') notes.push(`The cited URL was requested, but the fetched resource was ${record.finalUrl}.`);
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
      blockId,
      id: entry.id,
      sourceQuote: sourceQuote(reply, item, observations, sourceStale),
      claim: entry.claim,
      support: entry.support,
      source: entry.source,
      dates,
      fetchedClaimed: claimed,
      fetchedObserved,
      attribution,
      record,
      citationUrlMatch,
      textVerified: false,
      notes,
    };
  });

  const observedFetchCount = assessed.filter((entry) => entry.fetchedObserved).length;

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
  } else if (reply.status === 'partial') {
    verdict = 'insufficient';
    reason = 'This reply is partial. Recorded retrievals do not establish claim support.';
  } else if (assessed.some((entry) => entry.attribution === 'observed-fetch')) {
    verdict = 'unverified';
    reason = 'A cited URL resolves to an observed retrieval, but its text and support for the claim are unverified.';
  } else {
    verdict = 'insufficient';
    reason = 'No complete, current retrieval attribution is available; claim support is unverified.';
  }

  return {
    transform: EVIDENCE_TRANSFORM,
    verdict,
    replyStatus: reply.status,
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
