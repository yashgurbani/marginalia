# E30 Complete source bindings and per-part origins

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
Close the related, confirmed gaps in fidelity-ledger rows 04, 14, 65 and 118:

- Row 04: “a diagram whose parts point back into the sentence.”
- Row 14: “whose parts each say whether they were quoted, computed, an analogy or fetched.”
- Row 65: “A saved explanation is never later mistaken for evidence.”
- Row 118: “a diagram maps nodes and edges to source spans.”

At source head `bdfe8d7`, `SourceBinding` is a reply-level list (`contracts/reply.ts:24,99`) and diagram blocks refer to named bindings (`contracts/reply.ts:57-63`), but the contract does not require every rendered part or every diagram edge to carry an origin/binding. The renderer keeps generated citation statements author-supplied (`renderer/index.ts:259-261`), so retrieval and support must remain distinct.

Add typed origin coverage for every reader-visible reply part and require node and edge bindings where a diagram claims source correspondence. Preserve source-page, reader-note, computed, analogy and fetched as distinct origins. A fetched page is not support without the separate evidence assessment.

## Acceptance
- Contract tests reject an unbound diagram edge and a reader-visible part without an origin.
- Renderer tests expose each origin in reader language and keep fetched material separate from support.
- Existing saved replies either migrate explicitly or render an honest legacy/unavailable state.

