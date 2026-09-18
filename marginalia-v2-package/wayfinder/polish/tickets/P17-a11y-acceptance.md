# Keyboard, zoom and reduced-motion acceptance

status: closed
type: build
blocked by: Real diagrams and equations in a browser

## Goal
PRODUCT.md sets WCAG 2.2 AA, keyboard-only use, reduced motion, dark mode, 200% zoom and narrow screens. Dark-mode contrast has a test. 200% zoom has no evidence at all. Reuse the real-browser harness from Real diagrams and equations in a browser.

## Owned paths
New browser acceptance tests, and only the affected rules in `ui/margin.css`, `ui/consent.css`, `ui/library/library.css`, `renderer/reply.css`.

## Acceptance
- One keyboard-only run: read, write a note, open Ask, review, cancel, open the library, return. Focus is visible at every stop. No action is reachable by pointer only.
- The same run at 200% zoom and at a 360 px wide viewport: no clipped action, no horizontal page scroll outside scrollable diagrams.
- The same run with `prefers-reduced-motion`: no animation or smooth scroll.
- Slider movement announces at most one status update per settled value.
- Screenshots land under `.local/polish/shots/P17/`. Defects are fixed in the owned CSS or listed with file and line.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P17.md`

## Technical preflight
P07 is closed with real Chrome proof. P17 reuses renderer/testing/real-browser.ts through a generic owned-browser session. Browser Arrow-key probe observed five .mr-status mutations for one rapid burst ending at one settled value. Chief expands technical ownership to the narrow renderer/index.ts calculation-announcement lifecycle and dedicated browser regression; this is required for the ticket's explicit slider criterion. Immediate local calculation and all authority fences stay in place. Main journey, zoom and reduced-motion acceptance are still required.

Real journey preflight expands ownership to ui/consent.ts focus entry and return: actual Chrome showed the focused consent action offscreen, then the return target offscreen at 200% page zoom. Allowing the existing focus transfers to scroll fixes both without changing consent decisions or dispatch. The fixture uses real margin, asking, consent and library UI with a controlled helper boundary; it proves no live provider or loaded extension behavior.

## Resolution
Closed2026-09-18 after independent bounded review and stable chief four checks:1044 total/1038 pass/0 fail/6 platform skips; root tsc, extension typecheck and build exit0. Actual Chrome keyboard journey at desktop,200% page zoom,360px and reduced motion; consent focus entry/return defects fixed, slider settlement covered. Report D:/Projects/Marginalia/.local/polish/reports/P17.md; final receipt SHA256 A7E6230BDD4E2B8FEB6B3A1328E7C389DDE78C0B5AF58D9156F0668F929C8AA8. Screenshots .local/polish/shots/P17/. Controlled helper fixture only; native/provider and assistive-tech live gates remain open.
