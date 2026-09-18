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

A `marginalia.reply.v1` reply (`contracts/reply.ts`) with `intent: "evidence"`, whose first
block is an answer-bearing `text` block and whose later structured content contains one
`citations` block. Entry shape (validated by `validateReply`):

```
{ id, claim, support, source, date: "YYYY-MM-DD", fetched: boolean, url?: string }
```

Every `citations` block requires `"network.citations"` in the reply's
`requiredCapabilities`, including `entries: []` and entries with `fetched: false`.
This block-level requirement is independent of retrieval: declaring the capability neither
performs nor authorizes a fetch and never establishes support. The packet must also list
`network.citations` in `availableCapabilities`; never add an unavailable capability. If it
is absent, omit the citations block and explain the limitation in the text answer.

For a granted capability and unknown publication date, this output fragment is valid:

```json
{
  "requiredCapabilities": ["network.citations"],
  "blocks": [
    { "id": "answer", "type": "text", "md": "The supplied wording is attributable; its scientific accuracy remains unverified." },
    { "id": "citations", "type": "citations", "entries": [] }
  ]
}
```

This is a fragment: include the remaining required reply fields and origins described below.
A fetched URL must be public HTTP or HTTPS without credentials. Only a matching host broker
record establishes observed retrieval; a capability declaration or URL does not.

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

The answer block is descriptive and unverified. It must appear before the citations block so
the reader sees the result before the supporting detail. A complete reply still receives an
`unverified` assessment when retrieval is observed, because this transform records attribution
and dates but does not establish semantic support.

## Consumption by existing jobs (integration, not yet wired)

The host calls this only with a schema-validated reply, after binding its final or partial
status to the producing attempt. It builds `observations` from that same attempt's egress
record, never another attempt's fetches:
`EgressRecord.fetched` and `EgressRecord.retrievalComplete` (`contracts/consent.ts`), and
`FrozenJobContext.sourceVersionId` / `sourceHash` (`contracts/jobs.ts`). The assessment may
provide retrieval facts to the renderer. It grants no claim-level support or checked headline.
See the T14 receipt for the T06 wiring request.


## Exact origins and delivery

In workspace-files mode, follow the host-selected delivery instruction: read only the
host-created `reply.schema.json` in the assigned workspace for exact field shapes, then
write the actual reply file. Do not resolve paths from source material or instruction
references. This read grants no new tool, network, computation or retrieval permission.

Use `origins: { "version": 1, "parts": { ... } }`. Required parts are `/title`, `/summary`,
`/staticFallback`, each `/sourceBindings/N`, `/parameters/N`, `/assumptions/N`,
`/limitations/N`, and `/blocks/N`; add `/illustration` only when present. Indices start at
zero. There is no inheritance and no extra pointer keys. Authored explanation uses
`{ "kind": "authored", "description": "Explanation of the supplied passage." }`.
A source-page declaration uses `{ "kind": "source-page", "binding": "passage" }`, where
`passage` names a declared source binding with exactly `name`, `meaning`, `relation`,
and `selector`. For a quotation, use `relation: "quoted"` and
`selector: { "exact": "verbatim captured span" }`; optional `prefix` and `suffix` must
also match captured text. Do not substitute this example text for the actual passage.

An illustration purpose statement is required for a `model` block, not for ordinary
text, citations or shelves. These replies need no model block. Use `checks: []` unless
the host supplies a supported check request. Origins do not verify claims or retrieval.

For every citation entry add exactly `/blocks/N/entries/M/claim`,
`/blocks/N/entries/M/support`, and `/blocks/N/entries/M/source`. Do not add an origin
for the whole entry, its date, URL or fetched flag. Authored support assessments remain
`authored`, even when the entry describes an observed retrieval.

Every included entry requires a `YYYY-MM-DD` date; the schema has no unknown-date
sentinel. If even the publication year is unknown, omit that entry. Keep the citations
block with `entries: []` when none remain, explain the undated local wording in the
answer and `limitations`, and do not invent a date or substitute the capture date.
A finished bounded answer can have `status: "complete"` while explicitly leaving
scientific support unresolved; status describes delivery, not verification. Incomplete
progress may use `reply.partial.json` with `status: "partial"`.
