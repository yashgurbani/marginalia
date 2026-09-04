# Vault gate

## Implemented

- hidden multi-file input with `webkitdirectory`;
- keyboard-operable drop/select label;
- recursive WebKit directory-entry traversal;
- `.md` filtering;
- title extraction from first Markdown H1, with filename fallback;
- per-file cap 2 MB, total cap 24 MB, file cap 750;
- in-memory index only;
- visible file count, last query, and last result paths;
- local-only marker on the exposed bridge.

## Evidence

`diagnostics/tool-contract.mjs` indexed two Markdown notes and skipped a non-Markdown item. `diagnostics/integration-contract.mjs` mounted the Vault tab and displayed “2 Markdown files indexed locally.” Both returned `ALL PASS`.

Static inspection found no `fetch`, XHR, WebSocket, upload, worker, or provider call in indexing/search.

Qualification: a physical folder selection and recursive drag/drop could not be performed because managed Chromium blocks page navigation.
