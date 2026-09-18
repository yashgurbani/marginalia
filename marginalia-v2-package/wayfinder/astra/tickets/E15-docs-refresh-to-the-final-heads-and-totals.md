# E15 Docs refresh to the final heads and totals

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Luna max (retry Sol medium if Luna reports capacity)

## Task
The Luna docs refresh failed with "Selected model is at capacity" and produced nothing. Re-run after E01: update `docs/STATE-AND-PLAN-2026-09-18.md` (§5 queue, in-flight items closed), `docs/FEATURE-STRATEGY-2026-09-18.md` (M-table statuses: M4 egress record and retention, M7 position, M9, M11, M13, M14, M17, M18, P10, P11 done as merged), `docs/ENGINEERING-STANDARDS-2026-09-18.md` §2 statuses, `docs/QA-HANDOFF-ASTRA.md` §10 totals and a new §14 covering the features merged since (per-note remove and restore, one branch open, precise position, alarm reconnect, sentContent retention, migration message, installer, sheet, library route). Use `git log --oneline d420221..HEAD` as the source of truth; totals from a fresh `npm test`.

## Acceptance
- Every number in the four docs matches the live suite and `git log`.
- No claim beyond what tests or evidence files show.
