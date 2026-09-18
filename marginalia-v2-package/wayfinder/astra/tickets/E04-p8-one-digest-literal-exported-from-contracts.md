# E04 P8: one digest literal exported from contracts

label: wayfinder:task
mode: AFK
status: closed
blocked_by: E01
route: Luna max

## Task
`docs/ENGINEERING-STANDARDS-2026-09-18.md` §2 P8: the 64-hex digest pattern appears about 19 times across `contracts/ daemon/ ui/ renderer/ extension/`. Export `DIGEST_PATTERN` and `isDigest()` once from `contracts/` and migrate every call site, including the four files P8 originally deferred (`daemon/jobs/service.ts`, `daemon/jobs/store.ts`, `daemon/server.ts`, `ui/margin.ts`) now that no worker owns them.

## Acceptance
- `grep -rEc "a-f0-9\]\{64\}" contracts daemon ui renderer extension` returns 1 (the export).
- Full suite green; no behaviour change.

## Resolution

2026-09-18: Integrated `1c231a2` through `81eff23`. `contracts/digest.ts` now owns `DIGEST_PATTERN` and `isDigest`; the scoped production tree has exactly one 64-hex literal and all 19 equivalent validators use the shared contract. Named checks: the scoped `rg` literal search, `tests/solver-recompute.test.ts` and the focused consent/job/solver/adapter review (217/217), `npm run typecheck`, `npm test` (797 total, 791 pass, 0 fail, 6 skip), `npm run prepare`, and `npm run extension:typecheck`. Evidence: `docs/evidence/qa-2026-09-18/e04-digest/` (`worker-report.md`, `review-report.md`, `integrated-suite.log`, and the typecheck/prepare/extension logs).

The independent review found that non-string values formerly coerced by `RegExp.test` are now rejected. This is accepted boundary hardening that preserves typed-input/string behavior; it is candidly not a zero-runtime-input-change claim. Worker requested `gpt-5.6-luna/max`; actual runtime/effort telemetry was not observable.
