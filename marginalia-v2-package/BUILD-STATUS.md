# Marginalia overall build report

Updated 17 September 2026, 07:46 CEST. Chief task: 01a0adaf-dd71-7583-8307-b877547c9189.

## Current position

The helper, durable storage/journal, reply contract and initial numerical foundation are integrated. Four tasks are implementing the margin, extension, provider adapters and rich renderer. All four have verified their own GPT-6 Pro chats and submitted scoped reviews. No end-to-end live inference or release gate is complete.

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
| T01 | Local helper and pairing | Integrated 302fe52 | Pro review pending; extension lifecycle and runtime isolation remain open |
| T02 | Codex app-server + MCP adapters | Active, Sol Medium | Real authenticated inference, recovery and independent runtime evidence |
| T03 | Reply contract and host checks | Integrated foundation | Arbitrary scientific truth is not established; renderer/live integration |
| T04 | Extension capture and private margin host | Active, Sol Medium | Pro review; worker recovery and hostile-page gates deferred |
| T05 | Margin and design | Active, Astra Medium | Final integration with rich replies, consent and jobs; later visual/interaction verification |
| T06 | Durable jobs, cancellation and progressive replies | Queued | T02/T03 interfaces, then implementation and deferred live gates |
| T07 | Durable store, threads and journal | Integrated 3c72429 | Pro attachment finding under review; full browser conflict/reattachment gate open |
| T08 | Contextual definition | Queued | T02, T05 and T13; unseen term through real provider |
| T09 | Simulation | Queued | T06 and T18; real new passage, not fixture-only |
| T10 | WebMCP adapter | Queued | Stable T05 integration; typed replies and honest unsupported state |
| T11 | Library and settings | Queued; T07 foundation available | Thread browsing, grants, vocabulary and export |
| T12 | Launch | Queued | Actual release gates, fresh-machine run, video and honest listing |
| T13 | Consent and session boundaries | Pure policy integrated 3901dfe | Consent UI, grants, observed retrieval and actual isolation still required |
| T14 | Evidence | Queued | T13; claim-level dated support and abstention |
| T15 | Explore | Queued | T13; useful linked shelf parked by default |
| T16 | Full note workflow and vocabulary | Queued; basic notes in T05 | Note-version Ask, origin/deletion and full persistence flow |
| T17 | Page header | Queued | T05/T13; local identity, granted enrichment, return position |
| T18 | Complete renderer and kernel | Active, Sol Medium | All block types, four compute paths, safety and accessibility verification deferred |
| T19 | Install and recovery | Queued | T01/T11; fresh-machine and sign-out recovery |
| T20 | Saved solver execution | Queued | T02/T06; sandboxed rerun with zero model turns |

The basic T05 margin is implemented before rich rendering to resolve the original dependency cycle. This sequencing removes no T05/T16/T18 requirements. Later inventory tiers remain required beyond these immediate build tickets.

## Owners and Pro coordination

Chief owns dispatch, dependency decisions, source fidelity, integration, evidence accounting and higher-order Pro consultation. Ticket owners implement only their assigned paths. Technical execution/review uses **Sol Medium**; bounded bulk work uses **Luna Max**. T05 retains the explicitly requested **Astra Medium** design owner. Model changes were sent to active technical tasks; this does not retroactively relabel earlier work.

| Ticket | Codex task | Ownership | Own Pro review |
|---|---|---|---|
| T02 | 01a0add5-2436-7231-9727-63a11ab0c75a | daemon/providers, job-runner contract, provider evidence | [Provider advisory](https://chatgpt.com/c/6aab7cff-9ba4-83eb-9ad5-8e3a536800f8) running |
| T04 | 01a0add2-39b2-7591-b86b-9635b85c5d1c | extension and extension evidence | [Extension review](https://chatgpt.com/c/6aab7d11-52c4-83eb-99e4-2b649e28c0dc) running |
| T05 | 01a0adc8-a066-7d11-8248-9cb5a63cd737 | ui except journal, webapp, package/build wiring | [Margin review](https://chatgpt.com/c/6aab7cb6-cd84-83eb-ac23-6941621ab496) running |
| T18 | 01a0addb-ef93-77e0-8a57-45873cead42e | renderer and kernel | [Renderer advisory](https://chatgpt.com/c/6aab7cd5-31fc-83ed-9125-c1c2057277e2) received; reconciling |
| T01 | 01a0adc8-8f4d-73a3-9e13-abdb015c842b | helper main/server/pairing/diagnostics | Fresh 6 Pro verified; consolidated chief review avoids duplication |
| T07 | 01a0adcb-25bd-7451-831f-40197dade46a | store, reader contract, journal | Fresh 6 Pro verified; consolidated chief review avoids duplication |

[Chief Pro conversation](https://chatgpt.com/c/6aab6e88-3804-83ed-9f27-3f02572b2d98) is reviewing committed T01/T07 and practical provider evidence collection. Chief additionally requested higher-order judgment on the next source-faithful reader flows and the risk of policy machinery displacing product delivery. Pro was told to defer further tests and finish from existing evidence/source inspection. Preliminary attachment-context concern is not yet a finalized finding; T07 is informed and frozen awaiting specifics.

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
2. The policy audit needs independently observed tool capabilities and runtime isolation. Pro is advising the smallest concrete collection path. Configuration intent and MCP tool listing alone cannot prove the complete model tool surface. Keep this work bounded to enabling the reader's real flow.
3. Pro's preliminary attachment-context concern may require a T07 correction. Await exact finding, implement within owner scope, retain deferred-verification status.
4. Finish and freeze T02/T04/T05/T18 implementation, reconcile scoped Pro findings, and integrate only explicit owned paths. Then advance T06/T13 for real Ask and T16/T11 for the durable reader experience. Rich replies and saved solver remain full requirements.
5. No launch-ready claim: fresh-machine install, live consent/inference, cancellation, saved solver and final release demonstrations remain open. The challenge sets priority, not permission to remove capabilities.

## Integration record

Repository: https://github.com/yashgurbani/marginalia. Branch: codex/marginalia-v2. Last published code/coordination baseline before this report: f471dd4. Key implementation commits: 302fe52 helper; 3901dfe Pro policy; 3c72429 durable reader history/journal. Active task code remains partly uncommitted.

All tasks share the requested checkout with disjoint ownership. Chief stages exact frozen paths only; no branch switches/resets, broad staging or unrelated root edits. Runtime databases, credentials and browser profiles are excluded. A ticket closes only when its source requirement, delivered implementation, review disposition and eventual acceptance evidence are explicit.

## Codex MCP worker route

User authorized the existing router for task/subtask implementation. Reusable skill created at C:\Users\reader\.codex\skills\codex-mcp-router\SKILL.md. All six ticket owners received the skill, router/launcher/config paths, explicit Sol Medium/Luna Max call controls and continuation limits. Configuration already maps the codex MCP service to Start-Active-Codex-Mcp.ps1 and Codex-Mcp-Router.mjs in C:\Users\reader\yasb-personal\scripts. No router or account settings changed; no test/smoke worker was launched. Source and registered tool schemas inspected only. This developer route is distinct from Marginalia's own provider runtime and does not satisfy its authentication or isolation gates.

Latest T05 update: implementation provisionally frozen with file-hashes.json and T05 receipt; Pro remote test-file write explicitly denied after testing deferral. No remote test commit accepted. T18 Pro advice received: preserve samples provenance rather than assume missing fixed parameters; contract/documentation authority of local headline calculations requires chief reconciliation before claiming a host-validated result.
