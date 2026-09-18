# E07 Solver-interpreter pinning and the jobs pipeline map

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Sol medium

## Task
Two deferred standards items. (1) `daemon/jobs/solver-bindings.ts`: pin the solver interpreter the binding executes with (record the interpreter identity and version in the binding; refuse to run a binding whose recorded interpreter differs; `store.ts:344-345` holds the governing comment). (2) Document the six-entry-point job pipeline in `daemon/jobs/service.ts` (start, retry, followup, cancel, dispatch, settle) as a state diagram in `docs/JOBS-PIPELINE.md` with the fences (`assertDispatchFence`, `prepareSendCheckpoint`, `recordSentContent`) and what each guarantees. No pipeline refactor in this ticket.

## Acceptance
- A test that a binding recorded under interpreter A does not execute under interpreter B, with a plain reader-facing reason.
- The diagram names every state transition present in code (cross-check with `contracts/jobs.ts` `JobState`).
