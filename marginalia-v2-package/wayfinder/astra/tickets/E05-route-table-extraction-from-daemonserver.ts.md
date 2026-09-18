# E05 Route table extraction from daemon/server.ts

label: wayfinder:task
mode: AFK
status: closed
blocked_by: E01, E04
route: Sol medium

## Task
Deferred refactor in `docs/ENGINEERING-STANDARDS-2026-09-18.md` §2. `daemon/server.ts` is one request handler with inline route blocks (several added as "new block only" by workers). Extract a route table: one module per area (`daemon/routes/reader.ts`, `jobs.ts`, `solver.ts`, `helper.ts`, `static.ts`) with the same paths, methods, auth checks, headers and error strings. Keep `startServer` signature. The static CSP string from P9 moves unchanged.

## Acceptance
- `tests/server.test.ts` and every route test pass unchanged.
- `daemon/server.ts` under 200 lines; no route path, method, header or error string changes (diff the served surface with a before/after route listing in the report).

## Resolution

2026-09-18: Integrated `5892e65` as `29a4730`. `daemon/server.ts` is 130 lines; the six route modules preserve the served path set, auth/CORS/error/header/CSP behavior, solver fallthrough, and job regex. Named checks: the focused mounted-route set is 94/94 before and after, the named server/read-aliases/solver-route subset is 22/22, helper-management is 4/4, `surface-check.mjs` reports no added/removed literals and identical paths, and `npm run typecheck` exits 0. Main evidence is 801 total / 795 pass / 0 fail / 6 skip; CI run 35307863347 is green on all three OSes at `29a4730`. Evidence: `docs/evidence/qa-2026-09-18/e05-routes/`, including the independent route-review report/checks.

The implementation worker requested Sol medium (resume requests included Astra low/Luna max); the independent reviewer was assigned Luna max. Actual model/effort telemetry was not exposed by either worker. This closes route extraction only; Q09 and release/QA gates remain open.
