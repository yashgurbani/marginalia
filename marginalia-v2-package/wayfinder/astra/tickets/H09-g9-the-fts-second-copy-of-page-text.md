# H09 G9: the FTS second copy of page text

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: (none)
route: Fable with Yash; Astra executes the outcome

## Question
`daemon/store.ts:74` keeps a second copy of captured text in an FTS5 table for library search. Drop it, or keep it as a documented erasure target?


## Fable's recommendation
Keep and document. P4 (in flight) makes erasure delete the matching FTS rows in the same transaction and adds the comment. Library search is a whitepaper feature; a second copy that erases with its source is honest.

## Resolution
Yash accepted this recommendation on 2026-09-18: keep FTS as a documented erasure target deleted with its source. P4 is already merged at `6cc7eb8`; QA must verify the erasure behavior. Evidence: "Accept both recommendations" answering the combined H09/H11 question in task `01a0b26e-cc90-73b2-8688-de014bcacd80`. Decision by Yash; no implementation claim added here.
