# Marginalia — Final Design Brief (for Claude Design) — rev 2

Rev 2, 17 September, after Astra's design review of pass 1. Pass 1 (frames 1–5) is accepted for direction: keep the quiet margin, the restrained blue accent, notes senior to replies. The §Pass 2 section at the end lists what must change in 1–5 and what 6–14 must add, each with an acceptance test.

Register: product. Design serves the reading. The bar is earned familiarity: a reader fluent in Chrome, Readwise, Hypothesis or Notion should trust it on sight. The tool disappears into the text.

## Scenes (design for all of them; the margin must be the same product in each)

- A researcher doing a literature review at a desk in daylight: twelve PDFs and arXiv pages in a week, notes across them, threads that must reattach next month.
- A graduate student at 23:00 in a dim room with one hard paper: a definition, one simulation, back to reading.
- A developer inside a documentation site: a procedure block, a run-this example, a note that says "this contradicts the API reference?".
- A product manager on a competitor's website: what this is, what it claims, what supports it, save and park.
- Someone who arrived from Twitter reading a long blog post: an unfamiliar term, a contested claim, "go further" at the end.
- A news reader: who wrote this, when, what the numbers rest on; nothing more unless asked.

Consequences: both themes are first-class and follow the system; the top zone adapts to page type (paper, docs, article, news, reference) without the reader noticing a mode; density and vocabulary suit a first-time reader and a specialist at once; no scene ever sees a chat window.

## Voice

Quiet, non-distracting, intellectual, cozy. A reading lamp, not a dashboard. Invites thinking, reflection and organization. No AI-esque overwhelm: no badges, pills, eyebrow labels, sparkles, gradient text, glass, side-stripe cards, "AI" icons, confidence meters, or explanations of what the AI is doing. The interface is quieter than the text.

## Extension conventions (looked at, and where we stand)

- Chrome's side panel API is the native home for a persistent companion; it does not intrude on the page layout, follows the browser theme, and keeps a familiar width (about 360 px). Use it where available; inject a floating panel with the same content where it is not (ChatGPT desktop browser, Firefox). Same design, two hosts.
- Hypothesis shows the sidebar-plus-in-page-anchor pattern works for annotation; its highlight colour and card style are the familiar baseline for reader marks.
- Highlighters (Glasp, Liner, Weava) show what to avoid: colour-coded highlight rainbows, floating toolbars on every selection, badges. One highlight colour. One small card, only when you ask.
- Readwise Reader and Matter show a calm reading register; Notion shows restraint in controls. Borrow their quiet.

## The structural model (design this first)

The margin is a column in page order, scrolling with the page.

Top: page identity in one or two lines, an optional collapsed context line, "assumes:" terms (only after the site grant), "you were here"; never more than a quarter of the panel by default. Middle: your notes and highlights in anchor order, the agent's replies indented beneath, one marker per section, a one-line "write here" affordance at the reading position that expands on focus; full size at the viewport, one line a section away, a tick beyond — compact by size and excerpt, never by fading ink. The reading position follows the page while idle and holds while a note, slider, assumption editor or keyboard focus is inside an item; a quiet "follow reading" releases it. Bottom: threads here, related in your library, save, park, hear it; at the end of the page "think with it" and "go further". Collapsed: a rail with ticks, rule lines, one building dot, one sending dot (distinct), a hairline density strip, and the coloured page map (held). Below 900 px the rail opens a sheet with one passage and its reply and a quoted breadcrumb.

Notes are visually senior to replies. Replies are indented and lighter. Nothing expands on its own except the item at the reading position. Nothing reorders under the pointer.

## Screens (in this order)

Screens 1–10 cover the article scene on the Navier–Stokes post; 11–14 cover the other scenes and reply kinds. All are in the design base; the build order is in BUILD-PLAN-24H.md and is a different list.

1. Column on a fresh page (Navier–Stokes post): top expanded, section markers, write-here line, bottom. Then the same column after ten minutes: two notes, a highlight, one reply, compact and tick items above and below.
2. Rail.
3. Ask card at a selection: the document's own definition showing first when it exists ("from this page"); Keep; one Ask that expands to at most three suggestions with a time word on deep ones and a free-text line; Park in the action row; anchor state shown only when not exact, as a small word (moved / unsure / lost). Selecting sends nothing.
4. Building: Working with the plan line, a first frame that is visibly provisional until checks pass, Ready; cancel; elapsed time after 30 s; the pending-question line with its default taken; the dock item when scrolled away; a single soft pulse on completion; Unknown outcome with an explicit retry.
5. Reply, simulation (corrected fixture: damping γ, forcing f, start y0): one visible line under the title — "Illustration of self-amplifying growth. Not the paper's fluid model or a reproduction of its result."; the plot; sliders with units; the classification sentence that agrees with the closed form ("Still rising at 8 s. This model diverges at 32.4 s."); variable names that light the phrase in the page on hover, and only an explicit action scrolls; two text actions "Source passage" and "How this was made", with the where-from glyphs as a supplement; "What this example assumes (3)" collapsed; follow-up field; back to the anchor. A failed check as a plain sentence. Static state when the kernel cannot run.
6. Reply, definition: complete in itself; dismiss.
7. Note: writing one with its anchor shown as text ("Note on 'Viscosity pulls toward…' · Change"), frozen when writing starts; "whole page" as a deliberate choice; Save plus Enter accelerator with a Shift+Enter hint and draft recovery; a "?" ending offering Ask (never sending); a reply quoting the note version it answers.
8. Thread: versions and siblings, thread state (open · parked · done · archived), remove with an Undo that pauses on focus, removed items visible in thread history.
9. Calm states: helper absent (reading, notes and cached threads still work), Codex not signed in, sandbox unavailable, excluded site (no action offered that would be refused), unsupported selection, disconnected with work preserved and explicit retry, "updated in another tab". First-send sheet inside the margin: "Send this passage to Codex", the exact passage and notes, an expandable context list, the recipient, and This time / Always on example.org / Never on example.org; a second, narrower sheet when a request needs the web.
10. Settings, one page: model per tier, site grants (revoke), excluded sites, vocabulary list (origin per entry, delete), export. Pairing: the six-digit challenge screen and the paired state with revoke.
11. PDF viewer (extension page on PaperCraft's overlay model): the paper with the same margin; selection on rendered math with the TeX captured; a reply anchored to a bounding box; page thumbnails as the rail's ticks; the researcher's twelve-paper week in the library bottom zone.
12. Evidence reply (on the "Concurrent work" passage): the author's claim in one line; what supports it, with source and date per item; what is contested; a "fetched" glyph; a note that this reply used the network. Also its calm state before consent: "this needs to look things up on the web; allow this time / always here / not here".
13. Explore reply (end of the post): a shelf of three to five items, each with a one-line reason (cites this, a lecture on this derivation, argues the opposite), a timestamp on video items, parked to the thread by default, opened only on click.
14. Docs and news scenes: the column on a documentation page (procedure block, run-this reply) and on a news article (top zone with who, when, what the numbers rest on; nothing else unless asked).

## Craft rules (from /impeccable, product register)

- Typography: one family, the system stack (SF Pro, Segoe UI, Inter fallback). Fixed rem scale, ratio 1.125, four sizes, two weights. Body ≥ 4.5:1 contrast; do not use light grey "for elegance". Prose line length ≤ 70ch. `text-wrap: pretty` on replies.
- Colour: Restrained. OKLCH. Neutrals tinted 0.005–0.015 toward one accent hue; no cream or sand body. One accent (≤ 10 % of surface) for the current selection, focus, and the building dot only. A second neutral for the margin surface, slightly different from the page. Highlight: one colour, low chroma, high L in light theme, inverted in dark.
- Layout: the margin is a linear column; the only card is the reply; never a card inside a card; hairlines and spacing carry hierarchy, not boxes or shadows. Semantic z-index scale.
- Components: every interactive element has default, hover, focus, active, disabled, loading, error. Skeleton lines for loading, never a spinner in content. Empty states teach in one line.
- Motion: 150–250 ms, ease-out-expo; state changes only; the completion pulse is one soft opacity rise and fall; reduced-motion gets an instant change.
- Copy: verbs, not nouns. Keep · Ask · Park · Done · Back. Time as a word ("~1 min"). No "AI", "generated", "confidence", "tethers" (say "note on" / "attached to"). "What this example assumes" alongside "assumptions". Empty definition: "No definition found for this selection. Ask about a word or phrase." — never a claim about what the reader knows. Where-from is a glyph with a hover label, supplementing the two text actions.
- Accessibility: WCAG 2.2 AA; keyboard for everything (1 2 3 for suggestions, / for free text, K keep, P park, Esc close; visible Park too); focus handoff between page and panel explicit; stable prefixed IDs so re-render never drops focus; live region announces "ready" without moving focus; 200 % zoom; strokes stay thin but hit areas ≥ 24 px (28–32 px in dense rows); reduced motion disables colour and tooltip transitions too, or the promise is narrowed.
- Two hosts, one design: side panel and floating panel share tokens and components; the floating panel adds only a drag handle and a close.

## Deliverables

Frames for screens 1–14 in both themes at 360 px width (and 440 px for the floating host); component sheet (item at three sizes, ask card, suggestion, reply, note, section marker, rail, dot, glyph line, assumptions line, follow-up field); tokens in OKLCH; type scale; motion spec; accessibility notes per component; handoff spec. Design against the real Navier–Stokes page, with the note texts and the reply JSON from BUILD-PLAN-24H.md as data.

## Not in this design (later, inheriting these tokens)

Journeys and the journal as pages, the full library home, onboarding beyond settings, voice and image replies.

## Pass 2 (acceptance criteria; from Astra's review, accepted)

Changes to frames 1–5:

1. Simulation copy and classification (frame 5): rename ν to damping γ with a visible unit; the classification sentence comes from the analytic rule, not from the plotted window (regression set: divergence beyond the horizon, convergence, threshold equality, zero forcing, changed start); "the curve leaves the shown range" is separate from "the model diverges at T"; the illustration line sits under the title; remove "that is why the Euler case could fall first". Accept when a reader can tell, without hover or settings, which content is quoted, computed, an analogy, or fetched.
2. Held reading position (frames 1, 5): scroll the source while a slider is focused, type while a build finishes, hover a binding outside the viewport, click a near-end section, return from Back — no field or control disappears; the chosen section stays chosen; focus returns to a meaningful target. Notes stay in anchor order.
3. Head and note affordance (frame 1): page identity in one or two lines; context summary collapsed; the write-here line is one line until focused. Accept when note, reply title and the first useful frame fit together in a 360 × 600 panel.
4. Compactness by size and excerpt, not ink (frame 1): no opacity below full ink on any note; validate composited colours in both themes.
5. Targets and IDs (frames 2, 5): hit areas ≥ 24 px with thin strokes; every rendered instance has a prefixed ID; one style attribute per element; hover/focus labels on rail controls and a visible current-section cue.
6. Ask card (frame 3): definition first when the page has one; Keep; one Ask entry that expands; visible Park; no send on selection.
7. Building (frame 4): provisional first frame; failure as a plain sentence; unknown outcome with retry.

Frames 6–14 add: explicit note attachment with Change (7); versions, undo that pauses, thread history (8); the first-send sheet, persisted denial, disconnected-with-retry, excluded site with no false affordance (9); grants and pairing (10); evidence and explore as reply variations with their own web-grant sheet and claim-level citations, not new surfaces (12, 13); PDF, docs and news as the same product with different source metadata (11, 14). Validate four cases in both themes and both hosts: a novice reading a definition, a scientist inspecting an illustration, a researcher returning to a moved source, a keyboard-and-zoom user making and reopening a note.
