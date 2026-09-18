# E08 T13-P5 confinement evidence collector

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
`docs/STATE-AND-PLAN-2026-09-18.md` §5 item 2: the packet and verdict live in the packets folder (`docs/evidence/` T13 files and `.scratch/t13-*`). The verdict blocks as written: the collector must name `maxOutputBytes` and `executionAttemptId` for `transport.exec`, and the attempt id is not inert. Fix those two values in the packet (read `daemon/solver/lazy-transport.ts` and `daemon/solver/index.ts` for the real parameters), then implement: a closed-session run produces an evidence record proving no network egress (fetched evidence is not support; requested sandbox is not confinement), stored beside the job and readable from the "What was sent" sheet.

## Acceptance
- Test: a closed-session execution records an evidence entry with the two named values and `network: none`; an open-session execution records the fetched record or labels it incomplete.
- The sheet shows the record in reader language, nothing editable.
