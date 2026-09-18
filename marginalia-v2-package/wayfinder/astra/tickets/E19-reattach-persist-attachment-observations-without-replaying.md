# E19 REATTACH: persist attachment observations without replaying questions

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01, E07
route: Sol medium

## Task
From `docs/STAGE1-PACKETS-2026-09-18.md` packet REATTACH and ledger row 87 (partial: route and store operation exist, helper client lacks the call). A reopened thread says when its passage moved or cannot be located confidently; the original quotation stays available. Reconnecting the helper is read-only and never re-asks the question (governing decision: no implicit send on reopen, reconnect or recover). Recording a new attachment observation is a separate deliberate local save.

## Acceptance
- Tests: reconnect performs no dispatch (assert on the send fences); moved and not-found states render in reader language; the quotation survives both.
- `npm test` green.
