# HANDOFF — Bridge, hackathon build (read this first)

Now: ~05:40 CEST 2026-09-04. Deadline: 10:00 CEST (01:00 PDT). Submit target: 09:30. Rough video
uploaded by 08:00. Nothing is cut; everything is scheduled, and the constraint is Yash's
attention (integration + real-browser verification + video), not agent throughput.

Read in order: `SPEC.md` → `docs/adr/0001` → `CONTEXT.md` → your ticket in
`.scratch/bridge/issues/`. Use the glossary vocabulary in code and commits.

## 0. Prefactor first (Fable, 15 min, blocks everything) — ticket 00

One repo, ES modules, no bundler. **One file per lane; lanes never edit each other's files.**
`index.html` and `src/state.js` are owned by the integrator (Fable) only.

```
index.html            integrator only — mounts modules, loads CDN (Cytoscape not needed; pdf.js only)
src/state.js          integrator — the single source of truth (frozen source layer, reader marks,
                      knowledge, artifacts, depth) + pub/sub `subscribe(fn)`; exported API below
src/tools.js          lane T — WebMCP registration; every tool validates then calls state
src/render.js         lane R — three-layer renderer, gutter, stubs, toggles, marks UI
src/ingest.js         lane I — paste/md/pdf.js → sections; content hash
src/vault.js          lane V — folder drop, lexical index, search
src/figure.js         lane F — SVG sanitizer + render
src/widget.js         lane W — sandboxed iframe (stretch)
src/knowledge.js      lane K — knowledge panel UI (confirm/reject)
worker/               lane S — Cloudflare Worker snapshot (stretch, separate deploy)
fixtures/             lane X — fixture text + PD verification
tests/                every lane adds a browser-console test file for its validators
```

**state.js contract (write this exact API first; other lanes code against it):**
```js
export const state = { doc, cursorSection, marks, knowledge, artifacts, depth, layers, activity }
export function loadDoc(sections, meta)            // sets frozen source; Object.freeze deep
export function getReadingState({include_text=false})
export function getSectionText(id)
export function mark(sectionId, kind /*known|lost*/, on)
export function tapTerm(sectionId, term)
export function upsertKnowledge({concept, level, evidence, source})  // returns entry; status 'proposed'
export function setKnowledgeStatus(id, status)
export function setDepth(sectionId, level, reason, knowledgeRefs)     // enforces hidden⇒confirmed refs
export function addArtifact(sectionId, artifact /*{kind, range?, text?, svg?, html?, sources?, stance?, reason}*/)
export function removeArtifact(id)
export function toggleLayer(name, on)
export function logActivity(toolName, summary)
export function subscribe(fn)                                          // render on change
export function exportJSON()
```
Validation errors: throw `{code:'validation_failed'|'precondition_failed'|'not_found', detail, next_step}`;
`tools.js` converts to `{ok:false,...}`.

WebMCP shim (tools.js): register on `navigator.modelContext` **and** `document.modelContext`
if present (spec drift between Chrome docs and Devpost sample); log which one took.

## 1. Lanes and wall clock

| Time | Fable (integrator) | Codex A | Codex B | Codex C | Yash |
|---|---|---|---|---|---|
| 05:40–05:55 | 00 prefactor: repo, LICENSE, state.js, index.html shell, Netlify | X fixture: German 1905 original → own English of 4 sections; PD note | — | — | Create repo + Netlify site; install ChatGPT desktop; Inspector ext |
| 05:55–06:25 | **01 gate**: get_reading_state registered, deployed | I ingest (paste/md/pdf.js) | R renderer skeleton | T tools scaffolding + validators (all 10, against contract) | **Verify gate in ChatGPT browser personally**; screenshot |
| 06:25–07:15 | Integrate I+R+T; 02 marks | K knowledge panel (03) | R stubs+fold (04) | V vault + search (06) | QA: descriptions — does ChatGPT actually call tools? Fix wording |
| 07:15–07:45 | Integrate 03+04 → **reshape loop live** | F figures (07) | A annotate/highlight (05) | S Worker (09) | **Record rough video take 1**, upload YouTube (unlisted→public later) |
| 07:45–08:30 | Integrate 05+06+07; bug triage | W widgets (10) | tests sweep + honest error states | README (08) draft | QA pass on live URL; Devpost draft saved with rough video |
| 08:30–09:00 | Freeze except fixes; integrate 09/10 if green | Devpost description 4 paragraphs | Video script v2 | — | **Final video** if loop+vault+figure stable; else keep take 1 |
| 09:00–09:30 | Final deploy; tag `v0.1-hackathon` | — | — | — | Submit. Confirmation email. |
| 09:30–10:00 | Buffer. Nothing new. | | | | |

Rule: an agent lane that finishes early takes the next unowned ticket, never another lane's file.
Rule: "tested" means a screenshot or console transcript in the PR; the integrator rejects claims.

## 2. Pre-mortem (it is 10:05 CEST; the submission failed or was weak — why?)

| # | Failure | Likelihood | Impact | Mitigation | Owner / checkpoint |
|---|---|---|---|---|---|
| 1 | Tools showed in the Inspector but ChatGPT's browser never saw them (API name drift, origin-isolation header, Netlify header) | High | Fatal | Shim both `navigator.modelContext`/`document.modelContext`; `_headers` file; **Yash verifies in ChatGPT desktop at 06:25, not an agent** | Yash 06:25 |
| 2 | Four agents edited `index.html`; merge conflicts ate an hour | High | High | One file per lane; integrator owns index/state; PRs only | Fable, continuous |
| 3 | Video uploaded at 09:40, still "processing"; or unlisted; or >3:00 | Medium | Fatal | Rough take uploaded by 08:00; set public at submit; 2:30 script | Yash 08:00 |
| 4 | A fixture wasn't actually licensed for copying (docs license ≠ software license); trademark/music in video | Medium | Disqualifying | Rutherford 1911 (PD), Wikipedia (CC BY-SA, attribution shown), docs only with a verified permissive license file beside the text; no music; no logos in title cards | Codex A 06:30 |
| 5 | Devpost form: license not visible in About, repo private, description fails Stage One theme gate | Medium | Fatal | Draft saved at 08:30; first paragraph says "human and agent on the same page"; License set in repo About | Codex C 08:30 |
| 6 | ChatGPT ignored the tools or called them wrong (bad descriptions) | Medium | High | QA descriptions at 06:25–07:15 with three README prompts; iterate wording; validators' `next_step` teaches | Yash 07:15 |
| 7 | Agents added features outside tickets; nothing integrated | Medium | High | Acceptance criteria only; integrator reverts extras | Fable |
| 8 | pdf.js / CDN blocked in ChatGPT browser | Medium | Medium | Paste/md path is primary; PDF optional in demo | Codex A |
| 9 | Folder drop unsupported in ChatGPT browser | Medium | Medium | `<input webkitdirectory multiple>` fallback + drag-drop; test at 07:15 | Codex C |
| 10 | Sandboxed iframe blocked by CSP → widgets dead | Medium | Low | Widgets are last; video doesn't depend on them; README says "next" | Codex A |
| 11 | Agent claimed "verified" without evidence; bug found on camera | High | High | Evidence rule (§1); Yash runs the demo script end-to-end at 08:30 on the live URL | Yash 08:30 |
| 12 | Reshape loop worked but looked like nothing (no fold, reason hidden) | Medium | High | Fold animation + typed reason are in ticket 04's acceptance; QA on camera framing | Codex B |
| 13 | Hidden-requires-confirmed rule made the demo stall (agent asks, human forgets to confirm) | Low | Medium | Demo script confirms on camera — it's the sovereignty beat, keep it | Yash |
| 14 | Worker CORS/deploy sink 40 min | Medium | Low | Stretch lane only; abandon at 08:30 if not green | Codex C |

## 3. Yash's QA checklist (run on the LIVE URL in the ChatGPT desktop browser)

- [ ] 06:25 tools listed; `get_reading_state` returns sections
- [ ] 07:15 "Interview me about what I know about Brownian motion" → entries appear proposed; confirm one
- [ ] 07:15 agent collapses a section with a reason citing the entry; stub expands on click; Agent toggle off = untouched paper
- [ ] 07:45 vault dropped; "reshape §2 using my notes" cites a path; devtools shows no network during search
- [ ] 07:45 "visualize the random walk" → SVG in gutter; malicious SVG fixture rejected
- [ ] 08:30 "is this still how it's understood?" → perspective with sources + stance words, no icons
- [ ] 08:30 full demo script, timed, on the live URL
- [ ] 09:00 README prior-vs-new section; License in About; video public; description first paragraph

## 4. Devpost description (fill by 08:30)

1. *Fit:* Bridge is a reader where a human and their agent work on the same page: the page holds the document, the reader's marks and their own notes; the agent brings what it knows about the reader; WebMCP tools are where they meet. The layer rule is enforced by tool absence — no tool writes the source.
2. *Better UX:* the document reshapes around what you already know, as you say it; every change is visible, reasoned, reversible.
3. *Newly possible together:* interview → knowledge → reshaped document; your vault reshaping a paper without leaving your browser; figures and perspectives in a separate layer.
4. *Implementation:* imperative API, 9–10 tools with JSON-schema inputs, validators with coach-voice `next_step`, three-layer state, client-side index, SVG sanitizer, sandboxed widgets. Prior-vs-new: this repo is entirely submission-period; Feynman and Noether IRE are separate private projects whose design lineage is linked.

## v0.2 deltas to the lanes (added 06:05)
- Codex A after ingest → **11 math (KaTeX)** (before figures).
- Codex B after stubs/fold → **13 pending-reshape + density chips + batch-confirm + remove-all**.
- Codex C after vault → **12 connections graph** → 15 export-to-vault (Worker 09 moves after 15).
- Lane A (annotate) adds **14 prerequisite + reference roles** in the same PR as 05.
- Fixtures (06:45, licenses verified): Rutherford 1911 (PD; Codex A pulls text), The Conversation "How do atoms form?" (Levy, 2025, article 256172; CC BY-ND text only; standard attribution line — Codex A copies text, not images), Chrome WebMCP docs page (CC BY 4.0). `fixtures/ATTRIBUTION.md` required. Theme: reading across a century.
- Video script: paper + personal in full, article 20 s. Description first line: "Marginalia: the web, annotated with agent-driven, personalized margins."
