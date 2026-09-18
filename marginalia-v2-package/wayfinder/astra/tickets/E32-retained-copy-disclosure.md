# E32 Disclose retained local copies and erase targets

label: wayfinder:task
mode: AFK
status: closed
blocked_by: E01
route: Sol medium

## Task
Close the confirmed disclosure gap in fidelity-ledger row 11: “stored on your computer.”

At source head `bdfe8d7`, source versions, note versions, reply versions and FTS content are separate retained copies (`daemon/store.ts:63-76,214,339`). H09 decided to keep FTS and erase it with its source. Add a reader-facing inventory that also names pending local work, browser-side caches and backups where present. Do not imply secure physical erasure from a logical delete.

## Acceptance
- Settings list each retained-copy class, location category and applicable remove/export behavior.
- Erasure tests cover the documented database copies; unsupported physical-erasure claims do not appear.
- No path, token or credential is exposed in reader copy.

## Resolution

2026-09-18: Closed on source `d472442`, integrated as `89a6335`. Both settings surfaces disclose eight retained-copy classes with location categories and remove/export behavior. The copy explicitly distinguishes logical removal, retained version history, browser caches, backups and downloaded exports; it disclaims secure physical erasure and exposes no filesystem path or credential.

Named checks: `settings disclose every retained local copy with location, removal, and export behavior` and `thread removal erases every documented FTS copy but retains version records for restore and export`. Independent review accepted E32 after `tests/library.test.ts` plus `tests/store.test.ts`: 47/47 pass. The combined E32/E37 integration reported 58/58 focused tests; main `89a6335` retained full-suite output is 815 total / 809 pass / 0 fail / 6 skip, with typecheck, prepare and extension typecheck clean. Chief reports three-OS CI `35308691567` green at that head; this bookkeeping pass did not rerun the suite or CI.

Evidence (package-relative): `docs/evidence/qa-2026-09-18/e32-e37-settings/{worker-report.md,independent-review.md,main-test.log,main-typecheck.log,main-prepare.log,main-extension-typecheck.log}`. Integration/review assignments were Luna max; ticket route was Sol medium. Actual deployment/effort telemetry was unobservable. The original review used separate older trees; the combined integration and main logs support the merged result. Closure covers disclosure and documented logical erasure behavior, with retained copies candidly described.

