# TICKET T-05 — sandboxed insert widget

Status: open  
Model / effort: Luna, xhigh — deterministic bulk and security checks  
Outcome: Add a one-widget-per-section simulation in a sandboxed iframe with no network or parent access.

## OWNS

- `src/widget.js` — new payload validator and iframe builder.
- `src/tools.js` — additive `insert_widget` registration and validation.
- `src/render.js` — additive widget card and removal wiring.
- `.scratch/agora/results/T-05-insert-widget-sandbox/` — report and evidence.

Do not edit source text, `state.js`, tests, fixtures, style, or deployment files. Reuse the paper-viz scene wrapper as a payload shape. Do not add a package.

## Depends on

`T-04-worker-snapshot-store`. The figure surface from `PRO-EXPEDITION-01` must already be integrated.

## Acceptance check

Run both existing test pages and require `ALL PASS`. Insert a gold-foil test widget and inspect the iframe: `sandbox="allow-scripts"` is the only sandbox token, the CSP has no network source, and attempts to use `fetch` or `parent.` fail. Confirm one widget per section, a size cap, a removable agent card, and unchanged source text.

## Stop condition

Stop if the widget needs `allow-same-origin`, `allow-top-navigation`, a network dependency, or a parent bridge. Stop after two distinct failed sandbox checks and report the security boundary.

## Size estimate

Medium to large, about 2–5 hours.
