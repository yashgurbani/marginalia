# E25 G4: Keep underline and Highlight tint

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: H04
route: Sol medium

## Owner outcome

H04 is authoritative: Keep uses the existing underline treatment; Highlight is an
explicit local action with a tinted background. Use one palette, preserve existing
marks during migration, and keep both actions local.

## Task

Adapt the Stage 2 Keep-versus-Highlight design. Current seams include the `highlights`
table and Keep path in `daemon/store.ts`, local journal projection in `ui/journal.ts`,
`paintHighlights` in `ui/margin.ts`, and the Custom Highlight bridge in
`extension/entrypoints/content.ts`. Add an explicit highlight toggle and persist its
state through the existing local/helper synchronization path. Render Keep as an
underline and Highlight as tint; preserve old highlight rows and never reinterpret
them silently.

Owned source areas: `contracts/reader.ts`; `daemon/store.ts`; `ui/journal.ts`;
`ui/margin.ts`; `ui/margin.css`; `extension/entrypoints/content.ts`; named tests
only. Tests belong in `tests/reader.test.ts`, `tests/store.test.ts`,
`tests/margin-entry.test.ts`, and `tests/margin-management.test.ts`.

## Tests

- Extend the named reader/store/margin tests for old-mark migration, Keep versus Highlight, local/helper persistence, reload, removal and source-node identity.

## Acceptance

- Keep creates/retains the passage and thread with the underline treatment; it does not silently add a new tint.
- Explicit Highlight adds/removes the tinted mark and survives reload and helper synchronization.
- Existing marks survive migration with their visible meaning preserved; removing a highlight leaves the note, thread and source text intact.
- Source nodes are never wrapped or rewritten; temporary focus highlighting remains distinct from saved marks.
- Tests cover local persistence, helper round trip, reload, undo/removal and selection continuity; record totals in `docs/REPORT-E25-2026-09-18.md`.

## Hard limits

No source mutation, note/thread deletion, provider request, telemetry, or new identity
decision. H04 is the closed owner decision; implementation is still open.
