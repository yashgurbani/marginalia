# TICKET T-02 — per-section density chips

Status: open  
Model / effort: Terra, High — mid-judgment personalization and interaction work  
Outcome: Add per-section “more here” and “less here” controls that record a taste observation without a global density dial.

## OWNS

- `src/density.js` — new density calculation and observation helper.
- `src/state.js` — additive reader-layer storage for taste observations only.
- `src/render.js` — additive chip rendering and event wiring.
- `src/tools.js` — additive reading-state exposure if required by the frozen contract.
- `.scratch/agora/results/T-02-density-chips/` — report and evidence.

Do not alter source sections or their text. Do not edit fixtures, tests, `knowledge.js`, or deployment files.

## Depends on

`T-01-prerequisite-insets`.

## Acceptance check

Run the two existing test pages and require `ALL PASS`. On the live page, click “more here” and “less here” for two different sections. Confirm that only the selected section changes its density signal, the observation survives a state read, no global dial appears, and source text plus reader marks remain intact.

## Stop condition

Stop if taste data needs a new source-layer field or if a chip changes the current section's text before the reader leaves it. Stop after two distinct failed attempts and report the state contract conflict.

## Size estimate

Medium, about 2–4 hours.
