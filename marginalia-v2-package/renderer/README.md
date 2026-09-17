# Reply renderer

`mountReply(root, committedReply, options)` mounts one independent reply below the reader's notes. It returns `getState()` and idempotent `destroy()`. The entry imports its scoped CSS and the installed KaTeX CSS. No new dependencies or framework were added.

```ts
import { mountReply } from '../renderer/index.ts';

const mounted = mountReply(replyRoot, committedReply, {
  sourceText: capture.extractedText,
  initialState: savedView,
  capabilities: availableCapabilities,
  hostReport: reportFromAuthenticatedHost,
  resolveHostReport: (parameters, context) => resealInstalledChecks(parameters, context),
  onStateChange: state => saveViewForThisReplyVersion(state),
  onSourceHighlight: binding => highlightWithoutScrolling(binding),
  onSourceNavigate: binding => navigateExplicitly(binding),
  onRecompute: request => requestSavedSolverForThisReplyVersion(request),
  onFollowup: context => continueThisThreadAfterConsent(context),
});
```

This is illustrative host wiring, not an implemented storage or provider call. The host binds every callback to the immutable reply version and thread. Parameter/view state is independently persistable. `getState()` and callback arguments are detached snapshots. Saves are serialized and intermediate updates coalesced; failure of one snapshot does not strand a newer one. The latest failure offers an explicit retry without claiming persistence. Already requested saves drain after DOM destruction. **The host must serialize writes for a reply version across successive mounts**, because a renderer cannot cancel an external write already in flight. A remount defensively rejects invalid saved parameters and reports that defaults were substituted.

The renderer validates the candidate again against the captured source text, then clones it. This is not a host commit or scientific attestation. Capabilities default to unavailable; capability-gated blocks retain honest readable alternatives. No image, audio, video, iframe or citation URL is fetched on mount. A declared requirement is not a permission grant. The host is responsible for source-selector ambiguity and existing site grants.

## Covered content

The 17 block types have explicit rendering branches. Model has separate ODE/map execution paths. Text uses a small formatting grammar and DOM text nodes. KaTeX runs with `trust: false`, finite expansion/size limits, and accessible MathML. Dagre supplies geometry only; labels, edges, groups and source controls use packaged SVG/text code. Diagrams scroll at readable dimensions; the entire reply can expand into a native modal dialog with source and return controls retained.

Plots share the current numerical trajectory with a lazily constructed paged table containing every point. Table-backed plots preserve missing-value gaps and distinguish supplied/interpolated data from integration. Graphics use at most 3,000 vertices per plot and 24,000 across an update, with reduction or graphic omission labelled explicitly; complete tables remain available. Numeric inputs accompany native keyboard sliders, with units and bounds. Plot occurrence IDs remain stable during updates and unique across mounts/repeated comparison references. Steps reveal locally. Comparison traversal stops at the 160-occurrence bound. Steps and question drafts use stable occurrence-specific view keys. Questions validate restored selections against the offered choices and require a separate Send action. Assumption changes stay drafts until the explicit ask-again action creates a new version through the host.

Citations separate claims, quoted support, source, date and the author's fetched assertion. That assertion is not an observed retrieval record. Shelves retain reasons and timecodes. Media has capability-specific honest stubs with alt text/transcripts/timecodes; playback is deliberately not claimed.

## Computation and authority

`calculateReply` computes each logical model once per parameter snapshot, with a 40,000-attempt aggregate budget. ODE/map adapters preserve the contract's step, iteration and event semantics within the documented support boundary. Derived expressions are labelled as authored calculations, not verified scientific claims. See `kernel/README.md` for exact sample/event limits.

`computeIndependentChecks` supplies local growth calculations but does not produce a host report. The renderer adds applicability checks for units, events, finite outcomes and kernel admission. Classification authority comes only from `hostReport` supplied by the authenticated host, or `resolveHostReport(parameters, {requestId,stateKey})`. The latter may reseal existing installed checks only; it must never invoke a model, retrieve external data or execute a saved solver. It is optional: without it, slider interaction makes no host request and a changed-input headline remains withheld.

`host-authority.ts` uses WebCrypto to check the genuine report's schema, check version, reply digest, parameter digest and exact model/classification/request links, then compares the host outcome and sentence with the supported local calculation. Digests bind content, not sender identity; the host transport must authenticate the report. A parameter change or invalid input clears authority immediately. The detached injected report and most recent accepted report can be reused only after all current binding checks pass; an unusable injection does not suppress the optional resolver. Numerically unchanged input does not discard authority. Request generations, entry guards and immutable state keys fence dispatch/results after later input or destruction. No fake report or host-only `node:crypto` runtime import is used in browser code. Actual host callback integration remains with the consuming UI/helper owners.

The sample contract lacks a fixed-parameter generation binding. Current-state interpolation therefore requires every reply parameter to be represented by a sample axis. Other supplied samples remain readable as a historical grid; default parameter values are never invented as provenance. Complete rectilinear geometry, error-evidence presence, strict envelope bounds and forbidden regions are checked. Producer error evidence is displayed without certifying it.

Historical sample tables are built only when opened and remain stable during parameter updates. General tables and sample tables show at most 25 rows × 8 columns per page, with explicit row/column paging; their occurrence count is bounded by the same 160-view cap. Missing values break only their own plotted series. Shared source-highlight callbacks coordinate active focus/hover across mounts. Persistence warnings have separate UI state, so a later calculation announcement cannot erase an unsaved warning or retry action.

Four paths stay separate: packaged local math; admitted recorded samples; an explicit saved-solver request; and an explicit follow-up model turn. A failed sample lookup never invokes either callback. Recompute requires an unambiguous `solver.outputBlocks` association (or direct action on that solver), available capability, and callback. Requests contain `solverId`, `blockId`, complete parameters/view, a unique `requestId`, and a canonical `stateKey`. The host checks grants, validates and commits output, and rejects stale results for a different state or destroyed view. This renderer neither executes a solver path nor applies callback return data.

## Verification status

Implementation and static review only after the user instructed “Leave all testing for later.” No final typecheck, build or browser acceptance has been run. Earlier kernel-worker checks predate subsequent geometry, event and growth fixes and are not evidence for the final snapshot. The receipt `wayfinder/build-receipts/T18.md` records ownership, hashes, Pro consultation and the deferred acceptance checklist.
