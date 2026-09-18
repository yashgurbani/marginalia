# E13 Stage 3 non-gated renderer items

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Sol medium

## Task
`docs/FEATURE-STRATEGY-2026-09-18.md` Stage 3, non-gated parts: classification title suppression at `renderer/index.ts:237-257` (verify the [U] claim first; fix only if real); make `illustration` required when a model block is present (it is optional today); add a second criterion beside `growth-v1` following the same interpreter contract. Leave `grid`/`samples` naming for H07.

Also close fidelity-ledger row 51 using the bounded Stage 2 addition in `docs/STAGE2-3-DESIGNS-2026-09-18.md`. Introduce an explicit contract-level distinction between descriptive copy and result claims across reply types/schema/instructions, daemon validation, renderer admission and host-check contracts. Legacy replies keep their original text available but gain no checked status through migration. A model-authored declaration or generic check cannot certify arbitrary title, summary or ordinary prose.

## Acceptance
- Renderer tests for each item; a model block without an illustration is rejected with a plain reason.
- Fixture under `fixtures/` for the second criterion accepted by the closed form and the probe.
- Schema and validation require each result-like claim to be admitted as an explicit result claim or rendered as unassessed descriptive copy; only a matching host-backed result may appear checked.
- Adversarial fixtures place the same unsupported numerical conclusion in title, summary, ordinary text and classification. Every location is withheld from checked authority until matching host evidence exists.
- Compatibility coverage proves legacy title/summary/text remains readable without being silently promoted to checked authority.
