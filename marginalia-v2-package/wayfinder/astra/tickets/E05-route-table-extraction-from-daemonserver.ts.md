# E05 Route table extraction from daemon/server.ts

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01, E04
route: Sol medium

## Task
Deferred refactor in `docs/ENGINEERING-STANDARDS-2026-09-18.md` §2. `daemon/server.ts` is one request handler with inline route blocks (several added as "new block only" by workers). Extract a route table: one module per area (`daemon/routes/reader.ts`, `jobs.ts`, `solver.ts`, `helper.ts`, `static.ts`) with the same paths, methods, auth checks, headers and error strings. Keep `startServer` signature. The static CSP string from P9 moves unchanged.

## Acceptance
- `tests/server.test.ts` and every route test pass unchanged.
- `daemon/server.ts` under 200 lines; no route path, method, header or error string changes (diff the served surface with a before/after route listing in the report).
