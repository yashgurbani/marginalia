# Q04 Gate 3 interactive reply evidence

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Luna xhigh

## Task
`docs/QA-HANDOFF-ASTRA.md` §10 stage 3: the correct model on the demo and a second passage; the slider costs no inference; malformed output cannot run; the headline is withheld without its check. Confirm the four execution paths remain distinct and that simulate does not silently grant solver capability (see H12).

Record in `docs/evidence/qa-2026-09-18/` with the file names in `docs/QA-HANDOFF-ASTRA.md` §10. Evidence means command output and screenshots, not a sentence saying it passed. Windows first on this machine; macOS and Linux need another machine or CI (no WSL or Docker here, see project memory). If a step cannot run, write "not run" and why.

## Acceptance
- `gate-3-interactive-reply.md` with the job list showing zero new jobs during slider use.
