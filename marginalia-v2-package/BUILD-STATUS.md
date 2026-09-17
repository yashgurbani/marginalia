# Marginalia overall build report

## Latest integration update

Evidence/Explore corrected modules are now integrated after chief review:32focused tests and complete typecheck pass. They do not yet have live stage5a/reader mounting acceptance. Opus5 T20 finished atfda8dba with two adapters and committed-claim correction; the other two host prerequisites fail closed. T20 independent delta review is running before integration. See consolidation checkpoint for this newer disposition over older hold tables.

All four Luna regression slices are integrated, including the Sol capture typing/dependency repair at14b63c7. Fresh capture/protocol16tests and full package typecheck pass; the earlier persistence/library/renderer8tests also passed at their integration checkpoint. Full ticket/browser/platform acceptance remains open.

T08 Pro finished at a9a6a08 and passes53tests/full typecheck in candidate27bdbaf; independent actual-interface review is still pending, so it is not merged. T05/T06 Pro remain active. Opus4.8 T20 finishedc4a6744; Opus5 has resumed after the PC crash and is implementing solver adapters/corrections. Evidence and Explore Sol changes remain unmerged; Explore's saved-shelf correction is underway. The one-time Pro check was fulfilled and its automation paused. See [current consolidation checkpoint](docs/CONSOLIDATION-CHECKPOINT.md) for authoritative live owners and review holds; the following earlier stocktake is historical where superseded.

## Current checkpoint — 17 September 2026, whole-project consolidation

The project has substantial implemented foundations but is not launch-ready. No accepted real reader-to-provider-to-saved-solver journey exists yet. All T00–T20 and the full feature inventory remain scope. The priority is composing and verifying the real reader journey, not accumulating isolated modules or redesigning the architecture.

- Integrated product: T07 merge `dc0f963`, source `2464ce6`; documentation checkpoint `b4ad04d` before this review update. T07's42native tests and final project typecheck are exact-scope evidence, not whole-ticket/platform acceptance.
- Active Pro: `codex/pro-t05-full-recovery` (reader and all mounts), `codex/pro-t06-full-recovery` (jobs/providers plus evidence-backed runtime composition), `codex/pro-t08-full-recovery` (asking module). Shared project histories recovered; GitHub is the authorized common update point. No new source from these runs has been accepted at this checkpoint.
- T14/T15 Opus: published `86d6581`; worker finished, merge HELD for Evidence authority and Explore public-contract/navigation findings. Luna's final bounded review is complete, HOLD—CHANGES NEEDED, preserving earlier checks as historical evidence. Chief's correction rejects speculative authorization machinery and any ban on opening useful thin-shelf items. Do not wire the current supported verdict into the product.
- Active Opus4.8Medium: `codex/opus-t20-completion`, existing c144506 work transferred asddbe72d, scoped brief ea4ab42. First-party authentication, explicit user stale-meter override. Solver-owned files only; original worktree preserved.
- Independent verification: dynamic MCP Luna Max on isolated fixed-SHA worktrees; failures go back to the owner before merge. No automatic model/account fallback, recursive workers or duplicate work after timeout.

The user requested a half-hour Pro progress check, scheduled as `check-marginalia-pro-ticket-progress`. Current work meanwhile is independent review and project consolidation.

## Current reports and decision authority

- [Whole-project stocktake and every-ticket assessment](docs/PROJECT-CONSOLIDATION-REVIEW.md): product position, direction changes, requirements and acceptance order.
- [Steering handoff](docs/FABLE-STEERING-HANDOFF.md): exact active chats, branch/path ownership, worker IDs, recovery and next actions.
- [Fable continuation prompt](docs/FABLE-CONTINUATION-PROMPT.md): takeover only after coordination with current chief.
- [T14/T15 review hold](docs/evidence/T14-T15-CHIEF-RECONCILIATION.md), [T07 native verification](docs/evidence/pro-t07-fixes/NATIVE-VERIFICATION.md), and [historical integrated checks](docs/evidence/INTEGRATED-VERIFICATION.md).
- [Wayfinder collaboration rules](wayfinder/PRO-COLLABORATION.md), [SPEC-FINAL](wayfinder/SPEC-FINAL.md), [stage plan](wayfinder/BUILD-PLAN-24H.md), [feature inventory](wayfinder/FEATURE-INVENTORY.md).

Current documents replace old active-owner tables. Historical receipts below remain evidence for their stated revisions, not instructions to restart old workers or proof that current tickets are complete.

## Integration direction

Complete T06's actual-send and real runtime evidence, mount T08 through T05, and demonstrate exact-payload explicit consent, meaningful reply, honest failure/cancellation/unknown states and durable recovery. Then integrate saved recomputation through the same host/UI contracts with zero model turns. Correct T14/T15 before combining them. Continue remaining simulation, renderer, library, install/platform and launch gates without dropping scope.

Keep the original reading experience: untouched source, notes primary, editor at reading position, one informative map, no implicit sending. Fetched is not supported; paired is not ready; code exists is not mounted; passing fixtures are not live acceptance. Reuse the current store, contracts, broker and renderer. Ask Matt's implementation and Standards+Spec review applies; no new planning framework or speculative abstractions.

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
