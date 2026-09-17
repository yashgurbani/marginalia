# T19 — install and recovery experience: reserved Fable slice

Chief coordination task: `codex://threads/01a0adaf-dd71-7583-8307-b877547c9189`.
Workspace: `D:\Projects\Marginalia\marginalia-v2-package`.
Status: reserved for the user's Opus/Fable session; not yet claimed or running.

## Objective

“Marginalia is a margin beside whatever you are reading.” Design a truthful, calm path from first install to paired reading, and back after a helper stop, Codex sign-out, failed upgrade or interrupted connection. Preserve notes and reader trust. Deliver a concrete implementation-ready experience and copy specification for T19; do not claim that documenting the flow completes the installer or its runtime acceptance.

## Exact ownership

You may create or edit only:

- `docs/INSTALL-RECOVERY-EXPERIENCE.md` — entry points, state/action/copy table, recovery sequence, actual prerequisite gaps and implementation handoff.
- `docs/evidence/T19-fable-review.md` — source references, design decisions, verified observations, questions, and a later acceptance checklist.
- `wayfinder/build-receipts/T19.md` — claim, progress, outputs, outstanding implementation and handback.

You are not alone in this checkout. Do not edit product source, other tickets, global reports, the original design export, account settings or runtime homes. Do not commit/push, switch/reset branches, install packages or change any authentication state. If implementation requires an adjacent file, report the exact change to chief; do not take ownership implicitly.

## Sources and settled decisions

Read `wayfinder/SPEC-FINAL.md` first, then T19 in `wayfinder/BUILD-PLAN-24H.md`, `wayfinder/FEATURE-INVENTORY.md`, the whitepaper at `D:\Projects\Marginalia\Marginalia — Research Whitepaper.md`, `BUILD-STATUS.md`, and `docs/DESIGN-PASS-2-RECONCILIATION.md`.

Claude design is at `D:\UserData\reader\Downloads\marginalia-v1-package\design` and adjacent `design-pass-2`. Preserve its system and quiet voice. The user confirmed a composer at the reading position and one map preserving note density, section boundaries and current position. Hear it remains visibly unavailable until genuinely implemented. Local helper/pairing and remote model inference are separate facts; do not imply asking stays on the computer.

Inspect actual entry points and contracts: `package.json`, `daemon/main.ts`, `daemon/server.ts`, `daemon/pairing.ts` if present, `extension/README.md`, `webapp/main.ts`, `ui/helper.ts`, library/settings, and T01/T06/T11/T13 receipts. Existing source and reports are claims to reconcile, not proof of runtime acceptance. The dedicated product Codex home is currently signed out and dispatch lacks runtime evidence. Reading/pairing must remain distinct from readiness to send.

## Deliverable requirements

Cover supported-platform prerequisites and honest unsupported states; first helper start and extension installation; six-digit pairing and revoke/re-pair; grant boundaries; helper absent/stopped/restarted; signed-out dedicated runtime; unsupported version/isolation; disconnection and unknown outcomes; upgrade/data migration failure and rollback without deleting data; export/recovery access; diagnostics that do not expose page text or credentials. Name the reader action and observed state for each transition. Distinguish existing affordances, required code changes and unverified behavior.

Propose the smallest complete reader journey. Avoid a new dashboard, onboarding framework or architecture redesign. Never prescribe deleting profiles/databases or copying the desktop account's credentials as a recovery step. Preserve explicit retry for unknown outcomes. Do not write commands that imply a missing installer already exists.

## Coordination and stop condition

Before writing, post a claim and intended exact paths to the chief task using your available cross-session messaging; if unavailable, write the claim in the T19 receipt and have the user relay it. Report interface requests instead of editing adjacent owners' files. Chief owns consolidation and will reply with its frozen revision and any relevant review findings.

Testing is paused until chief announces the consolidated snapshot. This slice is source/design work; do not run builds, tests, browser QA or live sign-in/pairing. A later checklist is allowed, but executed evidence must be labelled separately. No independent Pro request is necessary for this slice: chief's combined Pro review will include it when available.

Return the three files, a concise list of required implementation changes, unresolved product decisions if any, and any discrepancies that could mislead a new reader. Stop at this slice; installer implementation and runtime verification remain T19 work to be assigned explicitly.
