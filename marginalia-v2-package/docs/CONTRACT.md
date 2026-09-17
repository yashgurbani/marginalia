# Reply contract

`marginalia.reply.v1` is untrusted candidate data. The daemon must call `validateReply` or `parseAndValidateReply` before it stores a reply version. The renderer receives only a validated, committed reply.

The launch block vocabulary is explicit: `text`, `equation`, `model`, `plot`, `derived`, `classification`, `table`, `diagram`, `steps`, `compare`, `question`, `turn`, `citations`, `shelf`, `samples`, `solver`, and `media`. Models declare bounded scalar or small-system ODEs and iterated maps. Blocks can describe content and mathematics. They cannot declare interface behavior, executable code, raw HTML, JavaScript templates, or renderer extensions. `samples`, `solver`, network-backed blocks, and each media kind require a declared capability and an available host capability.

The JSON Schema provides the portable structural contract. The TypeScript validator also performs checks that JSON Schema cannot: captured-source selector matching, mathematical expression compilation, cross-reference resolution, parameter ordering and bounds, aggregate depth and item limits, private-address rejection, safe workspace paths, and capability availability. Current top-level limits are 256 KiB, depth 16, 2,000 aggregate array items, 64 blocks, 32 parameters, and 64 requested checks. Kind-specific caps are in `REPLY_LIMITS` and `reply.schema.json`.

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

Host-only imports from `contracts/host-checks.ts`:

- `runHostChecks(reply, parameterState)`
- `hostReportMatches(reply, parameterState, report)`
- `classificationViews(reply, parameterState, report)`

The daemon should validate first, compute and persist the host report second, and commit the immutable reply version last. The renderer should call `classificationViews` whenever parameters change. A prior report must never authorize a classification under a new parameter state.
