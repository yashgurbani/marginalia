# 09-codex-session-policy

label: wayfinder:research
mode: AFK
status: closed
blocked_by: (none)

## Question

Against current Codex docs: confirm codex mcp-server tool parameters (model, sandbox, approval-policy, cwd, config for network off), codex/event notification types usable for progress, timeout settings, elicitation handling, thread lifecycle, and whether the app-server is preferable for streaming. Verify Luna and Astra model ids as accepted by the model parameter. Produce the session manager's config table.

## Resolution

Resolved (rev 2). Capabilities and egress are enforced outside prompts: closed sessions network-off and tested; open sessions through an observed broker (private-address, redirect, scheme and size refusals) with a fetched-resource record labelled incomplete if the session could bypass it. Dedicated config and isolated job workspaces; cancellation fences late output; disconnect ≠ failure; outcome_unknown never auto-retried; cancellation, recovery and sandbox proven on each supported OS. Model per tier (fast Luna, deep Astra).
