# Daily journal view

status: claimed
type: build
blocked by: none

## Goal
Yash, 2026-09-18: "journal is a way to integrate whatever you read across the web/pdf that day structured in topics automatically called journeys with your own notes and bookmarks and highlights and transforms to look back to and save". Build the day view first. It is factual and local, with no model call.

## Owned paths
New `ui/library/journal-view.ts` and its CSS, one route in `ui/library/index.ts`, a read method on the reader store, one new test. Do not touch `ui/journal.ts`; that file is the mutation queue.

## Acceptance
- The library shows one page per day. It lists each source read that day with the reader's notes, bookmarks, highlights and saved replies, in reading order.
- Every item opens its saved source at the passage. Nothing is looked up until the reader opens the journal.
- The reader can save a day as one export (JSON and Markdown). PDF sources appear once PDF reading exists; until then the view says so in one quiet line.
- Zero provider requests. Keyboard-only use works.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P21.md`

## Technical preflight
The day-view read path also owns contracts/journal.ts, daemon/reading-journal.ts, narrow daemon/routes/reader.ts and ui/helper.ts adapters. Existing saved activity has timestamps; all-reading/revisit history is absent. That acceptance remains open pending Fable's recording-scope answer in agents-talk.md. No inferred reading dates.

## Saved-activity checkpoint, ticket remains open
Projection, lazy Journal page, day selector, immutable-passage opening and refreshed JSON/Markdown exports pass chief1076/1070/0/6, both typechecks0/build0/sourceStable true. Independent8/8 plus original interruption1/1. Real Chrome keyboard360px and200%zoom passed with controlled data. Full all-reading/revisit acceptance remains missing and awaits the recording-scope answer. Complete evidence and dissent: `.local/polish/reports/P21.md` in the repository root.
