# Marginalia — Product Spec v1.1 (derived requirements; SPEC-FINAL.md governs)

17 September 2026 · revised after Astra's review. Numbered requirements R1–R30 with the corrections applied; read with SPEC-FINAL's vocabulary (artifact → reply, ledger → assumptions + egress record, sidebar → margin, chip → suggestion). Where this file and SPEC-FINAL differ, SPEC-FINAL wins.

## 1. One sentence

Select anything you are reading and explore it beside the text, in the representation that helps most, with the work kept as a thread you can resume; the source is never rewritten, the reader's own Codex authors the help and the browser runs it, and everything the agent makes says where it came from.

## 2. Glossary (use these words in code, tickets and UI)

- **Source layer**: the page or PDF as captured. Immutable evidence: URL, capture time, extracted text, normalization version, content hash, optional snapshot. The reflowed reader view is a *view* of it, never claimed byte-identical.
- **Reader layer**: human marks. Highlights, notes, keep, park, thread-state changes. The agent reads these; it never writes them.
- **Agent layer**: artifacts the agent placed, each anchored, attributed, removable.
- **Selection**: a span the reader chose, captured as W3C selectors (exact, prefix, suffix, text position; PDF page and quad later).
- **Anchor state**: exact, moved, unsure, lost. Never silently attached to similar text; ambiguity shows candidates or leaves the note unplaced.
- **Intent**: keep or ask. One gesture, two chips at the top of the card.
- **Transform**: a named operation on a selection producing an artifact. Implemented as a skill folder.
- **Chip**: a suggested transform with a cost label. Two or three, stable positions, plus More and free text.
- **Tier**: instant (no model), fast (small model, read-only), deep (execution).
- **Reply (reply_version)**: the validated, immutable result of a transform, per `marginalia.reply.v1`: intent, typed blocks (data, never code), source bindings, assumptions, checks (host vs model authority), provenance per part, static fallback. Rendered by packaged code.
- **Ledger**: the artifact's assumptions (editable; edit re-runs) and the host-recorded egress record (what was sent, where, which model, tools, checks).
- **Job / attempt**: a persisted unit of work with idempotency key and packet digest: queued, running, validating, succeeded | failed | cancelled | timed_out | outcome_unknown; cancel_requested as control state. Retry is a new attempt.
- **Thread**: anchor + source version + notes + reply versions + assumptions + egress events. States: open, parked, done, archived; removal is a `deleted_at` tombstone with undo.
- **Journey**: threads grouped around a question (alpha).
- **Context packet**: the bounded context sent to a provider, previewed as sent, hashed and recorded before send.
- **Daemon**: the local process that owns the store, jobs, router, Codex sessions, validation and ledger.
- **Margin**: the extension's side panel (or floating panel) on supported pages; the product's main surface.

## 3. Surfaces

| Surface | Role | Window |
|---|---|---|
| Extension (WXT, MV3, Node 24 toolchain) | content script (selection, selectors, page signals, namespaced shadow host, Custom Highlight marks, optional WebMCP registration), margin host (side panel / floating panel), disposable service worker (reconnecting daemon client) | stages 1–3 |
| Daemon (Node 24 LTS/TS) | loopback WS/HTTP with Host/Origin checks, challenge→token pairing; store (SQLite WAL, FTS5); jobs/attempts; router; `JobRunner` adapters (app-server primary, mcp-server second); validator; egress record | stages 1–3 |
| Localhost webapp | thread list, open thread, settings (models per tier, grants, exclusions, vocabulary, export) | stage 4 |
| PDF viewer page (PaperCraft overlay) | papers | stage 5 |
| Hosted webapp + API adapter | reading without a local process | roadmap |

## 4. Core interaction requirements

R1. Selecting text on a supported page opens the card in the same gesture, anchored to the span, without leaving the page. Source content and layout are preserved: the host adds a namespaced shadow host and Custom Highlight marks; it never edits the page's own nodes. Selecting sends nothing.
R2. Within 100 ms (measured locally) the card shows Keep / Ask; suggestions come from the instant tier; no spinner in place of suggestions. No cloud latency is promised.
R3. A quoted definition from the document shows at once with no send. A fast gloss (Luna, read-only) arrives without a click only under an existing site grant with automatic definitions enabled; it can be read and dismissed as a complete interaction.
R4. Choosing a deep suggestion persists a job before execution; the card shows Working, a visibly provisional first frame, Ready; the reader keeps reading; the card lives in a dock when scrolled away and pulses once on completion. Only complete, validated versions are published; on failure the last good partial is kept with its incomplete status.
R5. At most one clarifying question before a build; otherwise a stated default in the assumptions. Mid-build questions go into the card as pending items with a default taken.
R6. The reply renders as typed blocks through packaged code; no generated markup or script executes in v1. Interaction takes the cheapest sufficient path: local kernel; precomputed samples inside their recorded envelope; re-running the saved solver in the daemon with no model turn; and only then a new model call, shown as an explicit action. Assumptions are visible and editable; an edit creates a new reply version (and a model call only if the model itself changed), never overwriting a kept one. Unsupported computation is stated, never replaced by a weaker substitute presented as equivalent.
R7. Every reply part shows its provenance and relation (quoted / computed / analogy); host checks and model self-checks have different authority and appearance; a failed check is a visible plain-language failure; unvalidated replies never render; a headline claim without a backing host check is withheld.
R8. The reader can return to the anchor from any reply; the anchor state is shown if not exact; reattachment never guesses through ambiguity — it shows candidates or leaves the item unplaced.
R9. Threads, notes and highlights persist before any reply completes; reload reattaches by selector with replies and assumptions; thread state is changeable from the card.
R10. Keep (highlight) and park are one keystroke away regardless of ranking.
R11. Exclusions (sites, credential fields, browser pages, private-window policy) are enforced before extraction and again in the daemon; the card says when a page is excluded and never offers an action it would silently refuse.
R12. When the daemon is absent, reading, cached threads and local notes remain usable per the documented cache capability, and the margin says so. WebMCP is an experimental extra available only where the browser and assistant support it; nothing core depends on it.
R14. The reader can write a note in the margin at any time, attached to an explicit passage or chosen section, frozen when writing begins and changeable afterwards; notes are reader-layer marks, exportable, launch scope, and feed vocabulary memory. A "?" ending offers Ask and never sends by itself; Ask on a note opens suggestions with the note as stated context; the reply records and quotes the note version it answers.
R15. On page load for long-form pages on non-excluded domains, the margin shows page identity from page meta (local). Assumed terms, Semantic Scholar lookups and any model call are external processing and run only under the site grant, cached by content hash. Nothing is glossed inline without a selection.
R16. The margin is a scroll-synced column in anchor order: header, body (notes, highlights, replies, section markers), footer. Item size follows distance from the reading position (expanded, compact, collapsed) by size and excerpt, not ink; the rail is the same column collapsed. The reading position follows the page while idle and holds while any item has an active draft, control or keyboard focus, with a "follow reading" action to release. Suggestion sets are created per trigger and never reordered once rendered.
R17. Pairing: the daemon shows a short-lived, rate-limited six-digit challenge on first run; the extension exchanges it once for a ≥256-bit random token scoped to this extension; revoke and re-pair from settings. Provider credentials never enter the browser.
R18. First send on a new site shows the exact outgoing context, the recipient and the grant scope, with this time / always on this site / never on this site; denial persists and is editable in settings; an open-session (web) request is a separate, narrower grant.
R19. Math selection captures TeX from `annotation` or `alt` when present (MathJax, KaTeX, arXiv HTML); otherwise the rendered text with a `math: rendered` flag. Tested on duplicate equations, multiline selections and inline widgets.
R20. Cross-paragraph and code-block selections are allowed; block boundaries and code language are kept in the packet; code blocks are block type procedure; selections crossing blocks are tested.
R21. A reply has a follow-up field, separate from notes, that continues the persisted provider thread where supported, referencing a stable reply version; the thread forks when provider or permissions change.
R22. Multiple replies at one anchor are siblings (distinct requests) or versions (related outputs); newest expanded, others compact; a kept version is never overwritten.
R23. Builds show elapsed time after 30 s; cancel is always visible and fences late output; hard timeout at ten minutes with the partial kept; timeout, disconnect, failure and unknown outcome are distinct states.
R24. Source identity (locator candidates), source version (text hash) and per-tab attachment are separate records. SPA navigation and significant DOM mutation trigger reattachment; two tabs on the same capture share work with a visible "updated elsewhere" note; two different page versions require explicit reconciliation; conflicting edits use revision checks.
R25. When the document itself defines a selected term, the quoted definition shows instantly with "from this page" before any model call; uncertain extraction abstains rather than paraphrases.
R26. Rendered instances have stable, prefixed IDs so focus survives re-render; focus handoff between page and margin is explicit; completion is announced via a live region without stealing focus; every state is keyboard-reachable.
R27. The rail shows a sending indicator (distinct from working) while data leaves the machine; it opens the egress record (grant, recipient, context hashes, outcome, fetched resources or "incomplete").
R28. Remove reply, remove all on page, and thread-state changes are reversible: persisted tombstones, Undo that pauses on focus, removed work visible in thread history.
R29. The page header is metadata (local) plus assumed terms (under grant); contested-claim content requires an open session and the evidence gate; the header must not imply it.
R30. Below 900 px the rail opens a sheet showing one passage and its reply with a quoted breadcrumb; nothing becomes unreachable. Notes belong to the thread at their anchor and to the page's note list, and export with the thread.
R13. Cancellation, provider failure, malformed output, timeout, disconnect and reload each have a visible outcome; an unknown provider outcome is never retried automatically — retry is an explicit new attempt.

## 5. Transforms in v1 and their contracts

| Transform | Tier | Provider | Output kind | Fidelity contract | Checks (host) |
|---|---|---|---|---|---|
| define | instant → fast | document quote first (no send); then Codex, read-only, Luna under grant | blocks: text | contextual meaning in this passage; level from stated context; at most 60 words | cited span exists; quoted definition matches source text |
| simulate | deep | Codex, workspace-write, Astra, network off | blocks: text, equation, model, plot, derived, classification, table | equations, parameters with units and ranges, assumptions, source bindings per variable with relation (quoted / interpreted / analogy), limitations, a visible illustration statement unless the model is the source's own; the headline classification carries its own host check | reference cases the skill declares (y(0)=y0; zero forcing; threshold equality); closed-form agreement where one exists; bounds on grid, steps, horizon; no code in blocks |
| keep | instant | none | reader mark | — | — |
| park | instant | none | thread state | — | — |
Same infrastructure adds: instantiate, derive (deep, read-only), diagram (blocks: diagram), evidence (open session; blocks: citations), explore (open session; blocks: shelf), connect (library), reflect. Evidence and explore ship when the stage-5a gate passes.

## 6. Suggestion (v1)

```
eligible = transforms whose skill applies_to matches block and page type, and whose tools are granted
score(t) = relevance[block][t] + page_weight[page][t] + stated_preference(t) + prior_artifact_link(t) - repetition_penalty(t)
show     = top 3 by score, positions frozen once rendered; More; free text
```
Block types v1: term, equation, mechanism, claim, procedure, page. Page types v1: paper (arXiv/HTML), docs, article/news, social, reference, unknown.
Ambient help is off by default. Difficulty features are logged as events; they do not rank and make no comprehension claim. Exposure without choice is recorded explicitly. Exposure log schema: context hash, eligible set, chips with positions and labels, choice or no-choice, latency, policy version, outcome, thread state.

## 7. Context packet

selection (≤ 4,000 chars; truncation is deterministic and flagged, never silent) · ±1 section context (≤ 12,000) · page meta (URL, title, type, capture time, source version hash) · stated context · vocabulary hits and library matches only within the grant's scope · transform instructions and reply schema · omissions list. The preview shows the actual bounded payload. Hashed and written to the egress record with recipient and grant before send.

## 8. Codex session policy

`JobRunner` {start, resume, cancel, inspect}. Primary adapter: `codex app-server` over stdio (thread/start, thread/resume, turn/interrupt, event stream). Second adapter: `codex mcp-server` (`codex`, `codex-reply`, `codex/event`; cancel = abandon + tombstone). Pinned Codex version checked at pairing; both adapters pass the integration test (start, interrupt, resume, recover after daemon restart) before either is trusted. Dedicated Codex config: no inherited MCP servers, skills or env; `cwd` = job workspace with `packet.json`, `SKILL.md`, `reply.schema.json`; `sandbox: workspace-write`; network per session policy (closed: off, verified; open: brokered); `approval-policy: never`; `model` from tier; timeout 10 minutes; results by file (`reply.partial.json` then `reply.json`, atomic rename, size/depth limits, no path escape); follow-ups resume the persisted provider thread; unrelated jobs start fresh threads. Fast tier: same path with `sandbox: read-only`. Startup check: Codex login present, version pinned, sandbox available; otherwise the margin says so and reading continues.

## 9. Reply contract v1

`marginalia.reply.v1`; see BUILD-PLAN-24H.md for the JSON. Intent and blocks are separate axes. Validation order: schema → numeric/resource bounds → selector existence → kind fields → host checks → renderer restrictions → commit as an immutable reply version. Provenance per part with relation. `status: partial` renders visibly provisional; a headline claim renders only with its backing host check.

## 10. Store (SQLite)

WAL; all writes through the daemon; migrations from the first version; large blobs outside the database with checksums. Tables: sources(id, locators, title, pageType) · source_versions(id, sourceId, capturedAt, text, extractionVersion, hash, meta, snapshotRef) immutable · anchors(id, sourceVersionId, exact, prefix, suffix, start, end, blockHint, mathMeta) immutable · attachments(id, anchorId, targetVersionId, tabCapture, state, candidateRange) · threads(id, anchorId, state, createdAt, updatedAt, deletedAt) · notes(id, threadId, text, revision, createdAt, deletedAt) · highlights(id, threadId, createdAt, deletedAt) · reply_versions(id, threadId, intent, parentId, json, hash, validation, supersedes, createdAt, deletedAt) immutable once succeeded · jobs(id, threadId, idempotencyKey, packetDigest, provider, model, providerThreadId, policyVersion, state, outcome, lastSequence, createdAt) · attempts(id, jobId, n, state, startedAt, endedAt) · grants(id, site, scope, recipient, createdAt, revokedAt) · egress_events(id, jobId, grantId, recipient, contextHashes, dispatchedAt, outcome, fetched, complete) · events(seq, kind, payloadRef) outbox for replay · vocabulary(term, origin, status, firstSeen, lastSeen) · settings(key, value). FTS5 over notes, replies, source text. Export: JSON per thread; Markdown next.

## 11. Security

Loopback only with Host/Origin validation and restrictive CORS; challenge→random token pairing with revoke; no provider credential in the browser (the extension holds only its pairing token); dedicated Codex config with audited inherited capabilities; closed sessions network-off (tested), open sessions through an observed broker that refuses private addresses, redirects to them, unsupported schemes and oversized bodies; replies are data rendered by a bounded content renderer (no generated code executes in v1; the grammar never describes interface behaviour); saved solvers re-run only inside the isolated environment with the job's grants and limits; page text, fetched pages and skill instructions are untrusted data and cannot change grants or policy; skills pinned and reviewed; no raw page text or tokens in logs; exports inert and previewed; egress record host-written before dispatch and after outcome.

## 12. WebMCP surface v2

Experimental adapter with an explicit capability check; nothing core depends on it. Kept: get_reading_state, get_section_text, get_context, upsert_knowledge (proposal only), search_notes, annotate, highlight. Added: insert_reply (accepts `marginalia.reply.v1`, validated the same way; typed blocks only). Changed: set_section_depth becomes a reader-invoked fold; no agent-decided hiding.

## 13. Acceptance (the eight gates, restated)

1. Fresh-machine session completes install → pair → select → suggestions → definition → simulate → live reply → assumptions and record → return, with no hidden manual repair.
2. A second, unseen passage succeeds; if only curated passages work, the copy says so.
3. Define ends in a glance without any further step; simulate moves a parameter and updates a computed result with checks passing and the classification agreeing with the closed form, including divergence beyond the plotted horizon.
4. Reload and daemon restart reattach the thread with replies and assumptions, no inference; a changed page shows moved/unsure honestly.
5. Unsupported input yields an honest limitation.
6. Cancel, provider failure, malformed output and reload are exercised.
7. No provider credential or undeclared destination in the client or reply; the egress record shows what left the machine, to whom, under which grant.
8. Video, listing and README describe the same scope; latency is not edited into a false instant claim.

## 14. Out of this spec (in scope for the product)

See FEATURE-INVENTORY.md tiers A–D.
