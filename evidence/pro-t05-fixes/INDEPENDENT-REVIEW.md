# T05 fixes — independent review closure

## Scope and bounded verdict

- Final source reviewed: `88700cf30ffd9e5b192018f0039eea397392b05d` (`88700cf`)
- Reconciliation context: `d216063` against `integration3b6f61f`; `88700cf` is the immutable follow-up source
- Evidence read: the native reconciliation matrix, `wayfinder/SPEC-FINAL.md`, and Chief's `.chief-retry-check.log`
- Review scope: the three narrow claims in the handoff; no broad re-review and no production edits

**Bounded acceptance:** `88700cf` closes the earlier Q1 and R1 findings, and T1 is withdrawn after source-faithful inspection. The final source supports the narrow reconciliation: Final-Pro capture/sections are preserved, the original source-bound question key is retained, saved-thread fallback does not resurrect deliberate local absence, and historical saved replies remain available against their original source. This is not full product/runtime acceptance; the remaining gates are listed below.

## Claim checks

### 1. Final-Pro capture and section preservation — accepted

In `ui/margin.ts`, the final source clones the incoming capture, then selects `options.sections ?? capture.sections` and clones the selected list before UI ordering. This preserves the recorded `capture.sections` default and keeps display ordering separate from the source capture used for attachment.

This is a source-level acceptance of the narrow claim. A dedicated test that mutates host-owned capture/sections after mount is not present, so native browser durability is not inferred from this code check.

### 2. Source-bound question storage — accepted; Q1 closed

`88700cf` restores the established key shape:

```text
question:draft:<tabKey>:<capture.url>[:<draftScope>]
```

`draftKey` contains the tab, captured source URL, and optional scope. Reusing `question:` + `draftKey` both keeps questions source-bound and preserves already-persisted question drafts from the parent source. Question history and export continue to filter retained records by the captured URL.

This is the correct compatibility boundary for the current contract. The earlier `d216063` direct key shape would have needed a migration; `88700cf` removes that continuity defect. Chief's retry log includes the question hydration/cleanup and explicit question-retention cases as passing.

### 3. Saved-thread and saved-reply handling — accepted with original-source semantics

The `threadsNow` guard keeps a library `savedThread` snapshot read-only and refuses to reintroduce it when the local journal already contains the ID or pending, conflict, or resolution history names it. `orderedThreads` limits the visible page list to the current source URL and non-deleted threads. This preserves deliberate local absence and does not overwrite local history with a library fallback.

The saved-reply path correctly treats a reply as historical source-bound data:

- `validateReply` receives `saved.source.text`, not the current page text.
- `mountReply` receives `saved.source.text`, so the original reply/source remains renderable when the thread later has a different current source version.
- Reply history, local view recovery, and the original quote are not discarded merely because the current thread changed.
- A remote refresh separately checks the returned bundle's source ID against the current thread before adopting new helper data. That is a guard against accepting the wrong live bundle; it is not a reason to hide an already-saved historical reply.

This matches `wayfinder/SPEC-FINAL.md`: replies are immutable versions, source bindings have exact/moved/unsure/lost outcomes, page edits must not guess a new attachment, and saved threads/history preserve the work at its original source. A blanket `saved.source.id === currentThread.sourceVersionId` filter would violate that historical-access requirement and is not requested here.

## Source navigation judgment — T1 withdrawn

The relevant path is conservative and explicit:

1. `bindingAnchor(binding, saved.source.text)` first resolves the selector against the immutable saved source and requires one exact or moved match.
2. It constructs the original quote anchor, then attaches that anchor against the current capture. If the current page is lost or ambiguous, it returns no anchor.
3. `onSourceNavigate` calls `sourceAction` only for a successfully reattached anchor; otherwise it announces that the original reply is preserved and no navigation was attempted.
4. `sourceAction` independently rejects any non-whole-page anchor that is not exact or moved before invoking `onSource` or scrolling.

Therefore a historical reply remains accessible, while navigation acts on the current page only after an explicit action and an unambiguous exact/moved reattachment. I found no repro of accidental navigation on a mismatched or ambiguous current source, so T1 is not an implementation blocker.

The only small UX evidence gap is that this saved-reply path does not separately display the word “moved” when a safe current match has moved. That does not delete history or make navigation unsafe. If the launch surface requires the canonical non-exact label, the bounded correction is a status such as “Current page match; original source retained,” not hiding or deleting the historical reply.

## Targeted verification

Chief's exact retry check, recorded in `marginalia-v2-package/.chief-retry-check.log` after `88700cf`, reports:

```text
tests 31
pass 31
fail 0
```

The earlier local `30 passed, 1 failed` observation was made while `d216063` and the follow-up retry fix were landing concurrently. It is superseded by the immutable-source Chief rerun and is not carried forward as R1.

## Remaining gates and evidence limits

The native matrix's own open-gate section remains applicable. This report does not claim evidence for:

- real localhost Origin/Fetch-Metadata enforcement and Show/Renew/Pair/List/Forget/401 behavior;
- re-pair, offline, quota, reload/restart durability or extension-panel transport;
- keyboard, screen-reader, actual 200%-zoom, reduced-motion, and hit-target behavior; or
- the real note → exact consent → provisional → committed reply → explicit follow-up/cancel/unknown journey, including T06's send boundary and T20 runtime/renderer acceptance.

The supplied browser harness's TypeScript 5.9/Node 24 incompatibility also means its earlier Node 22/Chromium results remain historical rather than fresh native acceptance. The native report header still contains a “bounded fixes commit: pending” placeholder; this closure binds the source-level verdict to `88700cf`, but that evidence document should be refreshed separately if a canonical receipt is required.

## Final disposition

**Bounded acceptance of `88700cf`:**

- Final-Pro capture and recorded sections are retained.
- Source-bound question storage remains backward-readable under the established key.
- Saved-thread fallback preserves deliberate absence and local conflict/history authority.
- Historical saved replies remain source-faithful, and current-source navigation refuses mismatched or ambiguous reattachment.
- The exact focused suites are Chief-observed 31/31 with zero failures.

No source-level blocker remains for the three handoff claims. Full T05/product acceptance remains gated by the native browser, transport, accessibility, T06, and T20 evidence explicitly listed above.
