# Reply contract

`marginalia.reply.v1` is untrusted candidate data. The daemon must call `validateReply` or `parseAndValidateReply` before it stores a reply version. The renderer receives only a validated, committed reply.

The launch block vocabulary is explicit: `text`, `equation`, `model`, `plot`, `derived`, `classification`, `table`, `diagram`, `steps`, `compare`, `question`, `turn`, `citations`, `shelf`, `samples`, `solver`, and `media`. Models declare bounded scalar or small-system ODEs and iterated maps. Blocks can describe content and mathematics. They cannot declare interface behavior, executable code, raw HTML, JavaScript templates, or renderer extensions. `samples`, `solver`, network-backed blocks, and each media kind require a declared capability and an available host capability.

The JSON Schema provides the portable structural contract. The TypeScript validator also performs checks that JSON Schema cannot: captured-source selector matching, mathematical expression compilation, cross-reference resolution, parameter ordering and bounds, aggregate depth and item limits, private-address rejection, safe workspace paths, and capability availability. Current top-level limits are 256 KiB, depth 16, 2,000 aggregate array items, 64 blocks, 32 parameters, and 64 requested checks. Kind-specific caps are in `REPLY_LIMITS` and `reply.schema.json`.

## Precomputed sample binding

`samples.envelope.fixedInputs` records the exact values held constant when a grid was generated. It is optional in the candidate schema only so persisted `marginalia.reply.v1` data remains readable. Its absence does not authorize defaults: a reply without it is historical and cannot be interpolated until the host explicitly regenerates the grid. When `fixedInputs` is present, its keys and the axis names must be disjoint and together cover every reply parameter. This is intentionally conservative because v1 has no independently validated solver-input dependency graph. Values must be finite, inside their declared parameter bounds, and the current normalized fixed values must match exactly. Axis values must also remain inside both the parameter bounds and the generated envelope.

Candidate JSON does not carry generation authority. `SampleGenerationRecord` is host-owned data admitted from trusted host storage or a trusted host-delivery path, never from the candidate or an unchecked sidecar. It binds the complete immutable reply and the exact samples block contained in that reply to the resolved model computation, declared generation inputs and sample data with SHA-256 digests. The computation binding includes the referenced model's equations or map, initial state, horizon or iteration count, and solver settings; the complete reply digest binds the surrounding referenced artifacts. V1 has no external host-selected solver settings outside the hashed model. If a future generator has effective settings or mutable inputs outside the candidate, a later record schema must bind an immutable host generation specification rather than place them in an opaque label. A `host-execution` record requires an execution reference observed by the host and may include runtime or solver references only when observed. An `imported` record says only that the host observed the imported bytes and declarations; it must not contain execution, runtime or solver fields and cannot retrospectively upgrade an old grid to execution provenance.

`validateSamplesInterpolationReadiness` is the renderer boundary. Before any asynchronous hashing, it creates detached deep-frozen snapshots of the complete reply, supplied block, normalized parameter state and trusted host record. It returns ready only when that candidate snapshot has a complete axis/fixed-input partition, the supplied block exactly equals the unique block in the reply snapshot, the current bounded parameter snapshot matches it, and the host-record snapshot matches the reply, block and all binding digests. A successful result returns the immutable detached block and parameter snapshot. The caller must pass those returned values to interpolation, or discard the result if its own reply/view generation changed while the asynchronous hashes were computed. `deriveSamplesBinding` uses the same snapshot rule across all four digests. Missing metadata or provenance stays visibly historical; changed inputs or digests require recomputation. A digest proves identity and binding, not numerical accuracy, scientific truth or solver correctness. Readiness is only a prerequisite: interpolation still must pass the envelope, grid-completeness, error-evidence and forbidden-region checks in `kernel/samples.ts`.

Sample-generation digests use UTF-8 bytes of `canonicalReplyData({ domain, value })`, with domain strings under `marginalia.samples-generation.v1`. The canonical serializer recursively sorts object keys by UTF-16 code-unit order, preserves array order and Unicode text without normalization, uses JSON's finite binary64 number serialization (including `-0` as `0`), and rejects non-JSON values, non-finite numbers and unpaired Unicode surrogates. Digests are exactly 64 lowercase hexadecimal SHA-256 characters. The reply value is the accepted, persisted candidate snapshot, without host sidecars or mutable view state. Missing `fixedInputs` and an explicit empty object remain distinct: a grid with no fixed parameters records `fixedInputs: {}`.

Candidate `checks` are requests. They contain a criterion name and references, but no `kind`, `result`, or host authority. `computeIndependentChecks` is browser-safe and recomputes installed criteria for the current parameter state. It does not authorize a headline. `runHostChecks` is the host-only sealing step. Its report carries SHA-256 digests of the complete candidate reply and complete parameter state, plus `host-checks.v1`. Store that report separately from candidate JSON.

`classificationViews` is the renderer integration boundary. It returns a verified label only when a passing host result matches the classification, model, request, reply digest, parameter digest, and check version. A missing, unsupported, failed, mismatched, or stale result returns `withheld`. This follows `SPEC-FINAL.md`: the candidate reply remains structurally valid so its non-headline content can render, while the unsupported headline stays hidden.

The only installed scientific criterion is `growth-v1`. It accepts the declared scalar ODE `y' = y^2 - gamma*y + f` with initial value `y0`, after resolving the candidate's `gamma`, `f`, and `y0` parameter mappings. The criterion computes its own outcome and sentence with `kernel/growth.ts`. An altered equation, initial condition, mapping, model link, or classification link fails the check. New scientific classifications remain withheld until a renderer-owned criterion is implemented.

These checks establish structure, bounded execution, reference integrity, and the exact semantics of installed criteria. They do not prove the general scientific truth of narrative text, assumptions, citations, or novel models. Evidence and media still need their own retrieval, provenance, rendering, and policy checks.

The honest product fixture is `fixtures/growth-reply.ts`. It contains only the growth illustration's text, equation, model, plot, derived threshold, and classification. Synthetic examples for the rest of the vocabulary live in `tests/reply.test.ts` and are labelled as contract-test data.

## Integration

Browser-safe imports from `contracts/reply.ts`:

- `validateReply(input, { sourceText, capabilities })`
- `parseAndValidateReply(json, context)`
- `computeIndependentChecks(reply, parameterState)`
- `canonicalReplyData(value)`

Browser-safe imports from `contracts/sample-provenance.ts`:

- `deriveSamplesBinding(reply, samplesBlock)`
- `validateSamplesInterpolationReadiness(reply, samplesBlock, parameterState, generationRecord)`
- `SAMPLE_GENERATION_SCHEMA`
- `SampleGenerationRecord`

Host-only imports from `contracts/host-checks.ts`:

- `runHostChecks(reply, parameterState)`
- `hostReportMatches(reply, parameterState, report)`
- `classificationViews(reply, parameterState, report)`

The daemon should validate first, compute and persist the host report second, and commit the immutable reply version last. The renderer should call `classificationViews` whenever parameters change. A prior report must never authorize a classification under a new parameter state.
