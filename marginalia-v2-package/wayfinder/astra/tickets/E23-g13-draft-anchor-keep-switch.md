# E23 G13: preserve a draft anchor with explicit Keep or Switch

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: H13
route: Sol medium

## Owner outcome

H13 is authoritative: when a new passage is selected while a note or question
draft is open, ask “Attach to the new passage?” with Keep and Switch. Keep preserves
the original attachment; Switch changes it only after the explicit choice. Selection
and either choice send nothing.

## Task

Add the bounded replacement-selection flow for both note drafts and question drafts.
Keep the draft text, original `QuoteAnchor`, source capture and revision unchanged
until Switch is chosen. Switch must persist the new anchor through the existing
draft/question buffers and then render the new attachment. Do not silently re-anchor
or discard a draft.

Owned source areas: `ui/margin.ts` selection, note-draft and question-draft state;
`ui/persistence.ts` only for the existing draft/question persistence seam; the
current anchor types in `contracts/reader.ts` only if required. Tests belong in
`tests/margin-entry.test.ts`, `tests/margin-note-editor.test.ts`,
`tests/margin-management.test.ts`, and `tests/asking-flow.test.ts`.

## Tests

- Extend the named margin and asking-flow tests with A/B selection, Keep, Switch, reload and zero-send assertions for both note and question drafts.

## Acceptance

- With A attached and B selected, the exact prompt and only Keep/Switch choices are visible.
- Keep retains A, exact draft text, note revision and question context; Switch changes to B only after its click.
- Reload/reopen retains the chosen attachment and never guesses a replacement.
- Selection, Keep and Switch produce zero prepare, consent-decision, start, follow-up, model, retrieval or saved-solver calls.
- No source text, existing thread identity or note content is mutated.

## Hard limits

No implicit send, automatic re-anchoring, identity migration, or new identity
decision. Record the named test totals in `docs/REPORT-E23-2026-09-18.md`.
