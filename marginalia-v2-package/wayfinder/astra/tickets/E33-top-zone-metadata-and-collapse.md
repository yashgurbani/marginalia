# E33 Complete the top-zone metadata and collapse behavior

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
Close confirmed fidelity-ledger rows 16 and 20:

- Row 16: “One or two lines from the page's own metadata.”
- Row 20: “this collapses to one line.”

At source head `bdfe8d7`, the margin header is mounted at `ui/margin.ts:117-137`. `SourceCapture` and `SourceVersion` carry title and page type but no author, publication date or venue (`contracts/reader.ts:8-9`); persistence therefore cannot supply the promised line (`daemon/store.ts:203-221`). Add optional capture/extraction fields for locally observed author, publication date and venue, validate and persist them as immutable source-version metadata, and preserve compatibility with legacy captures where they are absent.

Display only metadata actually present in the capture. Never infer an author, date or venue. Collapse the top zone after reading begins while keeping its accessible name and an explicit way to reopen it.

## Acceptance
- Mounted tests cover complete, partial and unavailable metadata.
- Extraction/contract tests cover locally observed author, publication date and venue; malformed values are rejected, legacy captures remain readable, and source-version identity/persistence does not drop or invent fields.
- Reading collapses the top zone to one line; keyboard and screen-reader access remain intact.
- No author, date or venue is inferred from prose, URL shape or model output. No network lookup occurs from capture, opening or collapsing the header.
