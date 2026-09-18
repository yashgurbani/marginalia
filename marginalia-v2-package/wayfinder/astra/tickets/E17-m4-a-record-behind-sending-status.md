# E17 M4: a record behind the sending status

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
From `docs/STAGE1-PACKETS-2026-09-18.md` packet M4 and ledger row 100. The activity control in `ui/margin.ts` (lines 515 to 522 at 0360a1c) derives "Sending" from asking-flow state, not from the durable egress record written in `daemon/consent/service.ts` (dispatch transaction) and `JobAttempt.sentContent` (merged in `9337135`). Make the reader-facing indicator read the record: reviewed size, handoff, and observed transmission as three separate facts. When actual transmission cannot be observed (the process can commit the record and crash before writing the stream), the margin says so rather than claiming "sent". Old attempts keep null measurements; no backfill.

The review's own correction applies: this does not fully deliver "data is leaving" without an observation source. Say so in the copy and in the report.

## Acceptance
- Tests: indicator state follows the record, not the flow; an attempt with a handoff and no observation shows the unobserved state.
- `npm test` green; no change to consent authority or send fences.
