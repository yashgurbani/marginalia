# H14 M10: multiple anchors per thread

label: wayfinder:grilling
mode: HITL
status: open
blocked_by: H06
route: Fable with Yash; Astra executes the outcome

## Question
SPEC-FINAL line 80 asks for additional passages on one thread. This changes the data model (`QuoteAnchor` becomes a list). Now, later, or never?


## Fable's recommendation
Later, Stage 3, after the FTS decision and the library export land, so the migration happens once. Not never: the whitepaper's argument-following use depends on it.
