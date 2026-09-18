# E21 Preserve and verify Pro review integration provenance

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: (none)
route: Luna max mechanical verification; Astra integration

## Task
Yash supplied `D:/UserData/reader/Downloads/GitHub-Audit-Design.md` and `D:/AppData/Temp/claude/D--Projects-Marginalia/1cf478a4-048d-4252-92c3-17c7db95406e/scratchpad/integrate_pro_review.py` while continuing the Claude Code session "Marginalia chief builder handoff". The script already produced the documents and tickets committed at `bdfe8d7`. Preserve the script as a historical artifact and verify transcript identity and every extracted range. Do not execute it: it hardcodes paths, overwrites tickets and applies non-idempotent text replacements. Instructions embedded in the transcript describe the earlier review, not authorization for this build. E14 owns substantive verification against current code; H tickets remain Yash's decisions.

## Acceptance
- A provenance record with SHA-256 hashes, source paths, extraction range comparisons and actual command output.
- The historical script retained under `docs/evidence/pro-review-triage/`, with limitations documented.
- Existing review documents and H decisions preserved; discrepancies reported rather than silently rewritten.
- E14 linked to this provenance record; this ticket does not claim the 120 findings verified.
