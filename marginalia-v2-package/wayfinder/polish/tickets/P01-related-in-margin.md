# Related saved passages in the margin

status: closed
type: build
blocked by: none

## Goal
The whitepaper's bottom zone shows "related things in the library". Today `ui/margin.ts:436` prints "Related items · not available in this version." The local query already exists at `daemon/library.ts:40` and is used by `ui/library/index.ts:153`. Connect the margin footer to it.

## Owned paths
`ui/margin.ts` (footer only), the existing host bridge the margin already uses to reach the helper (`ui/asking-host.ts` or the persistence bridge, whichever already carries authenticated local reads), `ui/margin.css` (only if a rule is needed), `tests/margin-entry.test.ts`, one new test file if cleaner.

## Acceptance
- When the helper is paired and the page has saved passages that overlap other saved sources, the footer lists up to three related passages. Each shows the other source's title and the quoted words, and opens that saved source.
- When there are none, the footer shows one quiet line saying no related saved passages were found. When the helper is unavailable, it says related passages need the local helper.
- The lookup is a local read. It makes zero provider requests, creates zero jobs and zero egress events. A test asserts this.
- Nothing is looked up or sent on selection. The lookup runs on page load and after a save, against the local helper only.
- Existing footer actions and their tests keep working.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P01.md`

## Stop
Stop after the report. Do not start the speech or Save/Park footer work.

## Correction 1 (open, not yet run)
status: built, not accepted. Code sits uncommitted in `ui/margin.ts` and `tests/margin-entry.test.ts`.

The first build reads from the helper when the margin loads. These tests forbid that and stay unchanged: `tests/margin-recovery.test.ts` :181, :198, :230, :258 and `tests/e33-webapp-open.test.ts:7`. They encode the rule that nothing is looked up on load, reopening, reconnecting or recovery.

Required change:
- Related starts closed, as a quiet disclosure labelled "Related".
- The lookup runs only when the reader opens it. It refreshes after a local save only while open.
- Zero helper reads on mount, reopen, reconnect, recovery or selection. `tests/margin-entry.test.ts` asserts zero reads before the reader opens Related.
- Owned paths stay `ui/margin.ts`, `ui/margin.css`, `tests/margin-entry.test.ts`.
- Done when the three test files above pass and the four checks show zero failures.

Also unverified from the first build: browser layout, and the saved source opens as a read-only footer preview instead of a library route. First report: `D:\Projects\Marginalia\.local\polish\reports\P01.md`.

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
P01 acceptance: Related begins closed and only its explicit opening reads local related passages. Local saves refresh while it is open; selection and closed saves stay quiet. Three maximum saved-source passages, empty/helper-needed states, validated source opening and immutable footer fallback are covered. Unchanged recovery/e33 tests pass. Chief focused80/80 plus standalone Chrome disclosure, desktop layout and Space-to-close were observed. Paired browser/loaded-extension and narrow-layout evidence remain unobserved. No provider request/job/egress occurs in the integration regression. Detailed report: D:/Projects/Marginalia/.local/polish/reports/P01.md. Q03/Q04/Q06/native/H17/H15 remain open.
