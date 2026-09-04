# Marginalia — spec v0.2 (WebMCP Challenge cut + product horizon)

*Name: **Marginalia** — "the web, annotated with agent-driven, personalized margins." (v0.1 codename Bridge.) Drafted 2026-09-04 during the WebMCP Challenge
(submission deadline 10:00 CEST 2026-09-04). Part I is the product; Part II is the hackathon
cut; Part III is what to reuse from Yash's existing projects; Part IV is the fog beyond.
Governance: this file → `.scratch/bridge/MAP.md` (wayfinder map) → tickets. ETHOS-style rule
for this project lives in §4 and `docs/adr/0001-agent-layer-never-writes-source.md`.*

---

# Part I — The product

## 1. One line

**Marginalia is an agent-driven epistemological margin for the web: it knows what you know, ingests
what you read, and bridges them — connections, meaning, citations, assistance, integrated knowledge.**

The source is the page; the agent lives in the margin; the margin's depth at any point is your
epistemic state at that point. *Every paper is a book for someone who knows less; Marginalia grows
that book in the margins of the paper, for you.*

## 2. The two shores

**Shore A — what exists:** a snapshot of a document. A public-domain paper, a web article, a
PDF, later a private Google Doc or anything a Pocket/Evernote-style library holds. Immutable
once snapshotted. The only text on the page that scrolls.

**Shore B — what you know:** three sources, one slot.
1. **Interview.** The agent asks you what you know about the field the document sits in. Each
   answer becomes a *knowledge entry* (concept, level, evidence, source=interview), proposed
   until you confirm. This is the engine of the demo and the first thing built. Voice
   (ChatGPT Voice) is the same tools with a different mouth — deferred, see §16.
2. **Your archive.** An Obsidian vault, a folder of `.md`, Zotero notes, dropped onto the page.
   Indexed client-side; queried by the agent through `search_notes`. Never leaves the browser.
3. **Agent memory.** Whatever the agent already knows about you (ChatGPT memory, a project
   context). Costs the page nothing: the agent brings it to every call.

**The bridge:** operations the agent performs on the *agent layer* over the document, using
Shore B to decide how. Every operation is visible, attributed, reversible, and never touches
the source text.

## 3. Bridge operations (the feature list, mapped to tools)

| Operation (user-facing) | How the agent does it | Tool |
|---|---|---|
| Expand / ELI5 | Adds an annotation beside a paragraph, in your register, using what it knows you don't know | `annotate(kind: expand\|eli5)` |
| Compactify | Collapses a section to a stub *with a reason* ("you derived this in `notes/x.md`") | `set_section_depth(level, reason)` |
| Visualize this | Draws an SVG figure into the margin of a section | `insert_figure` |
| Teach me | Asks questions in chat; drops a small sandboxed simulation into the margin; records nothing to mastery today | `annotate(kind: question)`, `insert_widget` |
| Fact-check / perspectivize | Does its web research in the agent runtime; writes the result as a caveat or perspective annotation with sources; never a verdict | `annotate(kind: perspective\|caveat)` |
| Auto-highlight | Highlights spans with a reason, personalized from Shore B | `highlight(range, reason)` |
| Vocabulary to your level | Glosses on terms — tooltips in your register. **Never text replacement** (§4) | `annotate(kind: gloss)` |
| Consolidate what I know | Interview → knowledge entries → the document reshapes as you talk | `upsert_knowledge`, then any of the above |

## 4. The layer rule (the ethos, in code)

Three layers, never merged, each with a visibility toggle:

- **Source layer** — the snapshot. Immutable. **No tool writes here. Not one.**
- **Reader layer** — your marks: known / lost / tap-term / highlights you made / confirmations
  of knowledge entries / deletions of agent artifacts. Human-only; the agent reads it.
- **Agent layer** — stubs, annotations, figures, widgets, highlights the agent made. Every
  artifact carries `author: agent`, a `reason`, a timestamp, and a one-click remove.

**Pending-reshape rule (sibling of the layer rule):** the agent never reshapes a section the
reader is currently in. Reshapes on sections not yet reached land as *pending* and apply on
arrival or on click; reshapes on sections already read render as margin notes ("would collapse —
apply?"). The page decides "currently in" from the cursor section. The document never moves
under the reader.

Consequences you accept on purpose: no "rewrite this simpler", no summary that replaces the
text, no vocabulary substitution. A collapsed section is a stub with a reason and one click
back to full text; the document never silently shrinks. This is ADR-0001.

## 5. Honesty rules borrowed from the content-analysis assistant

For `annotate(kind: caveat|perspective)` (fact-check / perspectivize):
- No binary verdicts, no check/cross iconography. Four-way space: supported / refuted /
  conflicting evidence / not enough evidence (AVeriTeC), rendered as calibrated language.
- Sources always attached; "nothing found" is rendered as *no coverage found*, never as
  verification (implied-truth effect).
- Human review (your own notes, your archive) ranks above the agent's assessment in the panel
  order. Fixed order.

## 6. Personalization model — contextual density

There is no global density dial. **Density is a function of the knowledge entries for the concepts
in a section** (plus taste memory, later). A section whose concepts are `derived` renders as a stub;
one whose concepts are `unknown` gets prerequisites and glosses. Per-section override chips
("more here / less here") exist and write a taste observation; a default help level per domain is
seeded by the interview. Expert in one domain and novice in another is the normal case, not an edge
case.

### 6.1 Knowledge entries

Knowledge entry: `{id, concept, level: unknown|heard|used|derived|taught, evidence: string,
source: interview|note|agent-memory|inferred, status: proposed|confirmed|rejected, ts}`.
`inferred` and `agent-memory` entries are always `proposed`; only you confirm. Reshaping
decisions cite entries by id in their `reason`, so every stub and gloss is explainable:
"collapsed because K-12 (derived, from interview)". Levels are deliberately not Feynman's
evidence rungs — this is what you *say* you know, not what you have *shown*; the seam to
Feynman's evidence ledger is Part IV.

## 7. Ingestion

| Source | Today | Later |
|---|---|---|
| Pasted text / Markdown | Yes | — |
| Public-domain PDF | Upload → pdf.js text extraction in-browser | Locator schema for page regions (reuse, §14) |
| Web article | Paste, or `/snapshot?url=` on a Cloudflare Worker with Readability | Reader-mode fidelity, images, paywall honesty |
| Private Google Doc | Export / "publish to web" and paste | Drive OAuth via a gated connector (reuse LocalComms patterns, §14) |
| Library (Pocket-like) | One document at a time; export JSON | Local-first library, see Part IV |

Snapshots are content-addressed (sha256 of the normalized text) so agent-layer artifacts
attach to a hash, not a URL — a re-snapshot of a changed article gets a fresh layer and the old
one is kept.

## 8. Why WebMCP, precisely

- The document, your marks, your archive index, and the agent's artifacts are **page state**
  that you are editing live. An MCP server can't see the click you just made; the page can, and
  `get_reading_state` hands it to the agent on the next call.
- The **division of knowledge** — page has the document and your behaviour, agent has its memory
  of you — only meets in a shared page. Neither side can render the reshaped document alone.
- The **layer rule is enforceable** only where the tools live: a page can simply not register a
  write-to-source tool. A prompt can be argued out of; a missing function cannot.
- Every agent action renders where you are looking. Trust is visible, per Chrome's own WebMCP
  rationale ("tools execute on your webpage visibly").
- **Bring your own agent.** The page is agent-agnostic; ChatGPT today, any WebMCP-capable
  browser agent tomorrow, with the same layer rule applied to all of them.

---

# Part II — Hackathon cut (what ships today)

## 9. Scope

**In:** paste/upload ingestion (text, md, PDF via pdf.js); section split by headings;
three-layer renderer with toggles; reader-layer actions (known / lost / tap-term / expand /
remove artifact / confirm knowledge); knowledge panel; vault drop with lexical `search_notes`;
tools §10; fixture document; export JSON; Netlify deploy; README with the rules-required
sections; video.

**Out (say so in README):** Worker snapshot (stretch), Drive, library, voice, widgets if late
(stretch), any mastery/evidence ledger, any provider egress from the page.

## 10. Tools (WebMCP imperative API)

All tools return `{ok:true, ...}` or `{ok:false, error, detail, next_step}` where `next_step`
is coach-voice text the agent relays. Descriptions ≤ 60 words and carry the operating rule.

1. **`get_reading_state`** (read) → `{doc:{id,title,hash,sections:[{id,heading,depth,
   word_count,reader_marks:{known,lost,tapped_terms[]},agent_artifacts[]}]}, cursor_section,
   knowledge_summary:{confirmed[],proposed[]}, layers:{source,reader,agent}}`. Never returns
   full source text of collapsed sections unless `include_text:true` (keeps calls small).
   *Description:* "Read the document structure, the reader's marks (known/lost/tapped terms),
   where they are, and their confirmed knowledge. Call before any reshaping. Reshape only with
   a reason that cites knowledge entries."
2. **`get_section_text({section_id})`** (read) → source text for one section.
3. **`get_knowledge()`** (read) → all knowledge entries with status.
4. **`upsert_knowledge({concept, level, evidence, source})`** → proposed entry (or updates an
   entry with the same concept, keeping status `proposed` if level changed). Validator: `source`
   ∈ enum; `evidence` ≥ 10 chars. *Description:* "Record what the reader says they know, as a
   proposed entry they confirm. Ask, don't assume; one concept per call."
5. **`search_notes({query, limit=5})`** (read) → `[{path, title, snippet, score}]` from the
   dropped vault; empty array + `detail:"no vault loaded"` if none. *Description:* "Search the
   reader's own notes. Use their words in reasons and annotations; cite the path."
6. **`set_section_depth({section_id, level: hidden|stub|summary|full, reason,
   knowledge_refs[]})`** — validator: `reason` required; `hidden` requires ≥1 `knowledge_refs`
   with status `confirmed` (you can't hide on a guess); stub text is generated *by the page*
   from heading + reason, never by the agent (layer rule). *Description:* "Collapse or expand
   a section with a visible reason. Hiding requires confirmed knowledge. The full text is always
   one click away for the reader."
7. **`annotate({section_id, range?:{start,end}, kind: gloss|expand|eli5|question|caveat|
   perspective|link, text, sources?[]})`** — validator: `caveat|perspective` require
   `sources[]` ≥1 and a `stance` ∈ four-way space (§5); `gloss` requires `range`. Renders in
   the agent layer margin/tooltip, never inline. *Description:* "Add an annotation beside the
   text in the agent layer. Never rewrite the source. Caveats and perspectives need sources
   and a calibrated stance."
8. **`highlight({section_id, range, reason})`** → agent-layer highlight; validator: range
   within section.
9. **`insert_figure({section_id, svg, caption})`** — validator: parses as SVG, no `<script>`,
   no external hrefs; rendered in a sandboxed container. *Description:* "Draw an SVG diagram
   for a section. Schematics over decoration."
10. **`insert_widget({section_id, html, title})`** *(stretch)* — sandboxed iframe:
    `sandbox="allow-scripts"` only, CSP `default-src 'none'; script-src 'unsafe-inline'`,
    no network, no parent access; size-capped; one per section. *Description:* "Insert a small
    self-contained interactive simulation for a mechanism the section describes."

Human-only (UI, no tool): ingest, drop vault, mark known/lost, tap term, expand anything,
confirm/reject knowledge, remove any agent artifact, toggle layers, export.

## 11. Surface

Two columns, dark-first. **Left, wide:** the document; section headings with a depth chip
(full/summary/stub/hidden-stub); stubs show the reason and "expand"; agent artifacts in a
right-hand margin gutter attached to their section (annotations as cards, figures inline in
the gutter, widgets as framed boxes); glosses as dotted underlines with tooltips. **Right,
narrow:** tabs *Knowledge* (entries with confirm/reject), *Vault* (drop zone, file count,
last query), *Activity* (last 10 tool calls, human-readable). **Top bar:** title, layer
toggles (Source / You / Agent), export. Marks: click a paragraph → "I know this" / "Lost me".
Double-click a word → tapped term (goes into reader marks).

Delight moment for the video: on the first `set_section_depth` after an interview answer, the
section folds with a 300ms animation and the reason types in under the stub. That's the
"document reshapes as you talk" beat.

## 12. Fixture and demo
Fixtures and theme: see §21 (Rutherford 1911 / Wikipedia *Ernest Rutherford* / CERN-HEP OSS docs).

Demo (≤ 2:30, audio, no music, no trademarks in title cards):
- 0:00 Thesis sentence over the untouched Rutherford paper, margin empty.
- 0:15 "Interview me about what I know here." Two answers; entries appear proposed; confirm one.
  §1 folds with a reason; §2 gains a `prerequisite` inset on alpha particles. *(the beat)*
- 1:00 Drop the vault. "Connect §3 to my notes." Stub/connection cites a note path; graph tab
  shows the edge.
- 1:25 "Draw the gold-foil geometry." SVG in the margin; KaTeX formula expanded beside it.
- 1:45 Open the Curious Kids article. "Read this as me, not as Joshua." Basics collapse to stubs
  with reasons; "the nucleus" gains a `connection` to Rutherford 1911 §1 and to a vault note;
  one `perspective` with sources. Attribution line visible.
- 2:05 Open the WebMCP docs. "Connect what this page says about tools to the tools you are
  using right now." Connection artifact; graph spans all three documents.
- 2:20 Toggle Agent layer off: untouched sources. Toggle on. Close on the layer rule.

## 13. Build order (see tickets 01–10), gates, and cuts

Gate 1 (45 min): a deployed page registering `get_reading_state` over the fixture, visible in
the ChatGPT desktop in-app browser or the Model Context Tool Inspector. Miss it → submit Amino
Arcade tools instead. Then the reshape loop (04) — **record the video the moment it works** and
re-record only if time remains. Cut order from the bottom: widgets → Worker snapshot →
figures → highlight → vault. Never cut: layers, interview, depth-with-reason, the video.

---

# Part III — Reuse (do not reinvent)

## 14. From FeynmanILE (`github.com/yashgurbani/FeynmanILE`, private) and the sanitized copy
- **Paper-companion skill** (`skills/paper-companion/`): the annotation grammar and LaTeX
  box grammar for derivations → the `expand` annotation kind should accept its output shape so
  companion fragments render in the agent layer unchanged.
- **Locator schema v1** (SPEC-V3 §3a, ticket 01): page-region mapping beyond char offsets →
  Bridge's `range` for PDFs should adopt it rather than invent a second locator.
- **Paper-viz scene schema** (`skills/paper-viz/`): `insert_widget` payloads should be able to
  carry a scene in that schema so Feynman sims and Bridge widgets are one format.
- **ETHOS coach mode + anti-fluency**: the `question` annotation kind and the interview
  phrasing in tool descriptions.
- **Improvement ledger** (`improvement-ledger.md`): observation → proposal → decision → applied
  as append-only JSONL is exactly the right store for "the agent proposed a reshape, the reader
  removed it" — Bridge's taste memory should reuse the schema, not a new one.
- **providers.md consent pattern**: per-provider grants, HITL always, fail-closed — reuse verbatim
  when Bridge gains Drive/Zotero connectors.
- **Evidence rungs (§6a)**: deliberately *not* reused today; the seam is Part IV.

## 15. From Noether IRE (`README.md`, `docs/ARCHITECTURE.md`)
- **Provider descriptors + Private mode egress classification** (`providers.rs`, `netclass.rs`):
  when Bridge gets any server component or BYOK, reuse the local/cloud/unknown classification
  and fail-closed rule.
- **Zotero OAuth + BibTeX interop**: the archive shore's third source; port, don't rewrite.
- **Quorum / Debate council + verdict schema** (`schema/council_verdict.schema.json`): the
  perspectivize operation at product scale is a council run rendered as perspective
  annotations with dissent surfaced — same schema.
- **PDF preview / SyncTeX / CodeMirror**: the desktop reading surface; Bridge's web reader and
  Noether's desktop reader should share the layer model and locator schema.

## 16. From the other projects
- **Content-analysis assistant** (PRODUCT.md, spec v0.2): honesty invariants (§5 above),
  ClaimReview/Community-Notes matching tier before live AI, curated source allowlist — for
  the caveat kind at product scale.
- **LocalComms / CommsOS** (HANDOFF.md, CONTEXT.md): loopback-only gating of sensitive routes,
  redacted digests, readiness evidence — the pattern for a Drive/Gmail connector that reads a
  private doc without leaking it.
- **Scrollwise**: the self-owned, local-first knowledge/interest graph is the same object as
  Shore B; one graph, several surfaces.
- **Waypoint**: the "memory inbox" (proposed → approved) is Bridge's knowledge-entry status
  model; already adopted.
- **Amino Arcade**: Mol* is a proof that a heavy scientific visualizer can live in a static
  page — the model for domain-specific widgets later.

---

# Part IV — Fog (product horizon, not for today)
See `.scratch/bridge/MAP.md` → Not yet specified. Headlines: library and snapshot store;
Drive/Zotero connectors with consent; voice interview; the Feynman seam (knowledge entries vs
evidence rungs; when does "I know this" become "I have shown this"); taste memory; multi-agent
(bring-your-own-agent parity); council-backed perspectivize; PDF locators; sharing a reshaped
layer with another reader without sharing the source.

---

# v0.2 additions (2026-09-04, from brainstorm)

## 17. Artifact registry and source-preference order
`kind` is an open enum; each kind is one renderer file in `src/kinds/`. **Preference order for
every kind: existing web source → reader's archive → generated.** Generated is last, attributed,
removable.

| Kind | Today | Source order | Notes |
|---|---|---|---|
| `gloss`, `expand`, `eli5`, `question`, `caveat`, `perspective` | yes | archive → generated | prose in margin; `expand` accepts Feynman paper-companion LaTeX box grammar |
| `math` (KaTeX render inside any prose kind) | **yes** | — | non-negotiable for physics |
| `connection` | **yes** | archive | passage ↔ note/knowledge entry with relation ∈ {prerequisite, analogy, contradiction, enables, bridge, example}; feeds the connections graph |
| `reference` (role-typed link) | yes | web → archive | role ∈ {read-first, see-also, origin, counterpoint, data}; replaces bare `link` |
| `figure` (SVG) | yes | web (attributed) → generated | sanitizer |
| `prerequisite` (inset chapter before a section) | yes | archive → generated | the "paper becomes a book" kind; depth capped by density |
| `widget` (sim) | stretch | generated | sandboxed |
| `code`, `data` | fog | archive → generated | Pyodide/JS cell; data plot beside a claim |
| `audio` | fog | existing episode link → NotebookLM (Feynman skill + grant) | |
| `video` | fog | YouTube existing; captions-only analysis (Feynman video-curation) | embed by link only |
| `people`, `timeline` | fog | Wikipedia/Wikidata (CC BY-SA attribution in card) | ETHOS "human stories" |

## 18. Connections graph (sidebar, today, small)
Nodes: section concepts (agent-proposed, human-confirmed), archive notes, knowledge entries.
Edges: `connection` artifacts. Rendered with Cytoscape in the right pane, "Connections" tab.
This is Feynman's concept spine grown live from reading; the edge vocabulary is Feynman's.

## 19. Reader affordances added
Batch-confirm ("confirm all these") for agent-drafted knowledge proposals · **Remove all agent
artifacts** for this document · per-section density chips · "copy as question" on a selection
(writes `pending_questions` into reading state for the agent to pick up) · **Export to vault**:
margin + marks + knowledge deltas as Markdown (the reading produces notes; Shore B grows from
Shore A) · activity log shows payloads returned by `search_notes` (privacy made visible).

## 20. Tools added / changed (delta to §10)
- `get_reading_state` adds `pending_questions[]`, `cursor_section`, per-section `density`.
- `annotate` kinds gain `prerequisite` (`{title, text_md, sources[]}`, renders as inset before
  the section; validator: ≤ 600 words, sources required if not generated), `connection`
  (`{target: note_path|knowledge_id, relation, reason}`), `reference` (`{url, role, why}`).
- `set_section_depth` gains `apply: now|pending`; server-side rule forces `pending` when
  `section_id == cursor_section` (pending-reshape rule).
- `search_notes` returns `paths` the agent must cite in `connection`/`reason`.
- New read tool `get_connections()` → graph JSON.

## 21. Fixtures — three levels, verified licenses (decided 06:45)
Theme: **reading across a century** — a 1911 paper, a 2020s essay about it, the 2026 docs of the
tool doing the reading. Connections graph spans all three.
1. **Scientific paper**: Rutherford 1911, *The Scattering of α and β Particles by Matter and the
   Structure of the Atom* — English original; author d. 1937 → PD worldwide; pre-1930 → PD US.
   Shows: interview → contextual density, KaTeX on the scattering formula, `prerequisite` insets,
   SVG gold-foil geometry, widget (stretch).
2. **Article**: The Conversation, *How do atoms form? A physicist explains where the atoms that
   make up everything around come from* (Stephen L. Levy, Binghamton University, Curious Kids,
   June 2025; theconversation.com/…-256172) — **CC BY-ND**, text only (images excluded);
   attribution: "This article is republished from The Conversation under a Creative Commons
   license. Read the original article." + author + link. Opens with Feynman's "all things are
   made of atoms" — the homage. Written for a 7-year-old: the same text yields two margins —
   prerequisites for the child, stubs + deeper connections (nucleus → Rutherford 1911 §1; nucleosynthesis → reader's notes) for the expert. Contextual density in one shot. Marginalia's layer
   rule is ND-compliance by construction (source byte-identical; everything in the margin) — say
   so in the description. Fallbacks: Quanta (CC BY-NC-ND, republish terms), Wikipedia (CC BY-SA).
   Shows: perspectives with sources, `reference` roles, segue from paper to person/story.
3. **Documentation**: **Chrome's WebMCP documentation** (developer.chrome.com, CC BY 4.0 per page
   footer) — the "hackathon reads itself" segment, ~30 s. Shows: internal/company-docs use case,
   `connection` from the docs to the tool registered on this very page, a wink to the jury.
   Geant4 docs verified usable under the Geant4 Software License with notice — kept as an
   alternative if the scattering theme is preferred for the docs level.
Rejected and why: Einstein 1905 (English only via 1926 Cowper translation — US PD, EU status
unverifiable); Feynman Lectures online (© Caltech/Gottlieb/Pfeiffer, read-online only, actively
DMCA'd); Aeon Essays (paid syndication only); The Marginalian (all rights reserved — homage by
name only); Vaswani et al. (arXiv non-exclusive license). Boundary reminder: repo fixtures must be
licensed for redistribution; the live URL lets judges paste anything (their act); the video keeps
licensed content on screen except for a ≤5 s "paste any URL" generality shot, never music/logos.
Attribution lines render on screen and live in `fixtures/ATTRIBUTION.md`.

## 22. Fog additions (→ MAP.md)
W7 Web journal: reading entries (margin + marks + knowledge deltas) accumulate; cross-document
connections; Feynman seam where an entry becomes evidence after a checkpoint; sharing a margin
without the source (Scrollwise self-owned graph). W8 Modalities: audio/video/people/timeline/code
/data kinds with the source-preference order and Feynman's provider grants.
