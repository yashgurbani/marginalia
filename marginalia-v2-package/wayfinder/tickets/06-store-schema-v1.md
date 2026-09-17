# 06-store-schema-v1

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: 02-artifact-contract-v1, 05-anchors-and-source-versions

## Question

Adopt or adapt the ThreadEnvelope from the Codex spec (source, anchor, contextBundle, request, artifact, interaction, provenance, job) as the SQLite schema; decide thread states, versioning of artifacts and corrections, export format (JSON, Markdown), and what the extension caches when the daemon is absent.

## Resolution

Resolved. Normalized entities per SPEC.md §10: sources, source_versions, anchors, attachments, threads, notes, highlights, reply_versions (immutable once succeeded; supersedes relation), jobs and attempts (idempotency key, packet digest, provider thread id, policy version, outcome), grants, egress_events, events outbox for replay, vocabulary, settings. WAL; all writes through the daemon; migrations from v1; bounded JSON only where it is a versioned value; blobs outside the database with checksums; FTS5 for search, vectors only when a measured need appears.
