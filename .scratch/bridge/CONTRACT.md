# Marginalia — frozen build contract (08:32 CEST, 2026-09-04)

Ethos (ADR-0001): "The page registers no WebMCP tool that mutates the source layer." The agent lives in the margin.

Deadline 10:00 CEST. Workers stop writing at 09:05 CEST and write their report. No git commits by workers; the integrator commits.

## File ownership (disjoint; never touch another lane's files)
- W1 core:     src/state.js, src/tools.js, tests/tools.test.html
- W2 surface:  index.html, src/render.js, src/knowledge.js, src/ingest.js, src/style.css, tests/render.test.html
- W3 content:  fixtures/**, README.md, docs/DEVPOST-DESCRIPTION.md, docs/VIDEO-SCRIPT.md, docs/PROMPTS.md
- W4 tickets:  .scratch/agora/**
- Integrator (Fable): everything else, git, deploy.

## Module contract
ES modules, no bundler, no build step, plain CSS, dark-first. index.html loads `src/ingest.js`, `src/state.js`, `src/tools.js`, `src/render.js`, `src/knowledge.js` as `<script type="module">`.

### src/state.js (W1) — exact exports
```js
export const state = { doc, cursorSection, marks, knowledge, artifacts, depth, layers, activity, pendingQuestions }
export function loadDoc(sections, meta)            // sections: [{id, heading, text}], meta: {id,title,attribution,license}; deep-freezes source
export function getReadingState({include_text=false}={})
export function getSectionText(id)
export function setCursor(sectionId)
export function mark(sectionId, kind /*known|lost*/, on)
export function tapTerm(sectionId, term)
export function upsertKnowledge({concept, level, evidence, source})  // returns entry {id,...,status:'proposed'}
export function setKnowledgeStatus(id, status)     // confirmed|rejected
export function setDepth(sectionId, level /*hidden|stub|summary|full*/, reason, knowledgeRefs=[], apply='now') // hidden => >=1 confirmed ref; section==cursor => pending
export function applyPending(sectionId)
export function addArtifact(sectionId, artifact /*{kind, range?, text?, svg?, sources?, stance?, reason, target?, relation?}*/) // returns artifact with id, author:'agent', ts
export function removeArtifact(id)
export function removeAllArtifacts()
export function toggleLayer(name /*source|reader|agent*/, on)
export function logActivity(toolName, summary)
export function subscribe(fn)                       // fn(state) on every change
export function exportJSON()
```
Errors: throw `{code:'validation_failed'|'precondition_failed'|'not_found', detail, next_step}`. tools.js converts to `{ok:false, error:code, detail, next_step}`.
Vault hook: `window.marginaliaVault = { search(query, limit) => [{path,title,snippet,score}] }` may be absent; `search_notes` returns `{ok:true, results:[], detail:'no vault loaded'}` then.

### src/tools.js (W1) — WebMCP registration
Register each tool on `navigator.modelContext` if present, else `document.modelContext`, else `window.modelContext`; use `registerTool({name, description, inputSchema, execute})`; log which API took. Also expose `window.marginaliaTools` (same objects) so tests can call `execute` directly without WebMCP. Tools (SPEC §10/§20): get_reading_state, get_section_text, get_knowledge, upsert_knowledge, search_notes, set_section_depth, annotate, highlight, insert_figure. Descriptions ≤60 words, carry the operating rule.

### Fixture format (W3 writes, W2 reads)
`fixtures/index.json`: `[{ "id": "rutherford-1911", "title": "...", "path": "fixtures/rutherford-1911.md", "license": "Public domain", "attribution": "one-line attribution shown on screen", "source_url": "..." }]`
Each fixture: Markdown. First line `# Title`. Every `## Heading` starts a section. Paragraphs separated by blank lines. No HTML. Math as `$...$` / `$$...$$` (KaTeX later).
`src/ingest.js` (W2): `export function parseMarkdown(md) -> {title, sections:[{id:'s1', heading, text}]}`, `export async function loadFixture(entry)`.

### UI (W2)
Two columns: left document with per-section depth chip, stub with reason + "expand", margin gutter with agent artifact cards (kind label, reason, remove button), reader marks (I know this / Lost me; double-click word = tapped term). Right pane tabs: Knowledge (confirm/reject/confirm-all), Activity (last 10 tool calls). Top bar: fixture picker (from fixtures/index.json), layer toggles Source/You/Agent, Remove all agent artifacts, Export JSON. Attribution line under title. Fold animation 300ms on depth change.
