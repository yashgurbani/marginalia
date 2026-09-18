# E02 P7 remainder: type parity and CI green on three OSes

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Sol medium

## Task
`docs/ENGINEERING-STANDARDS-2026-09-18.md` §2 P7. The Sol run in `fable-p1-p7-p9` adds `.npmrc`, `.github/workflows/ci.yml` and the test glob but could not install. Finish: bump `@types/better-sqlite3` from 9.6.0 to the 13.x line matching runtime 13.0.3 (`npm install -D` in the main checkout only, lockfile committed), fix any type fallout in `daemon/store.ts` and `daemon/jobs/store.ts`, decide `postinstall` (`wxt prepare extension`) versus documenting `npm run prepare` in README, then push and read the CI run on ubuntu, windows and macos.

## Acceptance
- `npm ci` on a clean clone followed by `npm run typecheck` passes without a manual prepare step, or README says the step plainly.
- CI green on all three OSes; link the run in the resolution.
- No behaviour change.
