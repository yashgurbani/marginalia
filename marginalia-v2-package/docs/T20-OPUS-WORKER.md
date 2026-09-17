# T20 — saved solver execution, Opus 5 implementation

User explicitly assigns the next substantial ticket to headless Opus 5 after the T19 handback. Select exact model `claude-opus-5`, high effort, first-party Claude Max authentication. Do not switch accounts/providers/models. Chief is task `01a0adaf-dd71-7583-8307-b877547c9189`; use receipt/report as relay if messaging is unavailable.

## Root, branch and ownership

Work only in `D:\Projects\Marginalia-worktrees\t20-saved-solver\marginalia-v2-package`, branch `codex/opus-t20-saved-solver`, based on consolidated `2c35157c38a59a3a84c8eaa1265aaf12706951f2`.

You are not alone in the repository. Other owners are producing Pro fixes on separate branches. Preserve their work. Do not edit the shared integration checkout, change branches, commit/push, install global tools or change authentication. Owned new paths:

- `contracts/solver.ts`
- `daemon/solver/**` (execution service, transport adapter and route module)
- `tests/saved-solver*.test.ts`
- `docs/evidence/T20/**`
- `wayfinder/build-receipts/T20.md`

Do not edit existing job/provider/consent/store/renderer/margin contracts or modules. Pro concurrently owns them. If a shared seam is necessary, document the exact caller change and propose a narrow integration patch in `docs/evidence/T20/integration.patch`; do not apply it. Prefer consuming existing public contracts over inventing parallel persistence, policy, job or consent systems. Report incompatible dependencies early while continuing independent implementation. No subagents or external model calls from this worker.

## Outcome and source authority

“Marginalia is a margin beside whatever you are reading.” Implement path 3: a reader changes inputs beyond a saved sample envelope, explicitly chooses Recompute with the saved solver, and the daemon runs the actual saved solver in the isolated job environment, validates its outputs and returns new results for the same reply blocks without making ANY model turn.

Read personal/project AGENTS, wayfinder/SPEC-FINAL.md, derived SPEC.md, BUILD-PLAN-24H T20, FEATURE-INVENTORY, docs/CONTRACT.md, contracts/sample-provenance.ts, current renderer sample/solver callbacks, daemon/codex-policy.ts saved-solver construction, provider/job contracts and daemon/jobs lifecycle. Receipts/evidence describe historical checks, not current proof. Review all proposed code changes against these sources.

Windows, Linux and macOS are ALL target platforms. The user can directly test Windows/Linux and will arrange a Mac. No Windows-only design, hard-coded D: home, shell quoting assumptions, synthetic platform support or inferred isolation. Model/inference network and tool/execution network are separate boundaries.

## Required behavior

1. Explicit recompute request binds immutable committed reply/solver identity, original job workspace/artifact generation, complete validated input tuple, grant/policy and a stable request identity. Reject unknown or modified solver artifacts, path escapes/symlinks, invalid bounds and unsupported capabilities with calm typed outcomes.
2. Use the pinned Codex isolated command-execution path for real local execution; do not execute model-authored code in the browser or as an unrestricted local shell fallback. Treat generated code and output as untrusted. No `thread/start`, `turn/start`, MCP `codex` or any inference call in recompute.
3. Preserve the same applicable grants, current revocation/exclusion checks, write/network restrictions and truthful isolation evidence. Wire to existing authority seams, without fake approved evidence or a permanently disabled placeholder masquerading as completion. Missing genuine runtime evidence returns unavailable honestly.
4. Enforce finite time/memory/output limits, safe argument handling, current-attempt cancellation and late-result fencing. Do not replay unknown outcomes. Model-free execution may still use time/compute; report that honestly.
5. Validate actual outputs against the declared solver/output model, host checks and sample-generation provenance before acceptance. Bind complete inputs, exact solver/source/reply hashes, actual execution identity and numerical output. Never let an imported/model-authored record assert host execution.
6. Cache only equivalent successful executions with exact artifacts/inputs/policy bindings. A cache hit remains distinguishable from a new execution and must obey current authorization. Errors/unknown/cancelled results must not become successful cache entries.
7. Expose a small service/route boundary for T06 composition and T05 explicit controls. Preserve local kernel, saved-samples and Ask again paths; do not conflate them with recompute. Supply the concrete integration patch/request for any frozen adjacent path rather than claiming the feature is mounted.

## Verification and handback

Testing is now authorized after consolidation. Follow TDD with meaningful public boundaries: service request/cancel/result, command adapter protocol, artifact/path/limits, authorization expiry and output provenance. Use temporary fixtures/data only. Use independent expected examples rather than deriving expectations from implementation. Run focused existing/new checks and report exact commands/results; do not fake real sandbox/platform execution if unavailable. Do not launch inference or change product sign-in to make a test pass. Avoid broad dependency/framework changes.

Write `docs/evidence/T20/REPORT.md` and `SESSION.json` with actual model identity if exposed, changed paths, executed checks, unverified platforms, dependencies and specific integration requests. Update T20 receipt. Finish the owned executable module and justified tests; stop at this ticket slice. Do not mark full T20 accepted until the real end-to-end recompute path is integrated and demonstrated with zero model turns.
