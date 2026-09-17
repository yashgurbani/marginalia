# Marginalia overall build report

Updated 17 September 2026. Chief task: 01a0adaf-dd71-7583-8307-b877547c9189.

## Current position

The consolidated implementation is published at `2c35157c38a59a3a84c8eaa1265aaf12706951f2` on `codex/marginalia-v2`. Frozen owner hashes matched before integration. This includes the helper, durable reader journal, provider adapters, extension, saved-reply margin, jobs, consent, library and renderer/kernel. Integration is not feature acceptance: live asking, recovery, confinement and release gates remain open.

Post-review integration: T01 Pro commit `2c926c5` is integrated as `39ff68c`. Chief inspected its three-path diff; the T01 owner independently ran the exact commit on local Node 24.14.1, with 9/9 diagnostics tests passing. Diagnostics now probes only the explicitly configured executable and dedicated home. T06 lifecycle integration now wires the same canonical executable and dedicated home into bundled runtime creation and diagnostics; external runtime-module identity remains open. The paired-browser management backend is also integrated as `14f46c5`: independent stable IDs, selective idempotent revocation and legacy-row backfill preserve existing tokens. Chief ran the combined pairing/server suites: 14 passed, no failures or skips. Trusted helper management routes, UI and live recovery remain.

T02 Pro commit `e979312` is integrated as `eefb8b6`. Chief inspected all five paths and ran `node --test --test-timeout=60000 tests/provider-adapters.test.ts tests/provider-stdio.test.ts` on local Node 24: 49/49 passed, no failures, cancellations or skips. Completed-parent continuation is now read-only, and pre-inference authorization rejection has an attempt-bound `ProviderNotSentError`. T06 lifecycle integration now consumes that error and acknowledges durable cancellation fences; real provider acceptance remains open.

T18's exact Pro patch (SHA-256 `31f65ff1a2b7ee6e242546869829d61751794c1189b00d0922e34a1f2efe33e9`) is integrated as `57ad295`, after chief inspection of its ten allowed paths. The owner independently ran Node 24/TypeScript 5.9.3 checks: 13/13 including six actual Chrome scenarios, narrow typecheck and production build passed. The fix preserves unrelated DOM/focus during sample checks, avoids non-finite plot coordinates, separates unchecked authored descriptions from result headings and improves readiness copy. Full typecheck remains blocked by other tickets. Host highlighting arbitration, real sidecar delivery and complete reader flow remain open; see [verification](docs/evidence/T18-consolidated-pro-fixes-verification.md).

T11's combined Pro/Sol patch `cd808dc` is integrated as `d79bc63`. Pro authored the library lifecycle correction; one dynamically routed MCP worker, runtime-verified as Sol Medium, corrected only NodeList iteration and the daemon parameter-property syntax. Chief inspected all five paths and ran the current checkout's library suite: 31/31 passed. These use a controlled DOM surface and adapters, not actual-browser acceptance. T05 entry/return wiring, complete export and sanitized diagnostics remain required.

T04's reviewed routed-Sol patch is integrated as `2cbe4d0` (artifact SHA-256 `3ef3f110e8f15ab88b309cb0cf98988dcda5ea9a2adf516a6ea509370b846270`). Chief inspected all 16 paths, ran 9/9 protocol/pairing/reader checks and built the current Chrome MV3 extension successfully. It fixes admitted heading text, initial reading position, explicit message failures, configurable loopback helper address, reload identity and narrow-panel sizing. The corrected floating identity check separates browser-document and capture identities. Actual Chromium verification passed heading filtering, initial/reprojected position, floating mount, stale capability refusal and narrow fit, but found Open browser margin broken: webNavigation returns null for extension-owned workspace tabs. Correction integrated as 9efb2cf uses browser extension contexts; actual rerun passes initial workspace, reload, stale source rejection and narrow layout. Pairing POST succeeds but authenticated GET reads fail because Chrome omits Origin; The backend aliases are integrated as `3fc161e`: chief server/read-alias checks passed 15/15. T04 actual Chromium extension probe verified pairing and all three POST reads succeed with real Origin; old no-Origin GET and revoked-token requests still fail. T05 client mapping and awaited lock typing are integrated as `4e6d211`; full typecheck passes. Both reader surfaces were rebuilt. T04 actual Windows Chromium reader/background acceptance passed pairing, explicit save, saved-note reload, helper-down local-note survival and stale-source refusal; see [integrated reader evidence](docs/evidence/t04-integrated-reader/REPORT.md). Offline copy still says Failed to fetch, so calm recovery wording remains open. The larger Pro UI artifact remains pending. WS remains unverified; see [current browser evidence](docs/evidence/t04-workspace-context/BROWSER-ACCEPTANCE.md) and [original failure](docs/evidence/T04-browser-verification.md). Full cross-browser/platform acceptance and F16 exclusion synchronization remain open.
T07 first Pro slice4552b656 is integrated as6eb44a9, with routed Sol test-only correctioncb94232 as6b39ece. Shared mutation admission retains invalid drafts without blocking unrelated work; matching durable pending changes survive reconciliation; source title/type changes receive immutable versions; thread export includes scoped execution history. Native SQLite and current full-suite checks pass. C8 safe backups/newer-version refusal and durable device-version conflict choice remain in the unpublished Pro continuation, so T07 is not closed.

T03 Pro commits are integrated as `c14b351` and `7e6bf2c`. Empty selectors terminate, malformed candidates return errors, array minima match the contract, URL checks distinguish DNS names from IPv6, and headline admission preserves numerical domain information without granting scientific authority. Chief ran Node 24 contract and renderer tests with actual Chrome: **32/32 passed, zero skips**, including six browser scenarios. Existing host reports still require host-owned revalidation and resealing after changed semantics.

T13's Pro package plus one dynamically routed Sol Medium syntax correction is integrated as `e60000c`. Chief inspected its ten paths and ran Node 24 policy, consent and retrieval suites: **35/35 passed**. Reused grants bind current request hashes, retrieval pins the address family, consent dismissal/focus is coherent, and policy evidence distinguishes all three target platforms. These tests use controlled runtime observations; they do not establish actual platform isolation. F20's durable host-handoff transaction and legacy denial migration are now integrated through `da1992f`, including T13-reviewed immutable-context binding. The actual provider-send boundary remains open.

T06's reviewed dynamic-account Sol Medium lifecycle slice is integrated as `8b0804a`, `f9125ab` and `0723d87`. It fixes preparation return types, restart workspace recovery, admission after asynchronous preparation, cancellation acknowledgment, settlement races, current retry capabilities and portable runtime identity. T06 and T13 are dispatched on the shared `0723d87` baseline for atomic consent/dispatch finalization; T13 also owns the proven legacy denial migration defect. The combined transaction and immutable-token correction passed 57 focused owner tests and T13 independent review, then integrated as e94d797/f6a5837/959d38e/da1992f. Chief full-suite verification passed. T06 owns the next coherent actual-send correction in an isolated worktree, with T02/T13 reviewing provider/consent changes; its fresh Sol request was capacity-refused without edits after the old session could not resume. The packet is preserved and further retries stopped; no overlapping writers. This does not establish actual provider execution or finish T06.
Ten ticket owners have completed or are reconciling exact-source 6Pro reviews and have submitted bounded implementation follow-ups. Pro is producing fixes and regression tests on isolated branches or patch/ZIP artifacts. Astra owners inspect those outputs; chief controls integration. The [combined Pro review](https://chatgpt.com/c/6aab9618-74b8-83eb-9518-da28543f1429) is complete against the same revision, full spec, whitepaper and both design passes. Its write scope was review documents only, under `docs/evidence/pro-consolidated/`.

The combined reviewer has now published all six report documents; the final report tip `e27672b` is integrated through `4fc459c`. Its verdict is CHANGES NEEDED / not release-ready. [Chief reconciliation](docs/evidence/COMBINED-PRO-RECONCILIATION.md) accounts for F01–F21, current fixes and the remaining full product scope. A newly identified once-grant transaction-boundary defect is assigned jointly to T06/T13. The report preserves all 21 tickets, 71 inventory items and R1–R30; its older Windows-first evidence phrasing is explicitly superseded by the user's all-platform direction.

Testing is authorized. The current full suite on 4e6d211 completes: **269 tests, 268 passed, 0 failed, 1 skipped, no cancellations**, after the backend/client read transport integration. The optional browser harness was separately verified with Chrome. Typecheck now passes without diagnostics. Both the webapp production build and Chrome MV3 extension build pass. See [current verification](docs/evidence/INTEGRATED-VERIFICATION.md); the [earlier baseline](docs/evidence/CONSOLIDATION-BASELINE.md) remains historical evidence. These checks do not establish the missing real user flows or runtime isolation.

Opus 5's T19 experience review is delivered. C1–C15 retain explicit owners in [chief disposition](docs/T19-CHIEF-DISPOSITION.md). T20's first correction passed 88 chief-run tests, but source review found reader preparation, idempotency/result-authority, output framing and generation-binding gaps. The same first-party Opus 5 session is correcting them under live handle 58369. See [T20 review](docs/evidence/T20-CHIEF-REVIEW.md). T20 is not integrated or accepted.

## Source and vision

[wayfinder/SPEC-FINAL.md](wayfinder/SPEC-FINAL.md) governs. [SPEC.md](wayfinder/SPEC.md) supplies R1–R30, [FEATURE-INVENTORY.md](wayfinder/FEATURE-INVENTORY.md) retains all 71 entries, and [BUILD-PLAN-24H.md](wayfinder/BUILD-PLAN-24H.md) orders implementation and release gates. The research whitepaper explains the purpose. [Scope coverage](docs/SCOPE-COVERAGE.md) records requirements and gaps. Historical root notes cannot override these sources or current user decisions.

Marginalia is a margin beside whatever you are reading. Source stays unchanged; notes are senior; inference needs explicit consent; the reader owns the work. Selection sends nothing. Preserve all four computation paths: local kernel, saved samples within their envelope, saved solver without a model turn, and explicit Ask again. Mechanical checks are not scientific truth. Keep storage, inference, tool-network and retrieval boundaries distinct. The Astra challenge sets priority, not permission to cut scope.

Design comes from `D:\UserData\reader\Downloads\marginalia-v1-package\design` and adjacent `design-pass-2`. T05's Astra Medium owner combines Claude's system with Pro advice, Impeccable and taste guidance. The user settled the two material conflicts: the editor stays at the reading position; one map preserves density, sections, marks and current position. [Pass-2 reconciliation](docs/DESIGN-PASS-2-RECONCILIATION.md) separates intended behavior from delivered or unverified behavior.

Windows, Linux and macOS are all target platforms from the outset. The user can test Windows/Linux and will arrange a Mac. Portable daemon paths, process control, Codex app-server behavior and installers are required. Missing platform evidence must remain visible.

## Ticket board

Integrated means committed for review, not that the full reader experience passes. Queued capabilities remain required.

| Ticket | Capability | Current work and remaining gate |
|---|---|---|
| T00 | Numerical fixture | Foundation integrated; final rendered/live fixture remains |
| T01 | Helper and pairing | Diagnostics and bundled runtime identity integrated; paired-browser management backend integrated14f46c5, chief14/14 pairing/server checks pass; trusted helper UI/routes and live recovery remain |
| T02 | App-server and MCP adapters | Pro continuation/not-sent correction integrated as eefb8b6; 49/49 local focused checks pass; T06 integration and real authenticated asking/recovery remain |
| T03 | Reply contract/host authority | Pro fixes integrated c14b351/7e6bf2c; 32/32 contract/renderer checks including Chrome pass; real host records and delivery remain |
| T04 | Extension capture/private host | Reviewed routed-Sol fixes integrated 2cbe4d0; 9/9 tests and build pass; workspace correction integrated9efb2cf and browser rerun passes; backend aliases integrated3fc161e with15/15 chief checks and realextensionprobe; client mapping integrated4e6d211; bounded actual reader/background QA passed; broader design/provider/platform acceptance remains |
| T05 | Margin/design | Minimal read mapping/lock type fix integrated4e6d211; tests/typecheck/builds pass; full Pro design artifact still pending retrieval; bounded actual reader QA passed, recovery copy still open |
| T06 | Jobs/cancellation/helper APIs | Lifecycle integrated through 0723d87; F20 durable host handoff integrated through da1992f; actual provider-send boundary assigned next; real runtime, helper read transport, admission and recovery routes remain |
| T07 | Store/threads/journal | Pro first slice integrated6eb44a9 plus test correction6b39ece; native reader/journal/store/library63/63; backup/device-choice Pro continuation still awaiting retrieval |
| T08 | Contextual definition | Queued; depends on real provider, margin and consent flow |
| T09 | Simulation | Queued; real new passage through jobs and renderer required |
| T10 | WebMCP | Queued; typed replies and honest unsupported behavior required |
| T11 | Library/settings | Pro lifecycle + two Sol MCP compatibility corrections integrated as d79bc63; 31/31 focused checks pass; T05 entry/return flow, full export and diagnostics remain |
| T12 | Launch | Queued; fresh-machine gates, video and evidence-based listing required |
| T13 | Consent/provider boundaries | Pro/Sol fixes integrated e60000c; 35/35 focused tests pass; F20 implementation queued after T06 lifecycle and actual runtime isolation remains unverified |
| T14 | Evidence | Queued; dated claim-level support and abstention required |
| T15 | Explore | Queued; useful linked shelf parked by default required |
| T16 | Notes/vocabulary | Basic notes integrated; note-version Ask and complete origin/deletion/recovery remain |
| T17 | Page header | Queued; local identity, granted enrichment and return position required |
| T18 | Renderer/kernel | Pro corrections integrated as 57ad295; 13/13 owner checks including browser scenarios and build pass; host arbitration, real sidecar delivery and complete reader flow remain |
| T19 | Install/recovery | Opus experience slice delivered; C1–C15 routed; installers and fresh-machine recovery on all platforms remain |
| T20 | Saved solver | Chief reran 88 tests, all passed, then found preparation, idempotency/result-authority and transport gaps. Same Opus 5 session is correcting them; dependencies, route mounting and real recompute verification remain; not accepted |

## Ownership and model routing

Chief owns source fidelity, dispatch, receipts, cross-ticket decisions, integration and acceptance. The current desktop account is reserved for Astra coordination/judgment. Technical coordinators use Astra Low; T05 uses Astra Medium. Sol Medium implementation/review must use the dynamic-account Codex MCP Router. Bulk work may use Luna Max. No native Sol fallback or fixed account pin is authorized.

| Owner | Codex task | Product paths |
|---|---|---|
| T01 | 01a0adc8-8f4d-73a3-9e13-abdb015c842b | pairing, diagnostics and owned tests; server/main belong to T06 |
| T02 | 01a0add5-2436-7231-9727-63a11ab0c75a | providers except policy-gate, job-runner contract, provider tests |
| T03 | 01a0ae01-0695-7b61-bd4d-0bacdbce172f | reply contract/schema, sample provenance, contract docs/tests |
| T04 | 01a0add2-39b2-7591-b86b-9635b85c5d1c | extension and protocol tests |
| T05 | 01a0adc8-a066-7d11-8248-9cb5a63cd737 | margin/helper/persistence UI, webapp main/service worker; excludes library/consent modules |
| T06 | 01a0ae02-dc03-7ec2-ae86-26b6be5bf319 | jobs contract/engine, daemon server/main and owned tests |
| T07 | 01a0adcb-25bd-7451-831f-40197dade46a | reader contract, store/journal and owned tests |
| T11 | 01a0ae11-2eb5-7461-9caa-0446092f6a92 | library contracts/daemon/UI/webapp module and tests |
| T13 | 01a0ae07-41af-7b83-ae7f-d73ecb608090 | consent, retrieval, policy, provider policy-gate and consent UI/tests |
| T18 | 01a0addb-ef93-77e0-8a57-45873cead42e | renderer/kernel and owned tests; growth fixture reserved to T00 |

Each owner operates its own Pro chat and returns exact source artifacts, review disposition and test evidence. No duplicate operator or overlapping Sol writer while Pro owns a fix. GitHub writes are preferred where exposed; ZIP/diff fallback is authorized. A claimed commit or passing test is not accepted until the returned artifact is inspected. [Pro collaboration rules](wayfinder/PRO-COLLABORATION.md) retain the handoff details.

T20 worktree: `D:\Projects\Marginalia-worktrees\t20-saved-solver`, branch `codex/opus-t20-saved-solver`, advanced to `6987e64`. Session `163a228c-e0a6-4723-9a7d-285c8bda36a2`, correction execution handle 60311 completed with exit 0. First-party Claude Max login was rechecked successfully after the user repaired login. Chief reran the three saved-solver suites: 88 passed, zero failures or skips. Chief source review found five correction areas in [T20 review](docs/evidence/T20-CHIEF-REVIEW.md). The same verified Opus 5 session is executing that correction under handle 58369. No real Codex execution or platform isolation is established. Owned new files: `contracts/solver.ts`, `daemon/solver/**`, `tests/saved-solver*.test.ts`, `docs/evidence/T20/**`, receipt T20. It must propose shared integration changes as artifacts rather than edit T05/T06 paths. Claude always uses first-party account authentication.

## Main integration risks

1. Product Codex runtime authentication and actual confinement remain unverified. Repairing developer MCP or Claude login does not authenticate Marginalia's dedicated Codex home. Keep dispatch honestly unavailable until its required evidence exists.
2. Pro found cancellation/restart/continuation defects: terminal checkpoints can prevent provider stop, restart loses needed workspace state, reused grants can carry old preview hashes, and resumed provider attempts can checkpoint the wrong parent. T02/T06/T13 own coordinated corrections.
3. Margin persistence races and failed-save recovery must preserve the user's notes across edits, remounts and tabs. T05 and T07 share the durable conflict seam; one owner's local pass cannot establish the combined behavior.
4. The exact bounded outgoing packet must be the same content shown in consent and used for digest, prompt and workspace. Selection is at most 4,000 characters and adjacent context at most 12,000; full captured source stays private.
5. Browser-only checks cannot confer host authority on a result sentence. A deterministic authenticated loopback host check is permitted without model inference; external/model/retrieval calls are not. Apply lifecycle fencing before the call and bind the returned report to current reply/inputs.
6. T19's wrong-account diagnostics, migration safety and extension admission findings are release blockers until resolved and verified. Pairing UI, ports, data/web paths, sanitized diagnostics, full export and all-platform installers remain explicit requirements.

## Evidence and next actions

Current local baseline: [CONSOLIDATION-BASELINE.md](docs/evidence/CONSOLIDATION-BASELINE.md). Ticket review packets, responses and dispositions are under `docs/evidence`; receipts remain under `wayfinder/build-receipts`. Older passing counts refer only to their recorded revisions and do not describe the consolidated build.

Next: collect Pro artifacts without duplicate requests; inspect path scope, exact changes and claimed tests; integrate compatible fixes in dependency order; run focused regression checks, then the aggregate checks once the source blockers are resolved. Reconcile the combined Pro findings with each owner and retain all queued feature/release gates. Product completion requires the actual reader entry points, not only module tests.

## Developer MCP route

Reusable skill: `C:\Users\reader\.codex\skills\codex-mcp-router\SKILL.md`. Official launcher/router: `C:\Users\reader\yasb-personal\scripts\Start-Active-Codex-Mcp.ps1` and `Codex-Mcp-Router.mjs`. Selection is complementary/automatic, with no fixed account label. Old registered clients may cache `Transport closed`.

The skill's `scripts\invoke-router.mjs` opens a fresh official stdio MCP connection for a bounded JSON request when that cache is stale. Actual session `01a0ae43-d6ad-7f22-8b7b-3a3e07364402` completed a read-only jobs review; turn metadata verified `gpt-5.6-sol`, medium, in a managed complementary account home. All owners received this route. An already routed Sol worker executes directly rather than recursively dispatching itself. This developer execution evidence does not satisfy product-provider gates.
