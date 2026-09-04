# TICKET T-01 — prerequisite insets

Status: open  
Model / effort: Terra, High — mid-judgment UI and source-preference work  
Outcome: Add the `prerequisite` annotation kind as a removable, attributed inset before a section.

## OWNS

- `src/prerequisite.js` — new validator and inset renderer.
- `src/render.js` — additive mount and display hunk only.
- `src/tools.js` — additive `prerequisite` validation hunk only.
- `.scratch/agora/results/T-01-prerequisite-insets/` — report and evidence.

Do not edit `src/state.js`, `src/knowledge.js`, `src/style.css`, tests, fixtures, or deployment files. Use the existing artifact contract and keep the source text untouched.

## Depends on

`PRO-EXPEDITION-01`. Also wait for `T-06-connections-graph-fallback` when that conditional ticket is dispatched, because deferral order places the graph first.

## Acceptance check

Run `python -m http.server 4173`, then open both `tests/render.test.html` and `tests/tools.test.html`. Each page must print `ALL PASS`. In the live page, call `annotate({section_id,kind:"prerequisite",title,text_md,sources,reason})`. Confirm that the inset is visually separate, source text is unchanged, the source or `generated` badge is visible, the inset collapses, and Remove deletes only the artifact. Reject more than 600 words and a non-generated inset without sources with `next_step`.

## Stop condition

Stop after two materially different validator or renderer attempts if the existing tests fail or the inset requires a state or style file outside this boundary. Report the failed gate and keep source immutable.

## Size estimate

Medium, about 2–4 hours including browser evidence.
