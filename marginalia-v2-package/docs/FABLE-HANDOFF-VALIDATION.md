# Fable handoff validation

18 September 2026, Windows, Node v24.14.1, pinned package dependencies including TypeScript5.9.3. Tested product HEAD: **6fb78e0894467726d98ebca615965fba44accd62**. Later commits in this handover contain documentation and preserved historical artifacts, not production changes.

| Check on merged checkout | Observed result |
|---|---|
| `npm test` | Exit0;671total,669passed,2skipped,0failed,0cancelled.9.17seconds. |
| `npm run typecheck` | Exit0. |
| `npm run build` | Exit0. |
| `npm run extension:build` | Exit0. |
| `npm run extension:typecheck` | Exit0 after extension build generated WXT configuration. |
| `git diff --check HEAD^ HEAD` | Exit0 for the T06 merge. |
| Production/tests compared with `codex/final-pro-combined-check` | No differences across contracts, daemon, UI, extension, webapp, tests, renderer and package manifests. |
| Conflict inventory | No unmerged files. Merge completed cleanly. |
| User-owned tracked changes | Root CONTEXT.md and README.md remain modified, not committed. |

Raw fresh command logs are local at package root: `.handoff-tests.log`, `.handoff-typecheck.log`, `.handoff-build.log`, `.handoff-extension-build.log`, `.handoff-extension-typecheck.log`. Existing npm environment warning about `store-dir` was emitted; it did not fail checks. The two skipped categories remain the browser-only regression and Windows link/reparse behavior. No authentic inference, confinement proof, installer, screen reader, Linux/macOS run or launch validation was performed in this handoff.

## T06 waiver and retained dissent

The user explicitly directed ignoring the new T06 review. Source is merged, independent approval is absent. Immediately before Stop was clicked, the review said:

> I reproduced a concrete shutdown hazard: swapping a checked reply file for a FIFO can block before validation. I’m adding a nonblocking-open fix and regression.

This is consultant-reported progress, not a reproduced chief finding, delivered patch or final verdict. At remote inspection `codex/pro-t06-integration-review` pointed to original candidate2e77f3a. Fable must investigate first; successful existing tests do not refute the untested race. The fresh review also correctly identified that NATIVE-INTEGRATION-REVIEW.md was absent from combined candidate2e77f3a; it is present in the merged e838488 history now. Do not describe that report as an independent acceptance verdict.

## Preserved unfinished/historical work

`docs/evidence/handoff-preserved/` contains two base-relative binary patches exported from the old staged T04 worktrees and the previously untracked T05 combined-failure and T08 independent-review reports, with SHA256.json. These artifacts are preserved for audit/recovery; **do not apply them to the current tree**. T04 reviewed-fixes base83c7178; workspace-context base7f77c195. Original files/worktrees remain untouched.

Direct normalized blob comparison found all three workspace-context production/test files identical to current integration. In the earlier reviewed-fixes tree, ten of14production/test files match; background/surface-identity/protocol-test were subsequently changed and are equal to the later workspace-context tree, while capture has later integration corrections. No old patch was blindly merged. The historical T05 eight-failure report predates accepted corrections; the historical T08 mount hold predates final T05 composition. Their original wording remains intact for chronology.

The Git inventory captures all37worktrees and local/remote refs, including older prototype/fallback branches. Those older generations are historical alternatives, not automatically additive requirements. Their uncommitted content and all original branches remain preserved. The inventory does not prove every old experiment should be merged into the final-spec product.

## Machine handoff limitation

The handoff-project skill's `C:/Users/reader/.Codex/hooks/snapshot-helper.ps1` was missing, including a filename search under the agent/Codex roots. Direct Git, desktop-task and native-agent inspection was used instead. Native registry had only the chief active; several generic Claude/Codex/Node processes exist, but no process-to-ticket ownership was inferred and none was killed. The separate machine-local ACTIVE.md records this limitation. Fable should reconcile current processes and worker reports before dispatching overlapping work.
