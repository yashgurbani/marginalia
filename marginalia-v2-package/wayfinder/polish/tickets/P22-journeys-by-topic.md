# Journeys group the day by topic

status: claimed
type: build, with one decision for Yash inside
blocked by: Daily journal view

## Goal
Journeys are the journal's topics, formed automatically. Step one groups locally with no send: shared vocabulary terms, shared sources, links between pages, and time proximity. The reader can rename, merge, split and save a journey.

## Owned paths
New `ui/library/journeys.ts`, a local grouping module beside the reader store, the journal view's grouping slot, new tests.

## Acceptance
- A day with two distinct subjects yields two journeys, from a fixture. Grouping is deterministic and explained: each journey shows why its items sit together.
- The reader's edits persist and are never overwritten by regrouping.
- Zero provider requests in step one.

## Decision for Yash before any step two
Model-written topic names or synthesis would send the reader's own notes. That must be a reviewed ask with the exact outgoing content shown. Does Yash want it?

## Report
`D:\Projects\Marginalia\.local\polish\reports\P22.md`

## Technical ownership and evidence limits
The local component also owns contracts/journeys.ts, narrow contracts/journal.ts, daemon/routes/reader.ts, ui/helper.ts, ui/library/index.ts and journal export/CSS integration. Existing settings provide versioned durable reader overlays. Membership follows an anchored thread inside a day/timezone partition. P21 all-reading history remains open; captured source links are absent and link grouping remains unproved pending Fable. No generated-link or inferred-visit substitution.

## Verified partial checkpoint, 2026-09-18

Connected local grouping, rename/merge/split/save, durable reader overlays, paired helper transport and refreshed journal export implemented. Chief19/19 focused; independent19/19 plus original regression probes2/2. Final frozen four checks1087total/1081pass/0fail/6platformskip, both typechecks and extension build exit0, sourceStable true. Receipt .local/polish/logs/P22-final-components-chief-gate-20260918/receipt.json SHA256 CA8958A08465569856D960554D3549361DA7CEAF49FDB874222A9116CA5675DD. Controlled Chrome component keyboard360px/200%zoom evidence in shots/P22-styled. Report .local/polish/reports/P22.md retains failed punctuation/draft-loss/delayed-save probes and corrections. Full ticket remains OPEN for source links and complete reading history; model-written synthesis has no authorization. No Resolution or closure.
