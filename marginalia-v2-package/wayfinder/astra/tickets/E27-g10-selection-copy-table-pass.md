# E27 G10: selection dead ends and copy-table pass

label: wayfinder:task
mode: AFK
status: open
blocked_by: H10
route: Sol medium

## Owner outcome

H10 remains the owner gate for the approved selection copy table. Use H03's approved
reader vocabulary: Keep, Note, Ask and Library. Do not invent a second identity or
move privileged sending into an injected page card.

## Task

Implement the bounded selection and reader-copy pass from
`docs/PRODUCT-QUALITY-PLAN-2026-09-18.md` P1/P7 and its copy table. In
`ui/margin.ts`, a stray selection offers a focused card without forcing the panel
open or latching reading position; every path leads to Keep, Note or Ask or gives a
plain reason. Centralize the duplicate intent/no-definition strings in
`ui/intent-labels.ts` and consume them from `ui/margin.ts` and
`ui/asking/mount.ts`. Apply only the approved copy-table rows in those files.

Owned source areas: `ui/margin.ts`, `ui/asking/mount.ts`, new
`ui/intent-labels.ts`, and the named tests. E20 owns the stable suggestion set and
exposure record; consume its offers without duplicating that implementation. Tests: `tests/margin-entry.test.ts`,
`tests/margin-management.test.ts`, `tests/asking-mount.test.ts`, and
`tests/asking-flow.test.ts`. E16 owns saved-solver/renderer/consent copy; cross-
reference E16 instead of duplicating those changes.

## Tests

- Extend the named margin, asking-card and asking-flow tests for stray selection, focus, keyboard, 200% zoom fixture behavior, exact vocabulary and every changed copy-table row.

## Acceptance

- A selection event leaves the panel collapsed and does not call `hold`; activating the card focuses it and the visible actions are reachable by keyboard.
- Keep, Note and Ask preserve their distinct local/send boundaries; selection and copy changes produce zero implicit request, retrieval or solver calls.
- Intent labels and no-definition copy are single-source, consistent, and use the approved vocabulary with no engineering terms in reader copy.
- Tests cover selection, focus, keyboard, 200% zoom fixture behavior and every changed copy-table row; record totals in `docs/REPORT-E27-2026-09-18.md`.

## Hard limits

No privileged sending in the page card, source mutation, draft discard, E16-owned
copy rewrite, or new identity decision. This packet remains blocked by H10.
