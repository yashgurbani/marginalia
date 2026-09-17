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

- `verdict`: `unverified` (a complete reply has a current observed retrieval, but claim
  support remains unverified), `insufficient` (partial, author-supplied, incomplete or
  unattributable), or `refused` (closed session produced retrieval records).
- `replyStatus`: `partial` or `complete` from the validated reply. A partial reply never gets
  the `unverified` final assessment.
- `entries[].attribution`: `observed-fetch` | `author-supplied` | `unsupported-fetch-claim` |
  `unresolved`.
- `entries[].record`: the bound `FetchedResourceRecord` when a fetch resolves.
- `entries[].citationUrlMatch`: `requested`, `final`, `both` or null. A requested URL may
  redirect; the actual resource is always `record.finalUrl`.
- `entries[].dates`: `{ claimedSourceDate, claimedSourceDateVerified: false, retrievalDate }`.
- `headline`: withheld (`null`) until a separate host check establishes semantic support.

## Consumption by existing jobs (integration, not yet wired)

The host calls this only with a schema-validated reply, after binding its final or partial
status to the producing attempt. It builds `observations` from that same attempt's egress
record, never another attempt's fetches:
`EgressRecord.fetched` and `EgressRecord.retrievalComplete` (`contracts/consent.ts`), and
`FrozenJobContext.sourceVersionId` / `sourceHash` (`contracts/jobs.ts`). The assessment may
provide retrieval facts to the renderer. It grants no claim-level support or checked headline.
See the T14 receipt for the T06 wiring request.
