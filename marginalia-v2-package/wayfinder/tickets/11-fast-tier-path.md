# 11-fast-tier-path

label: wayfinder:research
mode: AFK
status: closed
blocked_by: 09-codex-session-policy

## Question

Measure latency and cost of the fast tier through Codex with sandbox read-only and model=Luna versus a local model via Ollama, for a one-line gloss on a 400-token context. Report p50/p95 on the reference machine and recommend the default.

## Resolution

Resolved. Instant local affordances (Keep, Park, quoted document definition) never wait on a model. The daemon discovers installed and account model availability at pairing; fast tier uses the discovered small model (Luna where available) under the site grant; latency distribution is measured and shown as a time word, never promised.
