# Feedback on pass 1 (frames 1–5) — paste into the design session

Direction accepted: keep the quiet margin, the restrained blue accent, notes visually senior to replies, the OKLCH tokens, the type scale, and the coloured page map in the rail. Do not add components. Fix the following in frames 1–5, then continue to 6–14 per DESIGN-BRIEF-FINAL.md rev 2. Each item has an acceptance test; the frame is done when the test passes in both themes at 360 px.

## Frame 5 — simulation reply (highest priority)

1. Rename ν to **damping γ** with unit 1/s. Sliders: damping γ, forcing f (1/s²), start y0. No "viscosity" anywhere in the controls.
2. Directly under the title, one visible line, full ink, not a tooltip: *"Illustration of self-amplifying growth. Not the paper's fluid model or a reproduction of its result."*
3. The result sentence comes from the rule, not from the plotted window. Default (0.5, 0.07, 0) reads: *"Still rising at 8 s. This model diverges at 32.4 s."* Show also: (0.5, 0.2, 0) → "Diverges at 5.8 s"; (1, 0.2, 0) → "Settles near 0.28"; (0, 0.01, 0) → "Diverges at 15.7 s". "The curve leaves the shown range" is a separate, smaller line from "the model diverges".
4. Remove "That is why the Euler case could fall first."
5. Replace the where-from glyph line as the only origin cue with two short text actions under the plot: **Source passage** · **How this was made**. Glyphs may remain beside them. Test: without hover or settings, a reader can say which parts are quoted, computed, an analogy, or fetched.
6. Rename "assumptions (3)" to **"What this example assumes (3)"** (keep "assumptions" as the technical alias in the component sheet).
7. Add the failed-check state as a plain sentence: *"The calculation did not reproduce its starting value. Try again."* No raw diagnostics.
8. Hovering a variable name lights the phrase in the page; it does not scroll the page. Only "Source passage" scrolls.

## Frames 1 and 5 — held reading position

9. Reading position follows the page while idle and **holds** while a note field, a slider, an assumption editor, or keyboard focus is inside an item. Add one quiet "Follow reading" affordance that appears only when the reader has deliberately held another location. Notes stay in anchor order; no newest-first inbox in the current section.
   Test: scroll the source while a slider is focused; type while a build finishes; click a near-end section; return from Back. No control disappears, the chosen section stays chosen, focus lands on a meaningful target.

## Frame 1 — head and write-here

10. Head: page identity in one or two lines; the context summary collapsed to one line; "assumes:" terms only after the site grant (show the pre-grant state too). The head never exceeds a quarter of a 360 × 600 panel by default.
11. The write-here affordance is **one line** until focused, then expands. Test: note, reply title, and the first useful visual frame fit together in a 360 × 600 panel in the ten-minute state.
12. Compactness by size and excerpt, never by fading ink: remove the 0.58 opacity on older notes. One-line excerpts at full ink. Validate composited colours in both themes.

## Frame 2 — rail

13. Keep strokes thin; expand transparent hit areas to ≥ 24 px (28–32 px in dense rows). Add hover/focus labels on rail controls and a visible current-section cue. One style attribute per element.
14. Add a second, distinct dot for **sending** (data leaving the machine) beside the **working** dot.

## Frame 3 — ask card

15. Order: the document's own definition first when the page has one, marked "from this page" (no send); **Keep**; one **Ask** entry that expands to at most three suggestions with a time word and a free-text line; **Park** visible in the action row (not only the P key). Selecting sends nothing — show that state.
16. Empty definition copy: *"No definition found for this selection. Ask about a word or phrase."* Never a claim about what the reader knows.

## Frame 4 — building

17. States: Working (plan line) → first frame **visibly provisional** (dashed, labelled) until checks pass → Ready → the single soft pulse. Add: Cancelled, Failed (plain sentence), and **Unknown — try again** with an explicit retry and nothing automatic.

## Accessibility, all frames

18. Stable prefixed IDs per rendered instance so re-render never drops focus; "ready" announced via live region without moving focus; Undo pauses while focused; reduced-motion also disables colour and tooltip transitions (or narrow the promise in the notes).
19. Replace "tethers" with "note on" / "attached to". "Hear it" shown as a plainly labelled unavailable state, not a toast that pretends.

## Then frames 6–14

Per DESIGN-BRIEF-FINAL.md rev 2 §Screens and §Pass 2: explicit note attachment with Change (7); versions, undo, thread history (8); first-send sheet with the exact passage, recipient, scope, and This time / Always on example.org / Never on example.org; persisted denial; disconnected-with-retry; excluded site with no false affordance (9); grants and pairing (10); evidence and explore as reply variations with their own web-grant sheet (12, 13); PDF, docs, news (11, 14). Validate four cases: novice reading a definition; scientist inspecting an illustration; researcher returning to a moved source; keyboard-and-zoom user making and reopening a note.
