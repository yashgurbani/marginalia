# 03-daemon-stack

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: (none)

## Question

Daemon implementation: Tauri/Rust reusing Noether's shell, provider descriptors and egress classes, or a Node service for speed of iteration. Decide packaging, localhost port, token pairing with the extension, and how the webapp is served.

## Resolution

Resolved (rev 2). Node 24 LTS + TypeScript (Node 20 is EOL since 2026-03-24); better-sqlite3 with WAL and FTS5; `ws` on loopback with Host/Origin validation; `JobRunner` {start, resume, cancel, inspect} with `codex app-server` (stdio JSON-RPC: thread/start, thread/resume, turn/interrupt, events) as the primary adapter and `codex mcp-server` as the second; Codex version pinned and checked at pairing; both adapters pass one integration test (start, interrupt, resume, recover after restart). Dedicated Codex config with no inherited MCP servers, skills or env. Tauri packaging later.
