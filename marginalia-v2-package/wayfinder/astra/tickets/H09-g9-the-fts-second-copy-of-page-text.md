# H09 G9: the FTS second copy of page text

label: wayfinder:grilling
mode: HITL
status: open
blocked_by: (none)
route: Fable with Yash; Astra executes the outcome

## Question
`daemon/store.ts:74` keeps a second copy of captured text in an FTS5 table for library search. Drop it, or keep it as a documented erasure target?


## Fable's recommendation
Keep and document. P4 (in flight) makes erasure delete the matching FTS rows in the same transaction and adds the comment. Library search is a whitepaper feature; a second copy that erases with its source is honest.
