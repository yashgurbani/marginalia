# Real-browser acceptance gates

Date: 2026-09-04 CEST  
Browser: Microsoft Edge, headless Chromium through Playwright  
Reader URL: `http://127.0.0.1:4174/index.html`  
Frozen test URLs: `tests/render.test.html`, `tests/tools.test.html`, `tests/e2e.test.html`

## Frozen pages

```text
RENDER: ALL PASS
TOOLS: ALL PASS
E2E: ALL PASS
FAILURES: 0
```

The same frozen pages first exposed the production SVG parser defect before the correction:

```text
TOOLS: FAILURES: 1
E2E: FAILURES: 2
insert_figure strips scripts
```

Cause: the final sanitizer guard treated the required SVG namespace URL as external content. The correction restricts URL rejection to URL-bearing attributes. The DOM allowlist still removes scripts, event handlers, external images, `foreignObject`, unsafe styles, and dangerous schemes.

## Feature gates

```text
PASS live KaTeX 0.16.22 in source and margin
PASS production DOMParser SVG sanitization and source immutability
PASS physical folder selection, local-only search, ranked path marginalia-vault/physics/rutherford.md
PASS recursive browser drag-and-drop indexing
PASS all six connection relations, target provenance, cards, and Activity
PASS graph gate: 6 live connections. Click a section node to locate its passage.
PASS source serialization unchanged across browser feature gates
PASS sidebar focus, tab cleanup, and repeated fixture loads
PASS blocked-CDN raw-LaTeX fallback
PASS blocked-Cytoscape explicit fallback list
```

The folder chooser indexed two Markdown files from a real directory. The drag gate dispatched a browser `drop` event with a nested directory-entry tree and confirmed both nested paths.

No request occurred during folder indexing or `search_notes`. Search results contained `path`, `title`, `snippet`, and numeric `score`.

All six connection relations accepted a returned local note path or existing knowledge id. Unsupported relations and unseen paths returned `{ok:false,error,detail,next_step}`.

The sidebar keyboard gate found and corrected an ARIA state defect after an auxiliary tab was active. Knowledge and Activity now restore their selected state after auxiliary cleanup.

## Evidence

- `browser-reader.png`: live KaTeX in the reader and margin.
- `browser-vault.png`: physical folder selection and ranked local search.
- `browser-connections.png`: live Cytoscape graph with six connections.
- `browser-katex-fallback.png`: raw LaTeX after blocking KaTeX `0.16.22`.
- `browser-graph-fallback.png`: explicit Cytoscape-unavailable state with the usable connection list.

## Static and diagnostic gates

```text
node --check src/figure.js       PASS
node --check src/vault.js        PASS
node --check src/graph.js        PASS
node --check src/tools.js        PASS
node --check src/render.js       PASS
renderer-contract.mjs            ALL PASS
tool-contract.mjs                ALL PASS
integration-contract.mjs         ALL PASS
git diff --check                 PASS for continuation changes
```
