# E32 Disclose retained local copies and erase targets

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
Close the confirmed disclosure gap in fidelity-ledger row 11: “stored on your computer.”

At source head `bdfe8d7`, source versions, note versions, reply versions and FTS content are separate retained copies (`daemon/store.ts:63-76,214,339`). H09 decided to keep FTS and erase it with its source. Add a reader-facing inventory that also names pending local work, browser-side caches and backups where present. Do not imply secure physical erasure from a logical delete.

## Acceptance
- Settings list each retained-copy class, location category and applicable remove/export behavior.
- Erasure tests cover the documented database copies; unsupported physical-erasure claims do not appear.
- No path, token or credential is exposed in reader copy.

