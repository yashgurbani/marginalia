# 15-daemon-install-and-pairing

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: 03-daemon-stack

## Question

First-run flow: install daemon, detect Codex login and sandbox availability, pair the extension with a token, choose models per tier, set exclusions. Decide the degraded behaviour when Codex is missing or the sandbox is unavailable.

## Resolution

Resolved. Install, first run, diagnostics, upgrade and revoke are release work (T19). Pairing: short-lived, rate-limited six-digit challenge exchanged for a ≥256-bit random token scoped to the extension; revoke and re-pair from settings; provider credentials never enter the browser.
