# Reviewed solver artifacts survive continuation

status: closed
type: build
blocked by: Solver authoring contract

## Goal
`daemon/jobs/workspace.ts:34` rejects every extra provider-readable artifact on continuation. So a thread with a saved solver cannot take a follow-up. Allow exactly the artifacts pinned by the manifest from Solver authoring contract, and nothing else.

## Owned paths
`daemon/jobs/workspace.ts`, `daemon/jobs/workspace-integrity.ts`, `tests/jobs-lifecycle.test.ts`, `tests/jobs-workspace-integrity.test.ts`.

## Acceptance
- An unchanged, manifest-pinned solver survives a follow-up.
- A modified file, an unlisted file or directory, a link and a special file each fail before any mutation or dispatch.
- The deny-all default stays for workspaces without a manifest. The test "continuation verifies reviewed files before mutation and rejects undeclared artifacts" keeps passing.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P05.md`

## Stop
Stop after the report.



## Chief scope clarification, 2026-09-18

Ownership also includes daemon/jobs/service.ts solely to pass the immutable accepted parent reply and persisted P04 solver binding authority into both continuation verification/preparation calls. The on-disk manifest alone is mutable and cannot grant a new allowlist. This caller change is required by existing acceptance, without changing product scope. P03 owns contracts/jobs.ts and host-instructions.ts; those paths stay outside P05.

## Resolution
Closed 2026-09-18 after chief source review and stable independent four-check acceptance. Manifest-pinned solver artifacts survive consecutive text-only followups. The nearest validated solver authority for the current workspace governs continuation, including a newly authored solver and removal of older history; a fresh text-only fork inherits no old workspace authority. Modified bytes, manifest changes, unlisted files/directories, links and special files refuse before mutation or dispatch; absent immutable host authority retains deny-all behavior.

Chief focused37 total/33 pass/0 fail/4 Windows capability skips,1947.3573ms: `D:/Projects/Marginalia/.local/polish/logs/P05-chief-c4-focused.log`. Stable full snapshot at local HEAD6b3b246 plus uncommitted changes: npm test1009 total/1002 pass/0 fail/7 skipped,23944.1568ms; root typecheck0, extension typecheck0, extension build0. Receipt `D:/Projects/Marginalia/.local/polish/logs/P05-P09-chief-gate-20260918/receipt.json`, SHA256 DD0F5A89A6570611939C3F435B4985F3E29517D50D64F268DFA1D0F8FFF01BC3. Windows10.0.26200/Node24.14.1/npm11.11.0; source hashes stable before/after.

Selected implementers Sol medium and Luna Max, final independent technical review/correction Sol medium; actual backend/account unexposed. Chief independently ran the checks. Prior failing transition/ancestry logs remain in the P05 report. Seven full-suite skips: POSIX lifecycle, POSIX file modes, native Windows history-link/reparse run, reply FIFO, solver FIFO, opt-in Chromium unset, POSIX private data directory. This closes local continuation admission behavior, not real solver execution or Q03/Q04/Q06/native/H17/H15. No product git writes or publication. Founding documents reread and unchanged.
