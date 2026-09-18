# Q08 Per-OS command matrix

label: wayfinder:task
mode: AFK
status: open
blocked_by: E02
route: CI, then Luna xhigh reads the runs

## Task
`docs/QA-HANDOFF-ASTRA.md` §10 command table: `npm test`, `npm run typecheck`, `npm run extension:typecheck`, `npm run build`, `npm run extension:build` on Windows, macOS and Linux. After E02 lands CI, take the evidence from the CI logs into `docs/evidence/qa-2026-09-18/<os>-*.txt` instead of hand runs. The 5 skipped tests are POSIX-only and must run (not skip) on ubuntu and macos.

## Acceptance
- Fifteen evidence files; the POSIX-only tests show as passed on the two POSIX runs.
