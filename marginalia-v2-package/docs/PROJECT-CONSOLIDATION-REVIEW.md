# Marginalia — whole-project review and integration direction

## Current consolidation update — 18 September 2026

This update supersedes the historical branch ownership and merge-state rows below. Integration is `codex/marginalia-v2` through `a13a955` (documentation checkpoint); accepted T05 source merged at `96eef734`, T08 at `8a08853`, and T20 corrected source at `4466e32`. The corrected Evidence/Explore implementation and four Luna regression slices are also accepted in this integration history. Earlier “active Pro,” “active Opus,” and “review hold” labels in the dated assessment below describe the 17 September checkpoint, not live assignments.

| Ticket / workstream | Current source disposition | Remaining acceptance |
|---|---|---|
| T05 reader integration | Final Pro recovery reconciled with concurrent UI work and independently accepted. Saved question keys and retry/error display corrected; original-source historical replies retained. | Full live reader/provider journey, accessibility and platform evidence remain open. |
| T06 send/runtime | Final artifact recovered and applied; reconciled candidate `2e77f3a` includes accepted T05/T08/T20 composition. Not merged into the integration branch yet. | Fresh independent Pro review is running at the URL in FABLE-STEERING-HANDOFF.md. It owns concrete T06 corrections on a separate branch. Both exhausted MCP review attempts produced no verdict. Real runtime/confinement acceptance is still distinct. |
| T08 explicit Ask | Reviewed source and two UI corrections merged. The reviewed plan remains visible while working; connection labels reflect the actual method. | End-to-end execution depends on T06 review/composition and live evidence. |
| T14/T15 Evidence/Explore | Original hold resolved through bounded corrections and saved-reopen fix `184c12a`. Fetched evidence does not imply support; saved shelves preserve source context and explicit navigation. | Genuine retrieval/generation and reader-facing acceptance remain open; accepted modules are not complete product proof. |
| T20 saved solver | Opus delivery corrected by Sol and independently accepted at `d2a67b5`; merge `4466e32`. Exact producing attempt and explicit claim release are required. | Real runtime mount, confinement and observed recompute still required. No model turn or cloud grant may be consumed for local arithmetic. |
| Four Luna regression slices / two Sol corrections | Integrated corrections and regression coverage are preserved; their old worktrees are not evidence of active work. | Do not restart or merge superseded copies merely because ancestry lists an unmerged branch. Verify patch equivalence and receipts first. |

Combined candidate checks: **669 passed, 2 skipped, 0 failed**, full typecheck, app build, extension build and extension typecheck passed. These checks do not establish authenticated provider execution, confinement, accessibility or macOS/Linux runtime acceptance. All 21 tickets and 71 feature inventory entries retain their original scope; no launch-readiness claim is made.

Next sequence: recover the current Pro T06 verdict/corrections, verify and integrate accepted changes, update receipts and push; then submit the prepared comprehensive Pro review against the exact consolidated SHA. The comprehensive reviewer must implement justified improvements and assess all original requirements, not only recent changes. Existing worktrees and user edits remain preserved.

## Historical assessment — 17 September 2026

17 September 2026. Chief review requested by Yash after restoring shared Pro chats and adding Opus4.8Medium. This assesses source documents, existing implementation receipts, published branch heads and observed worker state. It is not a new full application test.

## Where the project stands

Marginalia has substantial reader, persistence, renderer, provider and policy foundations. It does **not yet have an accepted end-to-end reader journey through a real, correctly confined provider and saved-solver execution**. The critical remaining work is connecting and verifying those pieces. The project is not launch-ready, and a percentage would hide the difference between code volume and working reader outcomes.

The source destination remains a margin beside whatever the reader is reading: select a passage or write a note, get useful contextual help in the form that fits, interact locally where possible, and return to the durable thread. Source text stays untouched. The reader's notes remain primary. The extension margin is the working surface; the webapp is its library/settings companion, not a replacement dashboard.

All21 build tickets and71 inventory entries remain required. The stage plan orders delivery and limits honest release claims; it does not authorize dropping transforms, adapters, platforms or later inventory. A closed Wayfinder decision is not an implemented capability. No new product direction is being substituted.

## What is actually consolidated

| State | Concrete evidence | Limit |
|---|---|---|
| Integrated product checkpoint | T07 merge `dc0f963684fa616599cbe67ff183eebe6058ba7d`, source `2464ce63862d70f6ec702f759f2bdd88e054839c`; integration branch currently also includes documentation checkpoint `b4ad04d` | New T05/T06/T08 and T14/T15/T20 work is not integrated merely because its branch exists. |
| Independently checked T07 slice |42 reader/store/journal tests on identical runtime/assertions; final type-only correction passed project typecheck; Windows Node24.14.1 and better-sqlite3 13.0.3 | Not full T07/browser/Mac/Linux/power-loss acceptance. |
| Historical integrated checks | At0111589:281passes,1optional browser skip; selected Chromium local reader/recovery/management flows and builds in linked receipts | Not a fresh current-head test; no genuine model/solver isolation acceptance. |
| Preserved helper UI | `codex/t05-helper-management` e2fb6c2; focused tests/builds and isolated Chromium management journey in its report | T05 must reconcile it with its larger UI change; do not merge conflicting old UI copies independently. |
| Published new Evidence/Explore modules | `codex/opus-t14-t15-evidence-explore`86d6581; worker reports24focused/315whole-suite passes+1skip and typecheck | **Merge held.** Independent review found authority/navigation concerns. Source not wired into real reader path. |
| Preserved saved solver now under completion | Oldc144506 transferred onto current integration asddbe72d, scoped brief ea4ab42, new `codex/opus-t20-completion` | Existing code is unaccepted; a type/call-site handoff mismatch and absent host/mount/runtime acceptance remain. |

Exact active chat URLs, scopes, local recovery paths and worker IDs are in [the steering handoff](FABLE-STEERING-HANDOFF.md). Native T07 evidence is [here](evidence/pro-t07-fixes/NATIVE-VERIFICATION.md); historical integrated checks are [here](evidence/INTEGRATED-VERIFICATION.md). No worker-reported result is silently promoted to chief-observed acceptance.

## Direction changes required now

1. **Integrate the reader journey before expanding isolated modules.** T06 owns the real send/runtime path, T05 owns all reader mounting, and T08 supplies asking behavior. Their next accepted checkpoint must demonstrate how the same frozen passage/note and host-prepared permission flow produce a truthful saved reply. If a branch stops at callbacks or disabled actions, its receipt must name the owner and exact remaining connection.
2. **Finish saved recomputation as a distinct user action.** Opus T20 continues the existing code rather than starting a replacement framework. Its result must execute the saved solver with no model turn/cloud-grant consumption, use truthful local authorization and preserve source/generation/result binding. T06 supplies runtime composition and T05 mounts it after compatible contracts are published.
3. **Correct Evidence's claim of authority before integration.** Observed retrieval is a useful fact, but a matching fetched URL does not establish that its content supports the reader's claim. The current `supported` verdict/headline with `textVerified:false` is not an acceptable product promise. Fix the smallest output contract and its consumers; do not invent a new verification platform. Explore must preserve honest provenance and legitimate explicit link navigation. [Review disposition](evidence/T14-T15-CHIEF-RECONCILIATION.md).
4. **Make each completion claim traceable to a requirement and observable result.** Use existing ticket receipts, fixed-SHA diffs, focused behavior checks and entry-point evidence. New modules, line counts, branch creation, consultant confidence and passing fixtures are not product progress by themselves. Keep tests proportional to changed behavior.
5. **Consolidate coordination rather than adding process.** GitHub branches and receipts are the shared record. One owner per path, one chief-controlled integration branch. Preserve existing store, contracts, renderer and broker. No new parallel authority, general workflow engine, speculative abstraction, dependency or blanket rewrite without a current demonstrated need.

This is Ask Matt's implementation/review phase: existing spec and tickets -> required behavior -> focused tests -> Standards and Spec review -> commit/integrate. The map and product thesis do not need another discovery loop. Ponytail's simplicity check must preserve full functionality, error handling, accessibility and truthful boundaries.

## Ticket-by-ticket assessment

| Ticket | What exists | Status / direction / next acceptance |
|---|---|---|
| **T00 Science fixture** | Corrected model/analytical fixture and numerical foundations | Retain illustration limits and regression cases. Verify the actual rendered fixture through the reader, then use a genuinely unseen passage for generation acceptance. No new architecture. |
| **T01 Helper / pairing / diagnostics** | Stable paired-browser IDs, revocation, trusted management routes, dedicated-home diagnostics and port-error fixes | Integrate trusted helper controls through T05; close usable extension registration and installed-helper diagnostics. Distinguish reachable helper, local save and provider readiness. |
| **T02 Provider adapters** | App-server and MCP adapter/lifecycle corrections, historical focused checks | T06 currently owns compatible provider changes; no competing writer. Real dedicated authentication/start/cancel/continuation/restart on both adapters is still required. Do not borrow developer credentials. |
| **T03 Typed replies / host checks** | Strict reply data contract, validation/numerical/URL fixes, historical renderer checks | Maintain the distinction between model-authored output and host-checked facts. Verify real host check/reseal/delivery and T20 result compatibility. Do not allow Evidence metadata to bypass checked-headline rules. |
| **T04 Extension / capture** | Selection/source capture, private host, authenticated reads, local Chromium flows | Verify reconnect/exclusion/native panel and actual provider reply path. Firefox and OS coverage remain. Keep source untouched and selection free of transmission. |
| **T05 Margin / UI integration** | Basic notes/replies/offline Disconnect integrated; old17-file fix package and helperUI available | **Active Pro**, `codex/pro-t05-full-recovery`. Reconcile current T07 keep-device contract, reading-position composer/one map, focus/draft/recovery, helper management, library and T08 mount. Accept visible behavior, not only module tests. |
| **T06 Jobs / runtime** | Immutable context/CAS/shared-DB host handoff and prior lifecycle fixes | **Active Pro**, `codex/pro-t06-full-recovery`. Close post-authorization async gap and real evidence-backed runtime composition; preserve prepared-request single-use, honest unknown outcomes and both adapter semantics. Now owns collector/composition—old WAIT status is obsolete. |
| **T07 Store / threads / journal** | Device choice/absence persistence, conflict/history handling, SQLite backups/newer-schema refusal integrated and native-verified | Do not redo accepted slice. Next gate is actual browser conflict/recovery plus platform-specific migration/restart evidence. Coordinate any new migration ID with known history set. |
| **T08 Definition / explicit Ask** | Existing frozen context, consent/prepared API foundations; interrupted generated module recovered as history | **Active Pro**, `codex/pro-t08-full-recovery`. Page words first, explicit exact-payload approval, separate web permission, note-version/source binding, stale/double-send/cancel/unknown behavior. T05 owns mount and T06 runtime; unmounted module is partial. |
| **T09 Simulation** | Typed model/plot/kernel/fixture foundation | Next significant transform after real Ask path: actual model-authored checked demo plus unseen passage; sliders remain local, samples stay inside declared envelope. T20 handles recompute outside it. |
| **T10 WebMCP** | Typed reply/host-control foundation | Required experimental adapter still open. Capability-check and validated insertion/unsupported state; do not use as a shortcut around the dedicated runtime or explicit consent. Assign after current integration load falls. |
| **T11 Library / settings** | Services/components/operation-ownership fixes and historical checks | T05 mounts the existing surface. Finish real model/grant/exclusion/vocabulary/export/diagnostics flows. Single-thread export is not Export everything. Keep data in one store. |
| **T12 Launch** | Requirements and build/evidence structure | Not ready. Fresh-machine installation, real demo/unseen passage/failure/cancel, video and listing must match observed capabilities. Full inventory remains scope even if public claims wait for gates. |
| **T13 Consent / policy / retrieval** | Explicit policy/request bindings, broker, exclusion/grant work and shared-DB transactions | T06 owns current compatible host-evidence work. Verify actual confinement/egress, current permission and narrower web grants. Closed/open behavior and log completeness require observation, not labels. |
| **T14 Evidence** | New reconciliation transform/skill/tests published86d6581 | **Review hold**, not merged. Correct semantic authority and request/final-resource attribution; then wire job/renderer with actual observations. Claim-level dates/support/abstention and real stage5a acceptance remain. |
| **T15 Explore** | New parked shelf/open transform/skill/tests published86d6581 | **Review hold**, not merged. Correct public seam/provenance/navigation policy, preserving valid section links. Real useful3–5items, parked by default and only explicitly opened, remain the outcome. |
| **T16 Notes / vocabulary** | Basic write/keep/edit/offline retention | Continue through T05/T07 ownership, not another note system. Verify frozen attachment, exact answered-note version, question-mark offer without send, history/restoration and vocabulary origins/deletion. |
| **T17 Page header** | Captured page identity | Local identity/reading position first; honest assumptions and page-specific docs/news behavior. Enrichment only under explicit grant. Preserve source design; no automatic cloud summarization. |
| **T18 Renderer / local kernel** | Interactive packaged blocks, finite/checked output and sample-consumer fixes, historical browser evidence | Connect genuine host-generated sample/solver output and cross-reply highlights; keep focus and current-input host binding. Numerical validation is not a claim about the source's scientific proof. |
| **T19 Install / recovery** | Experience spec, C1–C15 findings/dispositions and several integrated backend fixes | C4 UI through T05; C8 bounded backup code through T07; live status/global export/registration/installers/docs remain. Cross-platform implementation with Windows/Linux tests first and Mac when available; preserve reader data by default. |
| **T20 Saved solver** | Preserved7,600-line WIP package and historical123tests, transferred without rewriting | **Active Opus4.8Medium**, `codex/opus-t20-completion`. Finish synchronous local execution claim/handoff, concrete existing-API adapters, truthful cancellation/provenance/cache and public mount contract. No model turn, cloud grant or false confinement. |

All rows retain an implementation or acceptance gate. This is a whole-project review, not21 independent completion declarations.

## Consolidation and acceptance sequence

1. Let the three current Pro runs finish substantial milestones; the requested next check is scheduled approximately30minutes after the user's instruction. Do not interrupt them with repetitive status prompts or duplicate work. GitHub writes within assigned branches are authorized; unrelated connectors are not.
2. Fetch and diff each returned SHA against its declared base. Reject accidental shared-file edits, stale-base replacements and unreported ownership changes. Preserve existing e2fb6c2/helperUI and c144506/solver corrections during reconciliation.
3. Native independent Luna Max checks on isolated exact-SHA worktrees; dynamic MCP accounts. Keep original reports when a tool times out; recover the session or existing evidence before starting a replacement. T14/T15's first verifier lost its session before final report; a narrowly bounded report-recovery review is now complete, verdict HOLD—CHANGES NEEDED. No second full test pass was claimed. Chief's disposition rejects overengineering and any new rule preventing a reader from opening an honestly labelled thin shelf.
4. Integrate backend and asking/UI in compatible order, with actual user-entry checks after composition. Verify no-send paths before positive sending; current permission and exact payload; cancellation/unknown; committed reply bound to original passage/note; reload/restart retention. Correct failure through the existing owner.
5. Integrate saved-solver execution with those accepted host/UI contracts, then real simulation and remaining renderer/library/install acceptance. Correct and integrate Evidence/Explore after its hold is resolved; do not wire an unreviewed authority claim because it passes fixtures.
6. Update ticket receipts and the current handoff after each accepted merge. The [steering handoff](FABLE-STEERING-HANDOFF.md) owns live assignments, this review owns the all-ticket assessment, and [BUILD-STATUS](../BUILD-STATUS.md) owns the integrated checkpoint/history. Keep older evidence revision-labelled.

## What must not drift

- Product: a calm reading margin with durable threads, not a dashboard, chat replacement or generic agent platform.
- UX: original page intact; reader notes first; writing at reading position; one informative map; explicit attachment changes; human language instead of implementation jargon.
- Cost and agency: no implicit inference, no automatic unknown retry, no model turn for local interaction or saved-solver recompute. Memory tunes how to help, never whether the reader is allowed to ask.
- Truth: fetched is not supported; paired is not signed in/ready; code exists is not mounted; tests pass is not live acceptance; a declared policy is not measured confinement.
- Engineering: reuse the current store/contracts/broker/renderer; complete user behavior before speculative abstractions. Improvements can be minor and autonomous; consequential deviations must be surfaced before adoption.

No new unresolved product choice is needed to continue the current assignments. The key open questions are executable contract/integration evidence, not an invitation to re-plan the product.
