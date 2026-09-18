# Explore skill: machine-consumable IO

Stable contract between the skill instructions, the reply schema, and the host processing.

## Input (host → model)

The job workspace holds `packet.json`, a `ProviderJobPacket` (`contracts/jobs.ts`) with
`intent: "explore"`. The skill reads the question, `selection`, `source`, `adjacentContext`, and
`availableCapabilities`. No credentials or fetch handles are provided.

## Output (model → host)

A `marginalia.reply.v1` reply with `intent: "explore"`, containing one `shelf` block
(`contracts/reply.ts`). Item shape (validated by `validateReply`, max 5 items, HTTPS-only URLs):

```
{ id, title, reason, url, timecodeSeconds?: number }
```

`requiredCapabilities` must include `network.shelf`.

## Host processing (deterministic, no IO)

`assessShelf(reply, context)` in `daemon/transforms/explore/shelf.ts`.

```
context: {
  sessionScope: 'cloud-inference' | 'open-session',
  returnTo: { sourceVersionId, anchor: { exact, prefix, suffix } }
}
```

Result `ExploreAssessment`:

- `verdict`: `ready` (3–5 suggested links) or `insufficient` (fewer, reported honestly).
- `items[]`: kept items, each `parked: true`, `provenance: 'model-suggested'`.
- `droppedCount` / `issues`: padded, duplicate, or non-public items removed with reasons.
- `parked: true`: the whole shelf. Building it performs no retrieval, navigation, or inference.

`prepareOpen(assessment, itemId, currentReturnTo?)` returns the explicit open request for one item:

```
{ ok: true, open: { url, timecodeSeconds, returnTo } } | { ok: false, error }
```

The host must call this only for an explicit reader click. Saved, serialized assessments remain
usable after reload. The builder validates the parked Explore shape, selected item, URL policy and
saved source/anchor, then returns that original `returnTo`; current reading may be elsewhere. The
optional `currentReturnTo` argument is accepted only for compatibility and does not grant or deny
anything. `prepareOpen` performs no fetch or navigation. Its result is not an authorization
capability or a claim that the resource was retrieved. The host executes the navigation in the
reader's browser and restores the reading position from `returnTo`. Ordinary section fragments and
public IPv6 destinations remain valid.

## Consumption by existing jobs (integration, not yet wired)

The host supplies `context.returnTo` from the thread's `sourceVersionId` and anchor
(`contracts/reader.ts`). The renderer already parks a shelf and opens items as links
(`renderer/index.ts` `case 'shelf'`); wiring `prepareOpen` gives that open action its validated
request and return context. The integration owner must route the explicit click through the saved
assessment. See the T15 receipt for the wiring request.

The first block is a text answer about the next reading, followed by the shelf. Origins cover
the answer, the shelf and each visible item. A recommendation is model-authored until the host
performs its own URL and saved-anchor checks. A URL alone never establishes retrieval.


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

For every shelf item add exactly `/blocks/N/items/M/title` and
`/blocks/N/items/M/reason`. Do not add an origin for the whole item or its URL.
Use `authored` origins for suggested titles and reasons; never declare them fetched
because a URL is present. Deliver the finished bounded shelf with `status: "complete"`;
fewer suggestions do not justify invented items or fetched claims.
