# Bounded assumptions adjust locally

status: closed
type: build
blocked by: none (G02 resolved; P08 closed)

## Goal
The whitepaper shows "what this example assumes (n)", editable in place with nothing sent. Today `renderer/index.ts:521` to `:528` stores edited text only, and applying it means "Ask again with this assumption".

## Owned paths
`contracts/reply.ts` (assumption to parameter binding), `renderer/index.ts` (assumption ledger), one new `tests/local-assumptions.test.ts`.

## Acceptance
- An assumption may bind to one model parameter and a host-declared range.
- Editing that assumption inside the range redraws locally and persists with the saved view. Nothing is sent. A test asserts zero requests.
- An edit outside the range is refused with a plain sentence.
- A structural assumption (no parameter binding) keeps today's explicit "Ask again" path.

## Report
`<repo>/.local/polish/reports/P09.md`

## Chief implementation coordination, 2026-09-18

Owned paths also include contracts/reply.schema.json for the same optional assumption binding so host-delivered schema and TypeScript validation remain consistent. This is the existing single-parameter, bounded local edit decision; a structural change remains an explicit new ask. Preserve native control semantics and exact saved-view identity.

Authoring completeness: skills/simulate/IO.md is also owned solely to document this optional assumption binding. Its canonical digest is computed by the existing host loader; preserve P04/P08 instructions and frozen prior job bundles. Range validation must use the bound parameter and stay inside its declared min/max. No widening of source or execution permissions.


## Resolution
Closed 2026-09-18 after independent review and stable chief four-check acceptance. Optional single-parameter assumptions admit only finite ranges within the declared parameter bounds. Accepted edits redraw locally, persist with the saved view, synchronize native parameter number/range controls and all bound assumptions, preserve focus and send nothing. Invalid drafts leave accepted state unchanged. Structural assumptions retain explicit Ask again. P08 source highlighting remains intact.

Luna Max implemented the packet and added the failing synchronization regression before hitting a terminal quota limit. Chief completed the small synchronization correction. Independent reused reviewer examined the actual bytes and ran4/4 extra probes, including same-value invalid recovery and distinct narrower ranges, with no blocking finding. Report `<repo>/.local/p09-review/report.md`; actual serving model/effort/account unexposed. Renderer reviewed SHA2565A77D6E798FB2CA946EA509514F4FBB8402DA0810DAE0DBE0856F982AF385E92 matches current bytes. Native browser validity remains unproved by controlled DOM tests.

Chief focused51/51/0/0,524.9148ms in `<repo>/.local/polish/logs/P09-chief-sync-focused.log`. Failed3/2/1/0 regression retained in `P09-chief-partial-after-cap.log`. Stable full gate at local HEAD6b3b246 plus uncommitted snapshot: npm test1009 total/1002 pass/0 fail/7 skipped,23944.1568ms; root typecheck0, extension typecheck0, extension build0. Receipt `<repo>/.local/polish/logs/P05-P09-chief-gate-20260918/receipt.json`, SHA256 DD0F5A89A6570611939C3F435B4985F3E29517D50D64F268DFA1D0F8FFF01BC3. Windows10.0.26200/Node24.14.1/npm11.11.0; sourceStable true. Seven skips: POSIX lifecycle, POSIX file modes, native Windows history-link/reparse run, reply FIFO, solver FIFO, opt-in Chromium unset, POSIX private data directory. Founding documents reread unchanged. Live/provider/confinement/native/H17/H15 gates remain open. No git writes or publication.
