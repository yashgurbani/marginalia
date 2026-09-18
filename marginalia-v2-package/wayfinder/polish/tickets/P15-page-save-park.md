# Whole-page Save and Park

status: closed
type: build
blocked by: Hear it, local speech

## Goal
The bottom zone promises save and park for the page. Today Keep, Highlight and Park act on a selection (`ui/margin.ts:558`, `:583`), and the footer offers Export JSON only.

## Owned paths
`ui/margin.ts` (footer only), `tests/margin-entry.test.ts`, `tests/reader.test.ts`.

## Acceptance
- The footer offers Save page and Park page. Both use the existing whole-page anchor and the existing thread states.
- A parked page appears in the library under parked, with the "You were here" line on return.
- Nothing is sent. Export JSON stays available.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P15.md`

## Technical preflight
Footer uses existing whole-page keep and parked-state mutations, with local capture-identity reservation and return-position checkpoint. Narrow startup checkpoint restoration is necessary for the return cue without helper access; removed/unparked threads and unattached changed passages cannot restore it. Same-capture repeats reuse the explicit page-save entry; changed text/metadata produces a new immutable capture. Position0 receives a cue only for an explicit parked checkpoint, preserving ordinary top-position behavior. Local checkpoint storage failures remain visible and retryable; helper Library inclusion uses the existing explicit synchronization action.

## Resolution
Closed2026-09-18: whole-page Save/Park, local return checkpoint including top, deletion/nonresurrection, changed-capture immutability and explicit helper Library sync. Independent50/50; chief stable1057/1051pass/0fail/6platformskip, root tsc0, extension typecheck0, build0. Report D:/Projects/Marginalia/.local/polish/reports/P15.md; receipt SHA256 569423EDC02A5567E7633929E6BA779DECEB5A8D567633733D5876DB1A9D606F. Provider/native/live gates remain open.
