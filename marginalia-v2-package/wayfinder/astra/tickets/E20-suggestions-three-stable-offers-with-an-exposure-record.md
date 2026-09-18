# E20 SUGGESTIONS: three stable offers with an exposure record

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01, H03
route: Sol medium

## Task
From `docs/STAGE1-PACKETS-2026-09-18.md` packet SUGGESTIONS and ledger row 33 (the margin already shows three fixed suggestions). Keep the fixed policy honest: at most three stable offers, an exposure record of exactly which label was shown and whether it was chosen, explicit resolution states, and an approximate category label for time ("about a minute") that is never a measured guarantee. Choosing a suggestion prepares a question; it does not send. Labels come from H03 (G3). Learned ranking is out of scope.

## Acceptance
- Tests: exposure record stores the exact label; choosing never dispatches; no fourth suggestion under any state.
- `npm test` green.
