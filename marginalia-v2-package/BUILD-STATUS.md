# Marginalia overall build report

Updated 17 September 2026 after integration of 1c5a1f0. Chief task: 01a0adaf-dd71-7583-8307-b877547c9189.

## Current position

The helper, corrected durable storage/journal, both Codex provider adapters, basic reader margin, extension capture/hosts, corrected samples contract and typed reply renderer/kernel are integrated and published through 1c5a1f0. Chief source review resolved the margin/extension anchor mismatch and two sample-binding defects. A bounded Sol Medium review found no actionable P0/P1 in the frozen renderer scope. T05 now owns real saved-reply mounting, T18 the new sample-readiness consumer, T06 durable jobs/authenticated APIs, and T13 consent/provider sessions. No end-to-end live inference or release gate is complete.

**User direction: leave all testing for later.** New test writing, test execution and browser QA are deferred across tasks. Historical evidence below is retained only for the versions it covered. Subsequent implementation is unverified. Source review, Pro advisory, implementation and coordination continue; deferral does not turn an open gate into a pass.

## Source and vision

[wayfinder/SPEC-FINAL.md](wayfinder/SPEC-FINAL.md) governs. [SPEC.md](wayfinder/SPEC.md) supplies R1–R30, [FEATURE-INVENTORY.md](wayfinder/FEATURE-INVENTORY.md) retains all 71 inventory entries, and [BUILD-PLAN-24H.md](wayfinder/BUILD-PLAN-24H.md) orders implementation and release gates. The whitepaper explains the purpose. [Scope coverage](docs/SCOPE-COVERAGE.md) maps the requirements and gaps. Root PRODUCT.md and historical decision notes cannot override the final spec or current user instructions.

Marginalia is a margin beside whatever you are reading. Source stays unchanged; notes are senior; inference needs explicit consent; the reader owns the work. Selection offers Keep and Ask without sending. Preserve all four computation paths: local kernel, samples within their envelope, saved solver without a model turn, explicit Ask again. Mechanical checks are not scientific truth. Preserve separate storage, inference, tool-network and retrieval boundaries. No silent scope cuts for the Astra challenge.

Design source: D:\UserData\reader\Downloads\marginalia-v1-package\design. T05 combines this system with Pro advice and Impeccable/taste guidance. Material changes to vision or scope are escalated; minor improvements proceed within these rules.

## Ticket board

Integrated means code is committed; it does not mean the full user-facing acceptance gate has passed. Queued means still required, not dropped.

| Ticket | Capability | Implementation position | Remaining acceptance or dependency |
|---|---|---|---|
| T00 | Correct numerical fixture | Integrated foundation | Final rendered fixture and live flow |
| T01 | Local helper and pairing | Integrated 302fe52 + Pro corrections e61389e | Extension lifecycle and runtime isolation remain open; final fixes untested |
| T02 | Codex app-server + MCP adapters | Integrated 889fb27 | Real authenticated inference, T06 integration, recovery and independent runtime evidence |
| T03 | Reply contract and host checks | Foundation plus samples binding integrated fc9a258 | Renderer readiness consumer and actual host record persistence/delivery remain |
| T04 | Extension capture and private margin host | Integrated 078d265, including chief source corrections | Final worker recovery, hostile-page, native panel and live Ask gates deferred |
| T05 | Margin and design | Basic margin integrated aee5750; saved-reply integration active, Astra Medium | Real reply/view APIs, cross-mount persistence and lifecycle, consent/jobs/solver callbacks; verification deferred |
| T06 | Durable jobs, cancellation and progressive replies | Active, Sol Medium | Persisted attempts, atomic cancellation/commit, authenticated routes and deferred live gates |
| T07 | Durable store, threads and journal | Integrated 3c72429 + Pro corrections 33aa698 | Final conflict/reattachment fixes source-reviewed, untested; browser gate open |
| T08 | Contextual definition | Queued | T02, T05 and T13; unseen term through real provider |
| T09 | Simulation | Queued | T06 and T18; real new passage, not fixture-only |
| T10 | WebMCP adapter | Queued | Stable T05 integration; typed replies and honest unsupported state |
| T11 | Library and settings | Queued; T07 foundation available | Thread browsing, grants, vocabulary and export |
| T12 | Launch | Queued | Actual release gates, fresh-machine run, video and honest listing |
| T13 | Consent and session boundaries | Pure policy integrated 3901dfe; full ticket active, Sol Medium | Durable grants/exclusions, consent UI, adapter-aware policy and retrieval; actual isolation remains unverified |
| T14 | Evidence | Queued | T13; claim-level dated support and abstention |
| T15 | Explore | Queued | T13; useful linked shelf parked by default |
| T16 | Full note workflow and vocabulary | Queued; basic notes in T05 | Note-version Ask, origin/deletion and full persistence flow |
| T17 | Page header | Queued | T05/T13; local identity, granted enrichment, return position |
| T18 | Complete renderer and kernel | Baseline integrated 1c5a1f0; samples consumer follow-up active | Trusted host sidecar delivery and real margin/helper plumbing; all runtime verification deferred |
| T19 | Install and recovery | Queued | T01/T11; fresh-machine and sign-out recovery |
| T20 | Saved solver execution | Queued | T02/T06; sandboxed rerun with zero model turns |

The basic T05 margin is implemented before rich rendering to resolve the original dependency cycle. This sequencing removes no T05/T16/T18 requirements. Later inventory tiers remain required beyond these immediate build tickets.

## Owners and Pro coordination

Chief owns dispatch, dependency decisions, source fidelity, integration, evidence accounting and higher-order Pro consultation. Ticket owners implement only their assigned paths. Technical execution/review uses **Sol Medium**; bounded bulk work uses **Luna Max**. T05 retains the explicitly requested **Astra Medium** design owner. Model changes were sent to active technical tasks; this does not retroactively relabel earlier work.

| Ticket | Codex task | Ownership | Own Pro review |
|---|---|---|---|
| T02 | 01a0add5-2436-7231-9727-63a11ab0c75a | daemon/providers, job-runner contract, provider evidence | [Provider advisory](https://chatgpt.com/c/6aab7cff-9ba4-83eb-9ad5-8e3a536800f8) reconciled; fixes source-reviewed |
| T04 | 01a0add2-39b2-7591-b86b-9635b85c5d1c | extension and extension evidence | [Extension review](https://chatgpt.com/c/6aab7d11-52c4-83eb-99e4-2b649e28c0dc) reconciled; frozen |
| T05 | 01a0adc8-a066-7d11-8248-9cb5a63cd737 | ui except journal, webapp, package/build wiring | [Margin review](https://chatgpt.com/c/6aab7cb6-cd84-83eb-ac23-6941621ab496) reconciled; frozen |
| T18 | 01a0addb-ef93-77e0-8a57-45873cead42e | renderer and kernel | [Renderer advisory](https://chatgpt.com/c/6aab7cd5-31fc-83ed-9125-c1c2057277e2) and two code reviews reconciled; final fixes untested |
| T01 | 01a0adc8-8f4d-73a3-9e13-abdb015c842b | helper main/server/pairing/diagnostics | Fresh 6 Pro verified; consolidated chief review avoids duplication |
| T07 | 01a0adcb-25bd-7451-831f-40197dade46a | store, reader contract, journal | Fresh 6 Pro verified; consolidated chief review avoids duplication |
| T03 samples | 01a0ae01-0695-7b61-bd4d-0bacdbce172f | reply.ts/schema, CONTRACT.md, optional sample-provenance.ts | Chief higher-order advice supplied; own bounded review assigned |
| T06 | 01a0ae02-dc03-7ec2-ae86-26b6be5bf319 | contracts/jobs.ts, daemon/jobs, helper server/main integration | Own lifecycle advisory and exact source review assigned |
| T13 | 01a0ae07-41af-7b83-ae7f-d73ecb608090 | daemon/consent, retrieval, codex-policy, provider policy-gate, contracts/consent, modular consent UI | Chief higher-order profile decision supplied; own Pro advisory and scoped execution allowed |

[Chief Pro conversation](https://chatgpt.com/c/6aab6e88-3804-83ed-9f27-3f02572b2d98) completed T01/T07 review and higher-order advice on headline authority, sample-grid inputs and provider evidence. All four T01/T07 findings have source fixes integrated. The samples correction is assigned; the adapter-aware policy correction remains T13 work. Pro was instructed to defer tests and work from sources and existing evidence.

Pro has already delivered real GitHub code: d631616 on codex/pro-t13-policy, reviewed and integrated as 3901dfe. It is pure policy construction/audit logic, not a runtime guarantee. Other Pro work remains advice/review unless a scoped commit is delivered and integrated. T05's remote test assignment was superseded by the testing deferral; its owner was instructed to stop further test work at the next safe boundary and not execute/integrate proposed tests now.

See [Pro collaboration](wayfinder/PRO-COLLABORATION.md) for exact handoff rules. Fresh-chat access is resolved: Latest family, Power maximum, visible 6 Pro label. Workspace-credit banner is not treated as a blocker.

## Evidence retained before testing deferral

| Area | Prior evidence | Practical limit |
|---|---|---|
| T00/T03 | Chief ran 13 growth/reply checks successfully | Known growth model only; not arbitrary scientific correctness |
| T01 | Chief ran 10 real HTTP/WebSocket checks; worker actual entrypoint smoke | Not full extension lifecycle or provider isolation |
| T07 | Chief ran 19 storage/journal/reader checks at integration | Pending Pro review can still reveal omissions |
| T13 policy | Chief ran 20 policy checks and targeted strict TypeScript | Synthetic audit decisions, not actual sandbox/network proof |
| T05 | Worker reported 93/93 suite and browser pairing, draft/reload/cross-tab behavior | Later draft/conflict edits are unverified; no final visual gate |
| T02/shared checkout | Worker reported 96/96 suite, 21 focused checks and targeted TypeScript | Moving checkout; subsequent changes unverified; no model request |
| T04 | Worker reported WXT build/typecheck, arXiv capture, local note/source preservation | Actual worker death/recovery was not established; remaining QA deferred |

Counts are historical snapshots, not additive, not a current full-build pass. Receipts in [wayfinder/build-receipts](wayfinder/build-receipts) and [docs/evidence](docs/evidence) retain commands, artifacts and limitations. Future acceptance must bind evidence to the actual delivered revision when testing resumes.

## Current risks and next implementation frontier

1. Dedicated Codex runtime is signed out. Protocol preflight works for both transports, but no authenticated definition or simulation has run. Do not copy credentials or manufacture evidence. App-server and MCP remain required with their distinct cancellation/recovery capabilities.
2. T13 must implement the accepted adapter-aware evidence profile: pinned reviewed built-in tool allowlist, observed effective configuration and actual applicable confinement evidence. Catalog observation can be unavailable/incomplete without inventing a per-request veto; authentication, grants and required isolation evidence still gate dispatch. No development bypass was approved.
3. Preserve current headline authority: browser independent checks alone cannot authorize a headline. T18 accepts a genuinely bound host report and optional zero-inference host resealing callback. A separate local-calculation authority would require an explicit spec decision and has not been adopted. T03 adds complete axis/fixed input binding; unknown generation values must never be guessed from defaults.
4. T18's bounded source review and T03's chief corrections are integrated. Finish the sample-readiness consumer and T05 saved-reply mounting while T06 and T13 converge on actual authenticated job/grant APIs. Reply wiring must serialize view writes across mounts and prevent destroyed mounts' async callbacks from changing a newer mount. T11 library remains next using its agreed independent mounting boundary. Rich replies, note-version Ask, saved solver and the full inventory remain required.
5. No launch-ready claim: fresh-machine install, live consent/inference, cancellation, saved solver and final release demonstrations remain open. The challenge sets priority, not permission to remove capabilities.

## Integration record

Repository: https://github.com/yashgurbani/marginalia. Branch: codex/marginalia-v2. Code published through 1c5a1f0. Key implementation commits: 302fe52 helper; 3901dfe Pro policy; 3c72429 durable reader history/journal; e61389e helper Pro fixes; 33aa698 reader conflict and attachment fixes; 889fb27 provider adapters; aee5750 basic durable margin; 078d265 extension capture and trusted surfaces; fc9a258 immutable samples binding; 1c5a1f0 typed renderer/kernel. These latest integrations were source-reviewed without executing checks, as requested. T05/T04/T18 freeze hashes matched before integration. Active renderer-consumer/UI/jobs/consent follow-ups remain separately owned and may be uncommitted.

All tasks share the requested checkout with disjoint ownership. Chief stages exact frozen paths only; no branch switches/resets, broad staging or unrelated root edits. Runtime databases, credentials and browser profiles are excluded. A ticket closes only when its source requirement, delivered implementation, review disposition and eventual acceptance evidence are explicit.

## Codex MCP worker route

User authorized the existing router for task/subtask implementation. Reusable skill created at C:\Users\reader\.codex\skills\codex-mcp-router\SKILL.md. All six ticket owners received the skill, router/launcher/config paths, explicit Sol Medium/Luna Max call controls and continuation limits. Configuration already maps the codex MCP service to Start-Active-Codex-Mcp.ps1 and Codex-Mcp-Router.mjs in C:\Users\reader\yasb-personal\scripts. No router or account settings changed; no test/smoke worker was launched. Source and registered tool schemas inspected only. This developer route is distinct from Marginalia's own provider runtime and does not satisfy its authentication or isolation gates.

Latest T05 update: implementation provisionally frozen with file-hashes.json and T05 receipt; Pro remote test-file write explicitly denied after testing deferral. No remote test commit accepted. T18 Pro advice received: preserve samples provenance rather than assume missing fixed parameters; contract/documentation authority of local headline calculations requires chief reconciliation before claiming a host-validated result.

## Current review actions — 17 September, 07:55 CEST

Chief Pro review returned four bounded findings against 3c72429: false unique-survivor attachment and missing durable local-conflict recovery assigned to T07; revoke-during-body race and discarded HTTP reattachment capture assigned to T01. See [review record](docs/evidence/PRO-T01-T07-REVIEW.md). Both owners resumed for fixes only, with testing deferred. T05 added the requested allowHelper=false host seam; T04 is moving sensitive pairing/sync actions into browser-owned UI after its Pro review found a page-controlled floating iframe can be clickjacked. Later changes remain unverified.

T18 confirmed its local-classification interpretation came from the chief's dispatch, not a user override of SPEC-FINAL. Candidate headlines remain withheld without contract authority while the chief and Pro resolve a trusted local-check path that preserves zero-inference interaction. The missing fixed-generation parameters in sample envelopes will receive an additive contract correction; conservative refusal is temporary protection, not accepted completion of the samples capability. Higher-order Pro advisory is running on these precise questions and the stock Codex definition path.

T01 review correction source is frozen and chief-inspected: daemon/server.ts rechecks captured pairing after request-body parsing and forwards optional reattachment capture. Both changes are untested under the current deferral. T07 is implementing its two assigned corrections. Its first actual Sol MCP Router dispatch failed before work with a revoked-refresh-token error (thread01a0adea-d549-7db3-bf67-67afe1a0d913); no retries or auth changes, native Sol Medium fallback active. Router configuration/schema discovery remains valid but successful execution is not established. Owners notified to avoid retry loops.

## Router repair and design continuation — 17 September, 08:07 CEST

Authentication repair temporarily pinned future development MCP sessions to gs. A fresh router completed an actual Sol Medium confirmation (ROUTER_AUTH_OK; thread01a0adf2-e8e4-7182-ad0e-a4e29e2dcb92). The failed registered calls were traced to an old fixed play session; earlier jill attribution was wrong. The failed root connector was closed and its client still caches Transport closed, requiring MCP reconnect/app restart. Other tasks were told not to repeat failures or stop unrelated processes. The router source in yasb-personal now recognizes narrow actual auth failures for complementary-mode rollover without replaying requests or overriding fixed selection. Source-reviewed only; regression tests deferred. No desktop login or Marginalia provider runtime credential was changed.

Claude can continue frames6–14. [Ready-to-send continuation prompt](docs/CLAUDE-DESIGN-PASS-2.md) preserves its existing design system and includes durable recovery, explicit attachment, held focus, source-version uncertainty, separate web consent and trusted browser-margin handoff. Basic UI is implemented; rich replies and live provider flows remain incomplete. T02/T04/T05/T07 now have frozen source receipts for chief review/integration; their later changes remain unverified.

The user clarified that new connections must retain automatic usage-based routing. The official selector is now restored to complementary mode with no fixed account. A production-selector dry run returned status ok, selected robi from the current usage cache, and excluded three drained/unhealthy candidates. This confirms selection, not robi model authentication. New connections rank eligible accounts while excluding the desktop-leased account; existing connections retain their selection until reconnecting. The shared router skill and ticket owners received this correction. Product testing remains deferred.
