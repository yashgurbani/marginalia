# MAP — Marginalia v1 (daemon + extension + webapp)

label: wayfinder:map
tracker: local markdown (tickets/ directory; blocking recorded in each ticket's blocked_by)

## Destination

Updated 17 Sep 07:00 CEST after Astra's review. Marginalia v1 built and shipped through gated stages 0–5 (BUILD-PLAN-24H.md): contract, durable reader, real definition, interactive reply, install and release, evidenced expansion; then the alpha (A), home (B), providers and skills (C). The immediate deliverable is a buildable spec for Marginalia v1: a local daemon (store, jobs, provider router, Codex session manager), a browser extension whose floating sidebar is the live margin on any page and also registers the WebMCP tool surface, and a localhost webapp for library, read-later, journeys and settings; first inference path is the reader's own Codex through a JobRunner (app-server primary, mcp-server second), with replies embedded live in the margin as typed blocks the browser runs. The map is done when /to-spec can collapse these decisions into tracer-bullet tickets for Astra to implement.

## Notes

Domain: interactive reading companion; see the whitepaper (Claude Doc) for ethos, transforms, architecture and the review record. Skills every session consults: /grilling, /domain-modeling, /prototype for UI questions, /research for external facts. Standing preferences: source never rewritten; artifacts with provenance per part; memory tunes how, never whether; reader picks models per tier; local first; no summarize as a default chip.

## Decisions so far

- Product shape: daemon + extension (live sidebar margin, main surface) + webapp (library and settings); one store, one artifact contract. (Conversation, 17 Sep)
- Margin host: Chrome side panel where available (user gesture), injected floating panel elsewhere; identical content. Namespaced shadow host and Custom Highlight marks; source content never rewritten. ([04-sidebar-rendering](tickets/04-sidebar-rendering.md))
- Replies are data, not code: `marginalia.reply.v1` with intent and typed blocks; packaged renderer with a local kernel (expressions, ODE integrators, maps, KaTeX, diagram layout); interaction at zero inference; precomputed grids for heavy solvers; recompute only as an explicit action; no generated HTML/JS ever executes (MV3 store policy and security). A headline claim must carry its own host check. Four execution paths (kernel, samples in envelope, re-run saved solver without a model turn, ask again); governing rule: every transform stays in scope, the kernel is the default path not the ceiling, no reduced substitute presented as equivalent. Store policy stated precisely (Chrome exempts isolated sandboxes, warns against command interpreters; Firefox separate): the grammar stays a content grammar; a sandboxed surface for runtime-invented interfaces is a later labelled capability. (Astra coverage follow-up, accepted 17 Sep) ([02-artifact-contract-v1](tickets/02-artifact-contract-v1.md), [16-renderer-block-set](tickets/16-renderer-block-set.md); Astra review accepted 17 Sep)
- Fixture corrected: y' = y² − γy + f with analytic classification (from rest, diverges iff f > γ²/4; T = [π/2 − atan((y0−γ/2)/√Δ)]/√Δ), damping not viscosity, visible illustration statement, no causal claim about the proof; kinematic vortex field as a second illustration. (Astra's science probe, 17 Sep)
- Runtime: Node 24 LTS. Codex: JobRunner {start, resume, cancel, inspect}; app-server primary, mcp-server second; pinned version; both pass one integration test. ([03-daemon-stack](tickets/03-daemon-stack.md))
- Four privacy boundaries with separate promises and grants: storage, cloud inference, tool network, external retrieval; nothing automatic before the site grant; observed fetch broker or an "incomplete" record. ([09-codex-session-policy](tickets/09-codex-session-policy.md))
- Canonical vocabulary and store entities frozen in SPEC-FINAL.md and SPEC.md §10 (thread, note, highlight, reply_version, tombstones, attachment states, job/attempt states). ([06-store-schema-v1](tickets/06-store-schema-v1.md))
- Release by capability table with gates; evidence and explore ship if the stage-5a gate passes on launch day, otherwise listed as upcoming with an honest state; alpha distribution stated. (17 Sep)
- Pairing: challenge → ≥256-bit token; provider credentials never in the browser. ([15-daemon-install-and-pairing](tickets/15-daemon-install-and-pairing.md))
- Inference: the reader's own Codex on their ChatGPT plan first; Luna selectable for the fast tier; local models, claude CLI and a hosted API adapter later. Two session policies, closed and open. ([09-codex-session-policy](tickets/09-codex-session-policy.md))
- Windows sandbox confirmed working on the maker's machine. (17 Sep)
- Execution model: Codex authors the model in its sandbox (workspace-write; network per session policy) and returns reply.partial.json / reply.json; the browser runs the model. ([02-artifact-contract-v1](tickets/02-artifact-contract-v1.md))
- Build transform set: define, simulate (with plot/diagram/instantiate on the same renderer), keep, park, unsure; evidence and explore behind the stage-5a gate. ([07-alpha-transform-set](tickets/07-alpha-transform-set.md))
- Held: the coloured page map in the rail (Yash, 17 Sep). Reading position follows while idle and holds during interaction. The margin is a scroll-synced column in anchor order: header (what this is, assumes, you were here), body (notes and highlights first, agent replies indented beneath, section markers, write-here line; focus-plus-context sizing), footer (library, tools, page actions; think-with-it and go-further at the end). The rail is the column collapsed. (SPEC-FINAL.md, DESIGN-BRIEF-FINAL.md)
- Notes are first-class and senior to replies, attached to an explicit passage frozen when writing starts; "?" offers Ask and never sends by itself; notes feed vocabulary memory. (SPEC.md R14)
- UI vocabulary is human: note, highlight, reply, thread, ask, keep, park; states open/parked/done/archived; anchor states exact/moved/unsure/lost. Artifact/provenance/ledger/transform/tier/job never appear on screen. (SPEC-FINAL.md)
- Suggestion ranking: additive heuristic with a hard eligibility filter; difficulty signals drive ambient exposure, not ranking; no reorder once rendered; logit with outside option later; cost is a label. (Codex review, accepted 17 Sep)
- Anchoring: W3C selectors with exact/moved/unsure/lost states; original source preserved separately from the reflowed view; no DOM reversion. (Accepted 17 Sep)
- Provenance per part and claim; host-recorded egress record; persisted explanations never count as independent evidence. On screen: a glyph line and "assumptions (n)". (Accepted 17 Sep)
- Personalization: vocabulary memory from the reader's writing, onboarding field priors and lookups (entries show origin, are deletable); stated context; no got-it loop; no inferred comprehension model and no comprehension claims from difficulty signals; memory tunes how, never whether. (16–17 Sep)
- Demo fixtures: OpenAI "On the Navier–Stokes Millennium Prize Problem" (article), Wikipedia NS existence-and-smoothness (reference), the Lean repo README (docs), the paper PDF later. (17 Sep)
- Contest entry = the real slice (daemon + extension), with the Sep 4 web reader + WebMCP as the assisted path and the fallback. ([01-contest-entry-tonight](tickets/01-contest-entry-tonight.md))
- WebMCP surface v2 and repo/licence decided. ([13-webmcp-mirror-v2](tickets/13-webmcp-mirror-v2.md), [14-repo-and-licence](tickets/14-repo-and-licence.md))
- Prior art: build on PaperCraft's overlay model for PDFs, Hypothesis-style anchoring, ScholarPhi entity types as block types; cite CiteSee, Scim, Threddy, Qlarify. (17 Sep)

## Open tickets

- [12-margin-design](tickets/12-margin-design.md) — pass 2 of the Claude Design session (HITL, now); acceptance criteria in DESIGN-BRIEF-FINAL.md
- [16-renderer-block-set](tickets/16-renderer-block-set.md) — resolve during T18

## Way is clear

Every remaining ticket resolves inside a build ticket. Hand off to BUILD-PLAN-24H.md (stage-gated; the /to-spec collapse is SPEC-FINAL.md + SPEC.md). Astra's review is the companion record: accepted the contract freeze, the typed-block renderer, app-server + Node 24, four consent boundaries, the fixture correction, the design P1/P2 list, the narrowed research and competitor claims, and the stage gates; rejected the hour-based framing, any text-only retreat, dropping the mcp-server adapter, and reopening the page map. The map stays open for the alpha and home stages.

## Not yet specified

- Evidence/browsing: the observed fetch broker's implementation and how source dates and captured versions are shown per claim.
- Library search and cited RAG over collections: index choice and provenance for answers over the reader's own store.
- Journeys auto-grouping and the journal's synthesis cadence.
- Skills runtime beyond instructions-only skills: sidecar manifest, permission grants, output validation.
- Voice and image capability routing.
- Alpha cohort recruitment and the paid-continuation test.

## Scope note

Everything in FEATURE-INVENTORY.md is in scope for the product; this map orders it. Stages 0–5 build the S tier (BUILD-PLAN-24H.md). A, B, C tiers follow in order. Only two things are ruled out of this map: the Noether IRE merge (its own effort) and institutional or publisher offerings (a business effort).

## Out of scope (this map)

- Noether IRE merge.
- Institutional or publisher offerings.
