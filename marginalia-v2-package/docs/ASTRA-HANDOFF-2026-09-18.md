# Astra handoff, 2026-09-18

Written by Fable (Claude Fable 5.1) at the end of the chief-builder session. Everything under "Verified" was checked against files, git, and a live test run. Everything under "Claimed" comes from worker reports and has not been checked in a real browser or on another OS.

Read in this order: this file, then `wayfinder/astra/MAP.md`, then `docs/ASTRA-LEAD-PROMPT-2026-09-18.md` (the prompt Astra runs from), then `docs/NEXT-BUILD-PLAN-2026-09-18.md` (the advisor view).

## 1. Where the code is

| Item | Value |
| --- | --- |
| Repository | `D:\Projects\Marginalia`, remote `https://github.com/yashgurbani/marginalia.git` |
| Branch | `codex/marginalia-v2` |
| Package | `marginalia-v2-package/` (Node 24, TypeScript ESM with `.ts` specifiers, node:test) |
| Head at handoff | `fdb12dc` (Merge branch 'fable/m14-m18') |
| Origin at handoff | `caa010c` before the final push in §7; see §7 for the pushed head |
| Suite at head | 785 tests, 780 pass, 0 fail, 5 skipped (POSIX-only) |
| Typecheck | `npm run typecheck` clean; `npm run prepare && npm run extension:typecheck` clean |

Commands: `npm test`, `npm run typecheck`, `npm run prepare` (runs `wxt prepare extension`, required before) `npm run extension:typecheck`, `npm run extension:build`, `npm run build` (web app). Known flakes: one journey-e2e case, `tests/jobs-workspace-integrity.test.ts`, `tests/solver-recompute.test.ts` "two concurrent clicks are one run". Rerun once before treating a failure as real. Ticket Q09 removes them.

## 2. What merged this session (verified)

Baseline for the session was `d420221`. Non-merge commits since, oldest first:

| Commit | Change | Files |
| --- | --- | --- |
| `d20289a` | Pro long-horizon review doc: single-message variant | `docs/PRO-LONG-HORIZON-2026-09-18.md` |
| `4517a21` | Stage 1: precise reading position from the first fully visible text node, section-start fallback | `ui/margin.ts`, tests |
| `9337135` | Stage 1: exact reviewed outgoing parts retained per attempt (`JobAttempt.sentContent`), written in the same transaction as provider handoff | `contracts/jobs.ts`, `daemon/jobs/store.ts` (`recordSentContent`), `daemon/jobs/service.ts`, `tests/jobs-lifecycle.test.ts` |
| `026b945` | M9: remove or restore one note with Undo, through the reader mutation reducer (`note-remove`) and the store | `contracts/reader.ts`, `daemon/store.ts`, `ui/journal.ts`, `ui/margin.ts`, tests |
| `a0c3f4f` | P10/P11: alarm-backed helper reconnect that survives service-worker eviction; workspace bindings cleared on tab close or navigation | `extension/lib/helper-reconnect.ts`, `extension/entrypoints/background.ts`, `extension/wxt.config.ts` (`alarms` permission), tests |
| `5d6f9b7` | M17/M11: plain migration failure message with backup path and exit 1; one thread open at a time, remembered per page | `daemon/main.ts`, `ui/margin.ts`, tests |
| `6cc7eb8` | P4: migration 7004 adds seven indexes, `list()` statements cached, URL filter in SQL, FTS rows erased with their thread and restored on undo | `daemon/store.ts`, `tests/store.test.ts` |
| `4bf2280` | P9/P1(b,c)/P7: `object-src 'none'; base-uri 'none'` on the static CSP; extension CSP tightened; web-accessible resources narrowed to `panel.html`; `.npmrc` engine-strict; three-OS CI at `.github/workflows/ci.yml`; test glob `tests/**/*.test.ts` | `daemon/server.ts`, `extension/wxt.config.ts`, `package.json`, `.npmrc`, `../.github/workflows/ci.yml`, `tests/server.test.ts` |
| `b04899a` | M14/M18: narrow-viewport sheet stays open on rail click (root cause: `sourceAction` called `closePanel` right after `showPanel`; initial collapsed state applied after hydration); focus returns to the opener; "Library" bar action calls `onLibrary`; extension panel passes `onLibrary` opening the helper web app root in a new tab when paired | `ui/margin.ts`, `ui/margin.css`, `extension/entrypoints/panel/main.ts`, `tests/margin-entry.test.ts` |

Per-worker reports live in each worktree under `.local/fable-<name>/report.md` (untracked, never committed). Worktrees: `D:/Projects/Marginalia-worktrees/fable-<name>` on branch `fable/<name>`.

## 3. Still in flight at handoff

**M13 installer (robi account, Sol medium)**, worktree `D:/Projects/Marginalia-worktrees/fable-m13-installer`, branch `fable/m13-installer` at `caa010c`. Packet: `scripts/install-helper.ps1` (Scheduled Task, `-Uninstall`, `-DryRun`), `scripts/install-helper.sh` (LaunchAgent or systemd user unit, `--uninstall`, `--dry-run`), README "Install the helper" section, `tests/fresh-machine.test.ts` (fresh data dir issues a pairing challenge; pair, write a thread, stop, restart, read it back; empty `MARGINALIA_CODEX_HOME` still starts). At handoff the worker had written the test file and was finishing the scripts. Final message lands at `scratchpad/codex-runs/m13-installer-last.md` in Fable's scratchpad and the report at `.local/fable-m13-installer/report.md` in the worktree.

To integrate (ticket E01): in the worktree, `git status --short | grep -v .local`, read the diff, `git add` scripts, README, tests only, commit on `fable/m13-installer`, `git merge --no-edit fable/m13-installer` into `codex/marginalia-v2`, run `npm test` and `npm run typecheck`, push.

**GPT-6 Pro long-horizon review** (Phases 1 to 5 of `docs/PRO-LONG-HORIZON-2026-09-18.md`), running outside this repo. Do not wait for it. Ticket E14 triages it when it lands.

**Docs refresh** (Luna max on the lrh account) failed twice with "Selected model is at capacity"; worktree `fable-docs-refresh` has no changes. Ticket E15 re-runs it after E01.

## 4. Claimed but not verified

- No real-browser check of any extension change this session: CSP after P1(b), WAR narrowing, alarm reconnect, workspace-key cleanup, the narrow sheet, the Library tab. Ticket Q07.
- macOS and Linux behaviour of anything (no WSL or Docker on this machine). CI from P7 has not run yet because it was not pushed until §7. Tickets E02 and Q08.
- Index selection is proven by `EXPLAIN QUERY PLAN` tests, not by timing.
- The Library action opens the web app root (`new URL('/', origin)`); the worker did not confirm the web app's library path. Check `webapp/main.ts` `openLibrary` in Q07.

## 5. Architecture in one page

- **`contracts/`** (2,240 lines): the types and validators everything else agrees on. `reader.ts` (threads, notes, anchors, `ReaderMutation`), `jobs.ts` (`Job`, `JobAttempt` with `sentContent`, `JobState`), `consent.ts` (`OutgoingPart`, review sheet shape), solver and renderer contracts. Change these first and last; a contract change without a test in `tests/` is incomplete.
- **`daemon/`** (about 7,000 lines with `jobs/` and `solver/`): the local helper on `127.0.0.1:43120`. `main.ts` reads `MARGINALIA_DATA_DIR`, `MARGINALIA_PORT`, `MARGINALIA_CODEX_EXECUTABLE`, `MARGINALIA_CODEX_HOME`, `MARGINALIA_AUTHORIZED_RUNTIME_MODULE`, starts the server, prints a plain migration failure with the backup path. `server.ts` (419 lines): one request handler with inline routes, pairing at lines 77-78, static assets with the locked CSP at line 358. `store.ts` (675 lines): SQLite reader store, migrations by membership (`READER_MIGRATIONS = [1,2,4,7001,7002,7004]`), FTS5 `search` table as a documented erasure target. `jobs/` : job store and service with the six entry points (start, retry, followup, cancel, dispatch, settle) and the send fences (`assertDispatchFence`, `prepareSendCheckpoint`, `recordSentContent`). `solver/`: the interactive reply engine and its lazy transport; `solver-bindings.ts` binds a reply to an interpreter (pinning is ticket E07).
- **`ui/`** (3,626 lines): `margin.ts` (1,183 lines) mounts the margin: rail, threads, composer, ask and review sheet, settings, reading position, sheet under 900px. `margin.css` holds the design system (`--m-*` tokens, `.m-meta` register). `journal.ts` and `persistence.ts` are the local reducer and storage. `consent.ts` builds the review sheet copy (line 45-46 carries the network promise, gate H01).
- **`renderer/`** (904 lines): renders the interactive reply; classification title suppression at `index.ts:237-257` is a Stage 3 item (E13).
- **`webapp/`**: Vite app that hosts the margin and library against the helper.
- **`extension/`**: WXT MV3. `entrypoints/background.ts` (alarm reconnect, workspace cleanup), `content.ts`, `panel/main.ts` (side panel host, passes `onLibrary`), `options/`, `workspace/`. `lib/helper-reconnect.ts`, `lib/protocol.ts`. `wxt.config.ts` holds manifest, CSP and permissions (`alarms`, side panel). Icons are missing (E03).
- **`tests/`** (72 files, 14,949 lines): node:test, jsdom for margin tests, real child processes for helper startup.

## 6. Rules that stay in force

- Governing product decisions: source unchanged; notes senior to replies; no implicit send on select, "?", reopen, reconnect or recover; review the exact outgoing content and recipient before inference; four execution paths distinct; fetched evidence is not support; requested sandbox is not confinement; Windows, Linux and macOS; preserve the design system.
- Founding documents outrank derived ones: the whitepaper (`Marginalia — Research Whitepaper.md`), `PRODUCT.md`, `docs/BUILD-PLAN.md` at repo root. All three are untracked on purpose and stay untracked. Root `CONTEXT.md` and `README.md` carry Yash's uncommitted edits and stay uncommitted.
- Git: never force-push, reset, delete worktrees, or mass-commit untracked content. Commit source and tests only; `.local/`, `.scratch/`, evidence zips and `t04-*` folders stay out. Push at milestones.
- Workers: isolated worktree per writer (`git worktree add -b fable/<name> D:/Projects/Marginalia-worktrees/fable-<name> codex/marginalia-v2`, then a `node_modules` junction to the main package; `npm ci` fails in worktrees). Every worker reports actual model and effort, changed paths, checks with totals, and uncertainty. A claim without a test name or evidence path is unverified.
- Never print token or auth file contents; copy auth files, never move them.
- Identity decisions are human-gated (H tickets). Yash's twenty-minute reading verdict (H15) is a release gate beside the automated gates.

## 7. Push state

Fable commits `wayfinder/astra/`, this handoff, the lead prompt and the next build plan after writing them, then pushes `codex/marginalia-v2`. The pushed head is recorded in `wayfinder/astra/MAP.md` under Decisions so far.

## 8. Accounts and tooling state (for Fable-side sessions)

Codex exec fallback per account: `CODEX_HOME=$LOCALAPPDATA/Codex-Profile-System/mcp-homes/<Profile>` with `codex exec -C <cwd> -m gpt-5.6-sol -c 'model_reasoning_effort="medium"' -s danger-full-access --skip-git-repo-check -o <last.md> -`. Homes: robi `Codex-22-a59b09c46f098109`, allen `Codex-23-6919e592f2012d2b`, tw `Codex-25-105ecd95323a5178`, lrh `Codex-26-b746ce8e787bae30`, merlin `Codex-27-merlin`. gs is reserved for Yash. jill is capped until 2026-09-24 15:11. Luna max on lrh returned "at capacity" twice on 2026-09-18. Yash's credits are near their limit at handoff: no new workers without his go-ahead.

## 9. Next actions, in order

1. Integrate M13 when its final message appears (E01), rerun the suite, push.
2. Yash resolves H01, H09, H11, H12 in one sitting (all have Fable recommendations in the tickets).
3. Astra starts wave one from `docs/ASTRA-LEAD-PROMPT-2026-09-18.md`: E02, E03, E09, Q01, Q03, Q07.
4. E15 docs refresh once E01 is closed, so every number in the four dated docs matches the live suite.
