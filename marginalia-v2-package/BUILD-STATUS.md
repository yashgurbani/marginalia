# Marginalia overall build report

## Current position — 17 September 2026

**Current integration baseline: `1517433968d03cdde054a70376ca26c2d9221315`, `codex/marginalia-v2`. Product incomplete; not launch-ready. All T00–T20, R1–R30 and all 71 feature-inventory items remain required.** The GitHub connector re-resolved this exact integration ref for the present documentation handoff. No new source review or test run was performed for this update.

**Current user direction:** continue all tickets through separate parallel 6Pro chats. Astra chief steers only; dynamically routed MCP Luna Max verifies independently. No new Sol/Opus implementation. Earlier outgoing-chief stop, T05-only restrictions, old Astra implementation exceptions and old Sol/Opus routing are superseded, not active instructions.

The coordination update lives on `codex/pro-build-steering-20260917`, based on the exact integration SHA above, and changes only this file, `docs/CLAUDE-STEERING-HANDOFF.md` and `docs/PROJECT-STATUS-AND-TICKET-REVIEW.md`. It does not update integration, implementation, tests, dependencies or receipts.

Start with [current steering/ownership](docs/CLAUDE-STEERING-HANDOFF.md) and [current all-ticket assessment](docs/PROJECT-STATUS-AND-TICKET-REVIEW.md). Basis: the latest user coordination facts and the accepted current-revision advisory in [this conversation](https://chatgpt.com/c/6aab9618-74b8-83eb-9518-da28543f1429). The original combined review remains pinned to `2c35157`; the current advisory reconciled specific findings against `1517433`. Historical paragraphs/counts later in this report are revision-scoped evidence, not current worker state or feature completion.

**Critical path:** actual-send correctness → usable evidence-backed dedicated product runtime → explicit Ask/live source-bound reply through the existing margin → real interactive computation and durable return. Recovery and the rest of the product continue in disjoint lanes. Do not replace missing entry-point behavior with component test counts or another architecture exercise.

## Live coordination board

| Lane | Chat / branch | Current ownership and gate |
|---|---|---|
| **T05** | [Existing 6Pro](https://chatgpt.com/c/6aab9408-941c-83ed-b5ea-8e8a7ea14b7d), `codex/pro-t05-integration-checkpoint` | Reconciling old 17-file patch plus helper UI to `1517433`. Sole writer for margin/helper/persistence/helper-management/webapp-main/SW and T05 tests; sole mount owner. Preserve integrated C6. No combined checkpoint acceptance claimed. |
| **T06** | [Existing 6Pro](https://chatgpt.com/c/6aab9381-d8c4-83eb-be12-75907bebd4c1), `codex/pro-t06-send-checkpoint` | Implementing actual-send after the host transaction. Its current provider write scope is broad. T02/T13 review without overlapping implementation. **Runtime collector must WAIT until chief explicitly narrows/releases the relevant ownership.** |
| **T07** | [Existing 6Pro](https://chatgpt.com/c/6aab93df-8f84-83eb-b0b7-d5780aef4e22), `codex/pro-t07-integration-checkpoint` | Current-base checkpoint `3b24063191daad872fd5312714f8de688e86069b`, exact parent `1517433968d03cdde054a70376ca26c2d9221315`, independently fetched by chief: nine files, +1,037/-24, continuation only, not merged. Owns reader contract/store/journal and tests. Original c9c2b27 verification continues through registered dynamic MCP Luna Max with confirmed model/effort; no pass or acceptance claimed. |
| **T08** | [Active 6Pro](https://chatgpt.com/c/6aabcb52-f988-83eb-8448-b54ad98298ce), visible 6Pro verified | Own ONLY `ui/asking/**`, `tests/asking*.test.ts`, `docs/evidence/T08-asking/**` and receipt T08. T05 alone mounts it. No completed module or mounted-flow acceptance claimed. |
| **Runtime collector/composition** | Accepted future 6Pro contract; **WAIT** | Do not use the earlier proposed split to override T06's actual issued reservation. Begin only after explicit path/interface handoff. |
| **T20** | Preserved `codex/opus-t20-saved-solver`, `c144506f32b67a27f2487426c24b79e4f606af16` | Unfinished and unaccepted; no active Opus. Later bounded 6Pro continuation must preserve existing code and coordinate T06/T07/T13/T18/T05 rather than recreate it. |

All scopes are package-relative. Reconciliation branch names describe assigned destinations unless an exact published checkpoint is stated; publication does not establish acceptance. No new lane may take reserved paths or recreate an existing owner's work. T05 and T07 must agree their device-choice/persistence interface without writing each other's files. T08 is a module owner, not a second margin owner. T20 host adapters/transactions cannot expand into T06 or T07 by implication. Testing is authorized, but this handoff performs none.

## Current evidence and uncertainty

| Evidence | Reported result / origin | What it does not establish |
|---|---|---|
| Historical integration `0111589` | Outgoing chief: Windows Node 24.14.1, 282 tests: 281 pass, 0 fail, 1 optional browser skip, 0 cancelled; associated typecheck/build and Chromium local-reader records. | Not a newly run suite on `1517433`, new checkpoints, all three OSes or real provider/solver/confinement acceptance. |
| Helper UI `e2fb6c2b61cce004c2c2964f9db146f73fac32fc` | Latest user says `.local/t05-luna-verification/REPORT.md` exists: focused 8/8 and 18/18, typecheck, webapp and extension builds pass. Isolated Chromium 147 visible Show/Renew → Pair → safe List → Forget → 401, local note retained, expiry, 360 px narrow state and no browser errors. | Reported exact-checkpoint verification, not combined T05 acceptance. Original runtime model metadata was not independently exposed. This author did not run or independently fetch the local report. Do not sum overlapping groups as a unique total. |
| T07 original `c9c2b2764e574ee670337ee3010e64930f9aaa5e`, parent `4552b65`; current-base `3b24063191daad872fd5312714f8de688e86069b` | Chief independently fetched the new checkpoint on exact parent `1517433968d03cdde054a70376ca26c2d9221315`: nine files, +1,037/-24, only continuation transferred. Verification was dispatched through registered dynamic Codex MCP, explicitly `gpt-5.6-luna/max`; runtime `turn_context` independently confirmed `gpt-5.6-luna`, effort `max`, thread `01a0af0b-ec6a-7dd2-8df4-7034e9f49bcc`. | No pass or acceptance claimed; current-base checkpoint is not merged. Verification must identify its exact tested SHA; results for c9c2b27 do not automatically verify 3b24063. This is a routed MCP worker, not a native desktop worker. |
| T20 c144506 | Historical chief reported 123/123 solver checks after stopping the writer. | No revision-4 completion receipt, final integration acceptance, mounted route, real solver execution or platform isolation. |
| Accepted current-source advisory | Read-only source observations at `1517433`, preserved solver branch separately inspected at c144506. | No tests, implementation or whole-ticket closure. The present task publishes documentation only. |

T07 operational status, per chief: the outer MCP `tools/call` timed out at 300 seconds but the session continued; no duplicate was launched. Chief corrected a nested advisory invoked against the no-delegation instruction. Direct native Node 24 / better-sqlite3 verification continues inside the routed MCP session, with no acceptance claimed.

The earlier integrated local-reader checks proved selected capture/pairing/save/reload/offline behaviors, not a complete reading-to-Ask-to-interactive-reply journey. Helper verification is scoped to its checkpoint; it must be repeated as needed on the reconciled combined UI rather than transferred by assertion.

## Current source findings — advisory carried forward

### Critical defects and missing implementation

**T06 actual send remains a P1 lifecycle correction.** `JobService.dispatch()` invokes `withDispatchHandoff()` before runner entry, after which adapter serialization, evidence, thread setup/verification and checkpoints can await before the inference RPC. The first F20 slice correctly made grant use/authorization/egress and the host handoff atomic, with same-connection and immutable-context checks. The remaining fix is to finish non-consuming asynchronous preparation before one synchronous final authorization/attempt claim and immediate prepared transport handoff. Preserve cancellation, deadline, CAS, thread leases and no-auto-retry behavior.

**Runtime readiness is a code gap as well as an evidence gap.** The bundled `daemon/main.ts` still constructs `unavailablePolicyHostEvidence()` and `dispatchReady: false`; the default host evidence returns empty observations. Signing in alone cannot make the bundled composition operational. The existing evidence interface needs a real implementation and readiness wiring after ownership handoff; simply changing the flag or copying requested values into observed evidence is not acceptable.

**Ask and design are not fully connected.** Current `ui/margin.ts` retains a local preview and disabled sending controls; `webapp/main.ts` mounts the margin only. Composer-above-scroll and two map representations remain in current integrated source. Existing T05 reconciles those files; T08 supplies a separate asking module using host-prepared consent/job interfaces. Do not open another writer or present a local preview as the actual authorized outgoing manifest.

**T20 is an unfinished migration.** Its preserved contract declares `prepareCommit()`/synchronous `commit()`, but execution still calls awaited `gate.finalize()` and separate journal persistence before transport. The route and context/authority/evidence/generation/attempt/journal adapters remain absent. The advisory did not run a typecheck. Local recomputation and cache reads must never consume cloud-inference grants or start a model turn.

### Old failures now visibly corrected

The accepted advisory confirmed source corrections for F01 empty-selector termination; F02 workspace-specific policy preparation; F03 completed-workspace recovery before settlement; F04 read-only completed-predecessor verification; F05 narrowly identity-bound terminal stop-fence acknowledgment; F15 matching durable pending intent; and the first F20 non-consuming-eligibility/shared-DB host-handoff transaction. These are not untouched bugs and must not be implemented again. Their remaining real-provider, recovery and whole-ticket gates are distinct.

On c144506, canonical base64/sticky malformed-output handling, empty input tuple admission and a digest state-key contract already exist. Preserve those changes while reconciling call sites and host/renderer integration. A preserved branch correction is neither an integrated correction nor proof that the complete recompute experience works.

Other old review dispositions, including current-request hashes, mutation admission, material source versions, contract/numerical semantics and library operation ownership, have historical integration receipts below. Do not mechanically replay the original F01–F21 backlog. [The current ticket review](docs/PROJECT-STATUS-AND-TICKET-REVIEW.md) distinguishes source-confirmed corrections from historical reports and remaining integration acceptance.

## Current ticket board

Every row remains open at some implementation or acceptance boundary. Queued means required work awaiting a bounded assignment, not removed scope.

| Ticket | Current position and remaining gate |
|---|---|
| T00 | Fixture foundation exists; final checked rendered/live acceptance through the reader path remains. |
| T01 | Dedicated diagnostics/pairing/management backend exists; combined T05 helper UI, registration, installed recovery and usable runtime composition remain. |
| T02 | Adapter continuation/not-sent fixes exist; T06 owns current send changes; real authenticated two-adapter lifecycle remains. |
| T03 | Contract/host-authority corrections exist; real host records, resealing and bound live delivery remain. |
| T04 | Selected Chromium local-reader flows verified historically; exclusion sync, SW/reconnect, full provider path, Firefox and all-platform evidence remain. |
| T05 | Active current-base UI/helper reconciliation; reading-position editor, one complete map, actual mounts and combined design/reader acceptance remain. |
| T06 | Active actual-send implementation; first host transaction is preserved, not the end of the boundary. Real runtime/recovery evidence remains. |
| T07 | Current-base continuation 3b24063 published on exact parent 1517433, independently fetched, not merged; routed verification continues with no pass, combined recovery acceptance remains. |
| T08 | Narrow asking-module chat ACTIVE with visible 6Pro verified; T05 mount, real consent/definition/reply and no-send lifecycle acceptance remain. |
| T09 | Real new-passage model-authored checked interactive output remains; kernel/fixture alone is not this journey. |
| T10 | WebMCP capability remains required; no bypass of product runtime/consent or false completion from stubs. |
| T11 | Library/settings components exist; T05 entry/return, full export and sanitized diagnostics remain. |
| T12 | Not launch-ready; fresh-machine gates, actual demo/video, reader/publication decisions and truthful listing remain. |
| T13 | Consent/policy/retrieval foundations and first transaction exist; actual send, exclusion sync and real evidence-backed confinement remain. |
| T14 | Evidence flow remains: dated claim-level support, observed fetches, narrower grant and honest insufficient-evidence state. |
| T15 | Explore flow remains: useful reasoned parked items, deliberate open and preserved reading context. |
| T16 | Basic notes work; exact version-bound Ask, frozen attachment, vocabulary origins/deletion and full recovery remain. |
| T17 | Local identity foundation exists; page-type truth, position/return and correctly granted enrichment remain. |
| T18 | Renderer/kernel corrections exist; host highlight arbitration, authentic sidecars and complete interactive delivery remain. |
| T19 | Experience review/C1–C15 and several fixes exist; full recovery/export/diagnostics/registration and three-OS installers/acceptance remain. |
| T20 | c144506 preserved, inactive, unaccepted; gate/call-site migration, host dependencies, route and genuine zero-model recompute remain. |

## Next integration sequence and conflict owners

1. Retrieve current T05/T06/T07 outputs without duplicate requests. Check exact parent, changed paths and receipts. T07's current-base checkpoint transfers only its continuation, not the already integrated first slice. T05 reconciles both the older design patch and helper checkpoint while retaining C6. No checkpoint is proposed for merge solely on an older report or passing tests.
2. Complete T06's actual-send checkpoint. Verify native SQLite race/rollback and prepared-request single-use/generation tests, both adapters, start/continuation and cancel/revoke during preparation. Known pre-send rejection consumes nothing; ambiguous post-commit failure remains unknown without refund or automatic replay. Preserve earlier restart/terminal cleanup fixes.
3. Chief explicitly narrows or hands off T06's relevant provider/runtime paths. **Until then, collector implementation waits.** Then a separate 6Pro owner implements the existing host-evidence/readiness composition and supplies genuine lifecycle/confinement evidence; no architecture expansion or readiness bypass.
4. Continue the active bounded T08 module in parallel where its paths are disjoint; do not dispatch a duplicate. T05 remains sole mount owner. Use exact host-prepared consent and note-version binding; fence stale preview/mount/pairing and duplicate actions. Selection, local definition, denial, dismissal and '?' send no inference request. Validate provisional/committed and cancel/unknown states.
5. On the resulting reviewed revision, prove the real reader loop through the actual mount: local Keep/note → explicit Ask → host preview/permission → provider result → local interaction → reload/reattachment, plus cancellation/recovery and an unseen page. Mocks exercise state machines, not launch inference evidence.
6. Continue preserved T20 with a later bounded 6Pro assignment and then the remaining transforms/library/platform/release work. Real saved-solver invocation is zero model turns and separate from cloud Ask-again. T05 owns UI handshake; T06/T07/T13 own their host/store/authority seams until explicitly handed off.

Astra chief steers scope, dependency, receipt and integration decisions, with no new implementation. Independent Luna verification records actual model/effort when exposed, route, exact SHA, environment, commands and observable behavior. A missing runtime model field stays unverified. Implementation, aggregate tests, real browser/provider behavior, per-OS confinement and human launch gates are separate acceptance records.

## Source and vision — unchanged

Current direct user decisions take precedence, then [SPEC-FINAL](wayfinder/SPEC-FINAL.md), [SPEC / R1–R30](wayfinder/SPEC.md) and all 71 [FEATURE-INVENTORY](wayfinder/FEATURE-INVENTORY.md) entries, then [build-stage sequencing](wayfinder/BUILD-PLAN-24H.md). Whitepaper, MAP, closed ticket decisions and designs retain their rationale/traceability roles. Challenge timing changes sequence, not scope. [Scope coverage](docs/SCOPE-COVERAGE.md) and [design reconciliation](docs/DESIGN-PASS-2-RECONCILIATION.md) remain reference maps, not completed-feature evidence.

Marginalia is a margin beside whatever the reader is reading. Source stays unchanged; notes are senior; the work belongs to the reader; explicit frozen anchors, durable return, help beyond summary, inspectable interactive outputs and calm states remain required. Reading-position editor and one complete map preserving density, sections, marks and current position are settled decisions. Do not replace the margin with a chatbot or administrative dashboard.

Preserve four computation paths: packaged local evaluation; recorded samples only inside their envelope; explicit saved solver with zero model turns; explicit cloud Ask again for interpretation/model revision. A deterministic authenticated loopback check may be zero-model work; external/model/retrieval traffic is not. Never spend cloud permission for local recompute/cache work. Candidate claims and browser calculations do not become host-certified scientific results by relabelling.

Windows, Linux and macOS are equal targets from the outset. Available hardware changes evidence scheduling, not requirements. Retain data by default on uninstall, offer export before deliberate deletion and preserve two verified SQLite pre-upgrade backups plus any unresolved recovery copy. Minimal public health and protected diagnostics remain. User sign-in, access to remaining machines, reader evaluation and publication choices are external/human gates. Collectors, installers, migration/export/diagnostic tooling and recording preparation remain engineering work.

## Historical integration chronology — evidence, not active instructions

The following records preserve prior commit/test evidence in past tense. They are not new runs, current worker assignments or evidence that all tickets are done. Full original wording is retained [in BUILD-STATUS at the exact base](https://github.com/yashgurbani/marginalia/blob/1517433968d03cdde054a70376ca26c2d9221315/marginalia-v2-package/BUILD-STATUS.md). Outgoing chief task: `01a0adaf-dd71-7583-8307-b877547c9189`.

### Frozen baseline and combined review

The frozen implementation was published as `2c35157c38a59a3a84c8eaa1265aaf12706951f2`; owner hashes were recorded as matching. It consolidated helper, reader journal, adapters, extension, saved-reply margin, jobs, consent, library and renderer/kernel, not a fully working asking/recompute experience. [CONSOLIDATION-BASELINE](docs/evidence/CONSOLIDATION-BASELINE.md) remains historical.

The six-document combined Pro review ended at `e27672b219151467ffedb51bada6f2910b53acad` and was integrated through `4fc459c`. Its source verdict was CHANGES NEEDED and not release-ready. It covered all 21 tickets, 71 entries and R1–R30; its initial Windows-first evidence phrasing was superseded by the user's equal-three-platform requirement. [Chief reconciliation](docs/evidence/COMBINED-PRO-RECONCILIATION.md) and [review documents](docs/evidence/pro-consolidated/README.md) retain the original findings, including the two F20/F21 boundary distinctions. Their old worker/disposition statements must be read against the current board above.

The original combined diagnostics ran on Linux Node 22 without native dependencies and did not establish a Node 24/product-platform gate. Later integration results below are separate, not retroactive passes for that original environment.

### Provider, contract, storage and library corrections

| Historical change | Recorded evidence and limits |
|---|---|
| T01 Pro `2c926c5` → integration `39ff68c` | Chief inspected three paths; owner independently reported exact-commit Node 24.14.1 diagnostics 9/9. Explicit executable/dedicated-home probing replaced ambient diagnostics. Bundled runtime later used the same identity; external runtime-module identity remained open. |
| Pairing backend `14f46c5` | Stable independent IDs, selective idempotent revoke and legacy backfill preserved tokens. Chief recorded pairing/server 14/14. Trusted management entry/UI still required later work. |
| T02 Pro `e979312` → `eefb8b6` | Chief inspected five paths and recorded `node --test --test-timeout=60000 tests/provider-adapters.test.ts tests/provider-stdio.test.ts`: 49/49, no failures/cancellations/skips on local Node 24. Completed-parent continuation became read-only; attempt-bound ProviderNotSentError was added. No actual provider acceptance followed. |
| T18 exact patch → `57ad295` | Patch SHA-256 `31f65ff1a2b7ee6e242546869829d61751794c1189b00d0922e34a1f2efe33e9`; ten allowed paths inspected. Owner recorded Node 24/TypeScript 5.9.3, 13/13 including six Chrome scenarios, narrow typecheck and production build. DOM/focus, finite plotting, unchecked prose separation and readiness changed. The then-blocked full typecheck was later fixed elsewhere. [Verification](docs/evidence/T18-consolidated-pro-fixes-verification.md). |
| T11 `cd808dc` → `d79bc63` | Pro authored lifecycle fixes; historical dynamically routed, metadata-verified Sol Medium corrected only NodeList iteration and a daemon parameter-property syntax issue. Chief inspected five paths and recorded library 31/31 using controlled DOM/adapters, not browser entry acceptance. This historical attribution is not permission for new Sol work. |
| T07 first Pro `4552b656` → `6eb44a9`; test correction `cb94232` → `6b39ece` | Shared admission retained invalid drafts without starving unrelated work; identical pending intent survived reconciliation; material title/type changes gained immutable source versions; export gained scoped execution history. Native SQLite/journal/full-suite and reader/journal/store/library 63/63 were recorded. The continuation was published as c9c2b27; its current-base continuation-only checkpoint is now 3b24063, unmerged and unaccepted. |
| T03 `c14b351`, `7e6bf2c` | Empty-selector termination, total candidate error handling, array minima, URL-family checks and numerical headline/domain semantics. Chief recorded 32/32 Node 24 contract/renderer checks including six Chrome scenarios, no skips. Host revalidation/resealing remained required after changed semantics. |
| T13 `e60000c` | Pro package plus one historical dynamically routed Sol syntax correction; ten paths inspected; chief recorded policy/consent/retrieval 35/35. Current-request hashes, DNS family pinning, consent focus/dismissal and platform evidence shapes changed. Controlled observations did not prove actual isolation. |
| T06 `8b0804a`, `f9125ab`, `0723d87` | Historical routed Sol lifecycle slice corrected preparation types, restart workspace, post-await admission, cleanup acknowledgment, settlement races, retry capabilities and portable identity. These source corrections are preserved, not work assigned anew. |
| T06/T13 `e94d797`, `f6a5837`, `959d38e`, `da1992f` | Same-DB handoff transaction, legacy denial migration and T13-reviewed immutable-context binding; 57 focused owner checks and independent T13 review were recorded before integration, followed by chief full-suite checks. This first transaction did not close the later asynchronous provider-send gap. |

### Extension, offline reader and helper management history

T04's reviewed patch was integrated as `2cbe4d0`, artifact SHA-256 `3ef3f110e8f15ab88b309cb0cf98988dcda5ea9a2adf516a6ea509370b846270`. Chief inspected 16 paths and recorded 9/9 protocol/pairing/reader checks plus a Chrome MV3 build. Changes covered admitted heading text, initial reading position, explicit message failures, loopback helper configuration, capture/reload identity and narrow sizing.

Actual Chromium inspection then found Open browser margin broken because webNavigation returned null for extension-owned workspace tabs. `9efb2cf` used extension contexts; the rerun recorded initial workspace/reload/stale-source/narrow behavior passing. Browser-document identity and capture identity remained separate.

Real pairing POST succeeded while authenticated GET reads failed because Chrome omitted Origin. Backend aliases `3fc161e` had 15/15 chief server/read checks; the actual extension probe recorded pairing and all three POST reads succeeding with real Origin, while old no-Origin GET and revoked-token requests still failed. T05 read mapping/awaited-lock typing `4e6d211` restored full typecheck. Both reader surfaces were rebuilt.

Actual Windows Chromium reader/background verification recorded pairing, explicit save, saved-note reload, helper-down local-note survival and stale-source refusal. See [integrated reader evidence](docs/evidence/t04-integrated-reader/REPORT.md). `3fb9e8e` then replaced raw network/timeout/unreadable-result errors with truthful unconfirmed wording. Chief recorded 26 helper/journal checks, typecheck and both builds; actual browser rerun recorded the wording and independent local-note reload. See [recovery evidence](docs/evidence/t04-recovery-copy-browser/REPORT.md). Earlier [workspace evidence](docs/evidence/t04-workspace-context/BROWSER-ACCEPTANCE.md) and [original browser failure](docs/evidence/T04-browser-verification.md) retain the progression; WS, exclusions and broader platform/design/provider acceptance were not implied.

`5507874` made occupied-port startup calm, with configured-port/address guidance. Chief reproduced the prior raw error, recorded 16 launch/server/read checks and typecheck, and noted the existing service stayed running. Installer and Linux/macOS launch evidence remained open.

C6 `2af10d5` durably forgot local pairing before revoke, with truthful uncertainty and protection for a newer pairing. Eleven focused helper checks, typecheck and both builds were recorded. Actual Windows Chromium disconnect/reload kept the local note and stopped Save traffic until pairing again. See [offline Disconnect](docs/evidence/t05-offline-disconnect/REPORT.md).

C4 trusted helper-only code/list/revoke routes were integrated as `87b451d`, with 23/23 combined management/pairing/server/read checks and typecheck. `0111589` recorded actual Chromium relative-fetch code/pair/list/revoke with real browser metadata, no synthetic forbidden headers. See [helper management contract](docs/evidence/T01-helper-management.md) and `docs/evidence/t01-helper-management-browser`.

The earlier T05 helper UI checkpoint `e2fb6c2b61cce004c2c2964f9db146f73fac32fc` was based on `87b451d`, on `codex/t05-helper-management`. Its original owner reported 8 UI/backend checks, typecheck and webapp build. The later user-reported Luna report adds the exact visible/extension evidence in the current table above. Neither statement accepts the newer combined T05 reconciliation.

The outgoing chief's final recorded integrated suite at `0111589` was 282/281/0/1/0 (total/pass/fail/skip/cancelled), Windows Node 24.14.1, log `.local/consolidation-current/tests-recovery-management.log`. Typecheck and both webapp/Chrome extension builds were recorded passing. The optional browser harness was separately exercised with Chrome. Built output was generated/ignored, not proof of a fresh-clone install. [INTEGRATED-VERIFICATION](docs/evidence/INTEGRATED-VERIFICATION.md) retains the detailed scope.

### T19/T20 and stopped-worker recovery history

T19's historical first-party Opus experience review delivered C1–C15, with owners in [T19 disposition](docs/T19-CHIEF-DISPOSITION.md). It was not implementation of all installers/recovery flows. C3 dedicated diagnostics, C5 port collision, C6 offline Disconnect and C4 backend subsequently received the bounded evidence above.

T20 historical worktree: `D:/Projects/Marginalia-worktrees/t20-saved-solver`, earlier base `6987e64`, branch `codex/opus-t20-saved-solver`. First-party Opus 5 High session `163a228c-e0a6-4723-9a7d-285c8bda36a2`: correction handle 60311 exited 0 and chief recorded 88/88; later handle 58369 exited 0 with worker-reported 116 checks. Independent T02/T03 and chief reviews found remaining malformed-output, state-key/fixed-input and atomic dispatch gaps. Process/handle 56457 was interrupted; resumed handle 20245 was deliberately stopped, exit 1, without a revision-4 completion receipt. Chief then recorded 123/123 on the preserved checkpoint. These counts are separate revisions, not cumulative acceptance.

c144506 includes partial revision-4 changes and remains unaccepted. [T20 chief review](docs/evidence/T20-CHIEF-REVIEW.md) is on integration; `docs/evidence/T20/HANDOFF-CHECKPOINT.md` and `PENDING-CHIEF-REVIEW.md` are on the preserved branch. Original `.local/opus-t20` logs/briefs were not pushed. There is no active Opus and no authorization here to restart it. A later 6Pro scope may use `contracts/solver.ts`, `daemon/solver/**`, saved-solver tests and T20 evidence/receipt only as explicitly assigned; host/UI/store changes need separate ownership.

The former T06 Sol worktree `D:/Projects/Marginalia-worktrees/t06-actual-send-boundary`, branch `codex/t06-actual-send-boundary`, base `da1992f`, was preserved clean after failed session recovery/capacity attempts. Task `01a0ae02-dc03-7ec2-ae86-26b6be5bf319` and latest refused attempt `01a0aec6-c498-7fc2-9cb0-f5eb742f8d96` did not produce the actual-send implementation. That stopped history does not describe the now-active T06 6Pro chat.

### Historical owner and developer-route references

These task IDs are retained for recovery, not reissued as active assignments:

| Historical lane | Codex task |
|---|---|
| T01 | `01a0adc8-8f4d-73a3-9e13-abdb015c842b` |
| T02 | `01a0add5-2436-7231-9727-63a11ab0c75a` |
| T03 | `01a0ae01-0695-7b61-bd4d-0bacdbce172f` |
| T04 | `01a0add2-39b2-7591-b86b-9635b85c5d1c` |
| T05 | `01a0adc8-a066-7d11-8248-9cb5a63cd737` |
| T06 | `01a0ae02-dc03-7ec2-ae86-26b6be5bf319` |
| T07 | `01a0adcb-25bd-7451-831f-40197dade46a` |
| T11 | `01a0ae11-2eb5-7461-9caa-0446092f6a92` |
| T13 | `01a0ae07-41af-7b83-ae7f-d73ecb608090` |
| T18 | `01a0addb-ef93-77e0-8a57-45873cead42e` |

Historical developer routing references were `C:/Users/reader/.codex/skills/codex-mcp-router/SKILL.md`, `C:/Users/reader/yasb-personal/scripts/Start-Active-Codex-Mcp.ps1` and `Codex-Mcp-Router.mjs`; the skill's `scripts/invoke-router.mjs` opened a fresh official stdio connection when an old client cached Transport closed. Prior read-only session `01a0ae43-d6ad-7f22-8b7b-3a3e07364402` exposed gpt-5.6-sol/medium metadata in a managed complementary account home. That was developer-route evidence, not product authentication/isolation or permission for new Sol work. Current verification routing is automatic complementary-account MCP Luna Max, without fixed-account pinning or token-file access; T07's registered dynamic MCP session and independently confirmed runtime model/effort are recorded in the current evidence table.

Historical design sources were `D:/UserData/reader/Downloads/marginalia-v1-package/design` and adjacent `design-pass-2`. Existing [Pro collaboration notes](wayfinder/PRO-COLLABORATION.md), source packets and receipts remain traceability materials; current user routing and explicit reservations above govern conflicts.

## Repository hygiene and final acceptance limits

Root `CONTEXT.md` and `README.md` were previously dirty/user-owned. Existing worktrees, untracked design/review archives, source packets and profiles must not be blanket-added, cleaned, reset or deleted. Machine-local paths/processes were not inspected in this GitHub documentation task. The old snapshot-helper path was missing; no successful helper snapshot is claimed.

Do not mark all 21 tickets complete, present the alpha as launch-ready, propose merging unverified code, or promote an owner test report to current combined acceptance. Source corrections, platform/provider evidence, human prerequisites and publication decisions remain separately recorded. This handoff changes coordination documents only.