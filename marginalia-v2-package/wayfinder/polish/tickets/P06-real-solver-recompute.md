# One real saved-solver recompute

status: blocked (live execution evidence and prerequisites pending)
type: build, live
blocked by: Reviewed solver artifacts survive continuation; One real declarative simulation; Runtime inference admission (H17, Astra map)

## Goal
Prove the third movement path once with a solver a live model wrote. The reader clicks recompute, the solver runs once on their machine with changed inputs, the result binds to that view, and no model turn occurs.

## Owned paths
`daemon/main.ts` (solver transport wiring under the reader-authorized runtime module), `daemon/reader-authorized-runtime.ts`, `ui/solver-recompute.ts`, one new acceptance test, one evidence record under `docs/evidence/`.

## Acceptance
- The audit reports that the reader-authorized module disables the default solver transport through the `runtimeModule` branch in `daemon/main.ts`. Confirm or refute this first.
- The reader-authorized inference exception never extends to solver execution silently. Solver execution needs its own explicit reader acknowledgement or its own observed confinement.
- If execution evidence is still missing, stop and report the exact remaining refusal. That report is a valid outcome.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P06.md`

## Preflight outcome, 2026-09-18

The runtimeModule branch in daemon/main.ts disables the default solver transport, confirmed by source inspection. The existing local HTTP-route test for an unmounted transport passes1/1 and returns `No saved-solver command transport is available.` with zero egress/grant consumption. Report: D:/Projects/Marginalia/.local/polish/reports/P06.md.

This is the ticket's permitted stop-and-report outcome while execution evidence is missing. It does not close the live recompute goal. No inference acknowledgement was reused for solver execution. P05, L02 and H17 prerequisites and the actual signed-in runtime observation remain open.
