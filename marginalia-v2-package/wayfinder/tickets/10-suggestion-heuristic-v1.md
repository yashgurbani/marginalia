# 10-suggestion-heuristic-v1

label: wayfinder:task
mode: HITL
status: closed
blocked_by: 07-alpha-transform-set

## Question

Write the v1 tables: block type -> transform relevance, page type weights, friction penalties, and the exposure log schema (context, eligible set, chips with positions, choice or no choice, latency, policy version, outcome). Decide the ambient-exposure default (off) and the whitelist UI.

## Resolution

Resolved. Stable additive rule with a hard eligibility gate (capability, grant); positions frozen once rendered; explicit no-choice exposure logged; difficulty signals drive ambient exposure only and make no comprehension claim; conditional logit with an outside option later, opt-in, with a measurable benefit.
