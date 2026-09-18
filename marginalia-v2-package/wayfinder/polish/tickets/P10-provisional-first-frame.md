# Provisional visual first frame

status: closed
type: build
blocked by: none

## Goal
The whitepaper promises deep help with "a provisional first frame" and cancel always visible. Today the provisional content is literal `staticFallback` text (`ui/asking/surfaces.ts:35`, `:39`).

## Owned paths
`ui/asking/surfaces.ts`, one new restricted renderer module under `ui/asking/`, `ui/asking/asking.css`, `tests/asking-flow.test.ts`.

## Acceptance
- A provisional model or plot preview renders with a visible "provisional" label that stays until the committed reply replaces it.
- The preview never shows a checked result sentence, a recompute action, an external link or anything executable.
- Cancel stays visible and fences a late preview.
- The committed renderer replaces the preview only after full validation. The test "provisional first content never uses the committed renderer" keeps passing.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P10.md`

## Chief integration scope, 2026-09-18
`tests/margin-recovery.test.ts` additionally owned for its scientific-boundary module stub only: new static preview imports require the computeIndependentChecks export to exist. The stub throws if called, preserving the recovery suite's prohibition on scientific calculation. Every existing recovery assertion remains. This is a fixture compatibility correction, without widening runtime or product behavior.

## Resolution
Closed 2026-09-18. Restricted packaged model/table plot frame with visible provisional and illustration labels, bounded4000steps/600vertices, no checked result sentence or executable/external action. Existing cancellation and full-validation replacement fences preserved. Independent review61/61 plus35/35 recovery after fixture correction; chief focused95/95. Standalone browser observed640/330CSSpxframes with no frame overflow or console errors; loaded-extension/provider proof stays open.

Stable chief gate at local HEAD6b3b246 plus uncommitted snapshot:1012 total/1005 pass/0 fail/7 skipped,24603.7304ms; root typecheck0, extension typecheck0, extension build0. Receipt `D:/Projects/Marginalia/.local/polish/logs/P10-chief-gate-final-20260918/receipt.json`, SHA25646F4E5A2760EDF6341402320A657D155AB5F3C660371D50AE53161EF39A4D747. Windows10.0.26200/Node24.14.1/npm11.11.0; sourceStable true. Same seven platform/opt-in skips recorded in receipt. First failed978/970/1/7 gate, reviewer dissent and browser sizing correction preserved in `D:/Projects/Marginalia/.local/polish/reports/P10.md`.

Sol medium stopped at quota before implementation; chief implemented locally, independently reviewed by reused owner. Actual serving routing/account unexposed. No git writes or publication. Founding promises unchanged; live/provider/confinement/native/H17/H15 gates remain open.
