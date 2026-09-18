# Extract the reading-position and rail controller

status: open
type: build
blocked by: Whole-page Save and Park; Three offers plus More

## Goal
`ui/margin.ts` has 1,636 lines and `mountMargin` owns most state. The Astra ticket "Decompose ui/margin.ts" (E06) set a target of concern-specific modules under 400 lines, and it is unmet. Take the first slice: the reading position, size-by-distance and rail logic (`ui/margin.ts:321`, `:473`, `:483`, `:922`).

## Owned paths
`ui/margin.ts`, new `ui/margin/reading-position.ts` and its types. CSS stays unchanged.

## Acceptance
- Behavior is unchanged. Existing margin tests pass without edited expectations.
- The public API of `mountMargin`, focus keys, labels and class names are unchanged.
- The hold while typing, sliding or focused still works. The resume line and the narrow-sheet focus return still work.
- No second owner appears for draft or reply state. Reuse `ui/margin-model.ts`, `ui/note-editor.ts`, `ui/asking-host.ts`, `ui/solver-recompute.ts`.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P18.md`

## Stop
Stop after this one module. Threads, composer, settings and the narrow sheet are later tickets.
