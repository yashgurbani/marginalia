# E34 Make bottom actions honest and complete

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
Close the confirmed gap in fidelity-ledger row 26: “Threads on this page, related things in your library, save, park, hear it.”

At source head `bdfe8d7`, Save/Park and Library paths exist, while the footer explicitly renders `Hear it · not available yet` (`ui/margin.ts:315`) and no related-items implementation exists. Keep unavailable actions honest. Implement listening only when its source, transport, controls and persistence boundaries are specified; related items belong to E31.

## Acceptance
- Every bottom action either works through a tested reader path or states one plain unavailable reason.
- Hear it never starts playback or network work implicitly.
- Related items use E31's attributed local-match contract.

## Acceptance reconciliation — pending

2026-09-18: Source `2c9a27b`, integrated as `b1ce21f`, satisfies the availability/no-implicit-playback portion. Named regression `bottom availability keeps local paths actionable and missing related/listening paths inert` covers working Library/Keep/Park paths, plain unavailable Related items/Hear it text, no fake controls or media, and zero requests. Independent review accepted this scoped behavior with `tests/margin-entry.test.ts` 28/28 pass. Main retained suite is 802 total / 796 pass / 0 fail / 6 skip; typecheck, prepare and extension typecheck are clean. Chief reports three-OS CI `35308543856` green at `b1ce21f`.

Keep the ticket claimed: the third acceptance bullet requires E31's attributed local-match contract, while `worker-report.md` explicitly states that implementation is absent. Dissent from the review's overall ACCEPT is limited to ticket completeness, not a defect in the inert footer. Concrete pending requirement: integrate E31's bounded attributed local-match surface and verify the bottom related-items path against it, or obtain an explicit chief disposition that defers this bullet to E31 before closing E34. This bookkeeping pass does not amend the acceptance criteria.

Evidence (package-relative): `docs/evidence/qa-2026-09-18/e34-availability/{worker-report.md,main-test.log,main-typecheck.log,main-prepare.log,main-extension-typecheck.log}`; shared independent review: `docs/evidence/qa-2026-09-18/e32-e37-settings/independent-review.md`, also retained at `C:/Users/reader/.codex/worktrees/ecd8/Marginalia/.local/review-settings/{report.md,checks.log}`. Reviewer assigned Luna max; owner actual model/effort and reviewer telemetry were unobservable. Historical owner retry evidence remains historical; no suite was rerun for this reconciliation.

