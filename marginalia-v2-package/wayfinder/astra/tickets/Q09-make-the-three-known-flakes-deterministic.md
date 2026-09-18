# Q09 Make the three known flakes deterministic

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
Known flakes: one journey-e2e case, `tests/jobs-workspace-integrity.test.ts`, and `tests/solver-recompute.test.ts` "two concurrent clicks are one run". Find each race (timers, unawaited promises, shared temp dirs, port reuse) and fix the test or the code so 20 consecutive runs pass. Fix code only where the race is real product behaviour; say which.

## Acceptance
- `for i in 1..20: npm test` passes every time; the report names each root cause.
