# E35 Enforce one clarifying question per build

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Sol medium

## Task
Close the confirmed scope gap in fidelity-ledger row 36: “one clarifying question at most.”

At source head `bdfe8d7`, reply validation permits at most one question block per reply (`contracts/reply.ts:507`), but the job/thread state does not establish that only one clarification can occur before a build proceeds. Add a build-attempt-level clarification budget. A later reader-authored follow-up remains a new explicit action and is not silently consumed as the clarification.

## Acceptance
- A second model-authored clarification in the same build is rejected with a plain fallback.
- A reader may still start an explicit reviewed follow-up after the completed reply.
- Reopen, reconnect and retry do not reset or spend the budget implicitly.

