# PRO-EXPEDITION-01 progress

Operation: `marginalia-posthackathon-l1-l2`  
Repository: `yashgurbani/marginalia`  
Base: `main@0cc53c586660c2b7752207da73c7cbb8116c0f0a`  
Branch: `pro-expedition-01-long-horizon`  
Pull request: `#1` against `main`  
GitHub mode observed: write-enabled  
Runtime mode observed: connector-backed Git writes plus isolated local validation; Devspace connection unavailable

## Checkpoints

| Time (CEST) | Commit | Outcome |
|---|---|---|
| 09:31 | `9a4869c542c60b33fdfb7c1d4378dd80fac807bd` | Added bounded `vault.js`, `figure.js`, and `graph.js` helpers. |
| 09:47 | `8d8ba3c9838fd33dc1eac85e4dce121edebdd095` | Wired math, local search, connection validation/cards, Vault tab, and optional graph into the existing renderer/tools contract. |
| final | PR head containing this file | Durable report, validation evidence, hashes, diagnostics, and demo script. |
| continuation | PR head after browser acceptance | Corrected SVG namespace handling and native-tab ARIA restoration. Exact pages, live CDNs, blocked-CDN fallbacks, folder/drop, search, provenance, graph, and source immutability passed in Edge. |

## Required loop record

1. **Inspect.** Read ADR-0001, the frozen bridge contract, SPEC, map, handoffs, current source, frozen tests, and packet/index/run instructions.
2. **Hypothesis A.** Keep all new capability in three modules and use additive imports/wiring in `render.js` and `tools.js`; preserve the nine-tool contract.
3. **Checkpoint 1.** Added local-only vault indexing, hardened SVG helpers, and graph data/fallback renderer.
4. **Gate.** Syntax and module-level contract checks passed. Branch boundary showed only the three new modules.
5. **Hypothesis B.** Extend the existing sidebar without editing `knowledge.js`, `index.html`, or CSS by observing its rendered tab strip and mounting auxiliary panels from `render.js`.
6. **Checkpoint 2.** Added lazy KaTeX enhancement, vault/search wiring, connection target provenance, connection cards, and optional Cytoscape activation.
7. **Gate.** Three local harnesses passed. Exact browser navigation remained blocked by the managed runtime; recorded rather than concealed.
8. **Hardening.** Canonicalized note targets to a path actually returned by `search_notes`, avoiding case-variant or look-alike attachment.
9. **Finalization.** Opened draft PR #1 and added this durable result subtree for integrator/browser review.

## Status

All Must implementation items and the Should graph item pass real-browser acceptance. The branch is ready for the normal PR merge path.
