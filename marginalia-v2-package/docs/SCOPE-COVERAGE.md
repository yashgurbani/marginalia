# Marginalia v2 scope coverage

This is a traceability inventory for the bounded build. It records what the source package asks for, where the T00–T20 plan places it, and where the sources still leave an acceptance or dependency question. It does not narrow scope or choose architecture.

## Reading rule

The source package says `marginalia-v2-package/wayfinder/SPEC-FINAL.md` governs; `SPEC.md` is the derived R1–R30 view. `BUILD-PLAN-24H.md` supplies the T00–T20 work breakdown and gates. `FEATURE-INVENTORY.md` says every S/A/B/C/D line remains in product scope and that the letter is order, not a verdict. `MAP.md`, `HANDOFF-ASTRA.md`, the decision tickets, the whitepaper, and `docs/pivot-review/*` provide rationale and review observations.

Status in this document is an observation:

- **Mapped** means one or more build tickets name the behavior and their stated acceptance is substantially aligned.
- **Partial** means a ticket touches the behavior, but its acceptance does not prove the full requirement or a source gives a conflicting rule.
- **No dedicated ticket** means the feature remains in the inventory or roadmap but has no explicit T00–T20 implementation ticket. T12 launch work can document it, but does not make the feature implemented.

The source requirements and feature statements below are condensed for readability. The cited path and section are the source of truth; the coverage labels and gap notes are observations.

## Stage and ticket index

| Stage | Build tickets | Source gate |
|---|---|---|
| 0 Contract | T00, T03 | Valid fixture plus malicious/invalid fixtures; probe agrees with the closed form. |
| 1 Durable reader | T01, T04, T07, T16 | Note on a real page survives daemon/browser restart; edited text is moved/unsure. |
| 2 Real definition | T02, T06, T08, T13, T17 | Unseen term works; excluded page sends nothing; unknown outcome does not auto-retry; sending is distinct from working. |
| 3 Interactive reply | T05, T09, T18, T20 | Demo and second passage are correct; local interaction costs no inference; malformed output cannot run; unchecked headline is withheld. |
| 4 Install and release | T11, T12, T19 | Fresh reader installs, recovers, and public claims match the run. |
| 5a Evidenced expansion | T14, T15 | Closed session is tested offline; open fetches are complete or labelled incomplete; no fabricated sources. |
| 5b Roadmap | T10, PDF viewer, library search, local models, hosted home | Each later capability gets its own fidelity, permission, persistence, and failure contract. |

## R1–R30 to build tickets

Source: `marginalia-v2-package/wayfinder/SPEC.md`, §4. The corresponding governing behavior is in `marginalia-v2-package/wayfinder/SPEC-FINAL.md`, especially §The margin, §Asking, §Replies, §Notes, §Privacy, §Codex, and §Definition of done.

| Req. | Condensed source requirement | Build coverage | Status and evidence gap |
|---|---|---|---|
| R1 | Supported-page selection opens the anchored card without rewriting source content; selecting alone sends nothing. | T04, T05, T12 | **Partial.** T04 checks no send on arXiv/news selection, and T05 owns the card, but no ticket acceptance proves the native Chrome side-panel user-gesture path or the full supported-page matrix. |
| R2 | Local Keep/Ask appears within measured 100 ms; suggestions precede model return; no cloud-latency promise. | T04, T05, T12 | **Partial.** The 100 ms measurement is a requirement but not a named T04/T05 acceptance check. |
| R3 | Document quote appears with no send; automatic Luna gloss only after prior site grant and opt-in; dismiss is complete. | T05, T08, T13 | **Partial.** T08 proves an unseen term and page quote, but does not explicitly accept automatic-definition opt-in, dismissal, or grant-before-send. |
| R4 | Persist before deep execution; Working → provisional first frame → Ready; keep last good partial on failure; reader can continue. | T05, T06, T09, T18, T20 | **Partial.** T06 proves progressive states and cancel fencing, but its acceptance does not explicitly prove last-good-partial retention and incomplete status on failure. |
| R5 | At most one clarification; otherwise a visible default; mid-build questions remain pending with a taken default. | T05, T09, T16 | **Partial.** The plan mentions the pending-question UI, but no ticket acceptance checks the one-question bound and default capture through a real run. |
| R6 | Typed blocks only; cheapest sufficient path is kernel → in-envelope samples → saved-solver replay → explicit new model call; assumptions are editable versions; unsupported work is stated. | T03, T05, T09, T18, T20 | **Mapped with contract risk.** T18/T20 cover local and saved-solver paths, but the launch block contract and the expression grammar have unresolved issues listed below. |
| R7 | Per-part origin/relation; host and model checks have different authority; failed checks are visible; unchecked headline is withheld. | T00, T03, T05, T09, T14, T18 | **Partial.** T03/T18 mention validation and T00 the fixture check, but the contract also contains a model self-check; there is no explicit acceptance that self-attestation can never satisfy a headline host check. |
| R8 | Return to anchor; show moved/unsure/lost; ambiguous reattachment shows candidates or leaves unplaced. | T04, T05, T07, T16 | **Mapped with terminology risk.** T07 explicitly says moved/unsure, but the feature inventory and SPEC.md glossary use relocated/ambiguous/orphaned. |
| R9 | Threads, notes, highlights persist before reply completion; reload reattaches; state is changeable. | T06, T07, T11, T16 | **Partial.** T07 acceptance covers reload/restart and the ticket lists pre-reply persistence, but the no-daemon local-note promise is not assigned to a ticket. |
| R10 | Keep and Park are one keystroke away regardless of ranking. | T05, T07, T16 | **Mapped.** T05 owns visible actions; the ticket and design brief also require visible Park for discoverability. |
| R11 | Exclusions apply before extraction and again in daemon; excluded pages offer no action they would refuse. | T01, T04, T13, T17 | **Partial.** T13 tests an excluded site, but T04's acceptance does not prove the pre-extraction check for credential fields, browser pages, or private-window policy. |
| R12 | Without daemon, reading, cached threads, and local notes remain usable; WebMCP is optional and capability-checked. | T01, T07, T10, T11, T19 | **Partial.** T10 and T19 cover optional WebMCP/install recovery, while no T00–T20 acceptance proves local notes/cache while the daemon is absent. |
| R13 | Cancellation, failure, malformed output, timeout, disconnect, and reload have visible outcomes; unknown is a new explicit retry only. | T02, T03, T06, T12, T19 | **Partial.** T03 rejects malformed fixtures and T06 covers unknown/cancel, but the complete matrix across timeout, disconnect, reload, and public evidence is not one ticket acceptance. |
| R14 | Notes have explicit frozen/changeable anchors, are launch scope, exportable, feed vocabulary; `?` offers Ask but never sends; replies quote note version. | T05, T07, T11, T16 | **Mapped with export gap.** T16 covers anchor freeze, draft recovery, Ask, and note-version quoting; T11 only names JSON export and does not prove all note/export paths. |
| R15 | Local page identity; assumed terms, Semantic Scholar, and model calls are external and grant/cached; no inline gloss without selection. | T04, T08, T13, T17 | **Partial.** T17 checks local header timing and post-grant assumed terms, but no acceptance records the external destination/egress for metadata lookups. |
| R16 | Scroll-synced anchor order, size/excerpt compactness, held reading position during interaction, explicit follow-reading, stable suggestion sets. | T05, T16, T17, T18 | **Partial.** T05 checks slider focus while scrolling, but no acceptance covers notes in anchor order, follow-reading, all held controls, and frozen suggestion positions together. |
| R17 | Short-lived six-digit pairing challenge exchanges for ≥256-bit scoped token; revoke/re-pair; provider credentials stay out of browser. | T01, T11, T19 | **Mapped.** Pairing and health are T01/T19 acceptance; exact attack/replay coverage is a verification gap, not an absent product ticket. |
| R18 | First send previews exact context, recipient, scope; this-time/always/never; denial persists; web grant is separate. | T05, T11, T13, T17 | **Partial.** T13 names the full sheet and persisted denial, but T05 acceptance does not exercise it and the second web grant is only in the stage gate. |
| R19 | Math capture prefers TeX from annotation/alt, otherwise rendered text with `math: rendered`; duplicate/multiline/inline cases tested. | T04, T18, T12 | **Partial.** T04 only names arXiv/news selection in its done test; the required duplicate-equation, multiline, and inline-widget corpus is not assigned. |
| R20 | Cross-paragraph/code selections preserve boundaries and code language; code is a procedure; crossings are tested. | T04, T09, T18, T12 | **Partial.** Packet and block contracts mention this, but no T04/T09 acceptance names a cross-block/code fixture. |
| R21 | Follow-up is separate from notes, resumes persisted provider thread where possible, references stable reply version, and forks on provider/permission change. | T02, T05, T06, T07, T16 | **Partial.** T02 tests resume and T05 has a follow-up field; fork identity and stable-version behavior are not explicit in a done criterion. |
| R22 | Same-anchor replies are siblings or related versions; newest expands; kept versions are never overwritten. | T05, T07, T16, T18 | **Partial.** Immutable reply versions appear in the contract/store work, but no ticket acceptance proves sibling/version rendering plus kept-version protection. |
| R23 | Elapsed time after 30 s; always-visible cancel; late-output fence; ten-minute timeout; timeout/disconnect/failure/unknown are distinct. | T02, T06, T05, T12, T19 | **Mapped with matrix gap.** T06 covers states and fences, but exact 30-second/ten-minute UI timing and all distinctions are not jointly accepted. |
| R24 | Source identity, immutable source version, and per-tab attachment are separate; SPA/mutation reattach; same-capture tabs share; different versions reconcile; edits use revision checks. | T04, T07, T16, T17, T12 | **Partial.** T07 checks changed-page moved/unsure and T04 owns page signals, but SPA, mutation, same-capture multi-tab, and conflict tests are absent from ticket acceptance. |
| R25 | Direct page definition shows instantly and is labelled; uncertain extraction abstains. | T04, T05, T08 | **Partial.** T08 accepts page quote before model, but uncertain extraction abstention is not in its done criterion. |
| R26 | Stable prefixed IDs preserve focus; explicit handoff; live-region Ready without focus theft; all states keyboard-reachable. | T05, T16, T18, T12 | **Partial.** T18 names stable IDs and T05 holds a slider, but the keyboard/screen-reader/live-region/reduced-motion suite is not a ticket acceptance. |
| R27 | Separate sending indicator while data leaves; opens grant/recipient/context-hash/outcome/fetched-resource record. | T05, T06, T13, T11 | **Partial.** T13 covers records and T05 design includes two dots, but T05's done test does not verify the rail indicator or full egress detail. |
| R28 | Remove reply/page work and state changes are reversible; tombstones persist; Undo pauses on focus; removed work remains in history. | T05, T07, T11, T16 | **Partial.** T07 lists tombstones/undo and T05 lists removal UI, but pause-on-focus and history/recovery acceptance are missing. |
| R29 | Header may show local metadata/assumed terms under grant; contested claims require open-session evidence and header must not imply evidence. | T13, T14, T15, T17 | **Partial.** T14/T15 cover evidence/explore, but no ticket acceptance checks that the header does not imply contested support. |
| R30 | Below 900 px rail opens usable sheet with passage/reply/breadcrumb; note belongs to thread/page list and exports. | T05, T11, T16, T12 | **Partial.** The design brief specifies the sheet, but T05's done test does not exercise the narrow host and T11 does not prove page-list export. |

### Strictly unmapped R acceptance

No R number is wholly absent from a broad T12 integration story, but the following requirements have no dedicated, named acceptance in T00–T20 and should not be treated as covered by a generic launch gate: R2 (100 ms), R5 (one-question/default behavior), R11 (pre-extraction exclusions), R12 (daemon-absent local cache), R15 (metadata egress), R19–R20 (math/code selection corpus), R24 (SPA/multi-tab/revision), R26 (keyboard/AT/focus/zoom), R27 (sending rail and complete record), R28 (Undo pause/history), R29 (header/evidence separation), and R30 (narrow sheet/breadcrumb). Source: `marginalia-v2-package/wayfinder/SPEC.md` §4 and `BUILD-PLAN-24H.md` §Tickets/§Stages and gates.

## Feature inventory to T00–T20

Source: `marginalia-v2-package/wayfinder/FEATURE-INVENTORY.md`. Each line below preserves the inventory's tier. `S` rows are launch-spine scope, with Evidence and Explore gated by stage 5a; A/B/C/D rows remain product scope even when there is no current implementation ticket.

### Core interaction, live margin (inventory lines 7–24)

- **S** Extension sidebar as floating margin on any page; selection card in same gesture → **T04, T05**. Partial for unsupported-page matrix and Chrome gesture.
- **S** Keep/highlight and Ask on one gesture → **T05**.
- **S** Two or three stable chips, cost labels, More, free text → **T05**.
- **S** Instant no-model page type/structure/difficulty features and chips → **T04, T05**. Difficulty features have no dedicated implementation ticket.
- **S** Fast Luna gloss through Codex read-only → **T02, T08, T13**.
- **S** Deep Astra artifact with execution embedded live → **T02, T06, T09, T05**.
- **S** Plan/first-partial/done states, progressive files, dock → **T05, T06**.
- **S** Editable assumptions that re-run → **T05, T09, T18, T20**.
- **S** Per-part provenance (document/archive/fetched/generated) → **T03, T05, T14, T15, T18**.
- **S** At most one clarification, marked assumptions → **T05, T09**.
- **A** Reflect chips and end-of-article suggestions → **No dedicated ticket**; only the general footer in **T05** and launch integration in **T12** mention adjacent behavior.
- **A** Explore intent, reading/video/contrasting items parked → **T15** (stage-5a gate).
- **A** Voice (`gpt-live`) and image (`gpt-image`) capability-gated → **No dedicated ticket**; T18's media stubs do not establish provider routing or actual voice/image output.
- **A** Situate, citation context/currency/claim-vs-evidence with network-on Codex → **T14, T17** only partially; no dedicated Situate ticket.
- **A** Connect, field analogy, note/thread links, prerequisite chain → **No dedicated ticket**.
- **A** Derive step-by-step/question-per-step and instantiate with numbers → **T09, T18** touch the renderer; no dedicated acceptance for either transform.
- **A** Margin rules, rail/density, surprisal underline, one branch open → **T05, T17** partially; no ticket implements the opt-in surprisal/branch policy.
- **B** Ambient opt-in by page type and whitelist → **No dedicated ticket**; T11 settings do not state this behavior.

### Suggestion engine (inventory lines 27–31)

- **S** Additive heuristic with capability/permission hard filter → **T05, T17** partially; decision ticket 10 is a policy record, not a build ticket.
- **S** Day-one exposure log with context, eligible set, positions, choice/no-choice, latency, policy, outcome → **T05, T07** partially; no done test asserts the full event schema.
- **A** Difficulty signals as observable events and transform relevance → **No dedicated ticket**.
- **A** Situation-model shift features → **No dedicated ticket**.
- **D** Conditional-logit outside-option model and exploration reward → **No dedicated ticket**.

### Personalization and memory of the reader (inventory lines 34–38)

- **S** Stated context field → **T05, T13**, with packet handling from decision ticket 08.
- **A** Five-minute skippable onboarding for fields/levels/preferences/languages/notes/Zotero/exclusions → **T11, T19** partially; no onboarding acceptance.
- **A** Visible/editable vocabulary from writing, priors, and lookups; no got-it loop → **T11, T16, T17** partially.
- **A** Flow/learning posture control without suppression → **No dedicated ticket**.
- **D** Visible/editable/tested inferred-comprehension model → **No dedicated ticket**; source principles explicitly reject hidden mastery inference in `SPEC-FINAL.md` §Purpose/§Notes and `Marginalia — Research Whitepaper.md` §Memory.

### Memory of work and library (inventory lines 41–50)

- **S** Auto-saved threads with span/selectors/source version/replies/ledger/unresolved and reload resume → **T06, T07**.
- **S** Thread states active/parked/resolved-by-reader/archived/removed → **T05, T07, T11**. State names conflict with canonical open/parked/done/archived in `SPEC-FINAL.md`.
- **A** W3C highlights and notes as reader layer → **T04, T07, T16**.
- **A** Save/bookmark pages or PDFs with snapshot/hash and queue resume → **T07** partially; PDF/snapshot work has no dedicated ticket.
- **A** Related-in-library card on page load → **No dedicated ticket**; T11 is only the minimal thread/settings webapp.
- **B** Journeys, proposed groupings, accepted/renamed, topics/tags → **No dedicated ticket**.
- **B** Collection search and cited answers with abstention → **No dedicated ticket**.
- **B** Journal synthesis → **No dedicated ticket**.
- **B** Markdown/JSON/BibTeX export, Obsidian/Zotero sync, import round trip → **T11** only partially (JSON export is named); no sync/import/BibTeX acceptance.
- **B** Backlog navigation for parked and abandoned work → **T11** partially; no explicit backlog acceptance.

### Surfaces (inventory lines 53–60)

- **S** WXT/MV3 extension, content script, sidebar host, reconnecting disposable worker → **T04, T05**.
- **S** Localhost daemon with store/jobs/router/Codex/session manager/validator/ledger → **T01, T02, T03, T06, T07, T13**.
- **S** Minimal localhost webapp with threads/settings/models/grants/exclusions/vocabulary/export → **T11**.
- **A** WebMCP mirror with `insert_artifact`, retired agent folding → **T10**, but naming/schema conflict is unresolved.
- **B** Extension PDF viewer on PaperCraft overlay and arXiv path → **No dedicated ticket**; listed as stage-5b roadmap in `BUILD-PLAN-24H.md`.
- **B** Webapp as home with library/queue/journeys/journal → **T11** only for its minimal subset; no home/library roadmap ticket.
- **C** Hosted webapp, API adapter, server store/privacy contract → **No dedicated ticket**.
- **C** Outward daemon MCP server for ChatGPT/Claude Desktop library queries → **No dedicated ticket**.

### Providers and transports (inventory lines 63–67)

- **S** Codex via `codex mcp-server`, reader plan, Luna/Astra per tier → **T02, T08, T09, T19**. The governing spec makes app-server primary and MCP second, so the inventory wording is stale.
- **S** Workspace-write sandbox, network-off artifact jobs, startup availability, degraded mode → **T01, T02, T13, T19**; per-OS proof is not a ticket acceptance.
- **A** Network-on Codex sessions for browsing transforms with ledger → **T13, T14, T15**.
- **C** Ollama, official Claude CLI, hosted API adapter, app-server upgrade path → **T02** only for the app-server path; local/Claude/hosted adapters have **no dedicated ticket**.
- **C** Capability interface for text/structured output/tools/execution/image/speech/browsing/local → **T02** partially; no capability-matrix acceptance.

### Skills (inventory lines 70–73)

- **S** Instructions-only transform skill folders with Marginalia sidecar → **T08, T09, T14, T15**.
- **A** Applicability, host capability, permission, output validation checks with pinned versions → **T03, T08, T09, T13, T14, T15**; no single acceptance covers all four checks and update-as-permission-change.
- **C** Executable skills behind gate, sandbox contract, quorum-review/fact-check/last30days/reproduce-figure → **T20** partially for saved execution; no dedicated skill-gate or named-skill acceptance.
- **C** Shared threads show static replies and never auto-install skills → **T07, T11** partially; no explicit acceptance.

### Anchors, source, provenance, security (inventory lines 76–83)

- **S** W3C selectors and exact/relocated/ambiguous/orphaned states → **T04, T07, T16**; state terminology conflicts with SPEC-FINAL.
- **S** URL/capture/text/normalization/hash evidence and labelled reflow → **T04, T07, T17**.
- **S** Typed packaged replies, no generated code, kernel, grids, explicit recompute → **T03, T09, T18, T20**.
- **S** Host egress record before send and extension domain exclusions → **T01, T04, T06, T13**.
- **A** Mechanical cited-span and fetched-text checks → **T03, T14**.
- **A** Fidelity contracts per transform kind → **T03, T09, T14, T15, T18**.
- **A** Evidence-laundering rule and correction propagation → **T07, T14, T15** partially; no explicit correction-propagation acceptance.
- **B** Share margin/hash only and recipient re-fetch → **No dedicated ticket**.

### Privacy and legal (inventory lines 86–88)

- **S** Local-first, sync off, no provider credentials in browser → **T01, T11, T13, T19**.
- **A** Per-provider retention/training terms and per-day spend → **T11** only partially; no settings acceptance.
- **A** TDM opt-outs, private-copy framing, ND argument qualified before hosting → **No dedicated ticket**; T12 can carry release copy, but does not establish legal review.

### Evaluation and business (inventory lines 91–94)

- **A** 12–15-reader alpha against existing assistant, usefulness/correspondence/steps/resumption/states → **T12** only as launch material; no cohort/evaluation ticket.
- **A** Bounded paid continuation at fixed checkpoint → **No dedicated ticket**.
- **D** Delayed-retention learning-outcome study → **No dedicated ticket**.
- **C** Open-source core, hosted convenience, institutional/publisher conversations, Noether IRE convergence → **T12** for launch/readme scope only; hosted/business/Noether work has **no dedicated ticket** and MAP explicitly excludes Noether/institutional work.

### Contest (inventory line 97)

- **S** Launch copy, eight gates, one live artifact video, honest scope, shoutouts, no upvote asks → **T12**. This is a release/documentation ticket; it cannot substitute for unpassed product gates.

## Decision-ticket traceability

Source tickets: `marginalia-v2-package/wayfinder/tickets/`. Build tickets: `marginalia-v2-package/wayfinder/BUILD-PLAN-24H.md` §Tickets. “Coverage” below is an observation of the mechanical placement, not a new disposition.

| Decision ticket | Decision source | Build ticket(s) receiving it | Coverage / unresolved point |
|---|---|---|---|
| 01 contest entry | `tickets/01-contest-entry-tonight.md` | T04, T05, T08, T09, T12, T14, T15, T19 | **Partial.** T12 owns launch evidence and T19 setup; the resolution's real-product slice spans multiple tickets and the fallback remains conditional on gates. |
| 02 artifact contract | `tickets/02-artifact-contract-v1.md` | T03, T05, T09, T10, T18, T20 | **Partial.** Resolution correctly replaces artifact bundle with `marginalia.reply.v1`, but the old ticket question and WebMCP inventory still say artifact/iframe. |
| 03 daemon stack | `tickets/03-daemon-stack.md` | T01, T02, T06, T07, T11, T13, T19, T20 | **Mapped with adapter gap.** The ticket chooses app-server primary/MCP second; T02's MCP interrupt acceptance is incompatible with MCP's stated abandon fallback. |
| 04 sidebar rendering | `tickets/04-sidebar-rendering.md` | T04, T05, T10, T18 | **Mapped.** No generated iframe path remains; Chrome side-panel gesture and Firefox acceptance are still host-specific gaps. |
| 05 anchors/source versions | `tickets/05-anchors-and-source-versions.md` | T04, T07, T16, T17 | **Partial.** Core records are placed, but SPA/multi-tab/PDF anchor acceptance is not assigned. |
| 06 store schema | `tickets/06-store-schema-v1.md` | T06, T07, T11, T16, T20 | **Mapped with offline gap.** Normalized entities and outbox are placed; daemon-absent local notes/cache are not accepted. |
| 07 alpha transform set | `tickets/07-alpha-transform-set.md` | T05, T08, T09, T14, T15, T18 | **Partial.** Core and gated transforms are placed; alpha Reflect/Connect/Derive/Instantiate have no complete ticket acceptance. |
| 08 context packet | `tickets/08-context-packet.md` | T03, T06, T08, T09, T13, T14, T15, T17 | **Mapped.** Actual packet preview, deterministic truncation, grant-scoped enrichment, and pre-dispatch hash are stated; no separate packet fixture ticket exists. |
| 09 Codex session policy | `tickets/09-codex-session-policy.md` | T02, T06, T08, T09, T13, T14, T15, T19 | **Partial.** Closed/open policy is placed, but OS matrix, broker enforcement, and adapter lifecycle evidence remain acceptance risks. |
| 10 suggestion heuristic | `tickets/10-suggestion-heuristic-v1.md` | T05, T07, T17 | **Partial.** Static v1 table/no reorder is T05; full additive score and exposure-log schema have no dedicated done test. |
| 11 fast tier path | `tickets/11-fast-tier-path.md` | T02, T08, T13, T19 | **Partial.** Discovery and measured time word are source requirements; T08's done test does not name latency/cost evidence. |
| 12 margin design | `tickets/12-margin-design.md` | T05, T16, T17, T19 | **Partial/open.** Pass 2 remains open and acceptance spans frames 1–14, while T05 checks only the live fixture and held slider. |
| 13 WebMCP mirror v2 | `tickets/13-webmcp-mirror-v2.md` | T10 | **Contradictory.** Resolution names `insert_artifact` and `marginalia.artifact.v1`; current T10/SPEC-FINAL names `insert_reply` and `marginalia.reply.v1`. |
| 14 repo/licence | `tickets/14-repo-and-licence.md` | T11, T12, T19 | **Partial.** T12 can document release scope and notices; no explicit SBOM/license fixture ticket. |
| 15 daemon install/pairing | `tickets/15-daemon-install-and-pairing.md` | T01, T11, T19 | **Mapped.** T19 owns install/recovery, with exact diagnostic and OS evidence still required. |
| 16 renderer block set | `tickets/16-renderer-block-set.md` | T03, T09, T18, T20 | **Partial/open.** T18 owns the set, but the ticket leaves caps to measurement and its grammar does not define template conditionals used by the contract. |

## Contradictory rules and acceptance statements

These are source inconsistencies or mutually incomplete acceptance rules. They are observations for the parent to resolve; this document does not select a winner beyond the package's stated `SPEC-FINAL.md` precedence.

1. **WebMCP name and schema.** `tickets/13-webmcp-mirror-v2.md` resolves to `insert_artifact` accepting `marginalia.artifact.v1`; `FEATURE-INVENTORY.md:56` repeats `insert_artifact`. `BUILD-PLAN-24H.md:T10`, `MAP.md`, `SPEC.md` §12, and `SPEC-FINAL.md` use `insert_reply` and `marginalia.reply.v1`. T10 cannot have a deterministic acceptance until the method and schema are one pair.
2. **Anchor state vocabulary.** `SPEC-FINAL.md` and ticket 05 use `exact/moved/unsure/lost`; `SPEC.md` §2 and `FEATURE-INVENTORY.md:76` use `exact/relocated/ambiguous/orphaned`. R8 and T07 therefore name different visible states for the same event.
3. **Thread state vocabulary.** `SPEC-FINAL.md` uses `open/parked/done/archived`; `FEATURE-INVENTORY.md:42` uses `active/parked/resolved-by-reader/archived/removed`. Removal is a tombstone in the governing spec, so “removed” is not clearly a thread state. T05/T07/T11 need one state machine.
4. **Codex adapter cancellation.** `SPEC-FINAL.md` §Codex and `tickets/03-daemon-stack.md` make app-server primary and MCP second. `BUILD-PLAN-24H.md:T02` says both adapters pass start/interrupt/resume/recover, then says MCP may be selected with abandon+tombstone; `SPEC.md` §8 and the ticket 09 resolution say MCP lacks explicit interrupt and cancellation degrades. The “both pass interrupt” acceptance cannot be true for the stated MCP fallback.
5. **Reply block contract is split.** `tickets/02-artifact-contract-v1.md` lists a reduced typed set; `BUILD-PLAN-24H.md`'s JSON example has text/equation/model/plot/derived/solver/classification and its rules mention samples; `tickets/16-renderer-block-set.md` and `SPEC-FINAL.md` add steps, compare, question, turn, citations, shelf, samples, solver, and media. T03/T18/T10 need one launch schema and one acceptance fixture set.
6. **Model self-check versus host headline check.** `BUILD-PLAN-24H.md`'s reply JSON includes `chk-self` with `kind: "model"`, while `SPEC-FINAL.md` §Replies, `SPEC.md` R7, and T03 require a headline claim to be one of the host checks. The package says authorities differ, but does not explicitly reject self-attestation when selecting the headline check. This is a validation acceptance ambiguity.
7. **Read-only fast tier versus file-output contract.** `SPEC.md` §8 gives the fast tier `sandbox: read-only`; `BUILD-PLAN-24H.md`'s contract rules require Codex to write `reply.partial.json` and `reply.json` in the job workspace, and T08 requires a real fast reply. The package does not state whether a read-only runner gets a writable output channel/subdirectory or whether fast replies use another transport.
8. **Template expression outside the declared grammar.** The `classification` label in `BUILD-PLAN-24H.md`'s JSON uses interpolation and a ternary (`{T > horizon ? ... : ''}`), while the same file's grammar rule allows arithmetic, comparisons, named math functions, and no other calls/loops. T03/T18 cannot accept the fixture deterministically until this template behavior is specified or removed.
9. **Local/offline wording.** `SPEC-FINAL.md` §Privacy promises reading, notes, and highlights without a helper/account, while `SPEC.md` R12 says this is “per the documented cache capability”; `BUILD-PLAN-24H.md:T07` tests daemon restart, not daemon absence. The source package also calls closed jobs network-off while Codex inference itself is a remote provider transport; `docs/pivot-review/ARCHITECTURE-AND-STACK.md:36–38` records the distinction. Offline local-note behavior and tool-network evidence need separate acceptance.
10. **Evidence/Explore launch status.** `FEATURE-INVENTORY.md:3` calls Evidence and Explore S behind a stage-5a gate; `SPEC.md` §5 and `SPEC-FINAL.md` §Release make them conditional; `BUILD-PLAN-24H.md`'s cut order allows T14/T15 to be dropped, while T12's generic eight gates do not name the stage-5a gate. Public launch scope is therefore conditional until T12 records the decision.
11. **“Every feature in scope” versus “out of spec.”** `FEATURE-INVENTORY.md:4` keeps all lines in scope, while `MAP.md` §Scope note explicitly rules Noether IRE and institutional/publisher offerings out of that map, and `BUILD-PLAN-24H.md` calls many items stage-5b roadmap. The distinction between product scope, this build, and this map should stay explicit in acceptance reports.
12. **Source-preservation wording.** `SPEC.md` R1 says the host adds nodes and never edits page nodes; `SPEC-FINAL.md` and ticket 04 say the source/layout are preserved while a namespaced host and highlights are added. The older “host DOM is never mutated” language called out by `docs/pivot-review/ARCHITECTURE-AND-STACK.md:40` cannot coexist with a floating host/marks statement unless “source nodes” is the scoped object.

## Missing dependencies and evidence hooks

The build plan records `blocked_by`, but several requirements consume behavior without declaring that dependency. These are concrete traceability observations.

- **T09/T20 need T13's grant/session policy.** Simulate is a deep Codex request and R18 applies to every send; T09 lists only `T06, T18` as blockers and T20 lists `T02, T06`. Source: `BUILD-PLAN-24H.md:T09/T20`, `SPEC.md` R18, `tickets/09-codex-session-policy.md`.
- **T10 needs T03 and T04.** `T10` accepts a validated reply inserted on a page, but its only blocker is T05; validation is T03's contract and registration is T04's content-script surface. Source: `BUILD-PLAN-24H.md:T03/T04/T10`, `tickets/13-webmcp-mirror-v2.md`.
- **T11 needs T01/T13 for grant revocation.** Its done criterion is “a revoked grant stops sends”, but T11 is blocked only by T07 and the grant/token enforcement lives in T01/T13. Source: `BUILD-PLAN-24H.md:T01/T07/T11/T13`, `SPEC.md` R17–R18.
- **T14/T15 need T18 and the provider path.** Evidence citations and Explore shelves are typed blocks rendered by T18 and require the open-session/provider contract in T13; their explicit blockers list only T13. Source: `BUILD-PLAN-24H.md:T13/T14/T15/T18`, `SPEC-FINAL.md` §Release.
- **T19 needs T02/T13 evidence.** Install/recovery accepts Codex sign-out and diagnostics, while the session lifecycle, pinned version, sandbox, and grant behavior are in T02/T13. Its explicit blockers are only T01/T11. Source: `BUILD-PLAN-24H.md:T01/T02/T11/T13/T19`, `tickets/15-daemon-install-and-pairing.md`.
- **T06 needs T13 before any real send.** T06's state engine is blocked by T02/T03 but its real-run acceptance can execute before consent/egress integration in T13. Source: `BUILD-PLAN-24H.md:T06/T13`, `SPEC.md` R4 and R18.
- **R19/R20 lack a test fixture dependency.** T04's done test mentions only arXiv HTML/news; the required duplicate-equation, TeX fallback, inline-widget, multiline, code-language, and cross-block cases have no named fixture path. Source: `SPEC.md` R19–R20, `BUILD-PLAN-24H.md:T04`, `docs/pivot-review/ARCHITECTURE-AND-STACK.md:230`.
- **R24 lacks SPA/multi-tab evidence ownership.** T04 and T07 mention page changes/restart, but no ticket owns same-capture sharing, per-tab attachments, mutation reconciliation, or revision conflict checks. Source: `SPEC.md` R24, `BUILD-PLAN-24H.md:T04/T07`, `docs/pivot-review/ARCHITECTURE-AND-STACK.md:230–232`.
- **R26/R30 lack UI acceptance ownership.** Stable IDs are named by T18 and held scrolling by T05, but the keyboard/screen-reader/reduced-motion/200% suite and narrow sheet/breadcrumb are not in their done criteria. Source: `SPEC.md` R26/R30, `BUILD-PLAN-24H.md:T05/T18`, `DESIGN-BRIEF-FINAL.md` §Pass 2.
- **Daemon-absent notes have no implementation owner.** `SPEC-FINAL.md` §Privacy and `SPEC.md` R12 promise local reading/notes, while T07 owns the daemon store and T19 owns recovery. No ticket says where note drafts/cache live when the daemon is stopped. Source: `BUILD-PLAN-24H.md:T07/T19`, `SPEC.md` R12, `SPEC-FINAL.md` §Privacy.
- **Fast read-only output has no writable contract.** T08 depends on T02/T05/T13 and the fast session is read-only, but the reply file contract requires writes. This is both a dependency and a contract gap. Source: `BUILD-PLAN-24H.md` Reply contract/T08, `SPEC.md` §8.
- **Host self-attestation needs validator fixture coverage.** T03's “headline-without-check” rejection is not enough if `chk-self` can be selected; the invalid fixtures need separate model-check versus host-check cases. Source: `BUILD-PLAN-24H.md` Reply contract/T03, `SPEC-FINAL.md` §Replies, `docs/pivot-review/REVIEW.md` proposed R4–R7 correction.
- **Template conditionals need contract fixture coverage.** The ternary in the classification label is used by the canonical fixture but excluded by the grammar description. T00/T03/T18 need a shared fixture decision before the probe can be deterministic. Source: `BUILD-PLAN-24H.md` Reply contract/T00/T03/T18, `tickets/16-renderer-block-set.md`.
- **Initial package inventory lacked contract/test artifacts.** T03 calls for malicious and invalid fixtures, T00 calls for the regression set, and T18/T20 call for renderer/saved-solver checks, and the supplied package originally contained only `wayfinder/`. Implementation began during this audit; see `../BUILD-STATUS.md` for current code and evidence, rather than treating this initial inventory as current state. Source: `BUILD-PLAN-24H.md:T00/T03/T18/T20`, `HANDOFF-ASTRA.md` §Lanes and files. This is an inventory observation, not a request to create them here.

## Material source observations

The pivot review is companion evidence, not governing authority. It reports that the design board is a prototype and that real provider requests, egress, durable storage, source reattachment, PDF behavior, network evidence, native hosts, screen-reader speech, sandbox production behavior, and unseen-page deployment were not demonstrated. Exact source: `docs/pivot-review/DESIGN-REVIEW.md` §Evidence and implementation boundary. The architecture review likewise says no real model execution or latency benchmark was performed and that the installed MCP handshake was not completed: `docs/pivot-review/ARCHITECTURE-AND-STACK.md:237–252`. These observations explain why the R rows above distinguish a mapped ticket from a passed gate.

