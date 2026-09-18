# Real diagrams and equations in a browser

status: closed
type: build
blocked by: none

## Goal
`renderer/diagram.ts` lays out real nodes, edges and groups with Dagre. The only browser harness, `renderer/testing/browser.ts:2`, doubles Dagre, KaTeX and CSS, so no test has ever seen a real diagram or equation. Add one real-browser acceptance that uses the packaged libraries and the real CSS.

## Owned paths
`renderer/testing/` (a new real-dependency harness beside the existing one), one new `tests/renderer-real-browser.test.ts`, `renderer/diagram.ts` and `renderer/reply.css` only for defects the test exposes.

## Acceptance
- The test skips with a clear reason unless a Chromium path is configured, the same way `tests/renderer-samples.test.ts:63` uses `T18_CHROMIUM`. Look for an installed Edge or Chrome on this machine and run it for real at least once. Record the path used.
- It renders one reply holding a diagram (two nodes, one labeled edge, one group) and one equation.
- It asserts: node and edge elements are visible with nonzero size, the arrow marker exists, the KaTeX output is present, the text fallback lists the same parts.
- It asserts source binding: focusing a node highlights its source span, blur clears it, and the equivalent text control does the same.
- It saves screenshots in light and dark themes under `.local/polish/shots/P07/`.
- Never open or read any browser profile under `.scratch/`. Launch with a fresh temporary profile.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P07.md`

## Stop
Stop after the report. 200% zoom and keyboard traversal belong to Keyboard, zoom and reduced-motion acceptance.

## Resolution
Real packaged Dagre/KaTeX/CSS acceptance ran in Chrome151.0.7922.138 with a fresh temporary profile; both theme screenshots, SVG/text source-focus and blur, unchanged source DOM and equivalent fallback verified. Independent1/1 and final correction review accepted; chief combined14/14. Stable full1037/1031pass/0fail/6platformskip, all four checks exit0 with browser suites enabled. Receipt `.local/polish/logs/P07-chief-gate-final-20260918/receipt.json`, SHA256 16180B076F4E208A7A0D367FEBD0966292CECA9E2C9CE1CD5ACF7451D068395E. Full report `D:/Projects/Marginalia/.local/polish/reports/P07.md` preserves failed logs/dissent and scope limits. P17 and all live gates remain open. No Git writes/publication.
