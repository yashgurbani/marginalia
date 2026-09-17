# Every build ticket at Fable takeover

18 September 2026; consolidated production checkpoint `6fb78e0`. All paths below are relative to `marginalia-v2-package`. Original requirements live in `wayfinder/SPEC-FINAL.md`, `BUILD-PLAN-24H.md` and `FEATURE-INVENTORY.md`. These are build tickets T00–T20, not the differently numbered design-decision tickets. No ticket is declared fully release-accepted here. Historical “testing deferred” receipt text is superseded by later authorized checks; do not silently replace it with a full-runtime pass.

## T00 — science fixture

**Exists:** corrected growth model and analytical/numerical foundations in `kernel/`, fixtures and contract checks. The equation is y′ = y² − γy + f; damping is not viscosity, and the demo is an illustration rather than evidence about the Navier–Stokes proof. **Evidence:** numerical tests and source review, included in full suite. **Left:** verify actual rendered fixture through the reader, causal/illustration wording and a genuinely unseen generation example together with T09. No standalone T00 receipt was present at takeover. Fable should add requirement/evidence accounting rather than invent a completion history.

## T01 — helper, pairing, diagnostics

**Exists:** `daemon/{main,server,pairing,diagnostics,helper-management}.ts`; loopback host checks, token hashing/origin binding, revocation and durable event replay; dedicated-home diagnostics and helper management improvements. T05 mounts trusted management controls. **Evidence:** `wayfinder/build-receipts/T01.md`, server/pairing/diagnostics tests and historical native/browser observations. **Left:** fresh installed registration/origin checks, truthful reading/saving/asking status, health disclosure policy, diagnostics/export UX, Mac/Linux paths. Reconcile C1–C5/C9/C12/C13 from T19 against current source; its original line references are historical. T01 owns helper boundary; coordinate server/main edits with T06.

## T02 — provider adapters

**Exists:** app-server primary, MCP second, stdio/protocol/preparation/send policy seams in `daemon/providers/` and `contracts/job-runner.ts`; final T06 source supplies serialization and synchronous finalization. **Evidence:** T02 receipt/advice and final T06 provider tests. **Left:** authentic dedicated-home start/interrupt/follow-up/restart tests for both adapters, actual pinned executable behavior and supported-platform checks. A synthetic protocol peer is not an authenticated Codex run. Keep unknown outcomes terminal/no automatic replay. Historical adapter packets are not a competing branch to reinstall.

## T03 — typed replies and sample provenance

**Exists:** `contracts/reply.ts`, JSON Schema, host checks and `sample-provenance.ts`; exhaustive axis/fixed-input binding, immutable hashes and trusted sidecars. Candidate replies cannot author host authority. **Evidence:** `T03-samples.md`, `docs/CONTRACT.md`, contract/sample tests. **Left:** actual host generation/check/reseal pipeline, persisted sample-generation linkage and renderer integration evidence, including T20 artifacts. Preserve legacy readability while preventing unbound interpolation. No standalone T03 main receipt exists; the samples receipt is only one slice.

## T04 — extension and source capture

**Exists:** `extension/**`; WXT MV3, capture/anchors/sections, panel/floating surfaces, private extension-origin notes, authenticated replay, exclusions and reconnect controls. Capture correction and Luna regressions integrated. **Evidence:** T04 receipt, `docs/evidence/T04*`, capture/protocol/native tests and earlier bounded Chromium checks. **Left:** native panel and floating-to-trusted-surface user journey, installed-origin and hostile-page isolation, worker termination/restart, Firefox and OS coverage, zoom/a11y; actual provider reply path. Selection must not send. Preserve the current test fixture correction rather than old Luna source. T04 owns extension transport; T05 owns shared UI.

## T05 — margin and complete reader UI

**Exists:** final recovery reconciled and merged `96eef734`; `ui/margin*`, note editor/model, helper/persistence/library entry, `webapp/main.ts` and service worker. Reading-position editor, one map, senior notes, frozen attachments, Keep/Park/Remove/Undo, saved original-source replies, durable question/draft recovery, library/asking mounts and helper management. **Evidence:** `docs/evidence/pro-t05-fixes/FULL-RECOVERY-REPORT.md`, `INDEPENDENT-REVIEW.md`; final corrections `41207c4`, independent closure `51655d8`, combined tests and Pro's labelled offline DOM checks. **Left:** full native browser/provider journey, persistent cross-surface recovery and provenance, accessible focus/large text/screen-reader behavior, multi-anchor/saved-anchor changes and T20 mount. Original recovery report names unavailable native jobs/export transport and legacy missing-source limitations: resolve them against current combined code, do not erase them. Do not revive the rejected rule hiding historical replies when current selection changes.

## T06 — durable jobs, send boundary and runtime

**Exists:** recovered final Pro artifact `d1deedf`, native integration `e838488`, merged `6fb78e0` with independent review waived. `daemon/jobs/**`, provider seams, consent host evidence and main/server composition. Frozen packet and serialized wire; synchronous final current-consent/attempt/CAS checks; transaction-bound grant/egress/handoff/checkpoint; truthful external-write ambiguity; attempt identity, restart packet integrity, retention/settlement fences and bounded instruction preview. **Evidence:** `docs/evidence/pro-t06-send/` reports; standalone 606 pass/two skip, focused 110 pass/one skip, combined 669 pass/two skip and builds. **Left first:** consultant-reported FIFO replacement/shutdown block; no delivered fix or independent verdict. Then real provider/confinement evidence, end-to-end durable reply/cancel/restart, actual samples/solver binding and platform link/reparse behavior. Progress report about a fix is not a patch. Fable owns this next bounded repair; old Pro review is ignored by user direction.

## T07 — store, threads, journal and recovery

**Exists:** `daemon/store.ts`, reader contracts and `ui/journal.ts`; original-source anchoring, durable notes before replies, tombstones/history, conflict choice including kept absence, outbox, SQLite-consistent pre-upgrade backup and newer-schema refusal. Merge `dc0f963`, source `2464ce6`. **Evidence:** receipt and `docs/evidence/pro-t07-fixes/NATIVE-VERIFICATION.md`, 42 native checks; later persistence regressions/full suite. **Left:** real browser/tab disagreement and recovery, power-loss/failure/platform evidence, global export and explicit installer upgrade path. Known migration IDs `{1,2,3,4,13,7001}` require coordination; no second store. T05 must consume exact reconciliation semantics.

## T08 — definition and explicit Ask

**Exists:** `ui/asking/**`, `ui/asking-host.ts`, `skills/define/**`; page definition first without sending; exact consent and sealed preparation, note/source version binding, provisional/final states and explicit follow-up/cancel. Final source `a9a6a08`, correction `efb3031`, merge `8a08853`. **Evidence:** T08 receipt, asking tests (56 at integration), T06 instruction hash tests. **Left:** unseen-term real response, observed zero-send page-defined case, revoked/excluded/changed-context paths, native trusted-surface handoff and persisted history through T05/T06. Keep displayed preparation separate from dispatch authority.

## T09 — simulation

**Exists:** shared renderer/kernel/model and fixture infrastructure; this is not evidence of a finished generation skill. **Evidence:** relevant numerical/model/renderer tests and specification. No standalone T09 receipt present. **Left:** audit/add complete simulate skill and host pipeline; generate correct demo and unseen passage, real validation and optional sample grid; prove sliders cost no inference and out-of-envelope choices are distinct. T20 handles saved rerun, not a substituted model call. Fable should own the missing requirement map before assigning implementation.

## T10 — WebMCP adapter

**Exists:** historical assisted prototype and typed-reply contract foundation; current v2 live adapter acceptance not established. No standalone receipt. **Left:** capability detection, validated `insert_reply`, non-fixture insertion and honest unsupported state. Keep source unchanged and do not bypass dedicated runtime/consent. Read historical root/prototype sources through the inventory before reusing them; do not treat old demo functionality as v2 integration.

## T11 — library and settings

**Exists:** `daemon/library.ts`, `contracts/library.ts`, `ui/library/**`, `webapp/library/**`; thread browse/state/restore/open, explicit per-thread JSON export, model choices, vocabulary delete, grants/exclusions; T05 library entry and helper mount. **Evidence:** receipt and T11 review/correction reports, Luna library regressions, full suite. **Left:** installed user journey, actual provider model-choice enforcement, whole-library export (single-thread export is insufficient), diagnostics allowlist, saved-source reopening and settings revocation observed end to end. Share T07 export/service work and T05 UI mount; no duplicate library/store.

## T12 — launch and honest release

**Exists:** staged release requirements, package/build tooling and evidence structure. No standalone receipt. **Left:** fresh-machine recorded run; real demo plus unseen passage; failure/cancel/recovery; release packaging, video, listing/README and platform capability table. No launch acceptance exists. Product Hunt/Astra challenge priority shapes delivery order, not feature deletion or false claims. Root README has user edits: never overwrite wholesale.

## T13 — consent, session policy and retrieval

**Exists:** `daemon/consent/**`, `daemon/retrieval/broker.ts`, `daemon/codex-policy.ts`, UI consent/settings and contracts; exact outgoing preview, durable grant/denial/exclusion, same-database transaction, bounded observed retrieval and current-send authorization. T06 final runtime evidence adapter is now integrated. **Evidence:** T13/T13-pro receipts, consolidated review material, policy/consent tests. **Left:** real closed-session network refusal, open-session observed egress completeness, authentic filesystem/network confinement, private-address refusal across actual redirects/DNS, grants bound to actual execution. Passive launch facts are intentionally not proof. Do not fix unavailable readiness by accepting fabricated evidence or borrowing desktop credentials.

## T14 — Evidence

**Exists:** `daemon/transforms/evidence/**`, `skills/evidence/**`; corrected reconciliation distinguishes fetched from support and retains dates/source attribution. Original `9443074` and Sol `053a203` reconciled as `4616150`; source parity verified. **Evidence:** T14 receipt, Opus report, independent/reconciled review and Sol report/tests. **Left:** real host observations and claim-level support/abstention in the reader, complete/incomplete retrieval record, specified captured-version demo. Do not resurrect pre-fix “supported” for unverified text. Original review hold is historical; runtime acceptance remains open.

## T15 — Explore

**Exists:** `daemon/transforms/explore/**`, `skills/explore/**`; shelf assessment, explicit open request, original return context and saved reopening correction `184c12a` after `bead552`. **Evidence:** T15 receipt, Opus/Luna/Sol reports and transform tests; owned source matches integrated branch. **Left:** actual useful three-to-five-item shelf, parked by default, mounted explicit opening with permissions/provenance, legitimate links on real pages. No automatic fetching or new identity registry that makes saved shelves unusable. Thin honest shelves may remain useful; do not forbid them through invented completeness rules.

## T16 — notes and vocabulary

**Exists:** functionality distributed through T05/T07/T11: note editor, frozen attachment, journal recovery, note-first presentation, vocabulary origin/delete services. No standalone receipt. **Left:** verify full requirement journey: Change passage/section/page attachment without losing draft, Enter/save shortcut, reload/failure recovery, exact answered-note version, question mark offering but not sending, note-derived vocabulary source/deletion. Audit gaps before writing another note system. Owner boundaries are UI T05, persistence T07, library vocabulary T11.

## T17 — page header

**Exists:** local captured page identity/sections and margin header foundation. No standalone receipt. **Left:** full identity/assumptions/reading-position design, under-two-second no-send path, explicit-grant enrichment/Semantic Scholar caching by content identity, excluded-site behavior, truthful docs/news assumptions. No automatic cloud summarization. Respect pass-2 design and actual source constraints.

## T18 — renderer and local kernel

**Exists:** `renderer/**`, `kernel/**`; typed block vocabulary, model/ODE/maps, plot/diagram/math, local parameter changes, checked-result authority and sample provenance consumers. Earlier corrections and Luna renderer regressions integrated. **Evidence:** T18 receipt/review/sample reports, renderer/kernel tests and historical bounded browser checks. **Left:** genuine host-produced result/sample record delivery, current-input headline validation, source-linked interaction, robust focus/zoom/a11y and all specified blocks on real reader pages; PDF math/anchors require actual viewer integration. No generated HTML/JS execution or unchecked scientific headline. Module coverage does not establish all-transform quality.

## T19 — installation and recovery experience

**Exists:** Opus/Fable spec `docs/INSTALL-RECOVERY-EXPERIENCE.md`, `docs/evidence/T19-fable-review.md`, receipt; 13 reader states and C1–C15 handoff. Several backend/UI fixes subsequently landed through T01/T04/T05/T07. **Left:** reconcile each C item on current source, actual per-OS installers/startup/uninstall/upgrade, fresh machine test and export-before-data-removal UX. Keep reading, local saving and asking separately visible. C3 diagnostics must use product home, C8 migration safety needs recovery validation, C12 extension registration must be exact. C9 diagnostics/global C10 export and C14 installers are not completed by a mockup. Cross-platform is intended; tested status must be truthful. Preserve saved data by default; unresolved details stay documented rather than silently chosen.

## T20 — saved solver execution

**Exists:** `daemon/solver/**`, solver contracts/tests and adapter module; Opus 5/4.8/5 delivery, Sol producing-attempt/claim-release fixes `a8a3a34`, independent closure `d2a67b5`, merge `4466e32`. **Evidence:** `docs/evidence/T20/`, receipt, 156 solver checks at one checkpoint plus combined suite; source acceptance only. **Left:** actual mount and concrete generation/artifact binding and host gate dependencies, confinement/resources/cache/cancel/provenance verified through reader. The accepted adapters require exact successful job/latest producing attempt and explicit synchronous release confirmation; undefined/throw/thenable leads to unknown, no dispatch. Do not make a new model turn, spend cloud grant or auto-retry to simulate path 3. Coordinate T06 host and T05 UI in one bounded integration ticket.

## Remaining work across tickets

The next owner is Fable for steering; original worker names are historical provenance, not active exclusive leases. Prioritize T06 FIFO repair and the connected real reader journey, then saved recompute and installation. Maintain all stage-5 and later inventory requirements including PDF, WebMCP, library search/journeys, other providers/skills and voice/image routing as specified. Their absence from a standalone receipt is an open tracking gap, never authorization to drop them. Only call a ticket complete when its actual stage/acceptance examples and failure paths are evidenced.
