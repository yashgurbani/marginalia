<!-- Drafted by Opus 5 workflow 2026-09-18 from the test inventory and gap reports. Saved unedited by Fable. -->

# QA handoff — Marginalia

For: Astra (gpt-6-astra, low effort), acting as QA and verification lead.
From: Fable (Claude), who wrote the code under test.
Repository: `D:\Projects\Marginalia\marginalia-v2-package`
Branch: `codex/marginalia-v2`, head `dcc8aa9`.
Date written: 2026-09-18.

You verify. You do not develop. Yash asked for that split.

---

## 1. Purpose and rules

### What this guide is for

Marginalia has 689 automated tests and a clean typecheck. It has no accepted product run. `BUILD-STATUS.md` states it plainly: "No accepted real reader-to-provider-to-saved-solver journey exists yet." Your job is to produce first-hand evidence about what the product actually does on a real machine, in a real browser, on three operating systems.

### Rules

1. **Report observed results only.** Write what you saw, what command produced it, and where the output file is. Do not write "should", "presumably" or "likely". If you did not run it, mark it NOT RUN.
2. **A passing suite is not product acceptance.** Nearly every suite injects fakes below the seam it tests. Section 4.4 lists what the green run does not cover. Never write "verified" on the strength of a unit test alone.
3. **Yash's experiential verdict is a release gate.** Reading quality, margin legibility, note primacy and copy tone are his call, not yours and not a test's. Capture screenshots so he can judge; do not grade them yourself.
4. **Never modify source to make a check pass.** If a check fails, record the failure and move on. If a check cannot run, record why. A patch from you invalidates the evidence.
5. **Do not fix defects.** File them using the template in section 11. Fable fixes; you verify the fix.
6. **File all evidence under `docs/evidence/qa-2026-09-18/`** in the package directory. One file per script, named exactly as this guide names it. Raw command output, unedited, plus a short observed-result note at the top.
7. **Fail-closed is not a defect.** Section 2.3 lists three behaviours that are deliberately off. Reporting them as bugs wastes a cycle.
8. **Do not commit source.** Evidence files only, and only if Yash asks for a commit.

### Evidence file header

Put this at the top of every evidence file:

```
Host: <OS name and version>
Node: <node --version>
Commit: <git rev-parse HEAD>
Date: <ISO date and time>
Script: <section number and name from this guide>
Result: PASS | FAIL | BLOCKED | NOT RUN
```

---

## 2. State of the branch, and what is deliberately off

### 2.1 Branch state (observed 2026-09-18)

`git branch --merged HEAD` on `codex/marginalia-v2` at `dcc8aa9` includes both `fable/journey` (merged at `ddc5ac7`) and `fable/t20-mount` (merged at `dcc8aa9`). **Nothing in this guide waits on an unmerged branch at this commit.**

Run this first and paste the output into your evidence:

```
git rev-parse HEAD
git branch --merged HEAD
```

If you are handed an older checkout, these items need the named branch:

| Item | Needs branch | What it added |
|---|---|---|
| Section 6 (reader journey on the extension surface), retained-request reopen, extension-origin admission | `fable/journey` | `AskingContext.surface`, retained requests reopen by GET only, extension-origin admission test |
| Section 8 (T20 recompute), `/api/solver/*` routes, `solver_artifact_bindings` | `fable/t20-mount` | `daemon/jobs/solver-bindings.ts`, solver route mount in `daemon/server.ts`, thread-bound pairing |

### 2.2 Baseline recorded on the development host

Windows 11 Pro 10.0.26200, Node v24.14.1, commit `dcc8aa9`:

- `npm test` → tests 689, pass 686, fail 0, skipped 3, duration ~8.9 s.
- `npm run typecheck` → clean, no output.
- `npm run extension:typecheck` → clean, no output.

The test inventory you may have seen quotes 671 tests. That count predates `fable/journey` and `fable/t20-mount`. **Expect 689, not 671.** Record whatever you actually get.

### 2.3 Three behaviours that are off by design

Do not file these as defects. Confirm them, and confirm the wording the product shows.

**a) Model dispatch is hard off.** `daemon/consent/evidence-host.ts:18` returns `readiness: () => ({ ready: false, reasons: [...7 reasons] })` unconditionally. `daemon/main.ts:60` feeds that into `dispatchReady`. `daemon/jobs/service.ts:39` gates `available` on it. So with the stock daemon, `/api/jobs` reports `available: false` and no model turn can ever be dispatched, even with a valid Codex install. The daemon prints: `Reading and notes are ready. Codex execution is unavailable until an authorized runtime is configured.`

Consequence: **section 7's consent and reply scripts cannot complete on the stock daemon.** Run them to confirm the honest unavailable state, not to get a reply.

**b) Saved-solver execution has no mounted backend.** `daemon/server.ts:37-45` constructs `SolverExecutionService` with `unavailableSolverExecutionGate(...)` and `unavailableSolverEvidence(...)`. `GET /api/solver/status` therefore returns `available: false` with reason `Saved-solver execution has no mounted command transport or durable execution gate.`

**c) The reader has no recompute control.** `renderer/index.ts:232` disables the Recompute button when `options.onRecompute` is absent. No file under `ui/` or `webapp/` supplies `onRecompute`, and no UI file calls `/api/solver`. The route mount landed; the reader wiring did not.

### 2.4 One known open defect — confirm, do not fix

`renderer/index.ts:230` builds the recompute request with `stateKey: canonicalReplyData({ reply, parameters })` — a raw canonical JSON string. `contracts/solver.ts:338` (`isSolverStateKey`) requires a 64-character SHA-256 hex digest, and `contracts/solver.ts:737,762` reject anything else as `invalid-request`. Any adapter that wires the reader control must hash the canonical string with `solverStateKeyFrom` first. Confirm this by reading those lines and record it in `docs/evidence/qa-2026-09-18/known-defects.md`. Do not patch it.

---

## 3. Environment setup

### 3.1 All operating systems

Required: Node >=24 <25. `package.json` `engines` enforces it. Node 22 and Node 25 are not supported.

```
node --version
cd <repo>/marginalia-v2-package
npm ci
```

Windows note: if you work inside a git worktree rather than the main checkout, `npm ci` fails. The project convention is a directory junction from the worktree's `node_modules` to the main package's `node_modules`. Prefer running in the main checkout `D:\Projects\Marginalia\marginalia-v2-package`.

### 3.2 Windows 11

```
node --version
npm ci
npm test
npm run typecheck
npm run build
npm start
```

Chrome 116 or later is required for the extension. For the extension build:

```
npm run extension:build
```

Unpacked output lands at `extension/.output/chrome-mv3` (gitignored). Load it in Chrome via `chrome://extensions` → Developer mode → Load unpacked.

Symlink note: `tests/saved-solver-transport.test.ts:747` skips itself at runtime if the host cannot create symlinks without elevation. On the development host it did **not** skip, so Developer Mode or elevation was active. If your Windows run shows 4 skips instead of 3, that test is the fourth. Record which.

### 3.3 Linux

```
node --version          # must be 24.x
npm ci
npm test                # this is the run that matters — see section 5.1
npm run typecheck
npm run build
npm start
```

Data directory defaults to `$XDG_DATA_HOME/Marginalia` or `~/.local/share/Marginalia`.

Linux is the primary host for the two POSIX-only workspace tests (section 5.1). Those tests use `mkfifo` via `execFileSync`. Confirm it exists: `command -v mkfifo`.

### 3.4 macOS

```
node --version
npm ci
npm test
npm run typecheck
npm run build
npm start
```

Data directory defaults to `~/Library/Application Support/Marginalia`.

macOS is the second host for the POSIX-only tests and the only host that can exercise the `macos-seatbelt` evidence path.

### 3.5 Environment variables (daemon)

| Variable | Meaning | Notes |
|---|---|---|
| `MARGINALIA_DATA_DIR` | Absolute data directory | DB at `<dataDir>/marginalia.sqlite`, job workspaces at `<dataDir>/jobs`. Use a throwaway directory per script so you can inspect a clean store. |
| `MARGINALIA_PORT` | Default 43120 | Integer 1-65535. Port in use prints `Another program is using port N...` and exits 1. |
| `MARGINALIA_CODEX_EXECUTABLE` + `MARGINALIA_CODEX_HOME` | Dedicated Codex runtime | Both must be set, both absolute, executable must be a real file (`.exe` on Windows), home must be a real directory, and the home must not nest with `~/.codex` or `$CODEX_HOME` in either direction. Any failure silently returns no identity — reading and notes still work. |
| `MARGINALIA_AUTHORIZED_RUNTIME_MODULE` | Path to a module exporting `createAuthorizedRuntime({dataDir, store, consent})` | Fully replaces the `MARGINALIA_CODEX_*` path. Must reuse the passed consent authority and supply `jobDefaults` or startup throws. Diagnostics then report `policyEvidence: external-runtime-not-verified-here`. **No test covers this loader.** |
| `T18_CHROMIUM` | Path to a Chromium binary | Enables the only browser-driving test. Unset means skip. |

---

## 4. Automated checks

### 4.1 Commands and expected results

Run each from `marginalia-v2-package`. Capture full stdout and stderr.

| Command | Expected on a healthy checkout | Evidence file |
|---|---|---|
| `npm test` | tests 689, pass 686, fail 0, skipped 3 | `docs/evidence/qa-2026-09-18/<os>-npm-test.txt` |
| `npm run typecheck` | no output, exit 0 | `docs/evidence/qa-2026-09-18/<os>-typecheck.txt` |
| `npm run extension:typecheck` | no output, exit 0 | `docs/evidence/qa-2026-09-18/<os>-extension-typecheck.txt` |
| `npm run build` | `webapp/dist` produced | `docs/evidence/qa-2026-09-18/<os>-build.txt` |
| `npm run extension:build` | `extension/.output/chrome-mv3` produced | `docs/evidence/qa-2026-09-18/<os>-extension-build.txt` |

`<os>` is one of `win`, `linux`, `mac`.

`npm run build` is not optional. `daemon/main.ts` serves `webapp/dist` as its web root. Without a build, the daemon serves nothing and every reader script in section 6 fails for the wrong reason.

### 4.2 How to read the skips

List the skipped test names, do not just count them:

```
npm test 2>&1 | grep "﹣"
```

Expected on Windows (3):

- `a linked history directory is rejected before creating descendants through it` — `# Native Windows link/reparse behavior requires its own host run.`
- `a reply path swapped for a FIFO is rejected without blocking` — `# POSIX FIFO only`
- `bounded T18 browser regressions` — `# SKIP` (because `T18_CHROMIUM` is unset)

Expected on Linux and macOS (1): only `bounded T18 browser regressions`, unless you set `T18_CHROMIUM`.

A skip is not a pass. `tests/renderer-samples.test.ts` says so in its own comment: the absence of `T18_CHROMIUM` is "never evidence that browser focus/readiness was verified."

### 4.3 The browser regression set

```
# Linux/macOS
T18_CHROMIUM=/path/to/chromium npm test
```

```
# Windows PowerShell
$env:T18_CHROMIUM = "C:\path\to\chrome.exe"; npm test
```

Expected: `bounded T18 browser regressions` runs with 6 sub-checks, 90 s timeout. Record all six names and their results in `docs/evidence/qa-2026-09-18/<os>-t18-browser.txt`.

### 4.4 What a fully green run still does not cover

State this in your report so nobody over-reads the number:

- No real Codex process. Every provider test injects a fake transport.
- No real OS sandbox. `tests/saved-solver-service.test.ts` says outright its fixtures "prove nothing about any real sandbox".
- No successful daemon boot. `tests/helper-startup.test.ts` only covers the port-in-use failure path.
- No real browser trust. Every `Origin` and `Sec-Fetch-*` header in the server tests is hand-set over `node:http`.
- No real IndexedDB, Web Locks, BroadcastChannel or service-worker lifecycle. `tests/t05-harness.ts` reimplements all four.
- No extension runtime. Nothing loads the MV3 build.
- No real reply renderer and no real consent sheet as mounted. The t05 harness stubs both.
- No layout, contrast-as-painted, focus order or screen-reader behaviour. `tests/t05-dom.ts` hard-codes `clientHeight` 600 and `offsetHeight` 32.

---

## 5. Pending items carried from previous runs

Six known gaps. Each has an owner action and an evidence file.

### 5.1 POSIX FIFO and link tests have never executed

`tests/jobs-workspace-integrity.test.ts` holds two tests that skip on Windows:

- `a linked history directory is rejected before creating descendants through it`
- `a reply path swapped for a FIFO is rejected without blocking`

The development host has no WSL distro and no Docker, so neither has ever run. The T06 FIFO fix recorded at commit `61eeffe` has **no passing verification anywhere**.

Action: run `npm test` on Linux and on macOS. Confirm both tests appear as passes, not skips. Record the exact lines.

Evidence: `docs/evidence/qa-2026-09-18/linux-npm-test.txt`, `docs/evidence/qa-2026-09-18/mac-npm-test.txt`, and a one-page summary `docs/evidence/qa-2026-09-18/posix-workspace-integrity.md` naming both tests and their results.

### 5.2 Cross-origin GET `/api/jobs` from a `chrome-extension://` origin

Never exercised against a running daemon from a real browser. Only hand-set headers over `node:http`.

What the code does: `daemon/server.ts:53` admits an origin that is either the daemon's own origin or matches `chrome-extension://[a-p]{32}` (or the Firefox UUID form). `daemon/server.ts:100` rejects anything else with 403 `This page cannot connect to the local helper.` `daemon/server.ts:126` derives `authOrigin` from the `Origin` header, or from a same-origin GET carrying `sec-fetch-site: same-origin`.

Action: see script 6.7.

Evidence: `docs/evidence/qa-2026-09-18/extension-origin-api-jobs.md` plus a HAR export or DevTools network screenshots.

### 5.3 Daemon shutdown on SIGTERM while a job is mid-read

`daemon/main.ts:97` registers `SIGINT` and `SIGTERM` handlers that close the readline interface, await `server.close()` and exit 0. `server.close()` closes the solver, terminates every WebSocket client, closes the HTTP server, awaits `jobs.close()` and closes the store. None of this is covered by a test.

Action: see script 7.5.

Evidence: `docs/evidence/qa-2026-09-18/sigterm-mid-read.md`.

### 5.4 Fresh-machine install on Windows, Linux and macOS

Never done on any machine other than the maker's Windows host. Includes pairing, daemon-stop recovery and Codex sign-out recovery.

Action: see section 9.

Evidence: `docs/evidence/qa-2026-09-18/install-<os>.md`, one per OS.

### 5.5 Saved-solver recompute with zero model turns

Needs an RPC transcript, an egress-table diff and a grant-counter reading. The route mount landed at `dcc8aa9`; the **execution backend did not** (section 2.3b) and the **reader control did not** (section 2.3c).

Action: see section 8. Today the achievable evidence is that the route exists, enforces authority and reports unavailable honestly.

Evidence: `docs/evidence/qa-2026-09-18/t20-routes.md` now, `docs/evidence/qa-2026-09-18/t20-recompute.md` when the backend lands.

### 5.6 The stage gates in `wayfinder/BUILD-PLAN-24H.md`

See section 10. Report one discrepancy: ticket T12 in that file says "the eight gates recorded with evidence", but the "Stages and gates" table holds seven rows (0, 1, 2, 3, 4, 5a, 5b). Record the seven that exist and flag the count mismatch to Fable.

---

## 6. Reader-journey manual script

Run this on each OS. The whole script assumes `npm run build` has produced `webapp/dist`.

### 6.0 Setup

Use a fresh data directory so the store starts empty.

```
# Linux/macOS
export MARGINALIA_DATA_DIR=$HOME/marginalia-qa/run1
mkdir -p "$MARGINALIA_DATA_DIR"
npm start 2>&1 | tee ~/marginalia-qa/daemon-run1.log
```

```
# Windows PowerShell
$env:MARGINALIA_DATA_DIR = "D:\marginalia-qa\run1"
New-Item -ItemType Directory -Force $env:MARGINALIA_DATA_DIR
npm start 2>&1 | Tee-Object -FilePath D:\marginalia-qa\daemon-run1.log
```

**Expected daemon stdout, in order:**

1. `Marginalia local helper: http://127.0.0.1:43120` (or your port)
2. `Pairing code: NNNNNN (valid for five minutes, one use)`
3. `Reading and notes are ready. Codex execution is unavailable until an authorized runtime is configured.`
4. `Enter pair here to renew the pairing code. This replaces any unused code.`
5. `Codex: <status>; sign-in: <login>. Execution remains unverified.`

Record all five lines verbatim. Line 3 is the observable confirmation of section 2.3a. Line 5 may take a moment or may report diagnostics unavailable; both are acceptable, record which.

### 6.1 The no-send proof method

You use this after every step. Two instruments.

**Instrument A — the store.** Query the SQLite file directly. Any SQLite client works.

```
sqlite3 "$MARGINALIA_DATA_DIR/marginalia.sqlite" \
  "select count(*) as egress from egress_events;
   select count(*) as jobs from jobs;
   select id, state, dispatchClaimed, handoffMarked from job_attempts;
   select id, site, scope, recipient, decision, revokedAt from grants;"
```

`egress_events` is the send ledger. Its columns are `id, jobId, attemptId, grantId, grantRevision, recipient, scope, provider, policyKey, contextHashes, permissionFingerprint`. **One row means one outgoing dispatch happened.**

**Instrument B — the daemon log.** Nothing in the log should reference a provider dispatch during the no-send steps.

**The invariant to prove at every step in 6.2 through 6.5:**

```
select count(*) from egress_events;                          -->  0
select count(*) from job_attempts where dispatchClaimed = 1; -->  0
```

Run both after every numbered step and paste the results into the evidence file against the step number. If either becomes non-zero before the explicit approval in section 7.1, **stop the script and file a P1 defect.** That is the product's central promise failing.

### 6.2 Open the reader and pair

1. Open `http://127.0.0.1:43120` in Chrome.
   - Expected: the reader page loads. A blank page or a 404 means `npm run build` was skipped.
2. Enter the six-digit pairing code from the daemon stdout.
   - Expected: the reader reports a connected helper. Leading zeroes must be preserved — if the code starts with 0, type it exactly.
3. Run the no-send queries.
   - Expected: `egress_events` 0, `dispatchClaimed` 0. Pairing is not sending.
4. Try the same code a second time.
   - Expected: refused. The code is one-use and expires in five minutes.
5. In the daemon terminal, type `pair` and press Enter.
   - Expected: a new code is printed and the old one no longer works.

### 6.3 Read and select — no send

6. Load a real article in the reader.
   - Expected: the source text is unchanged. Nothing is rewritten. The margin sits beside it.
7. Select a passage with the mouse.
   - Expected: the margin offers Keep and Ask. **No network request leaves the page.** Confirm in the DevTools Network panel: it stays empty apart from reader assets.
8. Run the no-send queries. Expected: still 0 and 0.
9. Screenshot the margin beside the selection. File as `docs/evidence/qa-2026-09-18/<os>-margin-selection.png`. Yash judges whether the margin reads well; you only capture it.

### 6.4 Write a note — no send

10. Write a note on the selected passage. Save it with Enter.
    - Expected: the note saves. The note appears above any reply area. The editor keeps focus and caret position.
11. Type a question mark in a note.
    - Expected: an Ask affordance appears. **Typing "?" does not save and does not send.**
12. Run the no-send queries. Expected: still 0 and 0.
13. Confirm the note is durable:

```
sqlite3 "$MARGINALIA_DATA_DIR/marginalia.sqlite" "select count(*) from notes; select count(*) from note_versions;"
```

   - Expected: non-zero. Notes are durable while egress is still 0. That is the point: saving is not sending.

### 6.5 Reopen, reconnect, recover — no send

14. Reload the browser tab.
    - Expected: the note and the reading position come back. Queries: 0 and 0.
15. Close the tab, open a new one, navigate back.
    - Expected: the thread reappears. A retained request reopens by GET only. Queries: 0 and 0.
16. Open a second tab on the same page.
    - Expected: both tabs show the same durable state. No duplicate submission. Queries: 0 and 0.
17. Stop the daemon (Ctrl+C). Wait. Try to edit a note.
    - Expected: the reader states an uncertain or offline result in plain language. It does not claim the note was saved remotely. It does not auto-retry.
18. Restart the daemon with the same `MARGINALIA_DATA_DIR`. Reload the tab.
    - Expected: the note is intact. The pairing still works, or the reader asks you to pair again — record which. Queries: 0 and 0.

### 6.6 The only explicit send

19. Press Ask on the note.
    - Expected on the stock daemon: the reader reports that asking is unavailable, because `/api/jobs` returns `available: false` (section 2.3a). Record the exact wording shown and screenshot it. That wording is a Yash gate.
    - If a consent sheet appears anyway, continue with section 7.1.
20. Run the no-send queries. Expected: still 0 and 0. An unavailable Ask must not create an attempt.

### 6.7 Extension surface and the cross-origin `/api/jobs` check (pending item 5.2)

21. Build and load the extension: `npm run extension:build`, then load `extension/.output/chrome-mv3` unpacked in Chrome 116+.
    - `extension/README.md` records that browser testing was deferred and that the generated build predates the final security and reconnect changes. Rebuild before testing; do not test a stale `.output`.
22. Open the side panel from the toolbar action on a real page.
    - Expected: the margin opens. The page is not modified.
23. Select text on the page.
    - Expected: Keep and Ask are offered. Queries: 0 and 0.
24. With DevTools open on the side panel, watch the network while the panel loads.
    - Expected: a preflight `OPTIONS` to the daemon returns **204** with `Access-Control-Allow-Origin` echoing the `chrome-extension://...` origin and `Access-Control-Allow-Headers: authorization,content-type`.
25. Before pairing the extension, observe `GET /api/jobs` with an `Authorization` header from the extension origin.
    - Expected: **401** with `Pair with the local helper to reopen saved work.`
26. Pair the extension, then repeat.
    - Expected: **200** with a body reporting `available: false` (section 2.3a).
27. Record the extension id you used, the exact status codes, and whether the id matched `[a-p]{32}`. An id outside that character class is refused with 403 at `daemon/server.ts:100`, which would be a real product problem on a differently-packed build. Report it if you see it.
28. Confirm the floating host on a non-side-panel surface contains no private note or library markup. Inspect the DOM of the floating iframe and record what it contains.

Evidence: `docs/evidence/qa-2026-09-18/extension-origin-api-jobs.md`.

---

## 7. Consent, denial, cancellation, unknown, restart

These scripts assume asking can reach a consent sheet. On the stock daemon it cannot (section 2.3a). Run each one, and where the precondition is unreachable record **BLOCKED — dispatch unavailable by design** with the exact product wording you saw instead. Do not simulate.

### 7.1 Consent — exact payload

Precondition: an authorized runtime is configured through `MARGINALIA_AUTHORIZED_RUNTIME_MODULE`, and `/api/jobs` reports `available: true`.

1. Press Ask. The consent sheet appears.
2. Read the sheet. Confirm three things and screenshot each:
   - the exact outgoing text shown matches the passage and the note version you wrote,
   - the recipient is named,
   - the scope wording is understandable without jargon.
3. Press Tab repeatedly.
   - Expected: focus stays inside the sheet. It never escapes to the page behind.
4. Press Escape.
   - Expected: treated as not-now. Not a denial, not an approval.
5. Query `egress_events`. Expected: still 0. Opening and closing a consent sheet sends nothing.
6. Reopen, then approve.
   - Expected: exactly one `egress_events` row appears, with `recipient` and `scope` matching the sheet. Record the whole row.
7. Compare the row's `contextHashes` against what the sheet displayed. If the sheet showed content the row does not account for, that is a P1 defect.

Evidence: `docs/evidence/qa-2026-09-18/consent-exact-payload.md`.

### 7.2 Denial and site exclusion

1. Press Ask, then deny for this site.
   - Expected: `grants` gains a row recording the denial. `egress_events` unchanged.
2. Press Ask again on the same site.
   - Expected: refused without a new sheet and without a send.
3. Exclude the site in Settings. Reload. Press Ask.
   - Expected: the excluded site offers no authorization control at all, and sends nothing.
4. Leave Settings and return.
   - Expected: the pending exclusion survives the round trip.

Evidence: `docs/evidence/qa-2026-09-18/denial-and-exclusion.md`.

### 7.3 Cancellation

1. Start an Ask and approve it.
2. Cancel while it is working.
   - Expected: the margin settles to a cancelled state. It does not claim the provider process stopped. The contract deliberately does not assert confirmed process termination.
3. Query `job_attempts`. Record `state`, `dispatchClaimed`, `handoffMarked` for the attempt.
4. If a reply arrives after the cancel, the saved reply must be preserved and the cancel must not overwrite the view. Record which happened.

Evidence: `docs/evidence/qa-2026-09-18/cancellation.md`.

### 7.4 Unknown outcome

1. Start an Ask and approve it. While it is in flight, kill the provider process or pull the network.
2. Expected: the margin shows an **unknown** outcome with an explicit retry control.
   - It must not say the request failed.
   - It must not say the request succeeded.
   - It must not retry by itself. Watch for at least 60 seconds and confirm no new attempt appears.
3. Query `job_attempts` repeatedly across that minute. The attempt count must not grow on its own.
4. Press retry explicitly. Expect exactly one new attempt.

Evidence: `docs/evidence/qa-2026-09-18/unknown-outcome.md`.

### 7.5 Restart, including SIGTERM mid-read (pending item 5.3)

1. With the reader open and a read in flight (open the library export preview, or load a large thread), send `SIGTERM`:

```
# Linux/macOS
kill -TERM <pid>
```

On Windows, Ctrl+C in the daemon terminal sends SIGINT; both signals take the same handler.

2. Expected: the daemon exits 0. No stack trace. No `EADDRINUSE` or `node:net` text. The WebSocket clients close.
3. Expected in the browser: the reader reports the helper is gone, in plain language, and keeps working for reading and notes.
4. Restart with the same data directory.
   - Expected: the store opens. Notes and threads are intact. No data loss, no duplicate rows.
5. Query the store before and after. Record both:

```
select count(*) from notes; select count(*) from note_versions;
select count(*) from reply_versions; select count(*) from egress_events;
```

6. Confirm `<dataDir>/marginalia.sqlite` has no stale `-wal` growth that fails to check point after restart. Record the file sizes.

Evidence: `docs/evidence/qa-2026-09-18/sigterm-mid-read.md`.

---

## 8. T20 saved-solver recompute script

Status at commit `dcc8aa9`: **the route mount has landed** (`fable/t20-mount`, merged at `dcc8aa9`). The execution backend and the reader control have not (sections 2.3b and 2.3c). Run the route-level script now. The full zero-model-turn demonstration waits on that backend and on a reader adapter.

### 8.1 Route-level checks you can run today

With the daemon running and the reader paired, issued from the reader's own origin so the token is origin-bound:

1. `GET /api/solver/status`
   - Expected: 200, body `{ available: false, reason: "Saved-solver execution has no mounted command transport or durable execution gate.", modelTurns: 0, durableAtMostOnce: <bool> }`.
   - Record the body exactly. `modelTurns: 0` is the contract's standing claim; it is not yet evidence of an executed recompute.
2. `POST /api/solver/prepare` without a pairing token.
   - Expected: 401 `Pair with the local helper to recompute saved work.`
3. `POST /api/solver/prepare` with a valid token and a `replyVersionId` that does not exist.
   - Expected: 404 `This reply is unavailable.`
4. `POST /api/solver/prepare` with a `replyVersionId` belonging to a different thread than the paired session's bound thread.
   - Expected: 403 `This reply belongs to a different paired thread context.`
5. `GET /api/solver/prepare` (wrong method).
   - Expected: 405 `Use POST to prepare a recompute.`
6. `POST /api/solver/cancel` with a malformed `requestId`.
   - Expected: 400 `A valid recompute request identity is required.`
7. `GET /api/solver/result?requestId=<well-formed unknown id>`
   - Expected: 200 `{ outcome: null, inFlight: false }`.
8. `GET /api/solver/nonsense`
   - Expected: 404 `Unknown recompute route.`

Evidence: `docs/evidence/qa-2026-09-18/t20-routes.md` with each request, each response and the status code.

### 8.2 The zero-model-turn demonstration — after the execution backend lands

Do not attempt this until `GET /api/solver/status` reports `available: true`.

1. Record baselines before any click:
   - `select count(*) from egress_events;`
   - `select id, site, scope, decision, revokedAt from grants;`
   - `select count(*) from job_attempts;`
   - the daemon log position.
2. Open a saved reply carrying a `solver` block and a bound artifact. Confirm a row exists:
   - `select * from solver_artifact_bindings;`
3. Move a parameter outside the saved samples envelope so the reader offers Recompute rather than a local redraw.
4. Press Recompute — the control that states no model turn is requested. It must be visually distinct from "Ask again with this change".
5. After the result arrives, re-read all three baselines:
   - **`egress_events` count unchanged.** This is the load-bearing proof. Any new row means a dispatch occurred.
   - **`grants` shows no newly consumed grant.** Compare the whole table before and after.
   - **`job_attempts` unchanged.** A recompute is not a job attempt.
6. Capture the RPC transcript. The transport must carry only `command/exec` and `outputDelta` traffic, and must never start a thread or a turn. If the adapter exposes an audit log, attach it; otherwise capture the daemon log for the window.
7. Cancel a recompute mid-run.
   - Expected: the reader reports the cancel honestly and does not claim the process stopped.
8. Revoke the site grant, then attempt a recompute.
   - Expected: refused, and the cached work that grant authorized is cleared.
9. Confirm the attempt input file is removed from the workspace after settling.

Evidence: `docs/evidence/qa-2026-09-18/t20-recompute.md`, with the three before/after table dumps side by side and the RPC transcript attached.

---

## 9. Install and recovery, per OS (pending item 5.4)

No installer exists. The helper starts from a source checkout with `npm start`. Record that as the observed install experience; it is a T19 gap, not a bug you found.

Run on Windows, Linux and macOS. One evidence file each: `docs/evidence/qa-2026-09-18/install-<os>.md`.

1. **Fresh checkout.** Clone or copy to a clean directory. No existing `MARGINALIA_DATA_DIR`.
2. `node --version` — record it. If it is not 24.x, record what the product does about it (today: an npm engines warning only, no product copy).
3. `npm ci` — record duration and any native build output from `better-sqlite3`.
4. `npm run build` — confirm `webapp/dist` exists.
5. `npm start` — record all five stdout lines from section 6.0.
6. Open the origin in Chrome, pair with the printed code, save a note. Record the time from `npm start` to first saved note.
7. **Daemon-stop recovery.** Stop the daemon. Confirm reading and notes continue in the browser and that the wording is calm and accurate. Restart. Confirm the note is intact and the reader reconnects.
8. **Codex sign-out recovery.** With `MARGINALIA_CODEX_EXECUTABLE` and `MARGINALIA_CODEX_HOME` set to a real dedicated Codex, sign out of that Codex home. Restart the daemon. Record what `Codex: <status>; sign-in: <login>` prints and what Settings shows the reader. Expected: a calm, separate statement. Reading and notes unaffected. A paired helper with a signed-out Codex is a normal state, not an error.
9. **Revocation.** From the management panel, revoke the paired browser. Expected: the live WebSocket closes immediately, not on a poll. Confirm in DevTools.
10. **Port conflict.** Start a second daemon on the same port. Expected: `Another program is using port N. Close it, or start Marginalia on another port...`, exit code 1, no stack trace, no pairing code printed, and the first daemon still running.
11. Record every place the product states an untested-platform fact. `docs/INSTALL-RECOVERY-EXPERIENCE.md` specifies copy such as "Tested on Windows 11. macOS and Linux are untested." If that copy is absent from the running product, report it as a claims gap for the stage-4 gate.

---

## 10. Stage gates checklist

From `wayfinder/BUILD-PLAN-24H.md`, section "Stages and gates". Seven rows exist. Assess each against observed evidence only. A gate is PASS only if you can name the evidence file.

| Stage | Gate | Evidence file | Your verdict |
|---|---|---|---|
| 0 Contract | One valid fixture accepted; malicious and invalid fixtures rejected; probe agrees with the closed form | `docs/evidence/qa-2026-09-18/gate-0-contract.md` | |
| 1 Durable reader | Save a note on a real page; restart daemon and browser; recover it; edit the page text and see moved/unsure, never a guess | `docs/evidence/qa-2026-09-18/gate-1-durable-reader.md` | |
| 2 Real definition | An unseen term gets a real reply; excluded page sends nothing; unknown outcome does not auto-retry; sending indicator separate from working | `docs/evidence/qa-2026-09-18/gate-2-real-definition.md` | |
| 3 Interactive reply | Correct model on the demo and a second passage; slider costs no inference; malformed output cannot run; headline withheld without its check | `docs/evidence/qa-2026-09-18/gate-3-interactive-reply.md` | |
| 4 Install and release | A new reader installs and recovers; all public claims match the recorded run | `docs/evidence/qa-2026-09-18/gate-4-install-release.md` | |
| 5a Evidenced expansion | Closed session provably offline; open session's fetched record complete or labelled incomplete; no fabricated sources | `docs/evidence/qa-2026-09-18/gate-5a-evidenced-expansion.md` | |
| 5b Roadmap | Each roadmap item has its own fidelity, permission, persistence and failure contract | `docs/evidence/qa-2026-09-18/gate-5b-roadmap.md` | |

Notes for your assessment:

- Gate 0 is the one most likely to pass on automated evidence alone. `tests/reply.test.ts` covers acceptance and adversarial rejection against the real schema with nothing mocked.
- Gate 1 needs section 6. Step 6.5 is the restart half; the "edit the page text and see moved/unsure" half needs you to actually edit the source page and reload.
- Gates 2 and 3 are blocked by section 2.3a on the stock daemon. Record BLOCKED with the reason, not FAIL.
- Gate 4 needs section 9 on all three operating systems.
- Write a one-paragraph summary at the top of each gate file: what you ran, what you saw, verdict.

Record the count discrepancy from section 5.6 in `docs/evidence/qa-2026-09-18/gate-count-discrepancy.md`.

---

## 11. Defect report template

One file per defect, under `docs/evidence/qa-2026-09-18/defects/`, named `D<NN>-<short-slug>.md`.

```markdown
# D<NN> — <one-line summary>

Severity: P1 | P2 | P3
  P1 = a no-send invariant broke, data was lost, or a false claim reached the reader
  P2 = a documented behaviour does not happen, or wording misstates what occurred
  P3 = cosmetic, or a rough edge that does not mislead

Host: <OS, version>
Node: <version>
Commit: <git rev-parse HEAD>
Surface: reader | extension side panel | floating host | daemon | CLI
Script: <section number from the QA guide>

## What I did
<numbered steps, exactly as performed, with the commands>

## What I expected
<the expectation this guide or the product copy states, quoted with its source>

## What happened
<observed only. Paste raw output. Attach screenshots by filename.>

## Evidence
- <file path>
- <file path>

## Store state
select count(*) from egress_events;
select id, state, dispatchClaimed, handoffMarked from job_attempts;
select id, site, scope, decision, revokedAt from grants;
<paste results>

## Reproducibility
Happens every time | Happened once in N attempts | Could not reproduce

## Not done
I did not change any source file. I did not attempt a fix.
```

---

## 12. What to escalate, and to whom

### Escalate to Fable immediately (stop the script)

- Any non-zero `egress_events` row before an explicit approval. This is the product's central promise.
- Any auto-retry after an unknown outcome.
- A reply that claims a result its host checks do not cover.
- A consent sheet whose displayed payload does not match the `egress_events` row.
- A saved reply that changes its source passage or its answered note version.
- A test that fails on Linux or macOS but passes on Windows, or the reverse.
- Any crash with a stack trace visible to the reader.
- Any behaviour that contradicts a claim in `BUILD-STATUS.md`, `docs/FABLE-TICKET-STATUS.md` or a `wayfinder/build-receipts/` file. Name the document and quote the claim.

Send Fable the defect file path, the severity and the one-line summary. Nothing else.

### Escalate to Yash (batch these; do not interrupt for them)

- Whether the margin reads well beside untouched source.
- Whether notes feel primary and replies feel secondary.
- Whether the editor lands where he was reading.
- Whether the single map is legible at real viewport widths, including 240-260px.
- Whether consent scope wording is understandable to a reader who has not read the spec.
- Whether the unavailable-asking copy feels calm or alarming.
- Light and dark theme as painted. `tests/margin-design.test.ts` only regex-parses `oklch()` literals out of `ui/tokens.css`; it never renders anything.
- Any judgement about whether something is good enough to ship.

Give Yash screenshots and a one-line question each. Do not pre-grade his answers, and do not substitute a measurable proxy for his verdict.

### Decide yourself

- Which order to run the scripts.
- Whether an observation is a defect or an expected fail-closed state, using section 2.3.
- How many times to retry a flaky step before recording it as intermittent.
- Whether to stop a script early because a precondition is unreachable, and record BLOCKED.

### Never decide yourself

- Whether a gate passes on inference rather than evidence.
- Whether to change source, tests, configuration or documentation.
- Whether a defect is worth fixing. That is Fable's call after Yash sets priority.
