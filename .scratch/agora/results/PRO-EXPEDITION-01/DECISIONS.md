# Decisions

## D-01: Preserve nine WebMCP tools

`get_connections()` exists in the product SPEC delta but not in the frozen contract, and the immutable tools test requires exactly nine tools. The graph therefore derives from attributed `connection` artifacts already present in page state. No tenth tool is registered.

## D-02: Local-first search, no egress

Vault indexing accepts only local browser `File` objects or explicit in-memory diagnostic entries. Search is synchronous over an in-memory lexical index. No `fetch`, XHR, worker, server endpoint, upload, or provider connector is used.

## D-03: Returned-path provenance is stateful

A note path can become a `connection` target only after it appeared in a `search_notes` result during the current vault load. Reloading/replacing the vault clears returned-path authority. Existing knowledge ids remain valid targets.

## D-04: Keep source bytes and raw fallback

Math is enhanced only after source text is placed into the DOM. When the pinned KaTeX asset cannot load, the original `$...$` or `$$...$$` text remains visible. No source string or frozen state object is rewritten.

## D-05: Sidebar integration without forbidden files

The current sidebar is owned by `knowledge.js`, while the packet forbids editing it and `index.html`. `render.js` therefore mounts Vault and Connections as additive tabs after the existing tab strip appears. Inline styles are deliberately local to the new controls because `style.css` is frozen.

## D-06: Optional graph degrades to a useful list

The Connections panel first renders a deterministic edge list. Cytoscape `3.30.3` is requested lazily only when the tab opens. A blocked CDN produces an explicit unavailable state while preserving the edge list and all Must gates.

## D-07: SVG sanitizer has browser and diagnostic paths

The browser path uses `DOMParser` plus an allowlist and normalized viewBox. A conservative regex fallback exists solely for non-browser diagnostic execution. Both remove scripts, foreign content, event handlers, unsafe styles, external URLs, and dangerous schemes; only the browser path should be treated as the production parser.
