# E37 Represent provider portability without claiming adapters

label: wayfinder:task
mode: AFK
status: closed
blocked_by: E01
route: Sol medium

## Task
Close the confirmed availability gap in fidelity-ledger row 67: “Any provider, any key, local models, or your own agent.”

At source head `bdfe8d7`, the helper exposes model settings but the reviewed execution policy accepts the implemented Codex adapters and operations (`daemon/codex-policy.ts:31-33,161-176`). Define the adapter boundary and reader-facing unavailable states for future local/third-party providers. Do not mistake a model-name setting for provider support, and do not add credential entry to the browser.

## Acceptance
- Provider capability is typed separately from model selection.
- Unsupported providers render an honest unavailable state and cannot reach dispatch.
- Provider credentials remain outside the browser trust boundary.

## Resolution

2026-09-18: Closed on source `d472442`, integrated as `89a6335`. `ProviderCapability` is separate from model selection; unavailable entries have neither recipient nor adapter, and all entries declare credentials outside the browser. Settings disclose unavailable local/third-party/own-agent connections and distinguish implemented Codex transports from actual readiness. Model-name edits grant no provider support, and no browser credential-entry or dispatch control was added.

Named checks: `provider capability is independent of model selection and unavailable entries carry no dispatch adapter`, `provider availability shows unsupported connections without selection, credential entry or runtime readiness`, and the parameterized unsupported-provider forged-job and win32/linux/darwin execution-policy rejection tests. Independent review accepted E37 after `tests/provider-capabilities.test.ts` plus `tests/library.test.ts`: 42/42 pass; combined E32/E37 focused integration was 58/58. Main `89a6335` retained suite is 815 total / 809 pass / 0 fail / 6 skip, with typecheck, prepare and extension typecheck clean. Chief reports three-OS CI `35308691567` green at that head; this bookkeeping pass did not rerun it.

Evidence (package-relative): `docs/evidence/qa-2026-09-18/e32-e37-settings/{worker-report.md,independent-review.md,main-test.log,main-typecheck.log,main-prepare.log,main-extension-typecheck.log}`. Integration/review assignments were Luna max; ticket route was Sol medium. Actual deployment/effort telemetry was unobservable. Older independent-review results are scoped to their inspected trees; main integration logs cover the merged result. Unsupported-provider rejection establishes neither live-provider readiness nor successful inference; those gates remain open.

