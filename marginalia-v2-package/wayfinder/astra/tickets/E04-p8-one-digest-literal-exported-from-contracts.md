# E04 P8: one digest literal exported from contracts

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Luna max

## Task
`docs/ENGINEERING-STANDARDS-2026-09-18.md` §2 P8: the 64-hex digest pattern appears about 19 times across `contracts/ daemon/ ui/ renderer/ extension/`. Export `DIGEST_PATTERN` and `isDigest()` once from `contracts/` and migrate every call site, including the four files P8 originally deferred (`daemon/jobs/service.ts`, `daemon/jobs/store.ts`, `daemon/server.ts`, `ui/margin.ts`) now that no worker owns them.

## Acceptance
- `grep -rEc "a-f0-9\]\{64\}" contracts daemon ui renderer extension` returns 1 (the export).
- Full suite green; no behaviour change.
