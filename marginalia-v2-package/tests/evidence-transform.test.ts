import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicHttpUrl, reconcileEvidence, type EvidenceObservations } from '../daemon/transforms/evidence/reconcile.ts';
import type { CandidateReply, CitationsBlock } from '../contracts/reply.ts';
import type { FetchedResourceRecord } from '../contracts/consent.ts';

/** All data here is a labelled unit fixture. It is not a real acceptance journey. */
const BOUND = { id: 'sv-1', hash: 'hash-1', capturedAt: '2026-09-10T00:00:00.000Z' } as const;

function reply(entries: CitationsBlock['entries']): CandidateReply {
  const block: CitationsBlock = { id: 'c1', type: 'citations', entries };
  return {
    schema: 'marginalia.reply.v1', intent: 'evidence', status: 'complete',
    title: 'Fixture evidence reply', summary: 'Fixture only.',
    sourceBindings: [], parameters: [], assumptions: [], limitations: [],
    blocks: [block], checks: [], staticFallback: 'Fixture.',
  };
}

function fetched(url: string, outcome: FetchedResourceRecord['outcome'], fetchedAt = '2026-09-15T12:00:00.000Z'): FetchedResourceRecord {
  return {
    requestedUrl: url, finalUrl: url, redirects: [], status: outcome === 'fetched' ? 200 : 403,
    contentType: 'text/html', sha256: outcome === 'fetched' ? 'a'.repeat(64) : null,
    bytes: outcome === 'fetched' ? 1024 : 0, fetchedAt, outcome,
  };
}

function entry(over: Partial<CitationsBlock['entries'][number]>): CitationsBlock['entries'][number] {
  return { id: 'e1', claim: 'A claim.', support: 'Supporting text.', source: 'Source name', date: '2026-01-01', fetched: false, ...over };
}

function open(over: Partial<EvidenceObservations> = {}): EvidenceObservations {
  return { sessionScope: 'open-session', retrievalComplete: true, observed: [], boundSourceVersion: BOUND, ...over };
}

test('a fetch claim binds a retrieval without certifying its support', () => {
  const url = 'https://papers.example.org/a';
  const record = fetched(url, 'fetched');
  const result = reconcileEvidence(reply([entry({ fetched: true, url })]), open({ observed: [record] }));
  assert.equal(result.verdict, 'unverified');
  assert.equal(result.entries[0].attribution, 'observed-fetch');
  assert.equal(result.entries[0].fetchedObserved, true);
  assert.equal(result.entries[0].record?.sha256, record.sha256);
  assert.equal(result.entries[0].dates.retrievalDate, record.fetchedAt);
  assert.equal(result.entries[0].dates.claimedSourceDateVerified, false);
  assert.equal(result.headline, null);
  assert.equal(result.entries[0].citationUrlMatch, 'both');
});

test('citation matching rejects private and credential-bearing hosts even when a record is supplied', () => {
  for (const url of ['https://127.0.0.1/private', 'https://[::1]/private', 'https://user:pass@example.org/private']) {
    const result = reconcileEvidence(reply([entry({ fetched: true, url })]), open({ observed: [fetched(url, 'fetched')] }));
    assert.equal(result.entries[0].attribution, 'unsupported-fetch-claim');
    assert.equal(result.entries[0].fetchedObserved, false);
    assert.equal(result.verdict, 'insufficient');
  }
});

test('rejects benchmark IPv4 ranges in direct and IPv4-mapped IPv6 URLs without overblocking public neighbors', () => {
  for (const url of [
    'https://198.18.0.1/private',
    'https://198.19.255.255/private',
    'https://[::ffff:198.18.0.1]/private',
    'https://[::ffff:198.19.255.255]/private',
  ]) {
    assert.equal(isPublicHttpUrl(url), false, url);
  }
  for (const url of [
    'https://198.1.18.1/public',
    'https://[::ffff:198.1.18.1]/public',
  ]) {
    assert.equal(isPublicHttpUrl(url), true, url);
  }
});

test('a forged fetch claim with no matching record is neutralized to unsupported', () => {
  const result = reconcileEvidence(reply([entry({ fetched: true, url: 'https://papers.example.org/missing' })]), open({ observed: [fetched('https://papers.example.org/other', 'fetched')] }));
  assert.equal(result.entries[0].attribution, 'unsupported-fetch-claim');
  assert.equal(result.entries[0].fetchedObserved, false);
  assert.equal(result.verdict, 'insufficient');
  assert.ok(result.issues.some((i) => i.includes('unattributable')));
});

test('a fetch claim matching a rejected retrieval yields no support and states the outcome', () => {
  const url = 'https://papers.example.org/blocked';
  const result = reconcileEvidence(reply([entry({ fetched: true, url })]), open({ observed: [fetched(url, 'rejected')] }));
  assert.equal(result.entries[0].attribution, 'unsupported-fetch-claim');
  assert.equal(result.entries[0].record?.outcome, 'rejected');
  assert.equal(result.verdict, 'insufficient');
});

test('a cancelled host retrieval is reported honestly and grants no support', () => {
  const url = 'https://papers.example.org/cancelled';
  const result = reconcileEvidence(reply([entry({ fetched: true, url })]), open({ observed: [fetched(url, 'cancelled')] }));
  assert.equal(result.entries[0].attribution, 'unsupported-fetch-claim');
  assert.ok(result.entries[0].notes.some((n) => n.includes('cancelled')));
});

test('an incomplete retrieval log withholds the headline and marks the claim unresolved', () => {
  const url = 'https://papers.example.org/a';
  const result = reconcileEvidence(reply([entry({ fetched: true, url })]), open({ observed: [fetched(url, 'fetched')], retrievalComplete: false }));
  assert.equal(result.entries[0].attribution, 'unresolved');
  assert.equal(result.entries[0].fetchedObserved, true);
  assert.equal(result.headline, null);
  assert.equal(result.verdict, 'insufficient');
});

test('a stale source binding withholds the headline even when the fetch is observed', () => {
  const url = 'https://papers.example.org/a';
  const result = reconcileEvidence(reply([entry({ fetched: true, url })]), open({
    observed: [fetched(url, 'fetched')],
    currentSourceVersion: { id: 'sv-2', hash: 'hash-2', capturedAt: null },
  }));
  assert.equal(result.sourceStale, true);
  assert.equal(result.entries[0].attribution, 'unresolved');
  assert.equal(result.headline, null);
  assert.ok(result.issues.includes('source-version-changed-since-generation'));
});

test('author-supplied support with no fetch claim is preserved but is not evidence', () => {
  const result = reconcileEvidence(reply([entry({ fetched: false })]), open());
  assert.equal(result.entries[0].attribution, 'author-supplied');
  assert.equal(result.entries[0].dates.retrievalDate, null);
  assert.equal(result.verdict, 'insufficient');
  assert.equal(result.issues.length, 0);
});

test('no citations block abstains rather than inventing support', () => {
  const bare: CandidateReply = { ...reply([]), blocks: [{ id: 't', type: 'text', md: 'No sources.' }] };
  const result = reconcileEvidence(bare, open());
  assert.equal(result.verdict, 'insufficient');
  assert.equal(result.entries.length, 0);
  assert.match(result.reason, /No citations/);
});

test('a closed session that produced retrieval records is refused as a confinement break', () => {
  const url = 'https://papers.example.org/a';
  const result = reconcileEvidence(reply([entry({ fetched: true, url })]), open({ sessionScope: 'cloud-inference', observed: [fetched(url, 'fetched')] }));
  assert.equal(result.verdict, 'refused');
  assert.ok(result.issues.includes('closed-session-produced-retrieval-records'));
});

test('a fetch claimed inside a closed session with no retrieval is unsupported, not refused', () => {
  const result = reconcileEvidence(reply([entry({ fetched: true, url: 'https://papers.example.org/a' })]), open({ sessionScope: 'cloud-inference', observed: [] }));
  assert.equal(result.verdict, 'insufficient');
  assert.equal(result.entries[0].attribution, 'unsupported-fetch-claim');
  assert.ok(result.issues.some((i) => i.includes('closed session')));
});

test('two citations may refer to one fetched resource and each keeps its attribution', () => {
  const url = 'https://papers.example.org/shared';
  const result = reconcileEvidence(reply([
    entry({ id: 'e1', fetched: true, url }),
    entry({ id: 'e2', fetched: true, url }),
  ]), open({ observed: [fetched(url, 'fetched')] }));
  assert.equal(result.observedFetchCount, 2);
  assert.equal(result.verdict, 'unverified');
});

test('a mix of observed and forged fetch claims preserves retrieval facts and flags the forged one', () => {
  const good = 'https://papers.example.org/real';
  const result = reconcileEvidence(reply([
    entry({ id: 'e1', fetched: true, url: good }),
    entry({ id: 'e2', fetched: true, url: 'https://papers.example.org/ghost' }),
  ]), open({ observed: [fetched(good, 'fetched')] }));
  assert.equal(result.verdict, 'unverified');
  assert.equal(result.observedFetchCount, 1);
  assert.equal(result.entries[1].attribution, 'unsupported-fetch-claim');
  assert.equal(result.headline, null);
});

test('contradictory source prose cannot turn retrieval into semantic support', () => {
  const url = 'https://journals.example.org/retraction';
  const result = reconcileEvidence(reply([entry({ claim: 'The treatment works.', support: 'The trial was retracted and found no effect.', fetched: true, url })]), open({ observed: [fetched(url, 'fetched')] }));
  assert.equal(result.verdict, 'unverified');
  assert.equal(result.headline, null);
  assert.equal(result.entries[0].textVerified, false);
  assert.equal(result.observedFetchCount, 1);
});

test('a redirect records requested and final resource attribution separately', () => {
  const requestedUrl = 'https://archive.example.org/old-study';
  const finalUrl = 'https://archive.example.org/correction';
  const record = { ...fetched(requestedUrl, 'fetched'), finalUrl, redirects: [{ url: requestedUrl, status: 302, location: finalUrl }] };
  const fromRequest = reconcileEvidence(reply([entry({ fetched: true, url: requestedUrl })]), open({ observed: [record] }));
  assert.equal(fromRequest.entries[0].citationUrlMatch, 'requested');
  assert.equal(fromRequest.entries[0].record?.finalUrl, finalUrl);
  assert.ok(fromRequest.entries[0].notes.some((note) => note.includes(finalUrl)));
  assert.equal(fromRequest.headline, null);
  const fromFinal = reconcileEvidence(reply([entry({ fetched: true, url: finalUrl })]), open({ observed: [record] }));
  assert.equal(fromFinal.entries[0].citationUrlMatch, 'final');
  assert.equal(fromFinal.entries[0].record?.requestedUrl, requestedUrl);
});

test('a partial reply keeps fetch accounting but cannot get a final verdict', () => {
  const url = 'https://papers.example.org/draft';
  const result = reconcileEvidence({ ...reply([entry({ fetched: true, url })]), status: 'partial' }, open({ observed: [fetched(url, 'fetched')] }));
  assert.equal(result.replyStatus, 'partial');
  assert.equal(result.entries[0].attribution, 'observed-fetch');
  assert.equal(result.observedFetchCount, 1);
  assert.equal(result.verdict, 'insufficient');
  assert.equal(result.headline, null);
});

test('the reconciliation is deterministic for the same inputs', () => {
  const url = 'https://papers.example.org/a';
  const build = () => reconcileEvidence(reply([entry({ fetched: true, url })]), open({ observed: [fetched(url, 'fetched')] }));
  assert.deepEqual(build(), build());
});


function quotedFixture() {
  const candidate = reply([entry({ support: 'Exact passage.', source: 'Current page' })]);
  candidate.sourceBindings = [{ name: 'passage', meaning: 'The cited passage', relation: 'quoted', selector: { exact: 'Exact passage.' } }];
  candidate.origins = { version: 1, parts: { '/blocks/0/entries/0/support': { kind: 'source-page', binding: 'passage' } } };
  return candidate;
}

test('local quote receipt requires a unique exact quoted support origin and preserves unverified claim support', () => {
  const candidate = quotedFixture();
  const observations = open({ boundSourceText: 'Before Exact passage. After', boundSourceUrl: 'https://source.example/page', retrievalComplete: false });
  const result = reconcileEvidence(candidate, observations);
  assert.deepEqual(result.entries[0].sourceQuote, { start: 7, end: 21 });
  assert.equal(result.entries[0].blockId, 'c1');
  assert.equal(result.entries[0].textVerified, false);
  assert.equal(result.headline, null);
  assert.equal(result.retrievalComplete, false);
  for (const mutate of [
    (r: CandidateReply) => { r.sourceBindings[0].relation = 'interpreted'; },
    (r: CandidateReply) => { r.origins = undefined; },
    (r: CandidateReply) => { r.status = 'partial'; },
    (r: CandidateReply) => { (r.blocks[0] as CitationsBlock).entries[0].fetched = true; },
    (r: CandidateReply) => { (r.blocks[0] as CitationsBlock).entries[0].url = 'https://other.example/page'; },
  ]) {
    const changed = structuredClone(candidate); mutate(changed);
    assert.equal(reconcileEvidence(changed, observations).entries[0].sourceQuote, null);
  }
  assert.equal(reconcileEvidence(candidate, { ...observations, boundSourceText: 'Different passage.' }).entries[0].sourceQuote, null);
  assert.equal(reconcileEvidence(candidate, { ...observations, currentSourceVersion: { ...BOUND, id: 'different' } }).entries[0].sourceQuote, null);
});

test('quote receipt refuses ambiguous containment and uses selector context to resolve it', () => {
  const candidate = quotedFixture();
  const observations = open({ boundSourceText: 'First Exact passage. Second Exact passage.' });
  assert.equal(reconcileEvidence(candidate, observations).entries[0].sourceQuote, null);
  candidate.sourceBindings[0].selector.prefix = 'Second ';
  assert.deepEqual(reconcileEvidence(candidate, observations).entries[0].sourceQuote, { start: 28, end: 42 });
});

test('identical entry IDs in different blocks keep separate quote attribution', () => {
  const candidate = quotedFixture();
  candidate.blocks.push({ id: 'c2', type: 'citations', entries: [entry({ support: 'Exact passage.' })] });
  const result = reconcileEvidence(candidate, open({ boundSourceText: 'Exact passage.' }));
  assert.deepEqual(result.entries.map(value => [value.blockId, value.id, value.sourceQuote]), [
    ['c1', 'e1', { start: 0, end: 14 }], ['c2', 'e1', null],
  ]);
});
