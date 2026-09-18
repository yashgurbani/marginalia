# E29 Establish the live-runtime acceptance prerequisite

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: (none)
route: Astra low technical judgment; bounded implementation only after design review

## Task
At the current source, `daemon/consent/evidence-host.ts` returns `ready: false` and `daemon/main.ts` passes that readiness into the default Codex runtime. Q03 and Q04 require real provider replies; unit fixtures and a test runtime cannot satisfy them. Determine exactly which missing host observations block the supported runtime, whether an already implemented authorized runtime can supply them, and the smallest honest route to the required acceptance. H01 corrects copy and defers web access; it does not authorize bypassing checks or treating a sandbox request as proof. Do not borrow developer-router credentials. No runtime authority change in this investigative packet.

## Acceptance
- Source-bound call chain and actual capability diagnostics, with commands/output where available.
- A concrete implementation packet or explicit owner/prerequisite decision, preserving exact reviewed bytes and recipient, no implicit sends, and honest confinement limits.
- Q03/Q04 clearly distinguish real-provider acceptance from fixture-only evidence. The release remains gated until actual acceptance passes.
