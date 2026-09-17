# Evidence skill: machine-consumable IO

Stable contract between the skill instructions, the reply schema, and the host reconciliation.
Types are the source of truth; this file names them and shows the exact shapes.

## Input (host → model)

The job workspace holds `packet.json`, an existing `ProviderJobPacket`
(`contracts/jobs.ts`). The evidence skill reads only these fields:

```
{
  "schema": "marginalia.job-packet.v1",
  "intent": "evidence",
  "question": string,
  "source": { "url", "title", "pageType", "capturedAt", "sourceHash", "sourceVersionId" },
  "selection": { "exact", "prefix", "suffix", ... },
  "adjacentContext": { "before", "after", "basis" },
  "availableCapabilities": ReplyCapability[]   // includes "network.citations" only in an open session
}
```

The skill never receives credentials, tool handles, or a way to fetch directly. Retrieval, when
allowed, is performed by the trusted daemon broker (`daemon/retrieval/broker.ts`), not by the
model.

## Output (model → host)

A `marginalia.reply.v1` reply (`contracts/reply.ts`) with `intent: "evidence"`, containing one
`citations` block. Entry shape (validated by `validateReply`):

```
{ id, claim, support, source, date: "YYYY-MM-DD", fetched: boolean, url?: string }
```

`requiredCapabilities` must include `network.citations` when any entry sets `fetched: true`.

## Host reconciliation (deterministic, no IO)

`reconcileEvidence(reply, observations)` in `daemon/transforms/evidence/reconcile.ts`.

```
observations: {
  sessionScope: 'cloud-inference' | 'open-session',   // closed | open
  retrievalComplete: boolean,                          // EgressRecord.retrievalComplete
  observed: FetchedResourceRecord[],                   // EgressRecord.fetched
  boundSourceVersion: { id, hash, capturedAt },        // FrozenJobContext.sourceVersionId + sourceHash
  currentSourceVersion?: { id, hash, capturedAt }      // present when re-checked later
}
```

Result `EvidenceAssessment`:

- `verdict`: `supported` (≥1 claim resolves to an observed fetch, log complete, source fresh),
  `insufficient` (author-supplied, incomplete or unattributable), or `refused` (closed session
  produced retrieval records).
- `entries[].attribution`: `observed-fetch` | `author-supplied` | `unsupported-fetch-claim` |
  `unresolved`.
- `entries[].record`: the bound `FetchedResourceRecord` when a fetch resolves.
- `entries[].dates`: `{ claimedSourceDate, claimedSourceDateVerified: false, retrievalDate }`.
- `headline`: withheld (`null`) unless a claim resolves to a complete, fresh observed fetch.

## Consumption by existing jobs (integration, not yet wired)

The host builds `observations` from records it already owns:
`EgressRecord.fetched` and `EgressRecord.retrievalComplete` (`contracts/consent.ts`), and
`FrozenJobContext.sourceVersionId` / `sourceHash` (`contracts/jobs.ts`). The assessment feeds the
renderer's citation authority line in place of the current author-only string. See the T14 receipt
for the exact wiring request to T06 Pro.
