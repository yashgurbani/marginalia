# 16-renderer-block-set

label: wayfinder:grilling
mode: HITL
status: open
blocked_by: 02-artifact-contract-v1

## Question

Which typed blocks the packaged renderer supports at launch, the bounded expression grammar, integrator caps (steps, horizon, state size), grid caps, and which later transforms (1-D PDE grids, iterated maps with many states, diagrams with more than ~60 nodes) need a precomputed-grid job instead of the local kernel. Resolve during T18.

## Resolution

(open) Launch set: text, equation, model (ODE ≤ 6 states; maps), plot, derived, classification, table, diagram, steps, compare, question, turn, citations, shelf, samples (with envelope), solver (path-3 reference), media (declared; capability-gated). Rule: blocks describe models and content, never interface behaviour. Grammar: arithmetic, comparison, pi e sqrt exp log sin cos tan atan abs min max; no other calls, no loops. Caps to be set from measured render time on a 2019 laptop: target < 16 ms per slider step.
