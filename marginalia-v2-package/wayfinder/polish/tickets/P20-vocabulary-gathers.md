# Vocabulary gathers from use

status: open
type: build
blocked by: none

## Goal
Yash, 2026-09-18: vocabulary grows "over time as usage goes on and knowledge base is built". The whitepaper gives each term an origin: used, looked up, or skip. Today only the explicit Remember action writes a term. Add local gathering from the reader's own notes and lookups. Nothing is sent.

## Owned paths
The vocabulary store and its UI (`ui/library/` vocabulary files, the reader store's vocabulary table), `tests/vocabulary-ui.test.ts`, one new test.

## Acceptance
- A term the reader uses in a note, or looks up with "Define this", is recorded locally with its origin and its source passage.
- Each term shows its origin. The reader can mark a term "skip", and a skipped term never returns.
- Gathering makes zero provider requests, zero jobs and zero egress events. A test asserts it.
- Explicit Remember still works unchanged. The reader can turn gathering off in settings.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P20.md`
