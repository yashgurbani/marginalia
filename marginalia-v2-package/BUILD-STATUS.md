# Marginalia overall build report

Updated 17 September 2026. Chief task: 01a0adaf-dd71-7583-8307-b877547c9189.

## Current position

The consolidated implementation is published at `2c35157c38a59a3a84c8eaa1265aaf12706951f2` on `codex/marginalia-v2`. Frozen owner hashes matched before integration. This includes the helper, durable reader journal, provider adapters, extension, saved-reply margin, jobs, consent, library and renderer/kernel. Integration is not feature acceptance: live asking, recovery, confinement and release gates remain open.

Post-review integration: T01 Pro commit `2c926c5` is integrated as `39ff68c`. Chief inspected its three-path diff; the T01 owner independently ran the exact commit on local Node 24.14.1, with 9/9 diagnostics tests passing. Diagnostics now probes only the explicitly configured executable and dedicated home. T06 must still wire the same canonical runtime identity into both runtime creation and diagnostics; until then the no-argument caller honestly reports unavailable/unknown. This fixes the component, not the complete sign-in/recovery journey.

T02 Pro commit `e979312` is integrated as `eefb8b6`. Chief inspected all five paths and ran `node --test --test-timeout=60000 tests/provider-adapters.test.ts tests/provider-stdio.test.ts` on local Node 24: 49/49 passed, no failures, cancellations or skips. Completed-parent continuation is now read-only, and pre-inference authorization rejection has an attempt-bound `ProviderNotSentError`. T06 still owns consumption of that error and acknowledgement of durable cancellation fences; real provider acceptance remains open.

T18's exact Pro patch (SHA-256 `31f65ff1a2b7ee6e242546869829d61751794c1189b00d0922e34a1f2efe33e9`) is integrated as `57ad295`, after chief inspection of its ten allowed paths. The owner independently ran Node 24/TypeScript 5.9.3 checks: 13/13 including six actual Chrome scenarios, narrow typecheck and production build passed. The fix preserves unrelated DOM/focus during sample checks, avoids non-finite plot coordinates, separates unchecked authored descriptions from result headings and improves readiness copy. Full typecheck remains blocked by other tickets. Host highlighting arbitration, real sidecar delivery and complete reader flow remain open; see [verification](docs/evidence/T18-consolidated-pro-fixes-verification.md).

Ten ticket owners have completed or are reconciling exact-source 6Pro reviews and have submitted bounded implementation follow-ups. Pro is producing fixes and regression tests on isolated branches or patch/ZIP artifacts. Astra owners inspect those outputs; chief controls integration. The [combined Pro review](https://chatgpt.com/c/6aab9618-74b8-83eb-9518-da28543f1429) remains active against the same revision, full spec, whitepaper and both design passes. Its initial write scope is review documents only, under `docs/evidence/pro-consolidated/`.

The combined reviewer has now published all six report documents; they are integrated through `3955424`. Its verdict is CHANGES NEEDED / not release-ready. [Chief reconciliation](docs/evidence/COMBINED-PRO-RECONCILIATION.md) accounts for F01–F21, current fixes and the remaining full product scope. A newly identified once-grant transaction-boundary defect is assigned jointly to T06/T13. The report preserves all 21 tickets, 71 inventory items and R1–R30; its older Windows-first evidence phrasing is explicitly superseded by the user's all-platform direction.

Testing is now authorized: the user lifted the pause after consolidation. The local baseline failed with 45 TypeScript diagnostics. The test run stalled in a provider-adapter child and was interrupted; its aggregate was 91 tests, 59 passing and 32 failing. This is not a completed-suite result. A real Node strip-only loader failure prevents server tests from loading. See [baseline evidence](docs/evidence/CONSOLIDATION-BASELINE.md). Fixes must address both genuine source defects and outdated test contracts without weakening product requirements.

Opus 5's T19 experience review is delivered. Its C1–C15 changes have explicit owners in [chief disposition](docs/T19-CHIEF-DISPOSITION.md). T20 saved-solver implementation is running in an isolated worktree after the user fixed first-party Claude login. Actual session metadata identifies `claude-opus-5`; no implementation acceptance is claimed yet.

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
| T01 | Helper and pairing | Pro diagnostics correction integrated as 39ff68c, 9/9 focused owner checks on Node 24; T06 canonical identity wiring and live recovery remain |
| T02 | App-server and MCP adapters | Pro continuation/not-sent correction integrated as eefb8b6; 49/49 local focused checks pass; T06 integration and real authenticated asking/recovery remain |
| T03 | Reply contract/host authority | Integrated with samples binding; Pro contract corrections/tests active; real host records and delivery remain |
| T04 | Extension capture/private host | Integrated with section metadata; Pro extension fixes active; hostile-page, worker recovery, port/identity and live Ask checks remain |
| T05 | Margin/design | Saved replies and recovery history integrated; Pro persistence/lifecycle, reading-position UI and library mount fixes active; browser/visual acceptance remains |
| T06 | Jobs/cancellation/helper APIs | Integrated; Pro lifecycle, prepare types and continuation fixes active; shared runtime, admission and restart/cancel gates remain |
| T07 | Store/threads/journal | Integrated through migration 4; Pro conflict/migration safety corrections active; preservation/recovery acceptance remains |
| T08 | Contextual definition | Queued; depends on real provider, margin and consent flow |
| T09 | Simulation | Queued; real new passage through jobs and renderer required |
| T10 | WebMCP | Queued; typed replies and honest unsupported behavior required |
| T11 | Library/settings | Modules integrated; Pro lifecycle/portability tests and fixes active; T05 mounts, T06 wires APIs; full export/diagnostics remain |
| T12 | Launch | Queued; fresh-machine gates, video and evidence-based listing required |
| T13 | Consent/provider boundaries | Integrated; Pro consent hashing, policy portability and focus fixes active; actual runtime isolation remains unverified |
| T14 | Evidence | Queued; dated claim-level support and abstention required |
| T15 | Explore | Queued; useful linked shelf parked by default required |
| T16 | Notes/vocabulary | Basic notes integrated; note-version Ask and complete origin/deletion/recovery remain |
| T17 | Page header | Queued; local identity, granted enrichment and return position required |
| T18 | Renderer/kernel | Pro corrections integrated as 57ad295; 13/13 owner checks including browser scenarios and build pass; host arbitration, real sidecar delivery and complete reader flow remain |
| T19 | Install/recovery | Opus experience slice delivered; C1–C15 routed; installers and fresh-machine recovery on all platforms remain |
| T20 | Saved solver | First-party headless Opus 5 worker running; isolated new modules/tests; T06/T05 integration and zero-inference execution acceptance remain |

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

T20 worktree: `D:\Projects\Marginalia-worktrees\t20-saved-solver`, branch `codex/opus-t20-saved-solver`, based on `2c35157`. Session `163a228c-e0a6-4723-9a7d-285c8bda36a2`, active execution handle 25761. Owned new files: `contracts/solver.ts`, `daemon/solver/**`, `tests/saved-solver*.test.ts`, `docs/evidence/T20/**`, receipt T20. It must propose shared integration changes as artifacts rather than edit T05/T06 paths. Claude always uses first-party account authentication.

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
