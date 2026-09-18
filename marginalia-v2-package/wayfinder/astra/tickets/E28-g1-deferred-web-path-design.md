# E28 G1: deferred consented web-path design

label: wayfinder:task
mode: AFK
status: open
blocked_by: E08, H01
route: Astra low

## Owner outcome

H01 is authoritative: correct the current network copy now and defer the distinct
open-session web path. E08 must first produce confinement evidence. This ticket has
no execution authorization and cannot turn the deferred path on.

## Task

After E08, write the bounded design for a fourth, consented web path. It must name
the browser-owned review surface, exact outgoing content and recipient, broker
policy, egress record, fetched-resource record, redirect/address limits, and the
reader-facing distinction between fetched evidence and support. Keep it separate
from cloud inference, local solver recomputation and generation.

Owned source areas for the eventual design review: `daemon/retrieval/broker.ts`,
`daemon/codex-policy.ts`, `daemon/consent/`, `contracts/consent.ts`,
`ui/consent.ts`, `ui/margin.ts`, provider/job routes and their tests. Planned tests
are `tests/retrieval.test.ts`, `tests/consent.test.ts`, `tests/provider-send.test.ts`,
`tests/jobs-send.test.ts`, plus a bounded web-path integration fixture after E08.

## Tests

- After E08, add the named retrieval/consent/provider/job tests and a bounded integration fixture; this blocked design ticket runs no web-path test or provider call.

## Acceptance

- The design cannot claim confinement without E08 evidence and cannot use fetched content as support without a separate check.
- Every request has exact preview, recipient review, explicit consent, bounded broker enforcement and an egress/retrieval record.
- Redirects, DNS/address, headers, body and deadline limits are explicit; credentials and caller headers do not cross the broker.
- No implementation, provider call, network execution, consent-scope change or release claim occurs while this ticket is blocked.
- Record the design review and test plan in `docs/REPORT-E28-2026-09-18.md` when unblocked.

## Hard limits

Do not reopen H01, alter E16's corrected copy, or infer execution authority from a
design. This packet is later than the immediate deadline candidate.
