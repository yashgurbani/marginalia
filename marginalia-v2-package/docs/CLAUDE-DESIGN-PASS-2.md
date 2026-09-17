# Claude Design continuation: frames 6–14

17 September 2026. Ready-to-send brief from the Marginalia build chief. This extends the existing design system; it does not replace the governing product spec.

## Context to supply

- Finished pass 1: `D:\UserData\reader\Downloads\marginalia-v1-package\design` (DESIGN-SYSTEM.md, tokens.css/json, margin.css, data.js, render.js, marginalia-margin.html).
- Governing product: `D:\Projects\Marginalia\marginalia-v2-package\wayfinder\SPEC-FINAL.md`.
- Full frame brief: `D:\Projects\Marginalia\marginalia-v2-package\wayfinder\DESIGN-BRIEF-FINAL.md` (rev 2).
- Current build report: `D:\Projects\Marginalia\marginalia-v2-package\BUILD-STATUS.md`.

If local paths are unavailable in Claude Design, attach these files or paste the relevant content. A path alone does not give Claude access.

## Prompt

Continue Marginalia with frames 6–14, using your finished pass-1 design system and the rev-2 design brief. Preserve the same quiet margin, typography, OKLCH tokens, restrained blue, hairline structure and six-colour page map. This is a reading companion beside the source. Notes remain visually senior and full ink; replies sit beneath them. Source text stays unchanged. Do not turn the margin into a chat window or dashboard.

The implementation now has the basic column, rail/map, local selection/Keep/Ask preparation, anchored notes, drafts, note states, undo and helper pairing/sync. Rich replies, complete model flows and final lifecycle integration are still in progress. Existing screenshots are development evidence, not a new visual specification. Continue the full intended product; do not reproduce temporary disconnected implementation states as the only design.

### Frame scope

| Frame | Design |
|---|---|
| 6 — Definition | A concise, complete contextual definition with dismiss and return-to-reading. Show the page's own literal definition first when available, labelled “from this page”; otherwise explicit Ask. No automatic inference on selection. |
| 7 — Note | Visible frozen attachment, Change, deliberate whole-page choice, draft recovery, Save/Enter and Shift+Enter. A trailing question mark offers Ask, never sends. A reply quotes the exact note version it answers. Include a saved note and an edited note with an older reply below it. |
| 8 — Thread | Sibling replies versus successive versions, newest expanded, kept history preserved, open/parked/done/archived, Remove and Undo that pauses on focus, removed items in history. Source moved/unsure/lost states preserve the original excerpt and invite explicit resolution. |
| 9 — Calm states and consent | Helper absent, Codex signed out, unavailable execution, excluded site, unsupported selection, disconnection, unknown outcome, update in another tab. Show exact outgoing passage/notes, recipient and scope before This time / Always on this site / Never on this site. Web access has a separate narrower grant. Include the recovery states below. |
| 10 — Settings and pairing | One quiet page for model choices, revocable grants, exclusions, vocabulary with origin/delete, and inert export preview. Six-digit helper pairing, paired state and revoke. Model labels should be understandable without exposing internal “tier” terminology. |
| 11 — PDF | The same margin beside the PDF, math selection, page/bounding-box attachment, thumbnails related to the rail, and related saved papers in the bottom zone. No separate product identity. |
| 12 — Evidence | Original claim, dated support per claim, disagreement/insufficient evidence, meaningful citation links and fetched-source indication. Show its pre-web-consent state too. No confidence badge or unsupported “verified” stamp. |
| 13 — Explore | Three to five links with specific one-line reasons, video timestamps where applicable, parked by default and opened only by explicit action. An end-of-reading continuation inside the same margin. |
| 14 — Docs and news | Documentation procedure/run-this example, plus news with author/date/basis of numbers in the header. Same structure and components; no extra assistance unless requested. Execution remains an explicit action. |

### Build and Pro feedback to incorporate

1. **Preserve the reader's work visibly.** Design a quiet distinction between “Saved on this device”, helper sync pending and an unsaved change. When another tab has a newer note, show the newer saved note and this reader's recoverable draft without silently merging or replacing either. Offer explicit comparison/recovery; no raw JSON, revision counters, journal or outbox terminology. A failed save keeps the editor and its text. A retry must not look like creating a second note.
2. **Keep the attachment explicit.** The note's passage freezes when writing starts. Browsing elsewhere cannot move it. When a quote occurs twice or the original occurrence disappears, do not visually imply a confident attachment. Show the original quote and a deliberate choice of candidate passages. Merely finding the same text elsewhere is not enough.
3. **Hold focus and reading position.** Background completion, sync and source updates must not replace a focused field, move its caret, scroll the source or close the current control. Only explicit navigation moves the source. Keep Follow reading discoverable. Order notes by their current unambiguous attachment while preserving the original attachment in history.
4. **One page map at a time.** Expanded horizontal map and collapsed rail are two presentations of the same navigation. Do not show duplicate competing maps. Keep a non-colour current-section cue and labelled controls. Compact notes by size/excerpt, never faded ink.
5. **Two hosts with one necessary handoff.** The ordinary floating margin can read and write local notes. Connecting the helper, syncing private work and authorizing sends must occur in browser-owned UI, not inside a surface a webpage can cover or reposition. Design a quiet “Open in browser margin” handoff retaining the current passage, note and place. Use the native side panel where supported and a dedicated extension page otherwise. The local app/native margin can show these controls directly. Do not show security jargon or an alarming warning; make the next action clear and reversible.
6. **Consent is specific.** Show exactly what would leave the device, including explicitly included notes, recipient and site scope. Separate sending from working. Denial persists and is editable. Excluded sites must not show an action that immediately fails. Disconnection/unknown outcome preserves work and never silently resends.
7. **Scientific presentation stays honest.** Retain the illustration sentence under a simulation title, damping gamma with units, and the distinction between the plotted range and an independently established result. Do not equate a successful local calculation with proving the source paper. The authority of a current classification is being reconciled in the implementation: design an ordinary checked-result state and a calm result-unavailable state without inventing a green verification badge.
8. **All four interaction paths remain.** Local sliders and in-envelope samples use no model turn. Beyond a samples envelope, offer explicit recomputation using a saved solver; revising the question/model uses explicit Ask again. These are understandable reader actions, not backend selectors. Never suggest extrapolation happened silently or relabel a static illustration as the complete interactive result.

### Small refinements to pass 1

Keep the page identity short and the context line collapsed. The write-here line expands only on focus. Note, reply title and first useful content should fit together in a 360 × 600 margin. Use a readable separator between section heading and quoted body without changing the quoted source. Keep Park visible, a single expandable Ask entry and the page definition ahead of model suggestions. No control or suggestion reorders under the reader's hand.

### Deliverables

Produce frames 6–14 in light and dark at 360 px native width and 440 px floating width, including the browser-owned handoff and recovery variants. Reuse components; use annotations for repeated states instead of unnecessary duplicate screens. Include component/state updates, token changes only where needed with reasons, concise interaction/motion/focus notes, intended 200% zoom behavior, and a short list of unresolved product decisions. Supply the editable preview and implementation-ready HTML/CSS/data export in the same style as pass 1. Export to a new pass-2 folder; preserve the original package and do not edit the live implementation.

Keep this pass focused on the requested frames. Journeys, a full library home, broader onboarding, voice and image experiences remain future design work, not removed product scope. Flag any material deviation from SPEC-FINAL instead of silently simplifying it.

Testing is currently deferred. Provide design intentions and accessibility annotations; do not claim fresh browser, screen-reader, contrast or runtime verification was performed.
