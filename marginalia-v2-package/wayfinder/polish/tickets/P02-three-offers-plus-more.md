# Three offers plus More

status: claimed (Codex chief, 2026-09-18)
type: build
blocked by: none (G01 resolved by Yash)

## Goal
The whitepaper says Ask opens "at most three suggestions". `ui/margin.ts:19` shows six fixed offers. Show three, keep the rest under More, keep positions stable.

## Owned paths
`ui/margin.ts` (suggestion constants and rendering), `ui/persistence.ts` (exposure shape), `tests/suggestion-ui.test.ts`, `tests/margin-entry.test.ts` (suggestion cases only).

## Acceptance
- A selection shows three offers and one More control. More reveals the remaining kinds in a fixed order. Positions never reorder while the card is open.
- The first three use the resolved G01 additive score: block fit + page fit + stated preference + a useful reply nearby - a just-dismissed repeat penalty. Eligibility is the only hard filter. No fixed trio is hardcoded.
- The exposure record lists only what was actually shown. An offer hidden under More is recorded only after More opens.
- With the helper disabled, no offer is recorded as eligible.
- Choosing any offer still saves a draft and sends nothing.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P02.md`

## Stop
Stop after the report. Scoring by block and page type is part of this ticket, as explicitly required by Yash and G01. Use the already available captured source and local explicit records; scoring must never trigger a lookup or provider request. Keep the line for a custom question. Test each score term, eligibility, stable positions and More exposure accounting. The sixth label remains a separate open decision.


## Chief preflight for the five score terms

The current code has six fixed selection offers and three whole-page offers, an exposure log, and a free-text context box. No suggestion policy table or explicit preference/posture setting was found. Do not satisfy the score by permanently zeroing missing terms or substituting a fixed trio.

Ownership additionally permits a small pure suggestion-policy module beside the UI and `contracts/suggestions.v1.json`, which the whitepaper explicitly names for editable block/page weights. Keep the margin's change limited to wiring and controls. Represent the whitepaper's existing explicit reader preference/posture decision in a compact local control if no current preference source exists. Use only current captured text, explicit reader statements and local already-available retained replies/exposures; ranking cannot cause a helper lookup or provider send. State deterministic heuristic assumptions and test each term independently.

Eligibility remains host/provider/permission capability only; relevance never removes an ask. The hidden remainder keeps a fixed order when More opens. Exposure recording must distinguish eligible versus actually shown, append revealed positions without rewriting a resolved exposure, and record nothing as eligible when the helper is disabled. All positions freeze for the lifetime of the card. Preserve a custom-question line and exact-review draft flow. Missing runtime eligibility data must be represented honestly, rather than inventing capability evidence.

## Current preflight question
The current margin has local blockers/pairing but no verified per-intent execution readiness; capabilitiesForIntent is renderer vocabulary, not execution authority. Existing exposures require shown intents to be eligible and falsely log eligibility with helper disabled. A question in agents-talk.md asks Fable to reconcile displayed draft choices with known execution eligibility. Chief is building the pure five-term policy and append-only reveal mechanism while that UI semantics decision is pending; no ticket closure claimed.

Technical ownership includes tsconfig.json resolveJsonModule for the whitepaper-named JSON weight table, ui/suggestion-policy.ts and tests/suggestion-policy.test.ts. Weights are deterministic initial heuristics, not an empirically fitted model. No lookup or user-knowledge inference.
