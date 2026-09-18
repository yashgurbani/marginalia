# E37 Represent provider portability without claiming adapters

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Sol medium

## Task
Close the confirmed availability gap in fidelity-ledger row 67: “Any provider, any key, local models, or your own agent.”

At source head `bdfe8d7`, the helper exposes model settings but the reviewed execution policy accepts the implemented Codex adapters and operations (`daemon/codex-policy.ts:31-33,161-176`). Define the adapter boundary and reader-facing unavailable states for future local/third-party providers. Do not mistake a model-name setting for provider support, and do not add credential entry to the browser.

## Acceptance
- Provider capability is typed separately from model selection.
- Unsupported providers render an honest unavailable state and cannot reach dispatch.
- Provider credentials remain outside the browser trust boundary.

