# Not sure gets a reply contract

status: closed (chief verified, 2026-09-18)
type: build
blocked by: none

## Goal
The eighth kind of ask in the whitepaper is "not sure". The intent `unsure` exists in `contracts/reply.ts:20` and "Think with it" drafts it (`ui/margin.ts:437`), yet no skill bundle exists. `daemon/jobs/host-instructions.ts:9` registers seven bundles.

## Owned paths
New `skills/unsure/SKILL.md` and `skills/unsure/IO.md`, `daemon/jobs/host-instructions.ts`, `contracts/jobs.ts` (only if the bundle union lives there), `tests/jobs-instructions.test.ts`, one new `tests/unsure-skill.test.ts`.

## Acceptance
- Model the bundle on `skills/derive/` and `skills/instantiate/`, including their narrow file-delivery permission for `reply.json`.
- Allowed blocks: text and at most one question. The skill tells the model to say what it can and cannot tell from the passage, to name the missing information, and to suggest which of the other seven kinds fits, in words.
- No tools, no fetch, no code execution, no provenance claims.
- The bundle is pinned with digests like the others. The negative load test in `tests/jobs-instructions.test.ts` currently uses `unsure` as the unsupported case. Replace that case with an intent string that is truly unsupported.
- A test asserts an authored unsure reply with one question validates, and one with two questions is refused by the existing clarification budget or schema.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P03.md`

## Stop
Stop after the report. Do not change `ui/margin.ts`.



## Resolution

Installed the eighth host-selected instruction bundle with canonical digest binding, complete per-part origins, declarative uncertainty and at most one clarifying question. Unsupported-intent test uses a truly unsupported value. Chief read both skill files and tests; independent focused8/8 pass. Selected Sol medium, actual serving backend/account unexposed. No live model output is claimed.
Independent chief gate: local HEAD6b3b246a9c423afa9ff547c07192d37661dc37b2 plus uncommitted snapshot, source hashes stable before/after. npm test1004 total/997 pass/0 fail/7 skipped,25195.7959ms; npx --no-install tsc --noEmit exit0; npm run extension:typecheck exit0; npm run extension:build exit0. Windows10.0.26200/Node24.14.1/npm11.11.0. Raw logs and source manifests: D:/Projects/Marginalia/.local/polish/logs/P03-P08-P13-chief-gate-20260918. Receipt SHA256 78EE0057A4A019FC970ACD15DAA2A2793E5B5D365E4F881FB95984BFB4B8053A.

Seven skips: POSIX service lifecycle, POSIX file modes, native Windows history-link/reparse host run, reply-path POSIX FIFO, solver-path POSIX FIFO, T18 Chromium unset, POSIX data-directory permissions. This is local automated evidence, not all-OS CI or live browser/provider/confinement acceptance. Q03/Q04/Q06/native install/H17/H15 and the Yash-driven live checklist stay open. No git writes or publication. Reporting-only ticket/map updates follow the checked source snapshot.
