# Q05 Gate 4 install and release evidence

label: wayfinder:task
mode: HITL
status: claimed (astra, 2026-09-18)
blocked_by: E01, E02, E03
route: Luna xhigh drives, Yash performs the fresh install

## Task
`docs/QA-HANDOFF-ASTRA.md` §10 stage 4: a new reader installs and recovers; all public claims match the recorded run. Use `scripts/install-helper.ps1` (and `.sh` on another OS), pair the extension from a clean profile, stop the helper, start it, sign out of Codex, and confirm notes survive. Compare README and extension store copy against what happened.

Record in `docs/evidence/qa-2026-09-18/` with the file names in `docs/QA-HANDOFF-ASTRA.md` §10. Evidence means command output and screenshots, not a sentence saying it passed. Windows first on this machine; macOS and Linux need another machine or CI (no WSL or Docker here, see project memory). If a step cannot run, write "not run" and why.

## Acceptance
- `gate-4-install-release.md` with the install transcript and the claims table (claim, observed, match).
