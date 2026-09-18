# Go further shelf and return path

status: closed
type: build
blocked by: none

## Goal
`daemon/transforms/explore/shelf.ts:146` (`assessShelf`) and `:203` (`prepareOpen`) have tests and no production caller. The renderer shows shelf items as ordinary links (`renderer/index.ts:472`). Route an explicit shelf click through the saved assessment and keep the reader's return anchor.

## Owned paths
`daemon/transforms/explore/shelf.ts`, the reply persistence or host callback that the renderer already uses, `renderer/index.ts` (shelf block only), `tests/explore-transform.test.ts`, one new acceptance test.

## Acceptance
- Building a shelf opens nothing and fetches nothing.
- Duplicate and private-network links are refused with a plain reason.
- An explicit open records the original thread and anchor. After reload, the reader can return to that anchor.
- Shelf suggestions stay visibly distinct from fetched evidence.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P11.md`

## Chief technical scope
Persist the assessment in immutable host validation and navigation intent in the existing durable events/receipts transaction. Original thread/source/anchor remain separate from debounced reading position. Narrow additional ownership: contracts/explore.ts (shared pure policy with daemon compatibility export), contracts/host-checks.ts, daemon/store.ts, daemon/routes/reader.ts, renderer/host-authority.ts, ui/helper.ts, ui/margin.ts and ui/asking-host.ts. No concurrent margin/store writer; P20 serialized. Both fresh and reopened replies need the explicit callback and return action. Opening records intent, never successful navigation or fetched evidence. This implements the existing ticket; no network retrieval is added.

Exact-attempt scope/source transfer also narrowly touches daemon/jobs/store.ts and daemon/jobs/solver-bindings.ts, preserving P12. No separate UI navigation module is needed: the renderer reserves a blank tab during the deliberate click, then follows an explicit no-referrer/noreferrer anchor after the host records the return passage. If popups are unavailable, it offers one explicit approved link.

## Resolution
Closed2026-09-18 on local6b3b246 plus preserved uncommitted work. Saved pure assessment, explicit host-recorded navigation intent and original thread/source/anchor return survive restart. Duplicate/private, stale/removed/partial, callback failure and disposal remain guarded. Both fresh and reopened reply paths wired. No implicit open/fetch or semantic support claim.

Chief final stable gate1023 total/1016 pass/0 fail/7 skips,24672.3807ms; root tsc0, extension typecheck0, extension build0. Receipt `D:/Projects/Marginalia/.local/polish/logs/P11-chief-gate-final-20260918/receipt.json`, SHA256D151252D6A65C881C053DB5ABB22366EFB4026E28BFF7E6012383CF84750FB84; Windows10.0.26200/Node24.14.1/npm11.11.0. Independent20/20 review plus final guard source check. Full report/limits: `D:/Projects/Marginalia/.local/polish/reports/P11.md`.

Chief local implementation after terminal requested Luna/Sol quota; actual backend/account unexposed. Native popup/referrer behavior remains unobserved; controlled DOM and synthetic provider evidence do not close native/provider/confinement/H17/H15 gates. No git writes or publication. Review dissent and earlier receipts retained.
