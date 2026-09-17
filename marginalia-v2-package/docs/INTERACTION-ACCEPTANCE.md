# Interaction acceptance

17 September 2026. This is an implementation acceptance plan, not a report of tested behavior. Screens 1–5 are being revised externally and were unavailable for this pass. Governing sources: [final spec](../wayfinder/SPEC-FINAL.md), [design brief](../wayfinder/DESIGN-BRIEF-FINAL.md), [pass-two feedback](../wayfinder/DESIGN-FEEDBACK-PASS2.md), and [review resolutions](REVIEW-RESOLUTIONS.md).

Preserve the quiet margin, restrained blue, full-ink notes above indented replies, and source text unchanged. Use ordinary text actions and familiar inputs. Add no badges, confidence meters, chat surface, or decorative explanation of the machinery. Priorities below determine implementation order; they do not remove features from scope or supersede release gates.

## Acceptance before rich replies

| Priority | Interaction | Observable acceptance |
|---|---|---|
| P0 | First durable margin | With no helper or account, open an article, Keep a passage, write and Save a note, Park its thread, then reload. All survive with their source attachment. Cached threads remain readable. Page identity occupies at most a quarter of the default 360 × 600 panel; the collapsed write line leaves room for the reader's work. |
| P0 | Selection and asking | Selecting sends nothing. The selection card shows a quoted definition labelled “from this page” when available, Keep, one Ask entry, and visible Park. Ask opens up to three stable suggestions and a free-text field. Ranking never hides the complete available action list; permission and capability determine availability. |
| P0 | Note attachment | Beginning a note freezes its anchor and displays “Note on ‘…’ · Change”. Scrolling cannot change it. Change explicitly chooses another passage or whole page. Save and Enter save; Shift+Enter inserts a newline. Draft recovery survives interruption. A trailing question mark offers Ask and sends nothing. Replies quote the note revision answered. |
| P0 | Exact consent | The first send on a site opens “Send this passage to Codex” inside the margin. Show recipient, scope, exact passage and note revision; expandable context exposes every outgoing page fact and context text. This time / Always on example.org / Never on example.org apply to the displayed packet. If the packet changes before sending, refresh the review. Never persists across reload and remains editable in settings. No pre-grant assumed terms or automatic definitions. |
| P0 | Absent helper and reconciliation | Explain unavailability once in plain text. Keep, Park, notes, drafts and cached work remain usable. Reconnection acknowledges local mutations without duplicating them; conflicting revisions remain recoverable with “updated in another tab”, never silent replacement. An excluded site offers no sending action that will be refused. |
| P0 | Held reading position | Focus in a note, control or assumption editor holds its item. Scrolling the source or completing a build does not collapse it, reorder notes or steal focus. Explicit section selection holds that section, including near the page end. “Follow reading” releases the hold. Hover or keyboard focus on a source binding highlights without scrolling; an explicit source action scrolls. |
| P1 | Reply lifecycle | Working shows its plan; an unchecked first frame is visibly provisional; Ready is announced without moving focus. Cancel remains reachable; elapsed time appears after 30 seconds. Failed checks use plain sentences. Disconnect and unknown outcome preserve work and offer explicit retry, never automatic retry. Cancelled attempts cannot replace the visible reply with late output. |

Private notes, consent text and library context must live in an extension-origin document in either host. The floating host must not expose them to page-owned markup. This preserves the accepted appearance while applying the Pro confidentiality correction.

## Four representative journeys

### 1. A novice keeps a definition, then asks

On a fresh site with no grant, select a term to open the card. The local quoted definition appears first with “from this page”; absent a match, show “No definition found for this selection. Ask about a word or phrase.” Activate Keep using its button or K while the card has focus. A saved highlight remains after closing and reloading; no send has occurred.

Open Ask with keyboard focus and Enter. Use 1, 2 or 3 for a displayed suggestion, or / to focus the free-text field; display the same actions for pointer use. Review the exact packet, then choose This time. Only this explicit request begins a send. Sending and Working have distinct accessible labels and distinct rail marks. The ready definition can be read and dismissed with Esc; focus returns to the invoking control or source anchor. Shortcuts are scoped to the active card and never intercept typing in editable fields.

Repeat with Never on example.org, then reload: the denial remains, local reading still works, and no send starts. Evidence or Explore requires a separate, narrower web permission even when ordinary inference is permitted. Its sheet explains the requested lookup scope before any lookup.

### 2. A scientist inspects and changes an illustration

Open the simulation reply. Directly beneath its title, read: “Illustration of self-amplifying growth. Not the paper's fluid model or a reproduction of its result.” See damping γ (1/s), forcing f (1/s²), and start y0 (1/s), each with a labelled numeric input beside its slider. Tab reaches each input; arrow keys adjust a focused slider by its declared step. Numeric entry supports precise values. Invalid or out-of-domain input retains the entered text, explains the bound beside it, and does not silently clamp or evaluate.

At (0.5, 0.07, 0), show “Still rising at 8 s. This model diverges at 32.4 s.” At (0.5, 0.2, 0), show divergence at 5.8 s; at (1, 0.2, 0), settling near 0.28; at (0, 0.01, 0), divergence at 15.7 s. The all-zero case stays zero. Threshold equality and changed starts use the analytic rule. “The curve leaves the shown range” is separate from mathematical divergence. Current parameters and model identity determine current checks; stale checks cannot support a new headline. Unsupported claims are withheld. Accessible plot data exposes units and values without requiring pointer hover.

Use the text action “Expand” to enter a larger workspace with the same quote, controls, assumptions, current values and source attachment. Source and workspace scrolling are independent and predictable. “Back to margin” restores the held item, control values and a meaningful focus target. Expanding creates no new thread or reply version. Editing assumptions creates a new reply version; ordinary local slider movement does not. Reload restores current inputs and view; a follow-up includes that current state.

“Source passage” explicitly navigates to the quote. “How this was made” distinguishes the scalar illustration, its host-checked numerical result, source correspondence and any fetched evidence. A successful calculation never implies reproduction of the fluid model. Focus a binding outside the viewport: highlighting must not move the page. Move a slider, scroll the source, and wait for another build to finish: the control remains usable in place. Out-of-envelope samples offer recomputation; changed interpretations offer “ask again with this change”. Neither is disguised as local slider evaluation.

### 3. A researcher returns after the source has moved

Save a note, ask on it, then edit the note and revisit after the source layout changes. The note remains visually senior; its earlier reply quotes the earlier note text. Exact attachments need no status label. A unique relocated match shows “moved”; ambiguous or missing matches show “unsure” or “lost” with the saved quote intact. The interface never guesses silently.

Tab to Change and press Enter to choose a new attachment; preserve the saved work and attachment history. Open the thread to inspect versions and siblings in source order. Remove an item: show Undo, pause its expiry while it has focus, and keep the removed item in history. Undo with Enter restores it. This is removal, not permanent erasure. Back returns to the chosen section with focus intact; “Follow reading” resumes tracking only when activated.

### 4. A keyboard-and-zoom reader writes without the helper

At 200% zoom with the helper unavailable, reach the margin from the source through an explicit focus handoff. Tab to the one-line write affordance, press Enter, and type. The frozen quoted attachment remains visible. Enter saves; Shift+Enter adds a line. End with “?”: an Ask action appears without sending. Reload and reopen the note; its exact text and attachment survive.

Reach Keep and Park by keyboard (K and P within the card) and by labelled buttons. Below 900 px, the rail opens the passage-and-reply sheet with a quoted breadcrumb; all actions remain reachable. Esc closes the transient sheet and returns focus to its opener. Reconnect the helper and verify synchronization preserves this note. While editing, another reply becoming Ready announces “ready” once and leaves the caret in place.

## Shared visual and accessibility checks

Run all four journeys in light and dark themes, native side-panel and floating hosts, at 360 px and 440 px where applicable, plus the narrow sheet and 200% zoom. Check keyboard-only and screen-reader operation, reduced motion, and source pages with different backgrounds.

- Notes remain full ink at every compact size; composited normal text contrast is at least 4.5:1. Use size and excerpt to compact older notes. A note, reply title and useful first frame fit the default ten-minute panel state.
- Controls expose names, units, state and visible focus. Rail strokes may stay thin; their hit areas are at least 24 px, preferably 28–32 px in dense rows. Current section is visible without colour alone.
- Stable instance-prefixed IDs preserve focus through renders and version changes. Expanded views and sheets have deliberate focus entry and return; focus is never trapped accidentally.
- Reduced motion removes completion pulses and colour/tooltip transitions. No status relies on motion, colour or hover alone. Ready announcements are polite and do not repeat on every plot update.
- Source quotations, computed results, illustrative models and retrieved evidence remain distinguishable without hover. The source is never rewritten. “Hear it” is plainly unavailable until supported.

## Reconciliation and remaining judgment

The Pro changes refine the accepted surface: build durable local notes first; add numeric inputs and expansion to the existing reply; keep mutable interaction state separate from immutable replies; recompute checks for current inputs; preserve conflicts; expose all permitted actions; protect private content with an extension-origin host. None warrants a new dashboard or reduced feature inventory.

Two wording tensions need explicit implementation decisions, but do not block this plan:

1. The brief says the selection card appears “only when you ask”, while the spec says a card appears on selection. SPEC-FINAL and R1 govern: selection immediately opens the small Keep/Ask card, locally. Explicit Ask expands suggestions and the sending flow. External frames must preserve this behavior; selection never sends.
2. “No badges” coexists with a requirement for a labelled provisional frame. Use a plain inline “Provisional” sentence and restrained frame treatment, not a badge. Ready remains a status announcement rather than a permanent decorative label.

The page map is retained from the accepted direction, but the spec calls its decision held. Preserve its space and visual intent; do not infer new colour semantics or a navigation model before the external handoff. Record implemented, tested and released separately. This document establishes acceptance only; browser verification awaits an implementation and the incoming design frames.
