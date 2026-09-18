# Completed-reply acceptance for worked example and derivation

status: closed (chief verified, 2026-09-18)
type: build
blocked by: none

## Goal
"Show me an example" and "Explain step by step" have draft tests only (`tests/margin-entry.test.ts:673`, `:674`). No test carries an authored reply through jobs, validation, render and reopen.

## Owned paths
New `tests/instantiate-acceptance.test.ts` and `tests/derive-acceptance.test.ts`, fixtures beside them. Source files only for defects the tests expose, listed in the report.

## Acceptance
- Worked example: an authored arithmetic reply with text, steps, a table and a derived value passes the jobs pipeline, renders, saves and reopens without a second request. The derived value shows finite and undefined cases.
- Derivation: a multi-step reply with exact source references renders with next and previous step controls. Boundaries hold. The saved step position survives reopening. No mathematical check is claimed that the host did not run.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P13.md`


## Resolution

Authored arithmetic and exact-source derivation fixtures cross actual job preparation, permission review, admission, immutable save, renderer, saved view, daemon restart and reopen. Finite/undefined values and step boundaries/persistence are asserted; exactly one synthetic runtime start and zero resume on reopen. Chief inspected the harness and independently ran2/2 acceptance tests. Selected Sol medium; backend/account unexposed. Synthetic runtime and controlled DOM prove these paths, not live provider or native browser rendering.
Independent chief gate: local HEAD6b3b246a9c423afa9ff547c07192d37661dc37b2 plus uncommitted snapshot, source hashes stable before/after. npm test1004 total/997 pass/0 fail/7 skipped,25195.7959ms; npx --no-install tsc --noEmit exit0; npm run extension:typecheck exit0; npm run extension:build exit0. Windows10.0.26200/Node24.14.1/npm11.11.0. Raw logs and source manifests: D:/Projects/Marginalia/.local/polish/logs/P03-P08-P13-chief-gate-20260918. Receipt SHA256 78EE0057A4A019FC970ACD15DAA2A2793E5B5D365E4F881FB95984BFB4B8053A.

Seven skips: POSIX service lifecycle, POSIX file modes, native Windows history-link/reparse host run, reply-path POSIX FIFO, solver-path POSIX FIFO, T18 Chromium unset, POSIX data-directory permissions. This is local automated evidence, not all-OS CI or live browser/provider/confinement acceptance. Q03/Q04/Q06/native install/H17/H15 and the Yash-driven live checklist stay open. No git writes or publication. Reporting-only ticket/map updates follow the checked source snapshot.
