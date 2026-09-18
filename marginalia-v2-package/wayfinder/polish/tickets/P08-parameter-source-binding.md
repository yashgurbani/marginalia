# Parameter controls light the source phrase

status: closed (chief verified, 2026-09-18)
type: build
blocked by: none

## Goal
In the whitepaper's vortex demonstration, "variable names light the source phrases". Today source buttons and diagram parts bind to exact spans (`renderer/index.ts:208`, `renderer/diagram.ts:32`), while parameter labels and sliders do not (`renderer/index.ts:283`, `:319`).

## Owned paths
`contracts/reply.ts` (one optional source binding on a model parameter), `renderer/index.ts` (parameter rows only), one new `tests/parameter-source-binding.test.ts`, `skills/simulate/IO.md` (document the optional field; update the pinned digest).

## Acceptance
- A parameter may carry an optional binding to an exact source span, validated like every other `SourceBinding`.
- Hover or keyboard focus on the label or the control highlights that span. Blur or pointer leave clears it.
- An invalid span fails reply validation. A parameter without a binding renders as today.
- Moving the slider still sends nothing. A test asserts zero requests.

## Coordination
If Solver authoring contract is in flight, it also owns `skills/simulate/IO.md`. Run this ticket after it closes.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P08.md`

## Chief implementation coordination, 2026-09-18

P04 is closed. Owned paths also include contracts/reply.schema.json for the same optional parameter field; its parameter object currently rejects additional properties, so the host-supplied schema must agree with the TypeScript validator. Keep source binding semantics consistent with existing exact selectors and preserve per-part origins.

The renderer's existing bindNode helper assigns role=button and intercepts Enter/Space on non-buttons. Reuse its source-highlight state logic without overwriting native number/range control semantics or swallowing slider keys. Verify label and control focus/hover behavior, blur/leave clearing and zero new requests. All other renderer work remains outside this packet.

## Resolution

Optional parameter SourceBinding is validated with the same exact-selector helper and JSON schema. Label/number/range focus and hover share source highlight state while preserving native control roles and keys; unbound controls remain unchanged. Chief inspected callback routing to immutable saved source and independently ran48/48 focused tests after restoring the original precise min/max refusal text. Selected Luna Max; backend/account unexposed. Browser/native semantics still await P07/P17 evidence. Initial worker failure was reconstructed in its summary log; the chief also recovered the actual tool output as P08-recovered-initial-tool-receipt.json. Simulate digest is recomputed and frozen by the existing host loader; no static registry literal exists.
Independent chief gate: local HEAD6b3b246a9c423afa9ff547c07192d37661dc37b2 plus uncommitted snapshot, source hashes stable before/after. npm test1004 total/997 pass/0 fail/7 skipped,25195.7959ms; npx --no-install tsc --noEmit exit0; npm run extension:typecheck exit0; npm run extension:build exit0. Windows10.0.26200/Node24.14.1/npm11.11.0. Raw logs and source manifests: D:/Projects/Marginalia/.local/polish/logs/P03-P08-P13-chief-gate-20260918. Receipt SHA256 78EE0057A4A019FC970ACD15DAA2A2793E5B5D365E4F881FB95984BFB4B8053A.

Seven skips: POSIX service lifecycle, POSIX file modes, native Windows history-link/reparse host run, reply-path POSIX FIFO, solver-path POSIX FIFO, T18 Chromium unset, POSIX data-directory permissions. This is local automated evidence, not all-OS CI or live browser/provider/confinement acceptance. Q03/Q04/Q06/native install/H17/H15 and the Yash-driven live checklist stay open. No git writes or publication. Reporting-only ticket/map updates follow the checked source snapshot.
