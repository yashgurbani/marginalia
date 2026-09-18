# H13 G13: a replacement selection does not re-anchor

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: (none)
route: Fable with Yash; Astra executes the outcome

## Question
Selecting a new passage while a draft or question is open does not re-anchor the draft. Should it, or should the margin ask?


## Fable's recommendation
Ask, in one line under the composer: "Attach to the new passage?" with Keep and Switch. Silent re-anchoring loses the reader's place; silent ignoring loses their intent.

## Resolution
Yash decided on 2026-09-18: "Ask with Keep and Switch". Preserve the draft and original attachment until an explicit Switch. Selection and either choice send nothing. Add a bounded implementation ticket with draft-preservation and no-send tests. Evidence: H13 answer in task `01a0b26e-cc90-73b2-8688-de014bcacd80`. Decision by Yash; implementation remains open.
