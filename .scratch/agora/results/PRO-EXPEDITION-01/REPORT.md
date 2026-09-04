# PRO-EXPEDITION-01 report

**Status:** implementation complete on PR branch; browser integration confirmation required before merge  
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
| Existing renderer test | **PASS, behavior-equivalent harness; exact page pending** | `validation/render-test.txt`. The frozen assertions were executed against the final modules in a minimal DOM. Managed Chromium blocked navigation, so `tests/render.test.html` itself was not opened here. |
| Existing tools test | **PASS, contract harness; exact page pending** | `validation/tools-test.txt`. Nine tools, validation semantics, state sharing, activity, and source immutability passed. Exact browser page remains an integrator check. |
| Math | **PASS for renderer path and fallback design; live CDN pending** | `validation/math.md`. Fake KaTeX exercised inline/display replacement; static checks bind the pin. Managed browser prevented a live network asset check. |
| Figure safety | **PASS** | `validation/figure.md`. Malicious script/event/external/foreign content was removed; viewBox and dimensions were bounded; source serialization was unchanged. Browser DOMParser path still deserves one live smoke test. |
| Vault input | **PASS for control/index behavior; physical browser drop pending** | `validation/vault.md`. Folder input, recursive drop path, caps, local-only implementation, and two-note indexing are present. Physical drag/drop needs browser confirmation. |
| Lexical search | **PASS** | `validation/search-notes.md`. Local ranked result shape and Activity path logging passed. |
| Connection card | **PASS** | `validation/connection.md`. Valid returned path succeeded; unseen path and unsupported relation failed in contract shape; renderer card was observed in the integration harness. |
| Source immutability | **PASS** | `validation/source-immutability.md`. Frozen state and exact serialized source were unchanged across Must tool operations. |
| Optional graph | **PASS for graph data and fallback; live Cytoscape pending** | `validation/graph.md`. Live edge derivation and sidebar mount passed. The CDN branch could not be exercised in managed Chromium. |

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

## Residual risks before merge

1. Open the exact frozen `tests/render.test.html`, `tests/tools.test.html`, and `tests/e2e.test.html` in an unrestricted browser served from the repo root.
2. Confirm KaTeX CSS/JS `0.16.22` loads under the production CSP and that blocked-CDN mode leaves raw delimiters readable.
3. Confirm Cytoscape `3.30.3` loads under the production CSP; otherwise accept the explicit fallback list.
4. Perform one physical folder select and one recursive drag/drop in the target WebMCP browser.
5. Smoke-test an SVG through production `DOMParser`, since the isolated Node gate exercised the conservative fallback.
6. Review the MutationObserver sidebar seam in the real page for tab focus and cleanup behavior.

## Next tickets

Because the graph implementation is present, do **not** dispatch conditional `T-06` unless browser review finds the interactive graph unacceptable. After this PR is integrated, the indexed order remains T-01 through T-05, followed by the research-only W1–W8 packets according to their dependencies.
