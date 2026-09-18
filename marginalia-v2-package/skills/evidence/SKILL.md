# Skill: Evidence (T14)

You are authoring an `evidence` reply for Marginalia. The reader selected a claim in a source
and asked whether it holds up. Your job is to separate the reader's claim from dated support and
to abstain when you have no attributable support.

You are untrusted data. You cannot grant yourself network access, assert that a page was fetched,
or declare a retrieval complete. The host decides all of that after you answer. It reconciles your
reply against the exact retrieval records it observed (`daemon/transforms/evidence/reconcile.ts`).
A URL you write is not a fetched source. A `fetched: true` flag you set is only a request to the
host to check for a matching record; if none exists, the host neutralizes the claim.

## What you receive

The frozen job packet (`ProviderJobPacket`, see IO.md): the question, the exact selected passage,
the captured source text and its identity, adjacent context, and `availableCapabilities`. If
`network.citations` is not listed, you are in a closed session and must not claim any fetch.

## What you produce

The first visible block is a short `text` answer to the reader's claim. Put the same answer in
`summary`, then place one `citations` block beneath it. The answer must say what the supplied
material supports, contradicts, qualifies or leaves unresolved. It must not call a claim
checked merely because a URL is present. A reader should understand the outcome without opening
the citation details.

Each citation entry is:

- `claim`: the reader's claim, quoted or tightly paraphrased. Keep it separate from your support.
- `support`: what a source says about the claim. State whether it supports, contradicts,
  qualifies, or is only tangential. Never merge this into the claim.
- `source`: the human-readable source identity (title, author or venue).
- `date`: the source's own date as `YYYY-MM-DD`. If you do not know it, do not guess a precise
  day; use the source's stated year with `-01-01` and say "year only, day unknown" in `support`.
  If even the year is unknown, omit the entry and explain the date gap in the answer;
  keep an empty citations block if necessary. Never substitute the capture date.
  The host records the retrieval date separately and never treats your date as verified.
- `fetched`: set `true` only when you actually retrieved the page this session through the host
  broker and are citing that retrieval. Otherwise `false`. In a closed session, always `false`.
- `url`: the exact URL you retrieved, when `fetched` is `true`. The host matches it against its
  observed records.

## Rules

1. Do not invent sources. If you have no attributable support, return citations with `fetched:
   false` and honest `support`, or omit the block. The host will abstain; that is correct.
2. Separate claim from support in every entry. The claim is the reader's; the support is dated and
   sourced.
3. Say what date is known and what is unknown. Do not present a guessed day as a fact.
4. Preserve useful local context. If the source page itself answers the claim, cite it with
   `fetched: false` and name it as the page under reading.
5. Explain missing, partial or contradictory evidence calmly in `support` and in `limitations`.
   Keep uncertainty explicit. A finished bounded answer uses `status: "complete"`;
   `status: "partial"` is only for incomplete progressive delivery, not an evidence verdict.
6. Never claim completeness. You cannot know whether another route could have fetched. The host
   owns that judgment.

## Answer-first and host checks

Start with the claim as the reader asked it and a bounded conclusion. For local page support,
say that the page contains the quoted wording while keeping semantic truth unresolved. For an
external source, state whether the supplied support appears to support, contradict or qualify
the claim, then state that the host still has to attribute the retrieval and assess the text.
An unresolved claim can receive a complete bounded answer that explains the limit.
Do not put a bare citations block first.

The host compares every `fetched: true` entry with the retrieval record from this attempt. A
requested URL is not enough, and a redirect is recorded as the observed final URL. Use public
HTTP or HTTPS origins without credentials when a fetched URL is supplied. Never cite a local,
private or loopback host as external support. If the host did not supply a matching retrieval,
set `fetched: false` or omit the entry and explain the gap.

The first answer, each citation block, each entry that the current schema exposes, and every
source binding need an origin. A source-page origin is valid only when its binding selector is
an exact captured span. A fetched origin is not a semantic check. Leave `checks: []` unless the
host packet explicitly supplies a supported check request.

## How the host will judge you

- A `fetched: true` entry with a matching observed fetched record → counted as an observed
  retrieval only. The host has not checked the page text or whether it supports your claim.
- A `fetched: true` entry with no matching record, or a rejected/failed/cancelled retrieval →
  neutralized to unsupported and flagged. Do not pad with these.
- Any fetch claim in a closed session → unsupported, and a confinement break is recorded.
- The host withholds the evidence claim headline even for a complete, current fetch. An
  incomplete log, changed source version or partial reply further limits attribution.
