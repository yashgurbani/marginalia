# Project status and ticket review for Claude / GPT-6 Pro

## Current assessment — 17 September 2026

**Baseline: `1517433968d03cdde054a70376ca26c2d9221315`, `codex/marginalia-v2`. Product incomplete; not launch-ready. All T00–T20 and all 71 feature-inventory entries remain in scope.** This assessment carries forward the accepted current-revision advisory and the user's latest coordination facts; this documentation update performs no additional source review or tests.

**Current routing:** separate parallel 6Pro implementation chats, Astra chief steering only, independent verification through dynamically routed MCP Luna Max. No new Sol/Opus implementation. The earlier T05-only continuation, outgoing-chief stop, old Astra implementation exceptions and old Sol/Opus assignments are superseded. The separately reported native Luna Max run on T07 remains an existing verification run, not a new routing default.

[Current steering handoff](CLAUDE-STEERING-HANDOFF.md) owns the detailed chat/branch reservations and integration sequence. [BUILD-STATUS](../BUILD-STATUS.md) retains historical evidence. [This conversation](https://chatgpt.com/c/6aab9618-74b8-83eb-9518-da28543f1429) contains the combined review, accepted current-source reconciliation and authorization for this three-document handoff. The original review at `2c35157` is historical; its findings are not automatically open at `1517433`.

There is no defensible completion percentage. Committed modules, focused tests, runtime behavior and full product acceptance are different facts. The critical path is **actual-send correctness → usable evidence-backed dedicated runtime → explicit Ask/live source-bound reply in the existing margin → real interactive computation and durable return**. Recovery/install/platform and the rest of the inventory continue in bounded nonoverlapping lanes; they are not removed by this sequencing.

## Active lanes and waits

| Lane | Current assignment | What is not yet established |
|---|---|---|
| T05 | [6Pro chat](https://chatgpt.com/c/6aab9408-941c-83ed-b5ea-8e8a7ea14b7d), `codex/pro-t05-integration-checkpoint`: reconcile old 17-file patch plus helper UI to `1517433`. Own margin/helper/persistence/helper-management, webapp main/SW and T05 tests; sole mount owner. | No completed combined checkpoint or combined design/reader acceptance is asserted here. The e2fb6c2 helper report is not transferable to the reconciled patch. |
| T06 | [6Pro chat](https://chatgpt.com/c/6aab9381-d8c4-83eb-be12-75907bebd4c1), `codex/pro-t06-send-checkpoint`: implement actual send. | Its issued provider scope remains broad. Runtime collector implementation must WAIT for an explicit chief narrowing or handoff; do not treat the previous proposed split as a current release. |
| T07 | [6Pro chat](https://chatgpt.com/c/6aab93df-8f84-83eb-b0b7-d5780aef4e22), `codex/pro-t07-integration-checkpoint`: reconcile continuation only to `1517433`. Own reader contract/store/journal and tests. | Published `c9c2b2764e574ee670337ee3010e64930f9aaa5e`, parent `4552b65`, was independently remote-verified in the latest user coordination receipt. Exact-commit native Luna Max verification is reported running; no pass or rebased acceptance claimed. |
| T08 | New 6Pro chat pending chief dispatch; URL not yet known. ONLY `ui/asking/**`, `tests/asking*.test.ts`, `docs/evidence/T08-asking/**` and receipt T08. | No dispatched chat, module delivery or mounted flow claimed. T05 alone edits the actual mount/entry. |
| Runtime collector/composition | Accepted next contract, currently **WAIT** because of T06 ownership. | No collector implementation or runtime readiness established; sign-in alone is insufficient. |
| T20 | Preserved `codex/opus-t20-saved-solver` at `c144506f32b67a27f2487426c24b79e4f606af16`; no active Opus. | Unfinished code, unmounted route, missing host dependencies and no real recompute/isolation acceptance. Later work needs a bounded 6Pro assignment. |

Branch names for reconciliation are destinations, not proof of a published completed result. Do not duplicate prompts to active owners. If a dependency requires an adjacent path, chief changes the written ownership reservation before implementation; a reviewer does not silently widen its scope.

## Current-revision findings and their disposition

The following source observations were established in the preceding accepted advisory. File references are relative to `marginalia-v2-package/`; no new source claims or executions are added by this document.

| Finding / category | Observed current source | Disposition / owner |
|---|---|---|
| **P1 actual-send lifecycle defect** | `daemon/jobs/service.ts` finalizes `withDispatchHandoff()` before `runner.start/resume`. The adapters then serialize and await policy/thread/checkpoint work before the inference RPC. A once-grant/egress handoff can therefore be recorded before later preparation rejects. | Active T06 correction, T02/T13 review. Preserve the existing same-DB immutable-context/CAS/deadline/cancel controls; move consuming finalization to the prepared transport boundary. |
| **Runtime implementation gap** | `daemon/main.ts` supplies `unavailablePolicyHostEvidence()` and `dispatchReady: false`; `daemon/consent/evidence.ts` supplies empty host observations by default. | Implement the existing evidence interface/readiness composition only after T06 releases ownership. Missing sign-in/probes are not the sole cause; a flag change or synthetic evidence is not a fix. |
| **Ask/entry integration gap** | `ui/margin.ts` still constructs a local outgoing preview with disabled send choices; `webapp/main.ts` mounts the margin only. | T08 owns isolated asking logic; T05 sole mount owner. Use host preparation and the existing consent/job/renderer contracts, not a second manifest or persistence authority. |
| **Design implementation gap** | Current `ui/margin.ts` places the composer above the scrolling content and builds both rail and section-map representations. | Existing T05 reconciliation only. Reading-position editor and one complete map are settled requirements, not open design questions. |
| **T20 unfinished contract migration** | On c144506, `SolverExecutionGate` declares `prepareCommit()` and synchronous `commit()`, but execution still calls awaited `gate.finalize()` and a separate journal write before transport. | Preserve WIP; later 6Pro continuation reconciles actual call sites and host transaction/transport contracts. No advisory typecheck or module acceptance claimed. |

### Demonstrably corrected old failure paths — preserve, do not duplicate

| Earlier finding | Current source correction | Remaining boundary |
|---|---|---|
| F01 selector nontermination | `contracts/reply.ts` refuses invalid selector text before search and bounds advancement. | Candidate validation and real delivery still need their own acceptance; this is not all of T03. |
| F02 policy/workspace identity | `JobService` supports workspace-specific `policyFor` during preparation. | Genuine runtime evidence/composition is still missing. Do not reopen the old static-key failure as untouched. |
| F03 completed-file restart | Recovery restores the completed authoritative workspace before settlement. | Real provider/process restart evidence is separate. |
| F04 terminal-parent continuation | App-server continuation verifies its completed predecessor without checkpointing that terminal record. | Preserve recorded/latest-turn, lease and cancellation checks through actual-send work. |
| F05 timeout blocks cleanup | JobStore has narrowly identity-bound `acknowledgeStopFence()`, used before ordinary checkpointing. | Stop acknowledgment never means confirmed process termination; late result fences stay intact. |
| F15 identical durable pending recovery | `ui/journal.ts` preserves matching durable mutation identities and retains conservative failed-ack overlap handling. | T07 device-version choice/backups and combined T05 behavior remain pending. |
| F20 initial eligibility consumption | Initial eligibility is non-consuming; grant/authorization/egress and host handoff commit on the same DB connection with immutable binding. | The later actual-send gap above remains open. Neither call the first slice absent nor call the whole boundary finished. |

Historical integration receipts also report corrections for F06 current-request grant hashes, F08 mutation starvation, F09 material source identity, F10 contract admission, F11/F12 numerical/presentation semantics and F17/F18 library lifecycle/navigation. Those historical reports retain their exact revisions and limits. Do not label every one independently re-reviewed in this bounded advisory; consult the current owner/source before reopening a defect. F13 byte-budget code was changed, but exact real preview/send agreement remains an acceptance requirement. F14 draft/source continuity, F16 exclusion synchronization and F19 complete editor/map experience remain owned integration/acceptance work; do not create duplicate fixes over T05/T07.

On the preserved T20 branch, canonical-base64/sticky malformed-output handling, empty-input admission and a digest state-key contract are already present. Their consumer/host integration is not proved; the old review must be reconciled rather than repeated wholesale. No preserved T20 change is thereby integrated into `1517433`.

## Ticket-by-ticket current assessment

Delivered facts below are existing source slices or historical receipts, not fresh test results. Every row retains its remaining acceptance work.

| Ticket | Delivered / existing foundation | Open work, accountable next boundary and acceptance |
|---|---|---|
| **T00 Numerical fixture** | Numerical contract/kernel/renderer fixture exists. | Actual rendered checked fixture through the reader path, illustration limits and required growth cases. A fixture is not evidence of new model-authored simulation. Coordinate T03/T18; full live acceptance remains. |
| **T01 Helper, diagnostics, pairing** | Dedicated executable/home diagnostics; stable paired-browser IDs, revocation and trusted management routes. Historical 23-check/backend browser evidence exists. | T05 owns combined visible helper controls. Installed-helper recovery, usable extension registration and truthful live readiness remain. Runtime composition waits for T06 ownership release. No generic extension origin gains management authority. |
| **T02 App-server / MCP adapters** | Completed-parent verification and attempt-bound not-sent behavior integrated; historical 49 focused checks. | T06 owns current actual-send/provider changes. T02 reviews without competing writes. Real dedicated authenticated start, interrupt, continuation and recovery on both adapters remain unproved. |
| **T03 Reply contract / host authority** | Empty-selector/error/minima/URL/numerical-domain corrections; historical 32 contract/renderer checks including Chrome. | Real host-owned checks, revalidation/resealing and delivery; current-input/source binding and T20 contract compatibility. Descriptive prose and browser calculations do not impersonate a host verdict. |
| **T04 Extension capture / private host** | Heading/position/capture identity, floating/workspace handling, loopback setup and authenticated POST reads; bounded Chromium local-reader evidence. | Exclusion synchronization, SW reconnect, native panel behavior, actual provider reply path, Firefox and all three OS targets. Keep trusted host boundaries; local-reader checks do not prove full design or platform acceptance. |
| **T05 Margin / design / mounts** | Basic notes/saved replies and C6 offline Disconnect integrated. Earlier helper UI e2fb6c2 has the separately reported verification below. | Existing 6Pro reconciles 17-file patch plus helper UI to `1517433`. Reading-position editor, one complete map, focus/design states, live status, library/consent/jobs/replies and T08 mount remain its exclusive integration scope. Combined acceptance is pending. |
| **T06 Jobs / cancellation / APIs** | Lifecycle/restart/cleanup fixes and same-DB immutable host-handoff transaction through `da1992f`. | Active 6Pro actual-send checkpoint. Single-use prepared request, synchronous current authorization/attempt claim and immediate transport handoff; preserve honest known-not-sent versus unknown. Broad issued provider scope blocks collector implementation until explicitly handed off. |
| **T07 Store / threads / journal** | First Pro slice integrated: bounded mutation admission, pending intent preservation, material source versions, scoped execution export. | c9c2b27 continuation published on old parent; exact-commit native verification running with no pass. Existing Pro reconciles continuation only: durable device choice, SQLite-consistent verified backups, newer-schema refusal and failed-migration recovery. Test temporary DBs, never user data. |
| **T08 Contextual definition / explicit Ask** | Capture, frozen context, host-prepared job/consent shapes and consent component exist. | New narrow module lane pending dispatch. Local page quotation first, no inference for selection/?/dismissal/denial. Explicit permitted Ask, stale/double-submit fencing, provisional/committed delivery and note-version binding. T05 sole mount owner; genuine acceptance depends on T06/runtime. |
| **T09 Simulation** | Typed blocks, kernel, renderer and fixture foundation. | New passage → actual model-authored checked interactive result. Preserve the visible illustration distinction, local slider computation, bounded sample envelope and explicit recompute/Ask-again choices. No fixture masquerading as generation. |
| **T10 WebMCP** | Typed reply and host-control foundations only. | Implement the specified experimental capability path with explicit user controls and truthful unsupported states; do not use it to bypass the required dedicated product runtime or consent. Assign bounded scope before work. |
| **T11 Library / settings** | Service/UI components and operation-ownership fixes; historical 31 focused checks. | T05 mounts real entry/return callbacks. Full export, sanitized diagnostics, model/grant/exclusion/vocabulary integration and calm navigation recovery remain. Single-thread export is not Export everything. |
| **T12 Launch** | Build/evidence structure and launch requirements exist. | Fresh-machine runs, real chosen demo/video, accurate listing, reader/publication decisions and claims matched to evidence. No launch-ready claim from tests, fixture screenshots or queued work. |
| **T13 Consent / policy / retrieval** | Revision/request bindings, current manifest hashes, legacy denial migration, UI/retrieval fixes and shared-DB transaction. | Review active T06 boundary without overlapping writes; then actual host-evidence implementation and real confinement on Windows/Linux/macOS. Synchronize exclusion authority. Keep storage, inference, tool-network and retrieval permissions distinct. |
| **T14 Evidence** | Retrieval and consent groundwork exists. | Dated claim-level support, explicit relation to the claim, exact observed fetched resources and an honest insufficient-evidence state. Real open-session flow must use the narrower permission and refuse unsupported destinations. |
| **T15 Explore** | Thread/parking groundwork exists. | Useful reasoned links and return-to-reading context, parked by default, opened only by reader action. Fixture links do not establish retrieval quality or complete behavior. |
| **T16 Notes / vocabulary** | Basic keep/write/edit and offline retention exist. | Frozen explicit attachments, exact note versions in Ask/replies, '?' offers rather than sends, visible vocabulary origins/deletion and full conflict recovery. T05/T07 retain current data/UI paths; do not duplicate their continuation. |
| **T17 Page header** | Local captured page identity exists. | Honest local identity, reading/return position and page-type-specific behavior first; granted enrichment and assumed terms only under the required policy. No silent automatic cloud enrichment. |
| **T18 Renderer / kernel** | DOM/focus, finite plotting, checked heading/readiness and sample-consumer corrections; historical 13 owner checks including browser scenarios. | Host-level cross-reply highlighting arbitration, authentic sample/generation sidecars and real reader delivery. Preserve local interactivity and current-input host binding; mechanical validation is not scientific truth. |
| **T19 Installation / recovery** | T19 C1–C15 review/disposition; dedicated diagnostics, calm port collision, C6 and C4 backend slices. | Combined C4 UI, live status, T07 C8 backups, diagnostics/global export/library mount/registration, installers and fresh-machine recovery on all three OSes. Retain user data by default and offer export before deliberate deletion. |
| **T20 Saved solver / zero-model recompute** | Unfinished c144506 checkpoint, partial transport/contract corrections, historical 123 chief-run tests. No active Opus. | Reconcile gate interface/call site, actual transaction/claim, immutable generation binding and missing context/authority/evidence/journal adapters. Mount via T05 and prove actual solver execution without a model turn or cloud-grant consumption. No merge from fixture tests alone. |

## Accepted implementation contracts and dependency gates

### 1. T06 actual-send — active, keep its issued scope

Asynchronous preparation is non-consuming and occurs inside the adapter's serialized operation. Bind one opaque, single-use prepared request to exact outgoing bytes, attempt/provider instance/transport generation, workspace/home, model/policy and authority/evidence generation. Synchronously recheck current attempt/CAS, cancel/deadline, principal/permission and manifest, then commit grant use, egress/handoff and initial canonical checkpoint/thread lease on the shared DB. Immediate prepared transport handoff follows without an await or queued continuation. Reject asynchronous finalizers; preserve all already integrated terminal/identity controls.

Acceptance includes native SQLite rollback/race checks, once-grant competition, cancellation/revocation during preparation, changed generations, duplicate prepared receipts and both adapter start/continuation paths. Known pre-send rejection must not consume. Ambiguous post-commit outcomes remain unknown, without refund, implicit retry or fake termination confirmation. Test controlled failure boundaries separately from actual provider/platform behavior.

### 2. Runtime collector/composition — accepted, but WAIT

Do not dispatch a writer until chief records the exact release/narrowing of T06's currently broad provider ownership. The earlier advisory's proposed split was a future contract, not permission to overlap. After handoff, use the existing host-evidence interface and composition; no new runtime framework. Observe the real dedicated executable/home, configuration, policy, platform and generation. Requested settings are not observations; developer MCP/desktop sign-in is not product auth. Missing/stale/wrong-generation evidence stays unavailable, while supported authentic configurations must become usable without a bypass.

Portable implementation covers Windows, Linux and macOS. Real authenticated start/interrupt/continuation/recovery and confinement remain independent evidence gates. Access to machines and user sign-in are external prerequisites; writing the collector and provisioning/install path is engineering work, not a human-only task.

### 3. T08 explicit asking — narrow module lane, T05 mount only

Write only `ui/asking/**`, `tests/asking*.test.ts`, `docs/evidence/T08-asking/**` and receipt T08. The URL remains pending chief dispatch. Use injected helper transport and frozen thread/anchor/note-version data, existing host-prepared `PreparedJobResult`, the existing consent sheet and renderer. Do not change T05 mounts, helper/persistence, T07 store/journal, provider contracts, manifests or dependencies.

Prove that local page definitions, selection, '?', dismissal and denial do not send. Obtain the exact host preview/plan before the explicit permitted action; do not turn the local `outgoingPreview()` into an authority. A denied grant must not dispatch. Fence replaced preview/source/note, revoked pairing, closed mounts and duplicate actions. Working/provisional output must not be presented as committed or checked. Cancel/unknown/retry remain explicit and truthful. T05 mounts the agreed callbacks after reconciliation; an unmounted module is not acceptance. Real source → Ask → reply → local interaction → reload requires finished T06/runtime, plus an unseen-page example.

## Evidence accounting

| Evidence | Current statement | Limits |
|---|---|---|
| Earlier integrated suite at `0111589` | Outgoing chief recorded 282 total: 281 pass, 0 fail, 1 optional browser skip, 0 cancelled on Windows Node 24.14.1; associated typecheck/build and isolated Chromium local-reader receipts exist. | Historical, not re-executed for this document or automatically a test of `1517433`/new checkpoints. No full provider/confinement/all-platform acceptance. |
| Helper `e2fb6c2b61cce004c2c2964f9db146f73fac32fc` | Latest user report says `.local/t05-luna-verification/REPORT.md` records 8/8 and 18/18 focused groups, typecheck and webapp/extension builds; Chromium 147 visible Show/Renew → Pair → safe List → Forget → 401, local note retained, expiry, 360 px and no browser errors. | Reported exact-checkpoint verification, not combined T05 acceptance. Original runtime model metadata was not independently exposed. Counts are not summed as unique tests. This author did not run or independently re-obtain that local report. |
| T07 `c9c2b2764e574ee670337ee3010e64930f9aaa5e` | Published commit/parent independently remote-verified in latest user receipt; native Luna Max exact-commit verification reported running separately. | No pass, report outcome or reconciled-branch acceptance yet. Native run must not be relabelled dynamic MCP. |
| T20 c144506 | Historical chief-run 123/123 after stopping the writer; older 88/116 counts belong to earlier revisions. | WIP gate/call-site migration, missing host dependencies and unmounted route remain. No genuine execution/isolation acceptance. |
| Accepted current advisory | Source observations and specific old-findings corrections at `1517433`; T20 source inspected separately at c144506. | Read-only; no advisory tests or mitigation implementation. This handoff adds documentation only. |

## Source fidelity, full scope and acceptance taxonomy

Current direct user decisions govern, then `wayfinder/SPEC-FINAL.md`, derived `SPEC.md`/R1–R30 and all 71 `FEATURE-INVENTORY.md` entries, then build-stage sequencing. Whitepaper and original design sources supply rationale and traceability, not silent overrides. The inventory's letters express priority, never deletion.

Preserve source unchanged, notes senior, frozen explicit anchors, durable work, assistance beyond summary, calm reading and real inspectable interactive outputs. Editor at reading position and one complete rail map are closed decisions. Keep automatic/implicit sending disabled except any separately explicit opt-in feature under its governing grant; selection or '?' never supplies that opt-in. Unsupported capabilities remain honestly unavailable rather than reduced substitutes presented as equivalent.

All four computation paths remain required: packaged local kernel; recorded samples inside their envelope without extrapolation; saved solver with zero model turns; explicit cloud Ask again for interpretation/model revision. Deterministic authenticated loopback checking is not cloud inference. Local recompute/cache use never spends a cloud-inference grant.

The full inventory also retains suggestion/exposure logging, personalization/vocabulary, reflected/connected/derived help, media capability gates, PDF/math/arXiv, library/queue/journeys/journal, search/cited answers/export/import/sync, alternative providers, skills, sharing, privacy/terms, research/business and cohort work. Listing these does not assert they are implemented or all have active writers; chief must issue disjoint scopes as dependencies permit.

Acceptance records stay separate:

- **Code correction/integration:** exact diff, parent, ownership, source requirements and meaningful regressions. A current test pass does not prove the full feature.
- **Runtime/platform evidence:** actual provider, browser, cancellation/restart, storage/recovery and confinement observations tied to the exact revision and named OS. Windows evidence does not stand in for Linux/macOS.
- **Human/external gates:** user-controlled sign-in, access to remaining test machines, reader evaluation and publication choices. Installers, safe migrations, diagnostics/export and recording preparation remain engineering work.

The largest drift risk is another round of isolated component polish without a working reader loop. Preserve existing fixes, finish the active boundaries, and require actual mounted user value. Never propose merging an unverified checkpoint or declare all tickets done from test counts.

## Historical assessment retained

The complete previous ticket assessment is preserved [at `1517433`](https://github.com/yashgurbani/marginalia/blob/1517433968d03cdde054a70376ca26c2d9221315/marginalia-v2-package/docs/PROJECT-STATUS-AND-TICKET-REVIEW.md). Its descriptions of an unpublished T07 continuation, no active T06 worker and absent helper-UI verification were accurate to that earlier handoff but are superseded by the current facts above. Old Sol/Opus/Astra implementation directions and T05-only restrictions are not active instructions. Historical numerical evidence and C1–C15 dispositions remain linked in BUILD-STATUS and the evidence files; this update neither erases them nor upgrades their acceptance scope.
