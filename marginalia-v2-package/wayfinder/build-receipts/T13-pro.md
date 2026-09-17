# T13 Pro receipt: pinned Codex policy preparation

## Claim and ownership

- Base observed through the GitHub connector: `codex/marginalia-v2` at `bb5b5b801b285d3f888dd47728be508501261724`.
- Delivery branch: `codex/pro-t13-policy`, created from that exact commit. The implementation commit is the commit containing this receipt; the final SHA is returned in the handoff.
- Owned files only: `daemon/codex-policy.ts`, `tests/codex-policy.test.ts`, and this receipt, relative to `marginalia-v2-package`.
- Authority read: `wayfinder/SPEC-FINAL.md`, `wayfinder/BUILD-PLAN-24H.md`, `wayfinder/PRO-COLLABORATION.md`; inspected `contracts/reader.ts`, `contracts/host-checks.ts`, candidate reply types and JSON schema, package/test configuration and existing node:test style.
- Pro conversation URL: not exposed to this executor; the current conversation is the handoff. No URL was invented.
- GitHub read and branch-write access observed. DevSpace workspace access failed with a connection error. Tests below ran in the execution container, not through the GitHub connector. No shared checkout, integration branch, package configuration or other builder's files were changed.

This is an implemented, unit-tested pure preparation seam for one part of T13. It is NOT evidence that the actual isolation gate passes. Full transform inventory and the four execution paths remain in scope; open/brokered sessions are not implemented or removed here. Chief owns integration. No merge requested or performed.

## Implemented API

`createCodexPolicy(input)` returns immutable, version-pinned request descriptors and dotted CLI/config overrides. It does not read files, launch a process, authenticate, copy credentials, stage a packet, invoke a model, or execute a network request.

- `definition`: read-only thread and closed turn policy, caller-supplied object `outputSchema`, final structured JSON over transport. The adapter adds `threadId` and granted `input`, waits for successful completion, validates the candidate against the existing reply contract and persists it. This follows the explicit bounded ticket instruction and T08's read-only requirement; the generic file-result wording in SPEC-FINAL is left unchanged for chief reconciliation. No replacement reply schema is introduced.
- `generation`: workspace-write thread/turn, only the job's requested writable root, network disabled, temporary-root exclusions and no approval escalation. File watching, atomic reply writes, candidate validation and host checks remain adapter/engine responsibilities.
- `saved-solver`: buffered `command/exec` with absolute argv, finite timeout and explicit read-only or workspace-write policy. No thread/model turn, environment overlay, interactive/streaming controls, custom capture cap or timeout disabling. The executable must support `solver --input input.json`; this is a host-selected adapter convention, not a claim about arbitrary solvers. Hash pinning, grants, path/ACL/reparse-point checks, resource enforcement beyond timeout, caching and result validation remain T20 work.
- All modes explicitly report `readAccess: 'not-job-confined'`. Lexical path checks do not establish job-only reads or protect against filesystem aliases. A private Codex home is disjoint from the workspace; no normal configuration is modified.
- `cancellationFor` requests `turn/interrupt` for model jobs with known IDs. Native Windows saved-solver cancellation fences late output and relies on timeout; it does not request `/terminate`, mark completion, or claim a confirmed kill. Missing IDs or unverified platforms remain unverified. Disconnect remains `outcome_unknown`; automatic retry is always false.

## Audit contract and integration obligations

`auditCodexPolicy(policy, evidence)` accepts host-normalized observations, not raw app-server messages and never candidate/page assertions. `Observation` is a Marginalia type, NOT additional Codex request fields. `complete` must cover pagination, inherited layers, effective defaults and discovery errors. A collector must not fill unknowns with the requested values to make this check pass.

Evidence is bound by a SHA-256 scope over the policy and host-owned `auditId`. Rotate that identity on worker restart, resume/configuration change or a changed attempt; recollect evidence before use. This is mismatch detection, not a signed attestation or a defense against a dishonest host collector.

The audit checks effective configuration and writable roots; administrative requirements; returned model-thread/turn policy; MCP, skill, non-tool capability and instruction inventories; an independently observed complete tool catalog; reviewed environment/private-home handling; and separate sandbox write/network probe evidence with model-service traffic distinguished. Model thread state is not required for a saved-solver call. A clean MCP inventory is never used as a complete tool catalog.

Unknown enabled features, inherited/unknown enabled capabilities, missing flags, partial inventories, stale identity, missing evidence, unreviewed environment, copied credentials, changed normal settings or unresolved runtime checks reject. Generation allows only named reviewed builtin tools; definitions have no implicit builtin-tool allowance. If a real Codex profile exposes unavoidable unreviewed tools/default features, it fails closed pending review; this module does not pretend a stable `tools: []` switch exists.

The positive decision is only `evidence-consistent`, always with `runtimeVerifiedHere: false`. Synthetic all-green evidence in unit tests is NOT a passed isolation gate. The collector and adapter are not implemented here. In particular, `instrumented-tool-catalog` names an independent host evidence source, not a documented RPC endpoint or an inference from `mcpServerStatus/list`. A saved-solver worker's non-model behavior must be observed without starting an inference turn just to satisfy an audit field. Evidence collection may remain unresolved and reject.

Only native Windows is a candidate for acceptance with supplied probe evidence; other OS policies can be constructed but audit as unverified. The policy requests tool-network denial, not zero service traffic. Neither configuration nor these unit tests prove confinement, absence of all side channels, immediate cancellation, exactly-once recovery or compatibility of the supplied JSON schema with a model provider.

## Acceptance evidence actually run

Working directory: `/mnt/data/marginalia-t13/marginalia-v2-package` in the execution container.

```sh
node --experimental-strip-types --test tests/codex-policy.test.ts
```

Result: **20 tests passed, 0 failed, 0 skipped** on **Linux, Node v22.16.0**. Tests cover all request variants, pin/path/timeout validation, immutability, missing/partial/stale/malformed evidence, independent catalog requirements, inherited capabilities, effective writable roots and returned thread policy, credential/environment contradictions, traffic-separation evidence and Windows cancellation semantics. All observations and probe statuses are synthetic. No model, authentication, daemon/server or sandbox/network probe was executed.

```sh
tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --erasableSyntaxOnly --lib ES2023,DOM --types node --typeRoots /opt/nvm/versions/node/v22.16.0/lib/node_modules/ts-node/node_modules/@types --skipLibCheck daemon/codex-policy.ts tests/codex-policy.test.ts
```

Result: **exit 0**, targeted to these two files, using existing **TypeScript 5.8.3** and **@types/node 25.1.0**. No dependencies installed. These are compatibility checks, not the repository's supported Node 24 / TypeScript 5.9.3 / @types/node 24.10.1 checks. The full project suite and full project typecheck were not run. A separate untracked container-only package marker supplied ESM mode; the repository's package.json was not changed.

Required integration evidence still absent: installed Codex 0.153.4 schema comparison, native Windows/Node 24 execution, real config/inventory/catalog collection, independent login and config isolation, write and tool-egress probes, traffic attribution, final-output parsing and validation, interruption/disconnect recovery, solver timeout/process behavior, and wiring into T02/T13/T20. No actual runtime completion claim is made.

## Pinned primary source basis

Protocol fields follow `rust-v0.153.4`, not newer documentation's extra fields:

- [ThreadStartParams](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts)
- [TurnStartParams: outputSchema](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts)
- [SandboxPolicy](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/app-server-protocol/schema/typescript/v2/SandboxPolicy.ts)
- [CommandExecParams](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/app-server-protocol/schema/typescript/v2/CommandExecParams.ts)
- [Native Windows execution and unsupported streaming/termination](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/app-server/src/command_exec.rs)
- [Configuration schema](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/config.schema.json)

Stop condition: only these three files delivered on the separate branch. Chief reviews and integrates; remaining runtime gates stay open.
