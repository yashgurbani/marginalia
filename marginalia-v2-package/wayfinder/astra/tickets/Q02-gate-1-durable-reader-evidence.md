# Q02 Gate 1 durable reader evidence

label: wayfinder:task
mode: HITL
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Luna xhigh drives, Yash confirms the feel

## Task
`docs/QA-HANDOFF-ASTRA.md` §10 stage 1: save a note on a real page; restart daemon and browser; recover it; edit the page text and see moved or unsure, never a guess. Also cover the merged Stage 1 work: precise reading position restores to the first fully visible line (not the section start); per-note remove then Undo; one thread open at a time remembered per page.

Record in `docs/evidence/qa-2026-09-18/` with the file names in `docs/QA-HANDOFF-ASTRA.md` §10. Evidence means command output and screenshots, not a sentence saying it passed. Windows first on this machine; macOS and Linux need another machine or CI (no WSL or Docker here, see project memory). If a step cannot run, write "not run" and why.

## Acceptance
- `gate-1-durable-reader.md` with screenshots before and after restart, and the moved/unsure states.
- Yash's one-line verdict on whether returning to the page "feels like coming back".
