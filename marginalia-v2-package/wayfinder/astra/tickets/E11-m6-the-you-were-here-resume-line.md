# E11 M6: the 'You were here' resume line

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01, H11
route: Sol medium

## Task
`docs/FEATURE-STRATEGY-2026-09-18.md` row M6 (Stage 1, non-gated) and gate G11: a recovery report claimed "You were here" was delivered; the source has none. Precise reading position now persists and restores (commits ebca090, 4517a21). Add the top-zone line: when a page reopens at a restored position that is not the top, the rail shows one quiet line "You were here" that scrolls to the restored anchor when clicked and disappears after the reader scrolls past it or after one interaction. Nothing when there is nothing to restore.

## Acceptance
- Margin test: restored position shows the line; fresh page does not; click scrolls and the line hides.
- Copy exactly "You were here"; register matches `.m-meta`.
- Resolve H11 first so this ticket's receipt is honest by construction.
