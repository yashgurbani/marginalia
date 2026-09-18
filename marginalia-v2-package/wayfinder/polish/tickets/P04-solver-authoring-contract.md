# Solver authoring contract

status: closed
type: build
blocked by: none

## Goal
The whitepaper's third movement path is "saved-solver recompute on the reader's machine". A live "See it" reply can never create a saved solver today. `skills/simulate/SKILL.md:43` forbids executable files and `skills/simulate/IO.md` leaves `solver` out of the allowed blocks, while the host supports solver artifacts (`daemon/jobs/solver-bindings.ts:23`, `:43`, `:55`). Define one explicit, manifest-bound way for a simulate job to author a solver. This ticket sets the contract and its validation. It does not execute anything.

## Owned paths
`skills/simulate/SKILL.md`, `skills/simulate/IO.md`, `contracts/solver.ts`, `daemon/jobs/solver-bindings.ts`, `tests/solver-bindings.test.ts`, `tests/simulate-skill.test.ts`, the pinned digest for the simulate bundle wherever it is recorded.

## Acceptance
- Solver authoring is a host-selected mode. The default simulate request stays declarative and keeps today's prohibitions. The packet tells the model when solver authoring is permitted. The skill text never lets the model decide that itself.
- In that mode the model may write exactly one solver file plus one manifest, at fixed names inside the workspace. The manifest lists each file with its SHA-256, the declared inputs with ranges, and the declared outputs.
- The host validates: manifest schema, every listed file present with matching digest, no unlisted file, no link or special file, size limits, inputs matching the reply's solver block.
- Tests cover: a valid artifact pins; an extra file, a changed file, a linked file and an undeclared input are each refused.
- The skill still forbids fetch and forbids running the solver. Execution claims stay with the host.
- Reuse existing types and checks in `contracts/solver.ts` and `solver-bindings.ts` before adding new ones. If the existing contract already covers part of this, say so in the report and build only the missing part.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P04.md`

## Stop
Stop after the report. Do not edit `daemon/jobs/workspace.ts`. That belongs to Reviewed solver artifacts survive continuation.

## Correction 1 (started 2026-09-18, result unverified)
status: built, not accepted. Code sits uncommitted in `skills/simulate/`, `contracts/solver.ts`, `daemon/jobs/solver-bindings.ts`, `tests/solver-bindings.test.ts`, `tests/simulate-skill.test.ts`.

The new manifest rule fails nine older tests with "The solver manifest is missing or changed.": `tests/solver-gate.test.ts` :104, :123, :146, :161, :183, `tests/solver-route-mount.test.ts:110`, `tests/stage0-journey.test.ts:27`.

Required change:
- Owned paths now include those three test files and any shared solver fixture helper they import.
- Give the fixtures a valid `solver/manifest.json` through one shared helper. Keep the host check as strict as it is. Delete no assertion.
- A solver thread saved before this change has no manifest. It must refuse plainly with a reader-facing sentence, keep the saved reply readable, and never run an unpinned solver. One test covers it. The report names the file and line.
- The simulate bundle digest: the first build left the pinned digest fixture unchanged. Confirm the host instruction tests still pin the new `SKILL.md` and `IO.md`.
- Done when the focused solver tests pass and the four checks show zero failures.

A worker was partway through this at handoff. Inspect the working tree before redoing anything. Report and log: `D:\Projects\Marginalia\.local\polish\reports\P04.md`, `logs\P04-c1.log`.

## Correction 2: chief acceptance review

The persisted legacy solver now refuses before authority or execution in focused tests, while its succeeded reply remains readable. Focused56/56 passes; the earlier validating-job test was insufficient and remains documented in the report.

Two acceptance gaps remain under correction: default runtime capabilities currently authorize solver authoring for every simulate request; a missing-manifest helper conflict becomes a generic margin message. The technical correction preserves the existing product requirement of default declarative simulation and explicit host-selected authoring.

Chief-expanded owned paths: daemon/jobs/service.ts, daemon/runtime-policy.ts, contracts/jobs.ts only if host-default types require it, daemon/solver/service.ts, daemon/solver/adapters.ts, ui/solver-recompute.ts, and focused regressions in their existing test files. No ui/margin.ts or workspace.ts changes in this correction. No live execution or runtime-confinement exception is authorized. Chief full four-check acceptance follows the settled snapshot.

## Resolution

Closed by Codex chief on2026-09-18 after independent source review and all four checks on a stable local snapshot at HEAD6b3b246a9c423afa9ff547c07192d37661dc37b2 plus the preserved uncommitted changes. No product code was committed or published.

- npm test:986 total/980 pass/0 fail/6 skipped,25195.9889ms, exit0.
- npx --no-install tsc --noEmit: exit0.
- npm run extension:typecheck: exit0.
- npm run extension:build: exit0.
- Windows10.0.26200, Node24.14.1, npm11.11.0. This is local Windows evidence, not a new all-OS CI claim.
- Exact checks, raw logs and before/after file hashes: D:/Projects/Marginalia/.local/polish/logs/P01-P04-chief-gate-final-20260918/. Source hashes stayed identical during all checks.
- Receipt SHA256: C3724CC5B6F22EF188DF62D64D603F27F39A9A03B1793A4B42D4806123EE0A54.

Six skips: POSIX service lifecycle, POSIX file permissions, native Windows reparse/link host behavior, POSIX FIFO, opt-in T18 Chromium (T18_CHROMIUM unset), POSIX private data-directory permissions. These gaps remain explicit.
P04 acceptance: host-selected authoring is explicitly off by default and requires a trusted host opt-in plus workspace-files simulate mode. Reviewed capabilities remain frozen through retry/follow-up. Fixed solver/main.js and solver/manifest.json are admitted only after schema, inventory, regular-file, size, digest and reply input/output checks. Shared fixtures have real matching manifests. A succeeded saved reply missing its manifest remains readable and receives a typed reader-visible refusal before authority or execution. The renderer maps a bounded code and excludes private raw error text. Canonical installed instruction bytes and the prepared simulate envelope digest pass their binding tests.

Selected worker Sol medium through complementary MCP; actual backend model/effort/account not independently asserted. Chief reviewed all changed behavior. Sol independently reviewed the chief generated-runtime import and the final test-only TestDocument cast (existing local convention; no blocking concern). Worker focused121/121/0fail/0skip. Detailed report: D:/Projects/Marginalia/.local/polish/reports/P04.md. Earlier failed logs remain, including chief baseline, partial Node syntax failure, and root typecheck failure. One overwritten intermediate focused failure is recovered as a tool receipt at logs/P04-c3-recovered-failed-tool-receipt.json; it is not claimed to be the original full raw log.

This closes the authoring/admission contract only. Production authoring stays disabled until a trusted host explicitly selects it. Continuation is P05; actual permitted execution is P06. No live provider, solver confinement or native installation evidence is claimed. Q03/Q04/Q06/H17/H15 remain open.
