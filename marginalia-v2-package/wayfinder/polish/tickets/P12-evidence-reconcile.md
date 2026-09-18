# Evidence reconciliation on saved replies

status: closed
type: build
blocked by: none

## Goal
`daemon/transforms/evidence/reconcile.ts:124` checks citations deterministically and has tests. Neither the jobs service nor the renderer calls it. Wire it in, so a "What supports this" reply shows each citation's checked status. Web fetching stays unavailable in this ticket.

## Owned paths
`daemon/jobs/service.ts` (evidence completion path only), `daemon/transforms/evidence/reconcile.ts`, `renderer/index.ts` (citation block only), `tests/evidence-transform.test.ts`, one new acceptance test.

## Acceptance
- On completion of an evidence job, reconciliation runs and its result is saved with the reply.
- The renderer marks each citation as quoted from the page, unverified, or unsupported. Per decision H11, unsupported receipts stay labeled unverified and are never upgraded.
- A fetch claim with no broker record is shown as unverified. No network call is added.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P12.md`

## Chief preflight: durable host receipt
The existing helper has only test callers. `ReaderStore.commitReply` writes the immutable serialized host validation report; `JobStore.succeed` and `commitSucceededReplyWithSolverBindings` are the completion seams. A transient renderer assessment alone cannot satisfy save/reopen acceptance.

The P12 packet may additionally own narrow evidence-receipt plumbing in `daemon/store.ts`, `daemon/jobs/store.ts`, `daemon/jobs/solver-bindings.ts`, `contracts/host-checks.ts` and, if necessary, one browser-safe evidence receipt contract. Preserve existing public exports and host-check semantics. This is a technical scope expansion to implement the existing acceptance requirement, with no new fetch or provider capability. Coordinate against P20 before assigning either packet: both may need `daemon/store.ts`, so they cannot be concurrent writers to that file.

Use the immutable source version actually bound to the saved reply. A local quote label requires exact support-text containment in that capture and honest source attribution; text that merely resembles the page stays unverified. A retrieved URL or authored fetched flag never proves semantic support. Missing host receipts on old replies stay unverified. Add job completion, persisted restart/reopen, missing broker receipt, stale/mismatched source and unsupported-check coverage. Keep the same-instance pure helper tests as unit evidence only.

The same narrow plumbing scope includes `contracts/jobs.ts`, `daemon/consent/service.ts` and `renderer/host-authority.ts`: an optional host observation method is read within the synchronous acceptance fence, and the browser verifies the immutable reply/source receipt before rendering a quote label.

## Resolution
Closed2026-09-18 on local6b3b246 plus preserved uncommitted work. Exact-attempt observations are reconciled inside acceptance and persisted with immutable reply/source identity; quote labels are narrowly bound and semantic support remains unverified. Independent reviewer23/23 and extra digest-valid negative probes accepted after corrections; dissent retained.

Chief stable four-check gate1019 total/1012 pass/0 fail/7 skipped,25467.0123ms; root tsc0, extension typecheck0, extension build0. Receipt `D:/Projects/Marginalia/.local/polish/logs/P12-chief-gate-20260918/receipt.json`, SHA2563900CD5C7465E208F9279FCDDC3BA4BEF797F717422EAC5362955FB5FBFD4537. Windows10.0.26200/Node24.14.1/npm11.11.0, sourceStable true. Same seven platform/opt-in skips; no live or all-OS claim. Full files, failed logs, routing and limits: `D:/Projects/Marginalia/.local/polish/reports/P12.md`.

Chief local implementation after terminal Luna/Sol quota, independent read-only review; actual backend/account unexposed. No git writes or publication. No web fetch added and all real-provider/confinement/native/H17/H15 gates remain open.
