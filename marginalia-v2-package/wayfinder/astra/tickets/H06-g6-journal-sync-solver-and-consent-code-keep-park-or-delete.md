# H06 G6: journal, sync, solver and consent code: keep, park or delete

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: (none)
route: Fable with Yash; Astra executes the outcome

## Question
About 4,500 lines serve deferred futures: `ui/journal.ts` (639) and `persistence.ts` (477), `daemon/solver` (about 2,522), consent (about 840), helper management in the margin, the library-entry duplicate, and v1 WebMCP `src/tools.js`. Keep, park or delete each.


## Fable's recommendation
Park everything except the v1 WebMCP tools, which delete. Parked code stays compiled and tested but is not surfaced. The solver is the flagship demo's engine and stays. Deleting the journal reducer now would undo M9, which routes per-note removal through it.

## Resolution

Yash explicitly delegated this decision on 2026-09-18: "Not sure, take a call". Astra decides to retain the working mutation journal, persistence, consent and solver code. They serve current behavior; no verified dependency analysis supports removal. Do not park active features or delete the v1 tools by category. A later removal requires a module-specific dependency review and its own ticket. This supersedes Fable's blanket parking/deletion recommendation. Evidence: owner response in task `01a0b26e-cc90-73b2-8688-de014bcacd80`. This records the decision, not implementation acceptance.
