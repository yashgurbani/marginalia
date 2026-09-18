# E38 Mark work derived from a corrected reply

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
Close fidelity-ledger row 98: “If a reply is corrected, everything derived from it is marked.”

At source head `bdfe8d7`, reply versions retain `parentId` and `supersedes` relationships (`daemon/store.ts:86,315-336`), but no invalidation marker is propagated through descendants. Add a derived-state marker without deleting the reader's notes, local control state or original versions.

## Acceptance
- Correcting a reply marks every transitive descendant and names the corrected ancestor.
- Notes and annotations survive unchanged and remain exportable.
- Restoring an old reply does not silently clear derived-state warnings.

