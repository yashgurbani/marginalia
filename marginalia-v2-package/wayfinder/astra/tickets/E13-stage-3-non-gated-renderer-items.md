# E13 Stage 3 non-gated renderer items

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Sol medium

## Task
`docs/FEATURE-STRATEGY-2026-09-18.md` Stage 3, non-gated parts: classification title suppression at `renderer/index.ts:237-257` (verify the [U] claim first; fix only if real); make `illustration` required when a model block is present (it is optional today); add a second criterion beside `growth-v1` following the same interpreter contract. Leave `grid`/`samples` naming for H07.

## Acceptance
- Renderer tests for each item; a model block without an illustration is rejected with a plain reason.
- Fixture under `fixtures/` for the second criterion accepted by the closed form and the probe.
