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
