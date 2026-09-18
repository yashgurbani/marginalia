# Q01 Gate 0 contract evidence

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Luna xhigh

## Task
`docs/QA-HANDOFF-ASTRA.md` §10 stage 0: one valid fixture accepted; malicious and invalid fixtures rejected; probe agrees with the closed form. Run the fixture suite under `fixtures/` through the daemon and the renderer; attach outputs.

Record in `docs/evidence/qa-2026-09-18/` with the file names in `docs/QA-HANDOFF-ASTRA.md` §10. Evidence means command output and screenshots, not a sentence saying it passed. Windows first on this machine; macOS and Linux need another machine or CI (no WSL or Docker here, see project memory). If a step cannot run, write "not run" and why.

## Acceptance
- `docs/evidence/qa-2026-09-18/gate-0-contract.md` with per-fixture results and the probe versus closed-form comparison.
