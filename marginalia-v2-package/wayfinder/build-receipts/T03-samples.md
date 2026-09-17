# T03 follow-up receipt: sample-grid binding

Status: source implementation complete; verification deferred  
Owner scope: reply contract, sample provenance contract and contract documentation  
Baseline inspected: `889fb2795bf44bcb7d22bea68940dd051558bf34`

## Delivered

- Added backward-compatible `SamplesBlock.envelope.fixedInputs?: Record<string, number>` to the TypeScript and JSON Schema contracts.
- Added candidate validation for unique axes, disjoint and exhaustive axis/fixed-input coverage, and a model-only samples target.
- Added `contracts/sample-provenance.ts` with domain-tagged SHA-256 binding derivation, immutable pre-hash snapshots and explicit interpolation-readiness validation.
- Kept generation evidence in a separate host-owned `SampleGenerationRecord`; candidate data carries no authoritative digest or execution claim. Imported records cannot carry execution metadata, while host-execution records require an observed execution reference.
- Preserved existing reply readability while making unbound grids historical and unusable for interpolation until explicitly regenerated.
- Kept browser checks and sample readiness separate from `runHostChecks`; headline authority is unchanged.

## Owned files

- `contracts/reply.ts`
- `contracts/reply.schema.json`
- `contracts/sample-provenance.ts`
- `docs/CONTRACT.md`
- `docs/evidence/T03-samples.md`
- `wayfinder/build-receipts/T03-samples.md`

## Coordination

T18 task `01a0addb-ef93-77e0-8a57-45873cead42e` received the proposal before edits and the final exported API afterward. Its integration rule is to await `validateSamplesInterpolationReadiness`, fence the result with its renderer generation/state key, and interpolate only `result.block` with `result.parameters`. T18 owns `kernel/samples.ts` and renderer integration; this slice did not edit those files.

## Review

[GPT-6 Pro review](https://chatgpt.com/c/6aab860a-43c8-83ed-92f3-c4333316fc73): visible `6 Pro`, fresh task-specific chat. Review basis was the exact supplied local design because uncommitted source was unavailable remotely. Pro’s four required contract corrections were incorporated. No remote writes or tests occurred.

Chief source review then caught two additional trust-boundary defects before integration. Imported records are now unable to carry execution/runtime/solver fields and host-execution records require an observed execution reference. Derivation and readiness now detach and deep-freeze all caller-owned inputs before the first asynchronous digest, so later mutation cannot change the block returned under an earlier binding.

## Evidence and limits

Detailed source findings and hashes: `docs/evidence/T03-samples.md`.

No tests, builds, typechecks, browser QA or model smoke probes were authored or run. This work is not a shipping, solver-correctness or numerical-accuracy claim. Runtime issuance and persistence of `SampleGenerationRecord`, plus T18 renderer integration, remain adjacent work outside this slice.
