# E18 S1-REPLY-REMOVE: discard a reply without discarding the note

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Sol medium

## Task
From `docs/STAGE1-PACKETS-2026-09-18.md` packet S1-REPLY-REMOVE. Mirror of the merged note removal (`026b945`, `note-remove` mutation with Undo): a reader removes one reply and can undo immediately; the note, highlight, question and other replies stay. Reply-only tombstone through the reader mutation reducer and store, explicit synchronization, different undo rules before and after acknowledgement, revision conflicts handled. Removal is never described as permanent erasure (the FTS copy is H09's question).

## Acceptance
- Tests through the reducer and the store, plus a mounted margin test for the Undo toast, following `tests/margin-entry.test.ts` patterns.
- `npm test` green.
