<!-- Opus 5 workflow synthesis, 2026-09-18. Refuter stages were skipped after a rate-limit outage; items are labelled verified-by-synthesizer or unverified. Saved unedited by Fable. -->

# Marginalia engineering-standards plan (synthesizer pass)

**Status of evidence.** The refuter stages never ran. Every finding arrived `verified: false`. I re-opened citations myself under the read-only constraint. Items below are labelled `[V]` verified-by-synthesizer (I read the cited line), `[U]` unverified (promoted on structure/consistency only, citation not opened), or dropped. Corrections to the source findings are stated inline. No feature is dropped; behaviour-changing fixes are separated from mechanical ones.

---

## 1. What is sound and must not regress

**Verified by direct read:**

- `renderer/dom.ts` `link()` — hard-blocks non-`https:`, credentialed URLs, `localhost`/`.localhost`/`.local`/`.internal`, `::1`, `127./10./192.168./169.254./0.`, `172.16–31.`, and `fc/fd/fe8-b` IPv6 ULA/link-local; emits `<span>` instead. Adds `noopener noreferrer` + `referrer-policy: no-referrer`. This is the anti-SSRF/anti-exfil boundary for rendered model output. `[V]`
- `daemon/helper-management.ts` — `trustedPage()` requires Host match, exact `Origin`, `sec-fetch-site: same-origin`, `sec-fetch-mode` in `{cors,same-origin}`, `sec-fetch-dest: empty`; re-checked *after* the body await ("No authority snapshot crosses the body await"); 1 KiB body cap with `destroyOnReturn: false` so the error response is still writable; strict content-type regex; rejects `content-encoding`; exact key-count validation; UUIDv4 pattern on revoke. Any "pairing-code is unauthenticated" claim does **not** survive this read — the route is bound to browser-controlled headers by design. **I drop that finding.** `[V]`
- `extension/lib/respond.ts` — closed allow-list of user-facing error strings with generic fallback; `readReply` bounds length ≤180 and charset to printable ASCII. Error text never leaks internals. `[V]`
- `daemon/store.ts` — `synchronous = FULL` set *before* `journal_mode = WAL` (`:24`, `:38-39`), and the file is inspected read-only before a writer opens (`:15`). Durability ordering is correct. `[V]`
- `daemon/jobs/service.ts` — retry/prepare-retry only admit `failed | cancelled | timed_out | outcome_unknown`; `outcome_unknown` is terminal and never auto-replayed. `retry()` re-derives the prepared digest and throws `'The reviewed outgoing content changed. Review it again.'` on mismatch (`:232`). This is the review-before-send invariant in code. `[V]`
- `contracts/solver.ts` = 780 lines, `ui/journal.ts` = 639 lines — matches the `sound` claims exactly. `[V]`
- `daemon/server.ts` static route confines paths with `resolve()` + `startsWith(root + sep)` and a fixed MIME map with `nosniff` (`:312-320`). `[V]`

**Carried forward from findings, not re-opened `[U]`:** the synchronous-commit boundary at `daemon/solver/service.ts:1132-1187` (no `await`/dynamic import/log between durable claim and `transport.exec`, thenable commit rejected at `:1133-1136`); the T06 descriptor-authoritative read hardening (`O_NOFOLLOW|O_NONBLOCK`, `fstat`, `nlink===1`, dev-ino pinning, commit `61eeffe`); `spawn` with `shell:false`/`windowsHide:true` + positive env allowlist; the `.exe`-only Windows Codex rule (CVE-2024-27980 class — **must not be relaxed**); `timingSafeEqual` digest comparison; the retrieval broker validating *resolved addresses*; closed shadow root + CSS Custom Highlight API (source page never rewritten); `incognito: 'not_allowed'`.

---

## 2. Packets (severity-ordered, disjoint file ownership, ≤~300 lines each)

| | |
|---|---|
| **P1** | **id** `P1-manifest` · **title** Manifest completeness: icons, CSP, WAR · **lens** mv3-cws + security + privacy + dependencies · **files** `extension/wxt.config.ts`, new `extension/public/icon/{16,32,48,128}.png` · **change** (a) add `icons` — **no `icons` key and no PNG anywhere under `extension/` `[V]`**, this alone blocks Chrome Web Store submission; (b) extend `content_security_policy.extension_pages` — it currently reads `script-src 'self'; object-src 'none'; connect-src http://127.0.0.1:* ws://127.0.0.1:*; base-uri 'none'` `[V]`, so **`base-uri` and `object-src` are already present** (both source findings claimed otherwise — corrected) but `default-src` and `style-src` are absent: add `default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'`; (c) narrow `web_accessible_resources.resources` from `['panel.html','assets/*','chunks/*']` to the minimum the panel actually loads. · **proving check** `wxt build extension` then load unpacked; panel renders, KaTeX styles intact, no CSP violations in the console · **est_lines** 12 · **behaviour_change** no (mechanical), except (c) which can break asset loading — verify before merging · **waits_on** none |
| **P2** | **id** `P2-retry-question` · **title** `prepareRetry` omits `outgoing.question` · **lens** refactoring / error-handling · **files** `daemon/jobs/service.ts` · **change** `retry()` sets `context.outgoing = { ...context.outgoing, question: context.question, availableCapabilities: [...] }` at `:231`; `prepareRetry()` at `:171` sets the same object **without `question`** `[V]`. The two paths therefore compute different prepared payloads, so the digest the reader reviewed cannot match the digest `retry()` recomputes, and `:232` throws `'The reviewed outgoing content changed.'` — retry-after-failure is likely broken end to end. Make `:171` identical to `:231`. · **proving check** new test: `prepareRetry` → `retry` with the returned digest must not throw; assert digest equality · **est_lines** 2 + ~30 test · **behaviour_change** **YES** — repairs a user-visible flow and changes the bytes sent to the model; review against the "reader reviewed the exact content" invariant · **waits_on** `daemon/jobs/service.ts` (reserved) |
| **P3** | **id** `P3-error-string` · **title** Allow-list string mismatch swallows a real message · **lens** mv3-cws · **files** `extension/lib/respond.ts`, `extension/entrypoints/background.ts` · **change** `background.ts:105` throws `'This page is excluded or changed.'`; the allow-list at `respond.ts:10` contains `'This site is excluded or changed.'` `[V]`. The thrown string is not in the set, so the reader always sees the generic fallback. Align on one wording (prefer "page" — it matches the sibling strings `'This page is excluded.'`, `'This page is not active.'`). · **proving check** grep both files for a single literal; add a test asserting `publicError(new Error(thrown)) === thrown` · **est_lines** 2 · **behaviour_change** no (mechanical); it does change displayed text · **waits_on** none |
| **P4** | **id** `P4-store-indexes` · **title** Query indexes + FTS duplicate-copy decision · **lens** performance + storage-schema · **files** `daemon/store.ts` · **change** **zero `CREATE INDEX` statements exist in the file** `[V]` — every `ReaderStore.list()` filter is a scan. Add the secondary indexes the hot queries need and cache prepared statements / push the URL filter into SQL (both source findings own this file, so they merge here by the disjointness rule). Separately: `CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(entityId UNINDEXED, kind UNINDEXED, content)` at `:74` `[V]` stores a **second copy of page text** — it is a privacy surface and an erasure surface. Decide: drop it if unused, or document it as an erasure target. · **proving check** `EXPLAIN QUERY PLAN` on the list queries shows index use; existing store tests pass; measure list latency before/after · **est_lines** 40 · **behaviour_change** indexes no; dropping FTS **YES** (removes search) · **waits_on** none |
| **P5** | **id** `P5-shutdown` · **title** Shutdown signals + data-dir mode · **lens** cross-platform + lifecycle + privacy · **files** `daemon/main.ts` · **change** `main.ts:98` registers only `['SIGINT','SIGTERM']` `[V]` — Windows has no real `SIGTERM` and never delivers `SIGBREAK`/`SIGHUP` handling; console-close and service stop therefore skip `terminal.close()` and `server.close()`. Use a platform-selected list (win32: `SIGINT,SIGBREAK,SIGHUP`; posix: `SIGINT,SIGTERM,SIGHUP`) and add a hard-deadline `process.exit(1)` timer so an unbounded drain cannot hang exit. Also `mkdirSync(dataDir, { recursive: true })` at `:22` passes **no `mode`** `[V]` — on POSIX the reader's annotation corpus inherits umask; pass `mode: 0o700`. · **proving check** POSIX: `stat -c %a` on the data dir = 700; signal test asserts close() ran; Windows: manual console-close check (no WSL/Docker available per project memory) · **est_lines** 18 · **behaviour_change** **YES** (exit path + on-disk permissions) · **waits_on** none |
| **P6** | **id** `P6-workspace-mode` · **title** Workspace file modes · **lens** privacy / cross-platform · **files** `daemon/jobs/workspace.ts` · **change** `writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' })` at `:85` `[V]` — `wx` correctly refuses to clobber, but no `mode`, so workspace files land world-readable under a permissive umask. Add `mode: 0o600`. · **proving check** POSIX `stat` assertion in `tests/jobs-workspace-integrity.test.ts` · **est_lines** 3 · **behaviour_change** no on Windows; **YES** on POSIX · **waits_on** none |
| **P7** | **id** `P7-build-hygiene` · **title** Reproducible install, type parity, CI · **lens** dependencies-build · **files** `package.json`, new `.npmrc`, new `.github/workflows/ci.yml` · **change** `@types/better-sqlite3` is **9.6.0** against runtime `better-sqlite3` **13.0.3** `[V]` — four majors of drift; the types no longer describe the API. Bump. No `postinstall` script `[V]` — add `"postinstall": "wxt prepare extension"` so a fresh clone typechecks. No `.npmrc` `[V]` — add `engine-strict=true` to enforce the declared `node: ">=24 <25"`. No `.github/` directory at all `[V]` — no CI runs `node --test` or `tsc --noEmit` on any platform; add a win32 + ubuntu + macos matrix on Node 24. **Correction:** the `"test": "node --test tests/*.test.ts"` glob was flagged as missing nested tests; `tests/` is flat and `find tests -mindepth 2 -name '*.test.ts'` returns nothing `[V]`, so **no test is currently missed** — demote to hygiene (`tests/**/*.test.ts`), not a defect. · **proving check** CI green on all three OSes from a clean `npm ci` · **est_lines** 60 · **behaviour_change** no · **waits_on** none |
| **P8** | **id** `P8-digest-literal` · **title** Consolidate the 64-hex digest literal · **lens** refactoring · **files** `contracts/` only (export one `isDigest()` / `DIGEST_PATTERN`) · **change** the pattern appears **19 times** across `contracts/ daemon/ ui/ renderer/ extension/` `[V]` — the source finding said 16; corrected. Export once from contracts; migrate call sites **outside** the reserved set in this packet. · **proving check** `grep -rEc "a-f0-9\]\{64\}"` drops to 1 in non-reserved files; full test suite green · **est_lines** 25 (contracts + non-reserved call sites) · **behaviour_change** no · **waits_on** `daemon/jobs/service.ts`, `daemon/jobs/store.ts`, `daemon/server.ts`, `ui/margin.ts` (migrate those call sites in a follow-up) |
| **P9** | **id** `P9-static-csp` · **title** Complete the static-asset CSP · **lens** security · **files** `daemon/server.ts` · **change** `:318` sends `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'` `[V]` — add `object-src 'none'; base-uri 'none'` (genuinely absent here, unlike the extension CSP). · **proving check** response-header assertion in the server test · **est_lines** 2 · **behaviour_change** no · **waits_on** `daemon/server.ts` (reserved) |
| **P10** | **id** `P10-helper-reconnect` · **title** Helper reconnect via `chrome.alarms` · **lens** error-handling + lifecycle · **files** `extension/entrypoints/background.ts` (+ `alarms` in P1's manifest — sequence P1 first) · **change** the manifest declares `['storage','activeTab','tabs','webNavigation','sidePanel']` with **no `alarms`**, and **no `chrome.alarms`/`browser.alarms` call exists anywhere in `extension/` `[V]`. A service worker evicted at ~30 s idle cannot resume a reconnect on a `setTimeout`. Add an alarm-driven reconnect with persisted backoff (the two source findings differ only in period — 0.5 min vs 1 min; take **1 min**, the Chrome-supported floor for released extensions). · **proving check** evict the worker via `chrome://serviceworker-internals`, confirm reconnect fires · **est_lines** 45 · **behaviour_change** **YES** · **waits_on** P1 |
| **P11** | **id** `P11-session-keys` · **title** `workspace:` session-key cleanup · **lens** mv3-cws + error-handling (two findings, same fix — merged) · **files** `extension/entrypoints/background.ts` — **collides with P10; run P10 then P11, or merge** · **change** `workspace:`-prefixed `storage.session` keys are never removed, accumulating against the 10 MB quota. Delete on tab close / navigation commit. `[U]` — not re-opened. · **proving check** open/close 50 workspaces, assert `storage.session` key count returns to baseline · **est_lines** 20 · **behaviour_change** no · **waits_on** P10 |

**Deferred, reserved-file, not packetised here:** route-table extraction from `daemon/server.ts`; `mountMargin`/`readReplies` decomposition in `ui/margin.ts` (1015 lines `[V]`); the six-entry-point job pipeline in `daemon/jobs/service.ts`; solver-interpreter pinning in `daemon/jobs/solver-bindings.ts`. All are `waits_on` their reserved file.

**Dropped for failed or absent verification:** the helper-management "unauthenticated pairing-code" claim (contradicted by `trustedPage` `[V]`); the "1.5 s panel poll" — `grep -n "setInterval\|1500" extension/entrypoints/*.ts` returns **nothing** `[V]`, the cited location does not hold, re-locate before promoting; the nested-test-glob defect (demoted, above). Low-confidence items I did not promote: macOS case-sensitivity (0.40), oversized event batches (0.55), Win32 archive wedge (0.55), solver-binding export vs. the governing comment at `store.ts:344-345` (0.55), `SQLITE_BUSY`→400 (0.55).

---

## 3. Chrome Web Store readiness

| Item | Verdict | Evidence |
|---|---|---|
| Icons 16/32/48/128 | **FAIL** | No `icons` key in `extension/wxt.config.ts`; `find extension -iname '*.png'` empty; no `extension/public/` `[V]` |
| No remote code | **PASS** | `connect-src` limited to `http://127.0.0.1:* ws://127.0.0.1:*`; `script-src 'self'` `[V]` |
| Minimum permissions | **UNKNOWN** | `storage, activeTab, tabs, webNavigation, sidePanel` + `host_permissions: ['http://127.0.0.1/*']` `[V]`. `activeTab` alongside `tabs` needs a written justification or removal |
| Per-permission justification | **FAIL** | No listing copy found in repo `[V]` |
| Single purpose | **PASS** | One stated purpose in `description` `[V]` |
| Limited Use / privacy policy | **FAIL** | No privacy-policy document in `docs/` `[V]` |
| `use_dynamic_url` on WAR | **FAIL** | Absent; `resources` are `['panel.html','assets/*','chunks/*']` matched on all http/https `[V]` — fingerprintable |
| Extension-pages CSP | **PARTIAL** | `base-uri 'none'` and `object-src 'none'` present; `default-src`/`style-src` absent `[V]` |
| `minimum_chrome_version` | **PASS** | `'116'` — above the `sidePanel` floor `[V]` |
| Incognito | **PASS** | `incognito: 'not_allowed'` `[V]` |
| Build reproducible from clean clone | **FAIL** | No `postinstall: wxt prepare extension`, no `.npmrc`, no CI `[V]` |

---

## 4. Privacy data flow

| What | From | To | Consent | Stored where | Deletable |
|---|---|---|---|---|---|
| Selected passage + question | Reader's page → margin | Daemon → model provider | Explicit per-send review; `retry()` re-verifies the digest at `:232` `[V]` | `daemon/store.ts` SQLite (WAL, `synchronous=FULL` `[V]`) | Tombstone-only `[U]` — **no hard erase** |
| Page text copy for search | Daemon | Local only | Implicit | FTS5 `search` table, `store.ts:74` `[V]` | **No** — second copy, not covered by tombstones |
| Workspace files | Job pipeline | Local disk | Implicit | `daemon/jobs/workspace.ts:85`, world-readable on POSIX `[V]` | Manual |
| Page identity / URL | Extension | Daemon | Implicit on activation | SQLite | Tombstone-only `[U]` |
| Pairing state | Helper page | Daemon | Explicit pairing code, `trustedPage`-gated `[V]` | Daemon store | Yes — `/revoke` `[V]` |
| `workspace:` session keys | Extension | Extension only | Implicit | `storage.session`, never cleared (P11) | On browser restart only |
| Model output links | Provider | Rendered margin | n/a | Not persisted as live links — private hosts downgraded to `<span>` `[V]` | n/a |

**Erasure sequencing:** resolve the FTS decision (P4) **before** building an erase path, or erasure must cover two copies instead of one.

---

## 5. Per-OS differences

| Concern | Windows | Linux | macOS |
|---|---|---|---|
| Shutdown signals | `main.ts:98` only handles `SIGINT`/`SIGTERM` `[V]`; `SIGTERM` is synthetic, `SIGBREAK`/`SIGHUP` unhandled → close path skipped | `SIGTERM`/`SIGHUP` work | same as Linux |
| Data-dir mode | ACL-inherited; `mode` ignored | `mkdirSync` without `mode` → umask `[V]` | same as Linux |
| Workspace file mode | ACL-inherited | `wx` without `mode` → world-readable `[V]` | same as Linux |
| Codex runtime | `.exe`-only rule (sound, do not relax); `.cmd`/`.ps1` shims unsupported → discriminated reason code, **not** shim resolution | n/a | n/a |
| `better-sqlite3` 13.0.3 | Node-API prebuild, `gypfile: false` `[U]` | prebuild | prebuild (arm64 + x64) |
| CI coverage | **none** `[V]` | none | none |

---

## 6. Conflicts and my recommendation

1. **`use_dynamic_url`** — three lenses say set it now; the dependencies lens says shrink `resources` first, because `background.ts:17-19` derives `panelUrl`/`workspaceUrl`/`extensionOrigin` from `runtime.getURL()` and those identity comparisons break against a rotating URL. **Recommend the cautious sequencing:** narrow `resources` in P1, re-verify the identity comparisons, then flip the flag as a separate change. Fingerprinting exposure is real but not a submission blocker; a broken origin check is.
2. **Extension CSP shape** — `default-src 'self'` vs `default-src 'none'`. **Recommend `'none'`** with explicit `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `font-src 'self'`. Both stated reasons for `'unsafe-inline'` (margin custom-property writes, KaTeX inline style attributes) are probably true; keep it and revisit.
3. **Erasure vs. FTS** — see §4. Drop-or-document FTS first (P4), then build erase against one surface.
4. **Panel poll: backoff vs. push model** — moot until the citation is re-located `[V]` that it is not in `extension/entrypoints/*.ts`. If confirmed elsewhere, prefer the **visibility gate + backoff**; the full `webNavigation`/`storage.onChanged` push model is a larger behaviour change than the symptom warrants.
5. **Windows Codex gate** — discriminated reason code, **not** shim-to-`process.execPath` resolution. The `.exe` rule is in the sound list and the shim path re-opens the CVE-2024-27980 argument-injection class.
6. **Shutdown** — the two findings are compatible; merged into P5 (platform list **and** hard-deadline exit). Also sequence against the lifecycle finding that `close()` clears the timers bounding in-flight work before an unbounded drain.
7. **Reconnect period 0.5 vs 1 min** — take 1 min; sub-minute alarms are unreliable in released extensions.
8. **`server.ts:375` vs `:359-364`** for the delivery interval — both in range (file is 379 lines `[V]`), but they cannot both be right. Unresolved; re-locate before acting.
9. **`store.ts:344-345`** comment says workspace state is *deliberately* excluded from export. Treat the solver-binding-export proposal as **contrary to a governing decision** and do not promote it.

**Do first, this week:** P1 (submission blocker), P3 and P7 (cheap, verified), P5/P6 (POSIX privacy). **Behaviour-changing, review-gated:** P2, P5, P6-on-POSIX, P10, and FTS removal in P4.
