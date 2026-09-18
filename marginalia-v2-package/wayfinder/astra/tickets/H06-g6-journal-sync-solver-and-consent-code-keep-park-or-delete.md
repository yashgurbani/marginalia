# H06 G6: journal, sync, solver and consent code: keep, park or delete

label: wayfinder:grilling
mode: HITL
status: open
blocked_by: (none)
route: Fable with Yash; Astra executes the outcome

## Question
About 4,500 lines serve deferred futures: `ui/journal.ts` (639) and `persistence.ts` (477), `daemon/solver` (about 2,522), consent (about 840), helper management in the margin, the library-entry duplicate, and v1 WebMCP `src/tools.js`. Keep, park or delete each.


## Fable's recommendation
Park everything except the v1 WebMCP tools, which delete. Parked code stays compiled and tested but is not surfaced. The solver is the flagship demo's engine and stays. Deleting the journal reducer now would undo M9, which routes per-note removal through it.
