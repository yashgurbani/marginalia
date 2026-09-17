# Feature inventory — everything from the chat, nothing dropped

Status: S = launch spine (build stages 0–5) · A = alpha (weeks) · B = home · C = providers/skills · D = research/later. Evidence and explore are S behind the stage-5a gate.
Every line here is in scope. The letter is priority, not a verdict.

## Core interaction (live margin)
- S  Extension sidebar as a floating margin on any page; selection opens a card in the same gesture
- S  Two intents on one gesture: keep (highlight) / ask (help)
- S  Two or three chips with stable positions, cost labels, More, free text
- S  Instant tier (no model): page type, structure, difficulty features, chips before any model returns
- S  Fast tier gloss (Luna via Codex read-only) on selection
- S  Deep tier artifact (Astra via Codex with execution), embedded live in the margin
- S  Build states: plan, first partial, done; progressive artifact files; dock when scrolled away
- S  Assumptions ledger on every artifact, editable, edit re-runs
- S  Provenance per part (document / archive / fetched / generated)
- S  One clarifying question before building at most; illustrative examples proceed with marked assumptions
- A  Reflect chips (brainstorm, integrate, critique, ask me one question) and end-of-article suggestions
- A  Explore intent (more to read, lecture video with timestamp, contrasting take) landing as parked items
- A  Voice (gpt-live) for hear-it; image (gpt-image) for illustrative visuals; capability-gated
- A  Situate: context lookup, what the citation says, currency check, claim vs evidence (needs a network-on Codex session)
- A  Connect: analogy from the reader's field, link to notes and earlier threads, prerequisite chain
- A  Derive step by step with a question per step; instantiate with concrete numbers
- A  Margin rules: collapsed by default, density strip, surprisal-gated underline (high surprisal and not in vocabulary), one branch open at a time
- B  Ambient opt-in policy per page type; whitelist mode

## Suggestion engine
- S  Additive heuristic score; hard filter only for capability and permission
- S  Exposure log from day one (context, eligible set, chips with positions, choice or no choice, latency, policy version, outcome)
- A  Difficulty signals as observable events feeding ambient exposure and transform-specific relevance (surprisal, term novelty, notation density, scroll-back, re-selection, dwell z-score)
- A  Situation-model shift features (time, space, causation, entity) as relevance features
- D  Conditional-logit choice model with outside option; per-transform coefficients; exploration only with a defined reward

## Personalization and memory of you
- S  Stated context field ("assume undergrad physics", "relate to my note")
- A  Onboarding: fields and level per field (a vocabulary prior), representation preference, languages, notes/Zotero link, exclusions; five minutes, skippable
- A  Vocabulary memory from the reader's own writing, field priors, lookups; visible and editable; no got-it loop
- A  Posture control (flow vs learning) as transform-specific bias; never suppression
- D  Any inferred comprehension model, only as a visible, editable, tested object

## Memory of work and library
- S  Threads: span, selectors, source version, artifacts, ledger, unresolved; auto-saved; resume after reload
- S  Thread states: active, parked, resolved-by-reader, archived, removed
- A  Highlights and notes as the reader layer (W3C annotation format)
- A  Save and bookmark any page or PDF with snapshot and hash; reading queue with resume
- A  Related-in-library card on page load (CiteSee-style)
- B  Journeys (proposed groupings, accepted or renamed), topics and tags
- B  Search and cited answers over collections (RAG with passage links; abstains when it cannot cite)
- B  Journal: periodic synthesis written for the reader
- B  Export (Markdown, JSON, BibTeX); Obsidian and Zotero sync; import round trip
- B  Backlog navigability: parked work found, abandoned work visible

## Surfaces
- S  Extension (WXT, Manifest V3): content script, sidebar host, service worker with reconnecting daemon client
- S  Daemon (localhost, token-bound): store, jobs, router, Codex session manager, validator, ledger
- S  Localhost webapp, minimal: thread list, settings (models per tier, grants, exclusions, vocabulary, export)  [stage 4]
- A  WebMCP mirror on any page (port tools.js; add insert_artifact; retire agent-decided folding)
- B  Extension PDF viewer on PaperCraft's overlay model; arXiv HTML path
- B  Webapp as home: library, queue, journeys, journal
- C  Hosted webapp with API adapter and server-side store (separate privacy contract)
- C  Daemon as outward MCP server so ChatGPT / Claude Desktop can query the library

## Providers and transports
- S  Codex through codex mcp-server on the reader's ChatGPT plan; model per tier (Luna fast, Astra deep)
- S  Sandbox: workspace-write, network off for artifact jobs; availability check at startup; degraded mode
- A  Network-on Codex sessions for browsing transforms, with ledger entries
- C  Ollama local models; official claude CLI; hosted API adapter; app-server upgrade path if streaming needed
- C  Capability interface per provider (text, structured output, tools, execution, image, speech, browsing, local)

## Skills
- S  Transforms as skill folders (SKILL.md + Marginalia sidecar) loaded by the daemon; instructions-only
- A  Four checks: applicability, host capability, permission, output validation; pinned versions
- C  Executable skills behind their own gate; sandbox contract; quorum-review, fact-check, last30days, reproduce-figure as skills
- C  Shared threads show static artifacts; never auto-install skills

## Anchors, source, provenance, security
- S  W3C selectors (exact, prefix, suffix, position) with states exact / relocated / ambiguous / orphaned
- S  Source evidence preserved (URL, capture time, extracted text, normalization version, hash); reflowed view labelled
- S  Replies are typed blocks rendered by packaged code; no generated code executes; local kernel for interaction; precomputed grids; explicit recompute
- S  Host-recorded egress ledger before anything leaves; domain exclusions enforced in the extension
- A  Two mechanical checks: cited span exists; fetched page contains the attributed text
- A  Fidelity contracts per transform kind
- A  Evidence-laundering rule: persisted explanations keep provenance, never become corroboration; corrections mark derivatives
- B  Share a thread: margin and hash only, re-anchors to a source the recipient fetches

## Privacy and legal
- S  Local-first; sync off; nothing in the browser holds credentials
- A  Per-provider settings pane with retention and training terms; per-day spend
- A  TDM opt-outs honoured; private-copy framing; ND argument stated as argument, not guarantee (counsel before hosting)

## Evaluation and business
- A  Alpha cohort of 12 to 15 technical readers; compare against their existing assistant workflow; metrics: usefulness, correspondence, fewer steps, resumption, thread states
- A  Bounded paid continuation offered at a fixed checkpoint
- D  Learning-outcome study with delayed retention, separately designed
- C  Open-source core; hosted convenience tier; institutional and publisher conversations; Noether IRE convergence

## Contest
- S  Launch copy per the packet; eight gates; video of one passage becoming one live artifact in the sidebar; honest scope; shoutouts; no upvote asks
