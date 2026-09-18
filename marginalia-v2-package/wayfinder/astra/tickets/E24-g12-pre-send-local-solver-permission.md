# E24 G12: show local solver capability before sending

label: wayfinder:task
mode: AFK
status: closed
blocked_by: H12
route: Sol medium (critical if missing)

## Owner outcome

H12 is authoritative: choosing Simulate is one reader decision, and the review
surface must show the capability before sending. The visible statement must say that
the model can run locally (use the owner wording “can run the model locally”); this
does not grant authority, bypass a gate, or authorize an implicit send.

## Task

Verify the existing behavior first. Inspect `contracts/reply.ts`'s
`capabilitiesForIntent`, the T08 preparation/consent handoff, and the renderer's
saved-solver gate. If the capability is already displayed before consent, add the
regression evidence and make no product change. If it is missing, add only the
smallest derived reader-facing line for a Simulate preparation.

Owned source areas: `contracts/reply.ts` only to consume the existing capability
mapping; `ui/asking-host.ts` and `ui/asking/mount.ts` for prepared-plan display;
`ui/margin.ts` for the existing review handoff; `renderer/index.ts` only for its
existing solver capability/gate copy. Use `tests/asking-flow.test.ts`,
`tests/consent.test.ts`, `tests/solver-gate.test.ts`, and
`tests/saved-solver-service.test.ts`.

## Tests

- Extend `tests/asking-flow.test.ts` and `tests/consent.test.ts` to inspect the prepared Simulate review before `decide`/`start`; use solver-gate tests for unavailable helper/platform paths.

## Acceptance

- Before the consent decision/start call for Simulate, the review DOM contains the exact owner phrase `can run the model locally` and the exact outgoing content remains inspectable.
- Clicking Simulate, opening the review, or changing inputs never runs a solver or sends; only the existing explicit consent path may start work.
- Missing helper, unsupported platform, or refused gate says unavailable and runs nothing.
- The test asserts the content before `decide`/`start`, then asserts explicit approval remains required.
- No new permission, consent scope, provider authority, or inferred capability is introduced.

## Hard limits

Existing behavior verification comes before implementation. Record baseline/final test
totals in `docs/REPORT-E24-2026-09-18.md`; do not broaden this into solver wiring.

## Resolution

2026-09-18: Integrated `f88f651` through `848c5d9`. Before consent/start, a prepared and digest-bound `solver` capability renders the exact owner phrase “can run the model locally”; stale or absent capability fails closed. Mounting, selecting, reviewing, or changing inputs does not send or run, and explicit consent remains the only start path. Named regressions: `prepared Simulate review exposes its digest-bound local solver capability before consent or start`, `ui: digest-bound solver plan says it can run the model locally before any consent decision`, and `ui: local solver disclosure fails closed for absent capability or stale preview binding`. Verification: asking/consent 90/90, solver-gate coverage 67/67, full integration suite 800 total / 794 pass / 0 fail / 6 skip, and typecheck/prepare/extension typecheck pass. Evidence: `docs/evidence/qa-2026-09-18/e24-capability/` and `docs/REPORT-E24-2026-09-18.md`.

The implementation report records GPT-5.6 Sol/high; actual model/effort telemetry was not independently exposed by the harness. No permission, provider authority, consent scope, or implicit-send behavior was added.
