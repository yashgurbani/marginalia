# PRO-EXPEDITION-01 stop handoff

**Status:** PAUSED by explicit user instruction on 2026-09-04. No further implementation work should continue from this checkpoint until deliberately resumed.

## Frozen repository state

- Repository: `yashgurbani/marginalia`
- Branch: `pro-expedition-01-long-horizon`
- Branch head before this stop-only commit: `125644b8d6d255cfa8939944125af22a370d4868`
- Base branch: `main`
- Main head observed at freeze: `0cc53c586660c2b7752207da73c7cbb8116c0f0a`
- Pull request: `#1`, open and draft, targeting `main`
- PR state observed at freeze: unmerged; GitHub reported `mergeable: false`
- Direct push to `main`: none
- Deployment or production mutation: none

This stop checkpoint changes no application source. It adds only this coordination artifact under the ticket result subtree.

## Work preserved

The branch already contains the bounded implementation and its durable evidence:

- KaTeX enhancement for source and margin prose, with readable raw-LaTeX fallback.
- Bounded SVG sanitization and agent-margin figure rendering helpers.
- Local Markdown vault folder selection and recursive drag/drop indexing.
- Local-only lexical `search_notes` returning ranked path, title, snippet, and numeric score.
- Connection validation against returned vault paths or existing knowledge ids, with the six frozen relations.
- Attributed, removable connection cards.
- Optional Cytoscape graph with a deterministic no-CDN list fallback.
- Reproducible diagnostic harnesses, validation notes, changed-file ledger, decisions, report, and timed demo script.

Authoritative status and caveats remain in:

- `PROGRESS.md`
- `REPORT.md`
- `CHANGED-FILES.md`
- `DECISIONS.md`
- `validation/`
- `diagnostics/`
- `DEMO-SCRIPT.md`

## Important qualification

The isolated harnesses passed, but this runtime could not open the exact browser test pages because managed Chromium blocked navigation. Do not merge based only on the harness results. The exact static tests, physical vault interaction, production `DOMParser`, and live pinned CDN paths remain integration gates.

## Next steps, in order

1. **Inspect PR mergeability before changing code.** GitHub currently reports PR `#1` as non-mergeable even though `main` was still at the recorded base. Determine whether this is an actual conflict, a pending mergeability calculation, or a repository rule/check state. Do not force-merge.
2. **Run the frozen browser tests from the repository root.** Start `python -m http.server 4173`, then open:
   - `http://127.0.0.1:4173/tests/render.test.html`
   - `http://127.0.0.1:4173/tests/tools.test.html`
   - `http://127.0.0.1:4173/tests/e2e.test.html`
   Require each page to report `ALL PASS` and a passing `body.dataset.testResult` where implemented.
3. **Smoke-test the real reader surface.** Load the Rutherford fixture, add an `expand` artifact containing inline and display LaTeX, and verify KaTeX `0.16.22` renders in both source and margin. Block the CDN once and verify the original delimiters remain readable.
4. **Exercise figure safety in a browser.** Send `insert_figure` an SVG containing a script, event handler, external image/href, `foreignObject`, and one valid primitive. Confirm active content is absent, dimensions/viewBox are bounded, the valid primitive remains, and `state.doc` serializes identically before and after.
5. **Exercise the vault physically.** Select a Markdown folder, then test recursive drag/drop. Confirm the local file count, run `search_notes({query:"gold",limit:5})`, inspect ranked result shape, and verify no network request occurs during indexing or search.
6. **Exercise connection provenance.** Create connections to a returned note path and an existing knowledge id across all six relations. Confirm invalid relations and unseen paths return `{ok:false,error,detail,next_step}` and valid cards remain attributed, reasoned, removable, and visible in Activity.
7. **Review the sidebar seam.** Check keyboard focus, tab switching, cleanup, repeated fixture loads, and MutationObserver behavior for Knowledge, Activity, Vault, and Connections.
8. **Decide the graph gate.** Confirm Cytoscape `3.30.3` loads under the deployed CSP and that node interaction identifies or scrolls to the relevant section. If the CDN is blocked, confirm the fallback list is honest and usable. Dispatch conditional `T-06` only if the current graph implementation is rejected.
9. **Update the durable report with real-browser evidence.** Add screenshots or transcripts under `validation/`, record exact commit hashes, and keep any correction inside the packet's writer boundary. Do not edit frozen tests to manufacture a pass.
10. **Only after all gates are green:** mark PR `#1` ready for review, merge through the normal PR path, then continue the indexed backlog in order: `T-01` through `T-05`, followed by research packets `T-07` through `T-14` according to dependencies.

## Resume pointer

Resume from branch `pro-expedition-01-long-horizon`, not `main`. Re-read `.scratch/agora/TICKETS/PRO-EXPEDITION-01.md` and this file before any write. Preserve the exact source boundary, the nine-tool contract, source immutability, local-only vault semantics, pinned dependencies, and PR-only integration.
