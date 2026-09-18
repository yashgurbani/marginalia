# E12 M15: whole-library export as Markdown and W3C Web Annotation

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
`docs/FEATURE-STRATEGY-2026-09-18.md` row M15 (Stage 3, non-gated), whitepaper line 159. The library already exports single threads (`exportWork` in `ui/margin.ts`). Add a whole-library export from the library pane: one Markdown file (per page heading, quote, notes, dates) and one JSON-LD file in W3C Web Annotation shape (TextQuoteSelector from `QuoteAnchor`). Local file download only; nothing leaves the machine.

## Acceptance
- Round-trip test: export, parse, and every thread and note is present with its anchor.
- Reader language on the button ("Export everything"); no new route if the existing read routes suffice.
