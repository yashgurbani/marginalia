# PRO EXPEDITION

Status: open  
Model / effort: GPT-5.6 Sol, Pro  

## Mission brief

1. Final outcome: land one verified PR that combines deferred lanes L1 and L2 after the hackathon.
2. Source hierarchy and baseline: `docs/adr/0001-agent-layer-never-writes-source.md`, `.scratch/bridge/CONTRACT.md`, root `SPEC.md`, `.scratch/bridge/MAP.md`, `HANDOFF-0815.md`, then the current source and test pages.
3. Connected backlog: Must = KaTeX, SVG figures, vault drop, lexical note search, and connection cards. Should = the Cytoscape connections graph tab.
4. Tool actions and writers: GitHub supplies the branch and PR. The connected runtime is the sole writer for the listed source files. The parent chair integrates the PR.
5. Current evidence and failed attempts: the current page has `src/state.js`, `src/tools.js`, `src/render.js`, and two static HTML test pages. `search_notes` has a no-vault response. SVG sanitization is basic. Vault indexing, KaTeX, and graph rendering are not complete.
6. Must/Should order: inspect and preserve the contract. Add KaTeX and SVG support. Add vault drop and lexical search. Add connection rendering. Then attempt the graph tab.
7. Loop and retry policy: use a materially different implementation hypothesis after a failed gate. Do not repeat an unchanged patch.
8. Acceptance matrix pointer: this packet's `## Acceptance matrix`.
9. True stop conditions: a forbidden path write, source-layer mutation, missing required credential, or a terminal failed gate after two distinct attempts.
10. Durable artifact contract: branch checkpoints, `.scratch/agora/results/PRO-EXPEDITION-01/PROGRESS.md`, `REPORT.md`, `CHANGED-FILES.md`, validation output, and exact hashes.

Operation ID: `marginalia-posthackathon-l1-l2`
Seat: parent selects a quota-approved Business Pro seat
ChatGPT Project: parent-provided project or none. Record the actual value before reservation.
Expedition role: execute
Workspace app: GitHub-connected ChatGPT workspace with the local repository runtime for tests
Tool directives: use the connected GitHub repository and the approved local execution plane. Do not assume GitHub write actions until the preflight shows them.
GitHub requested: yes
GitHub preflight: required before reservation
Repository: `yashgurbani/marginalia`
Baseline ref: parent-provided immutable commit and `PARENT-BASELINE.json`
Expedition branch: dedicated branch. Never `main`.
GitHub action mode: record the observed mode, `write-enabled` or `read-only`
Runtime: parent resolves `mcpx` or `legacy-devspace` before send
Runtime session: parent records the resolved session ID
Runtime generation: parent records the resolved generation ID
Tool schema hash: parent records the observed schema hash
Runtime role: execute-and-write on the exact source list, execute-and-test elsewhere
Authoritative writer: the Pro runtime for this ticket. GitHub and the runtime must not race.
Write mode: worktree with exact source reservations and an artifact subtree
Integration owner: `codex-parent`
Live state write: false
Root: the repository checkout for `yashgurbani/marginalia`
Worktree or output root: the dedicated PR branch with the exact file boundary below
Frozen baseline: the parent baseline manifest and branch commit
Progress path: `.scratch/agora/results/PRO-EXPEDITION-01/PROGRESS.md`
Report path: `.scratch/agora/results/PRO-EXPEDITION-01/REPORT.md`
Validation path: `.scratch/agora/results/PRO-EXPEDITION-01/validation/`
Required-before-launch dependencies: parent quota, GitHub, runtime, baseline, and review preflight. Bridge documents are listed above.
Exploration root: `.scratch/agora/results/PRO-EXPEDITION-01/`
Immutable mission inputs: `CONTRACT.md`, `SPEC.md`, `MAP.md`, `HANDOFF-0815.md`, ADR-0001, current tests, and the frozen baseline
Mutable coordination sources: the parent ledger, queue, transport receipt, and Pro progress state
Branch failure policy: isolate-and-continue. Stop only the affected optional branch.
Review synthesis path: parent-provided `REVIEW-SYNTHESIS.md`. Do not invent missing review findings.
Review join manifest: parent-provided `REVIEW-JOIN.json`. Reservation requires a valid parent join.
Plan review path: parent-provided `PLAN-REVIEW.md`. Its reviewed-packet SHA-256 must bind this packet.
Incorporated review findings: none supplied in the bridge packet

## Why this needs Pro

The mission joins two UI and data seams that share `render.js` and `tools.js`. It needs one context to preserve immutable source text, local-only vault semantics, reasoned agent artifacts, and the existing no-build test contract while comparing KaTeX, SVG, and graph behavior. Do not spend a separate Pro request on review or handoff prose.

## Governing sources

Read the sources in the order named in the mission brief. If sources conflict, preserve the layer rule and record the conflict in `DECISIONS.md` in the result subtree. The frozen contract is authoritative for exports and tool result shapes.

## Contract references

Treat `src/state.js` as read-only. Its contract exports `state`, `loadDoc`, `getReadingState`, `getSectionText`, `setCursor`, `mark`, `tapTerm`, `upsertKnowledge`, `setKnowledgeStatus`, `setDepth`, `applyPending`, `addArtifact`, `removeArtifact`, `removeAllArtifacts`, `toggleLayer`, `logActivity`, `subscribe`, and `exportJSON`.

Treat the `src/tools.js` contract as read-only in shape. It exposes the WebMCP tools through the available `navigator.modelContext`, `document.modelContext`, or `window.modelContext` shim and through `window.marginaliaTools`. Preserve `{ok:true,...}` and `{ok:false,error,detail,next_step}`. Preserve the existing nine-tool test expectation unless the parent explicitly changes the frozen test contract.

The contract tool names are `get_reading_state`, `get_section_text`, `get_knowledge`, `upsert_knowledge`, `search_notes`, `set_section_depth`, `annotate`, `highlight`, and `insert_figure`. Preserve the listed state exports and call `get_reading_state` before reshaping. Keep `search_notes` local and return `detail:"no vault loaded"` when no vault exists. Keep every agent artifact attributed, reasoned, timestamped, and removable.

For `connection`, use only `prerequisite`, `analogy`, `contradiction`, `enables`, `bridge`, or `example`. Accept a target only when it is a path returned by the local vault search or an existing knowledge id. Keep the connection reason visible in the margin.

`get_connections()` appears in the SPEC delta but not in `CONTRACT.md`. Treat it as optional with the graph tab. Do not register a tenth tool unless the parent changes the immutable tools test contract. The graph can derive its view from connection artifacts.

## Exact allowed file list

The Pro writer can change only these repository files:

- `src/vault.js` — new local folder index and drop/select controls.
- `src/figure.js` — new SVG sanitizer and figure renderer helpers.
- `src/graph.js` — new connection graph data and optional Cytoscape renderer.
- `src/render.js` — additive imports and wiring only: mount the vault control, render math in source and margin prose, use the figure helper, render connection cards, and mount an optional graph tab.
- `src/tools.js` — additive wiring only: delegate vault search, delegate figure sanitization, and validate connection fields. Do not refactor unrelated tools.

Do not edit `src/state.js`, `src/ingest.js`, `src/knowledge.js`, `src/style.css`, `index.html`, `tests/**`, `fixtures/**`, docs, deployment files, or another worker's paths. Put all diagnostics, trial pages, screenshots, and metrics under the exploration root.

## Mission

Deliver the L1/L2 reader experience while keeping the page source byte-identical. KaTeX renders `$...$` and `$$...$$` in source text and margin prose, with raw LaTeX fallback when the CDN is blocked. The figure path sanitizes SVG, caps its size, and renders only in the agent margin. The vault path accepts a folder input with `webkitdirectory` and drag-and-drop `.md` files, indexes title and body in the browser, and returns `path`, `title`, `snippet`, and `score` from lexical `search_notes`. A connection annotation targets a returned note path or a knowledge id, enforces the relation vocabulary, and renders as a removable margin card with its reason. The graph tab is optional and is a stretch gate.

Use only pinned CDN assets when needed. Recommended pins are KaTeX `0.16.22` and Cytoscape `3.30.3`. Load them lazily from the new modules. Do not add a package manager, bundle, build step, or unpinned URL.

## Intent coverage

| Item | Requested outcome | Class | Writer | Output | Disposition |
|---|---|---|---|---|---|
| INT-01 | L1 KaTeX in source and margin | Must | Pro | source files above plus report | covered |
| INT-02 | L1 SVG figure renderer polish | Must | Pro | source files above plus tests evidence | covered |
| INT-03 | L2 folder input and drag vault drop | Must | Pro | `src/vault.js` and render wiring | covered |
| INT-04 | L2 lexical `search_notes` with local-only results | Must | Pro | vault and tools wiring | covered |
| INT-05 | L2 `connection` kind margin card | Must | Pro | tools and render wiring | covered |
| INT-06 | L2 Cytoscape connections graph tab | Should | Pro | `src/graph.js` and render wiring | optional, fallback T-06 |

## Required loop

Inspect → form a hypothesis → make the smallest additive change → run the exact gate → record evidence → checkpoint → diagnose a failed gate → try a materially different hypothesis → re-read the contract at each milestone.

Capture the worker's observed base manifest before the first write. Run `Test-AgoraWriterBoundary.ps1` and `Test-AgoraWorkerBaseline.ps1 -Action Validate` before the parent integrates the PR.

Do not write to the source object or source text. Do not add an API endpoint or provider egress for vault contents. The only network resources permitted are the two pinned CDN assets, and vault indexing and search must make no network request.

## Acceptance matrix

| Gate | Command or method | Pass condition | Evidence path |
|---|---|---|---|
| Existing renderer test | Start `python -m http.server 4173`. Open `http://127.0.0.1:4173/tests/render.test.html` | Page prints `ALL PASS` and `body.dataset.testResult` is `pass` | `validation/render-test.txt` or screenshot |
| Existing tools test | Open `http://127.0.0.1:4173/tests/tools.test.html` | Page prints `ALL PASS`. `#final-result` starts with `ALL PASS` | `validation/tools-test.txt` or screenshot |
| Math | Load the Rutherford fixture and inspect source plus an `expand` artifact containing LaTeX | Both locations show KaTeX output when CDN loads. Blocked CDN shows the original LaTeX text | `validation/math.md` and screenshot |
| Figure safety | Call `window.marginaliaTools.insert_figure.execute` with a script, event attribute, external image, and valid circle | Returned SVG contains no active content, has a bounded viewBox/size, and source text is unchanged | `validation/figure.md` |
| Vault input | Drop or select a folder containing at least two `.md` files | File count appears. No vault result is `ok:true`, empty results, `detail:"no vault loaded"` | `validation/vault.md` |
| Lexical search | Call `window.marginaliaTools.search_notes.execute({query:"gold",limit:5})` after loading the fixture notes | Results are local, ranked, and contain `path`, `title`, `snippet`, and numeric `score`. Activity shows the returned paths | `validation/search-notes.md` |
| Connection card | Call `annotate` with a returned note path or knowledge id and each supported relation | Valid target and relation produce an attributed removable card with reason. Invalid target or relation returns the contract error shape | `validation/connection.md` |
| Source immutability | Hash or serialize `state.doc` before and after every Must gate | Hash and every section text stay unchanged. Source remains frozen | `validation/source-immutability.md` |
| Optional graph | Open the Connections tab after two connection artifacts exist | If CDN loads, Cytoscape graph updates from artifacts and a node click identifies its section. If CDN is blocked, the page states the unavailable condition without breaking Must gates | `validation/graph.md` |

The two existing test pages are immutable evidence pages. Do not edit them to make a gate pass. If a new feature cannot pass them without test edits, stop that feature branch and report the conflict.

## True stop conditions

Stop the entire expedition if the writer attempts a file outside the exact list, changes source-layer text, needs credentials not supplied by the parent, or needs a build step or package install. Stop only the graph branch if the pinned CDN cannot load or the graph would require an unapproved file. Stop a failing Must gate after two materially different implementation hypotheses and record `BLOCKED` with evidence. Do not send a follow-up only to request a missing report.

## Budget

Use one GPT-5.6 Pro request for this logical operation. Do not promise a fixed runtime. The parent applies the Agora local safety cap of 15 submissions per Business seat, 30 total, and at most two per Codex thread. A follow-up is exceptional and needs the critical-gate and quota checks. Keep all non-Pro follow-on work in its own ticket and branch.

## Required return

Return one PR against `main`, never a direct push to `main`, plus `.scratch/agora/results/PRO-EXPEDITION-01/REPORT.md`. Include branch and checkpoint hashes, changed paths, every acceptance result, failed hypotheses, CDN pins, residual risks, and the reason for any omitted graph stretch. Put `PROGRESS.md`, `CHANGED-FILES.md`, validation artifacts, and diagnostics in the same result subtree. Do not claim completion from prose without the durable report.

## Forbidden

- No source-layer writes, source-text replacements, or tools that mutate the source.
- No edits outside the exact five-file list.
- No build step, package manager, local dependency, or unpinned CDN dependency.
- No dependency other than the pinned KaTeX and Cytoscape CDN assets.
- No commits to `main`, no direct pushes to `main`, no deployment, and no production mutation.
- No network request during vault indexing or note search.
- No raw vault upload, provider egress, credential access, or copied private notes in the report.
- No test-file edits and no unrelated refactor.
