# 08-context-packet

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: 06-store-schema-v1

## Question

What the daemon sends to Codex per job and how much: span, section context budget, page metadata, vocabulary hits, library matches, thread history, stated background, the transform's instructions and schema. Define the ledger entry written before send, omission listing, and per-domain exclusion enforcement in the extension.

## Resolution

Resolved. SPEC.md §7: the preview shows the actual bounded payload with recipient and grant scope; truncation deterministic and flagged; vocabulary and library enrichment only within the grant; hashed and written to the egress record before dispatch, outcome after.
