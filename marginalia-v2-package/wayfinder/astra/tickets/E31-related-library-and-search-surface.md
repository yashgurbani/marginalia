# E31 Add the reader-facing related-library and search surface

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
Close the confirmed gaps in fidelity-ledger rows 06 and 92:

- Row 06: “a link to something you already read.”
- Row 92: “Search across everything you saved, with answers that cite the passage.”

At source head `bdfe8d7`, the library navigates saved threads (`webapp/main.ts:40-81`) and the daemon stores an FTS copy (`daemon/store.ts:76,214`), but there is no reader search or related-item match. Do not pass the saved-thread shelf off as matching, and do not pass FTS storage off as a cited answer.

Build local search first. Results identify the saved source and exact passage. Related items use a bounded, inspectable local match; any later model synthesis is a separate, explicitly reviewed request.

Ledger row 93 (“Related in your library” on every page) remains unverified under Q02 and is not accepted by this source finding alone.

## Acceptance
- A reader can search saved work and open the cited passage without a model request.
- A related result explains the local match and never labels generated text as evidence.
- Removing a thread removes its searchable material under the H09 erasure decision.

