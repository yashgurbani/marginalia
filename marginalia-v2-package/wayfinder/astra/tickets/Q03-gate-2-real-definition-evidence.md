# Q03 Gate 2 real definition evidence

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Luna xhigh

## Task
`docs/QA-HANDOFF-ASTRA.md` §10 stage 2: an unseen term gets a real reply; an excluded page sends nothing; unknown outcome does not auto-retry; the sending indicator is separate from working. Add: the "What was sent" sheet shows the exact reviewed parts (`sentContent`) for a completed job and "Nothing left this machine" for a cancelled-before-send job; the review sheet shows content and recipient before any inference.

Record in `docs/evidence/qa-2026-09-18/` with the file names in `docs/QA-HANDOFF-ASTRA.md` §10. Evidence means command output and screenshots, not a sentence saying it passed. Windows first on this machine; macOS and Linux need another machine or CI (no WSL or Docker here, see project memory). If a step cannot run, write "not run" and why.

## Acceptance
- `gate-2-real-definition.md` with the network log for the excluded page (zero requests) and the sheet screenshots.
