# PRO-EXPEDITION-01 report

**Status:** implementation and real-browser acceptance complete; ready for merge
**Pull request:** `https://github.com/yashgurbani/marginalia/pull/1`  
**Branch:** `pro-expedition-01-long-horizon`  
**Base:** `main@0cc53c586660c2b7752207da73c7cbb8116c0f0a`  
**Checkpoint commits:** `9a4869c542c60b33fdfb7c1d4378dd80fac807bd`, `8d8ba3c9838fd33dc1eac85e4dce121edebdd095`  
**CDN pins:** KaTeX `0.16.22`; Cytoscape `3.30.3`

## Executive result

The branch delivers all five Must outcomes and the optional graph outcome while preserving the immutable source/state contract and the nine-tool WebMCP surface:

1. KaTeX enhancement for source and margin prose, with original LaTeX retained when the asset is unavailable.
2. Hardened, bounded SVG sanitation and agent-margin rendering.
3. Folder select plus recursive drag/drop for local Markdown vaults.
4. Local-only BM25-style lexical `search_notes` returning ranked `path`, `title`, `snippet`, and numeric `score`, with returned paths visible in Activity.
5. Validated, attributed, removable connection cards with the six frozen relations and target provenance.
6. Optional Cytoscape Connections tab derived from artifacts, with a deterministic list fallback.

No source-layer mutation API was added. No tenth WebMCP tool was registered. No package manager, build step, server endpoint, note upload, provider egress, unpinned dependency, deployment, or direct push to `main` was introduced.

## Acceptance matrix

| Gate | Result | Evidence / qualification |
|---|---|---|
| Existing renderer test | **PASS** | Exact `tests/render.test.html` page printed `ALL PASS` in Edge. See `validation/browser-gates.md`. |
| Existing tools test | **PASS** | Exact `tests/tools.test.html` page printed `ALL PASS` in Edge. See `validation/browser-gates.md`. |
| Math | **PASS** | KaTeX `0.16.22` rendered source and margin math. Blocking the CDN preserved readable raw delimiters. |
| Figure safety | **PASS** | Production `DOMParser` removed active and external content, bounded dimensions, preserved the valid circle, and left source serialization unchanged. |
| Vault input | **PASS** | A real folder selection and recursive browser drop each indexed two Markdown files locally. |
| Lexical search | **PASS** | `validation/search-notes.md`. Local ranked result shape and Activity path logging passed. |
| Connection card | **PASS** | `validation/connection.md`. Valid returned path succeeded; unseen path and unsupported relation failed in contract shape; renderer card was observed in the integration harness. |
| Source immutability | **PASS** | `validation/source-immutability.md`. Frozen state and exact serialized source were unchanged across Must tool operations. |
| Optional graph | **PASS** | Cytoscape `3.30.3` rendered six live connections. Blocking the CDN produced the explicit unavailable state and preserved the fallback list. |

## Validation commands used

```sh
node --check src/figure.js
node --check src/vault.js
node --check src/graph.js
node --check src/tools.js
node --check src/render.js
node .scratch/agora/results/PRO-EXPEDITION-01/diagnostics/renderer-contract.mjs
node .scratch/agora/results/PRO-EXPEDITION-01/diagnostics/tool-contract.mjs
node .scratch/agora/results/PRO-EXPEDITION-01/diagnostics/integration-contract.mjs
```

All returned `ALL PASS` in the isolated runtime. See `validation/local-suite.txt`.

## Failed or unavailable paths

- **Devspace:** `open_workspace` returned: `We couldn't connect your account. Please try again.` GitHub remained write-enabled, so repository reads/writes used the connected GitHub tool and local code execution was isolated.
- **Managed Chromium:** enterprise policy exposed `URLBlocklist=["*"]`; navigation to the local HTTP server was blocked. Repeating the same browser attempt would not be a materially different hypothesis, so exact page checks were not falsely reported.
- **Network clone:** the isolated container could not resolve GitHub. Files were read from GitHub through the connector and reconstructed only for validation.

## Real-browser continuation

All listed pre-merge browser risks were exercised in Microsoft Edge. The run found two defects: SVG namespace rejection and native-tab ARIA state loss. Both corrections stay inside the packet boundary. The frozen pages and feature gates pass after the corrections. See `validation/browser-gates.md` and the five browser screenshots.

## Next tickets

Because the graph implementation is present, do **not** dispatch conditional `T-06` unless browser review finds the interactive graph unacceptable. After this PR is integrated, the indexed order remains T-01 through T-05, followed by the research-only W1–W8 packets according to their dependencies.
