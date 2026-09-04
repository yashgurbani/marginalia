# Math gate

## Implementation

- Pin: KaTeX `0.16.22`.
- Lazy load from the pinned jsDelivr JS and CSS URLs in `src/figure.js`.
- Parse both `$...$` and `$$...$$` text nodes in source and margin prose.
- Render with `trust:false`, `throwOnError:false`, and HTML+MathML output.
- Do not alter `state.doc` or section strings.
- If loading fails, leave original text and delimiters in place and mark the element `data-math-renderer="raw-latex"`.

## Evidence

`diagnostics/integration-contract.mjs` injected a KaTeX-compatible renderer and passed:

- inline expression rendered;
- display expression rendered;
- both appeared as `.marginalia-math` nodes;
- source DOM text was enhanced without touching source state.

Output: `ALL PASS`.

## Qualification

Live CDN and CSS loading could not be tested because the available Chromium blocks navigation. The raw fallback is deterministic; production asset loading remains a browser/CSP smoke test.
