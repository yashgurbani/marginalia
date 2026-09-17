# Claude steering handoff

**Current entry point:** [Fable/Codex steering handoff](FABLE-STEERING-HANDOFF.md). Shared-project access restored; full T05/T06/T08 Pro runs and first-party Opus4.8Medium T14/T15 implementation are active. Its ownership/status supersedes the older checkpoint and tables below. [Takeover prompt](FABLE-CONTINUATION-PROMPT.md).

## Latest checkpoint — read before the earlier ownership snapshot

T07's bounded device-choice/migration continuation is now integrated and pushed at `dc0f963684fa616599cbe67ff183eebe6058ba7d`, from Pro head `2464ce63862d70f6ec702f759f2bdd88e054839c`. See [native verification](evidence/pro-t07-fixes/NATIVE-VERIFICATION.md): 42 reader/store/journal tests passed on the identical runtime implementation and assertions; the final type-only correction passed project-config typecheck. Windows Node 24.14.1 / better-sqlite3 13.0.3 was exercised. Browser conflict controls, Linux/macOS and whole-ticket acceptance remain open. The merge differs from the tested Pro head only in the three steering documents.

T05 current-base continuation ended Thinking failed; T08 stopped at an explicit usage limit. Neither checkpoint branch had advanced from `1517433`; do not count their progress messages or staged blobs as delivered changes. T06 is still running and must be recovered from its existing chat before another dispatch. The chief refreshed the idle advisor chat and verified Pro is disabled in the model menu, with reset text tomorrow after 1:46 PM. Preserve the requested Pro-only implementation route; no account rotation, credit purchase or silent model fallback. The build goal remains unfinished. These status facts supersede the earlier active/unmerged entries below.

The existing verifier is runtime-confirmed `gpt-5.6-luna` / `max`, dynamic MCP thread `01a0af0b-ec6a-7dd2-8df4-7034e9f49bcc`. Its report was recovered despite the outer tool's 300-second timeout. No duplicate verification session is needed. Continue from the published exact checkpoints and report failures to the owning Pro chat when available.

## Current direction — 17 September 2026

**Continue all T00–T20 tickets through separate parallel 6Pro chats. Astra chief steers only; dynamically routed MCP Luna Max verifies independently. No new Sol or Opus implementation.** The earlier outgoing-chief stop, T05-only continuation, Astra implementation exceptions and Sol/Opus implementation routing are superseded. Parallelism never overrides one-writer-per-path ownership.

Integration baseline: **`1517433968d03cdde054a70376ca26c2d9221315`**, `codex/marginalia-v2`, repository `yashgurbani/marginalia`. The GitHub connector re-resolved this exact ref for this documentation update. Coordination branch: `codex/pro-build-steering-20260917`, based on that SHA. This branch changes only this file, `docs/PROJECT-STATUS-AND-TICKET-REVIEW.md` and `BUILD-STATUS.md`; it does not update integration or any implementation/test file.

Basis: the user's latest ownership/verification update and the accepted current-revision advisory in [this combined-review/steering conversation](https://chatgpt.com/c/6aab9618-74b8-83eb-9518-da28543f1429). This is a documentation handoff, not a new source review, worker dispatch, test run or product acceptance. The initial combined review was pinned to `2c35157`; use the reconciled findings below, not that old list as a current backlog.

**Product status: incomplete; not launch-ready. All 21 tickets retain acceptance work.** The critical path is actual-send correctness → usable evidence-backed dedicated runtime → explicit Ask and live source-bound reply in the existing margin. Local saving, cloud asking and zero-model recomputation remain distinct states and authorities.

Use this document for current ownership and dispatch gates, [the ticket review](PROJECT-STATUS-AND-TICKET-REVIEW.md) for all-ticket requirements and source/runtime distinctions, and [BUILD-STATUS](../BUILD-STATUS.md) for revision-scoped historical receipts. Historical evidence below those current sections is not an instruction to restart an old worker.

## Active ownership and conflict reservations

All paths in this section are relative to `marginalia-v2-package/`. Branch names describe assigned destinations unless an exact published checkpoint is separately stated; they are not proof that a reconciliation commit already exists.

| Lane | Current owner / destination | Status and exclusive boundary |
|---|---|---|
| **T05 integration checkpoint** | [Existing 6Pro chat](https://chatgpt.com/c/6aab9408-941c-83ed-b5ea-8e8a7ea14b7d), `codex/pro-t05-integration-checkpoint` | Active: reconcile the old 17-file patch plus helper UI to `1517433`. Sole owner of margin/helper/persistence/helper-management, webapp main/service worker and T05 tests. Sole mount owner for T08 and library/consent/reply entry wiring. Preserve integrated offline Disconnect. Do not start a second UI reconciliation. |
| **T06 actual send** | [Existing 6Pro chat](https://chatgpt.com/c/6aab9381-d8c4-83eb-be12-75907bebd4c1), `codex/pro-t06-send-checkpoint` | Active: prepared request, synchronous final authorization/commit, immediate actual transport handoff. The currently issued provider scope is broad. It remains reserved until chief explicitly narrows it or records handoff. T02/T13 review, not overlapping implementation. |
| **T07 recovery continuation** | [Existing 6Pro chat](https://chatgpt.com/c/6aab93df-8f84-83eb-b0b7-d5780aef4e22), `codex/pro-t07-integration-checkpoint` | Current-base continuation published at `3b24063191daad872fd5312714f8de688e86069b`, exact parent `1517433968d03cdde054a70376ca26c2d9221315`; independently fetched by chief. Nine files, 1,037 additions / 24 deletions; only continuation transferred, not merged or accepted. Owns reader contract, ReaderStore, journal and their tests. Device-version choice and SQLite-consistent backup/newer-schema refusal are the continuation. |
| **T08 asking module** | [Active 6Pro chat](https://chatgpt.com/c/6aabcb52-f988-83eb-8448-b54ad98298ce), visible 6Pro verified | Active, same narrow scope: own ONLY `ui/asking/**`, `tests/asking*.test.ts`, `docs/evidence/T08-asking/**` and the T08 build receipt. No mount, helper, persistence, journal, provider or entry-point edits. T05 alone mounts it. |
| **Runtime collector/composition** | Future 6Pro assignment; **WAIT** | Do not dispatch implementation while T06's broad provider reservation stands. A previous proposed disjoint contract is not a current ownership release. Chief must record exact released paths and compatible interfaces first. |
| **T20 saved solver** | Preserved `codex/opus-t20-saved-solver`, `c144506f32b67a27f2487426c24b79e4f606af16` | Unfinished, not integrated or accepted, no active Opus. Preserve the code. A later 6Pro continuation needs a bounded assignment reconciled with T06/T07/T13/T18/T05. Do not restart the historical Opus session or duplicate its implementation. |

T07's earlier published continuation **`c9c2b2764e574ee670337ee3010e64930f9aaa5e`**, parent **`4552b65`**, remains the original verification target. Chief dispatched verification through registered dynamic Codex MCP, explicitly `gpt-5.6-luna/max`; `turn_context` independently confirmed model `gpt-5.6-luna`, effort `max`, actual thread **`01a0af0b-ec6a-7dd2-8df4-7034e9f49bcc`**. This is a routed MCP worker, not a native desktop worker. The new current-base checkpoint is `3b24063191daad872fd5312714f8de688e86069b`; no passing result or acceptance is claimed for either revision.

Conflicts are resolved by chief before a writer starts: T05 owns mounts and UI/persistence integration; T07 owns reader/store/journal semantics; T06 owns its current issued actual-send/provider scope. T08 supplies callbacks, not an alternate mount. Future runtime and T20 work cannot take these paths by implication. Receipt ownership follows its named ticket; this documentation branch edits no receipt.

## Verification already reported, and its limits

### Helper UI checkpoint e2fb6c2 — report exists, combined T05 still pending

Exact earlier checkpoint: **`e2fb6c2b61cce004c2c2964f9db146f73fac32fc`**, branch `codex/t05-helper-management`, historical base `87b451d`. The user's latest update reports a Luna verification report at `.local/t05-luna-verification/REPORT.md` with focused **8/8 and 18/18**, typecheck, webapp build and extension build passing. Isolated Chromium 147 exercised visible Show/Renew → Pair → safe List → Forget → 401, with the local note retained; expiry, 360 px narrow layout and no browser errors were recorded.

This is **reported verification scoped to e2fb6c2**, not a test run performed by this document author and not acceptance of the reconciled 17-file T05 patch. The original runtime model metadata was not independently exposed; do not call that report runtime-verified Luna Max attribution. Keep the report's test groups separate rather than claiming a unique aggregate count. The combined T05 checkpoint needs its own exact diff review and current-revision visible acceptance, including integrated C6 behavior.

Privileged Show/Renew/List/Forget controls belong only in the trusted helper page, not extension/floating margins. The existing endpoint/trust contract remains [T01 helper management](evidence/T01-helper-management.md). Pairing management's stated browser-origin/CSRF boundary is not a defense against arbitrary native processes forging HTTP metadata.

### T07 continuation — verification in progress

Per chief's correction, the outer MCP `tools/call` timed out at 300 seconds while the same session continued; no duplicate was launched. Chief corrected a nested advisory invoked contrary to the no-delegation instruction. Direct native Node 24 / better-sqlite3 verification continues inside the routed MCP session, with no pass or acceptance claimed. Evidence must name its tested SHA: results for c9c2b27 do not transfer to current-base `3b24063191daad872fd5312714f8de688e86069b`, combined T05 conflict controls or all-platform migration acceptance.

### Earlier integrated baseline — historical

The outgoing chief recorded **282 tests: 281 pass, 0 fail, 1 optional browser skip, 0 cancelled** at product source `0111589`, Windows Node 24.14.1. Log: `.local/consolidation-current/tests-recovery-management.log`. Typecheck and both production builds passed on the stated preceding checks; isolated Chromium 147 covered selected local reader and management flows. These are historical revision/environment facts, not a new `1517433` run or proof of inference, confinement, all design states or Linux/macOS behavior.

Historical evidence remains at `docs/evidence/t04-integrated-reader`, `t04-recovery-copy-browser`, `t05-offline-disconnect`, `t01-helper-management-browser`, `T01-helper-management.md` and [INTEGRATED-VERIFICATION](evidence/INTEGRATED-VERIFICATION.md). Exact DOM/JSON records may show below-viewport states absent from a screenshot.

## Current source advisory to carry forward

The accepted advisory inspected `1517433` before this documentation task; no new implementation review was performed to write this handoff.

- **Actual-send defect:** `JobService.dispatch()` still finalizes `withDispatchHandoff()` before runner entry. Adapter queueing, evidence, thread preparation and checkpoints then await before the inference RPC. Keep the existing same-DB/context/CAS/cancellation protections, but place consuming finalization at the prepared transport boundary. Do not redesign the runtime.
- **Runtime code gap:** bundled `daemon/main.ts` uses `unavailablePolicyHostEvidence()` and `dispatchReady: false`; the host source supplies empty observations. Dedicated sign-in alone cannot make this composition operational. Implement the existing evidence interface and readiness composition after T06 releases ownership; never simply flip a flag.
- **Ask/design code gaps:** the actual margin still has a client preview and disabled send choices; `webapp/main.ts` mounts only that margin. Its composer is above the scrolling column and there are two section-map representations. These remain T05/T08 integration work, not a second advisor implementation.
- **Preserved corrections:** empty-selector termination (F01), workspace-specific policy preparation and completed-workspace recovery (F02/F03), read-only predecessor verification (F04), narrow stop-fence acknowledgment (F05), identical durable pending reconciliation (F15), and non-consuming eligibility plus atomic host handoff (the first F20 slice) are visible in current code. Do not implement them again. Specific source corrections do not close runtime/ticket acceptance.
- **T20 partial migration:** its interface declares `prepareCommit()`/synchronous `commit()`, but the execution path still calls awaited `gate.finalize()` followed by a separate journal write. Canonical base64/sticky malformed-output checks, empty input tuple admission and a digest state-key contract already exist on c144506. Preserve them; finish producer/consumer and host integration rather than treating every old review point as untouched. No typecheck was run by the advisory.

## Next integration order and release gates

1. Retrieve only the existing T05, T06 and T07 outputs. Verify each parent, exact file allowlist, diff and claimed evidence. Review T07's current-base continuation checkpoint without replaying its integrated first slice. Review T05's combined UI against C6 and the reported helper checkpoint; the helper report is useful but not transferable acceptance.
2. Complete T06 actual-send first on the execution critical path. Acceptance includes both adapters/start/continuation, suspended-preparation cancel/revoke, changed generations, once-grant competition, failed SQLite transaction, one-use prepared receipt, and preservation of terminal cleanup/restart behavior. Known pre-send rejection consumes nothing; ambiguous post-commit failure stays unknown, with no refund or automatic replay. No local solver/cache operation consumes cloud-inference permission.
3. **Only after an explicit ownership narrowing/handoff**, dispatch runtime collector/composition to a separate 6Pro chat. Bind actual observations to the dedicated executable/home, platform, model/policy and generation; fail closed on missing/stale evidence. Verify real authenticated lifecycle using the finished T06 boundary. Developer MCP routing/login is not product authentication or confinement.
4. Continue the active narrow T08 module while current nonoverlapping lanes proceed; do not dispatch a duplicate. It uses existing host preparation, consent and reply interfaces, not a second store or transport. T05 mounts it after the agreed interface and its own checkpoint are reconciled. Local page definitions, selection, dismissal, denial and a note ending in '?' send no inference request. Only the explicit permitted action sends. Check frozen note versions, preview replacement, revoked pairing, duplicate submit and closed-mount callbacks.
5. Verify the actual reader loop: Keep/write → explicit Ask → exact host preview/permission → Working/provisional/committed reply → local interaction → reload/source reattachment/cancel/recovery. Include an unseen page, current-input follow-up and truthful scientific authority. A fixture provider or unmounted module is not genuine generation evidence.
6. Continue T20 through a later 6Pro assignment on the verified boundary and complete the remaining transforms, library/settings/export/diagnostics, all-platform installation/recovery and launch work. These are sequential acceptance dependencies, not scope cuts or a requirement to finish every module before any reader value is tested.

Astra chief coordinates ownership, reviews receipts and controls integration decisions; it does not quietly author source corrections. Luna verification is independent and names the actual model/effort when exposed, route, exact commit, environment, commands and observed results. Missing metadata stays missing. No unverified branch or checkpoint is proposed for merge; after any integration, evidence must refer to the resulting revision rather than an owner branch alone.

## Governing product scope

Direct current user corrections → `wayfinder/SPEC-FINAL.md` → derived `wayfinder/SPEC.md` and all 71 entries in `wayfinder/FEATURE-INVENTORY.md` → build-stage sequencing. Whitepaper, MAP, ticket decisions and design sources retain their explanatory/traceability roles; historical cut orders do not delete capability. All T00–T20 and R1–R30 remain accounted for in the ticket review.

Marginalia remains a margin beside whatever the reader is reading: source unchanged, notes senior, frozen explicit anchors, durable work, help beyond summary, inspectable interactive outputs and calm reader states. Preserve the Claude design system, with the two resolved decisions: editor at reading position; one complete map preserving note density, section boundaries, marks and current position. No implicit sends, no candidate-authored host authority and no chatbot/dashboard substitution.

Keep four computation paths distinct: packaged local evaluation; saved samples only within the recorded envelope; explicit saved-solver recomputation with zero model turns; explicit Ask again for cloud interpretation/model revision. An authenticated deterministic loopback host check can be zero-model work; that does not permit a cloud/retrieval call under that label.

Windows, Linux and macOS are equal targets from the outset. Evidence availability changes scheduling, not scope. Retain data by default on uninstall, offer export before deliberate deletion, preserve two verified SQLite pre-upgrade backups plus an unresolved recovery copy, protect detailed diagnostics, and never operate migration tests on the user's database. User-controlled sign-in, access to remaining machines, reader evaluation and publication decisions are external/human gates. Portable collectors, installers, migration/export tools and recording preparation remain engineering work.

## Historical recovery references — not active assignments

The original outgoing chief was task `01a0adaf-dd71-7583-8307-b877547c9189`. The full previous handoff is preserved [at the exact base revision](https://github.com/yashgurbani/marginalia/blob/1517433968d03cdde054a70376ca26c2d9221315/marginalia-v2-package/docs/CLAUDE-STEERING-HANDOFF.md); its T05-only restriction and old routing are historical, not current authority.

Historical local repository: `D:/Projects/Marginalia`. T05 helper worktree: `D:/Projects/Marginalia-t05-helper-management`, former task `01a0adc8-a066-7d11-8248-9cb5a63cd737`. T06 preserved worktree: `D:/Projects/Marginalia-worktrees/t06-actual-send-boundary`, old branch `codex/t06-actual-send-boundary`, base `da1992f`, task `01a0ae02-dc03-7ec2-ae86-26b6be5bf319`. The old Sol session failed to resume and later capacity attempts, including `01a0aec6-c498-7fc2-9cb0-f5eb742f8d96`, produced no implementation. Those stopped attempts do not describe the active T06 6Pro owner.

T20 worktree: `D:/Projects/Marginalia-worktrees/t20-saved-solver`, old base `6987e64`. Historical first-party Opus 5 High session `163a228c-e0a6-4723-9a7d-285c8bda36a2`: process 56457 was lost during transition; resumed handle 20245 was deliberately stopped, exit 1, without a revision-4 completion receipt. Chief then reported 123/123 solver tests. Earlier 88 chief-run and 116 worker-reported results belong to earlier revisions. See `docs/evidence/T20/HANDOFF-CHECKPOINT.md` and `PENDING-CHIEF-REVIEW.md` on c144506, and `docs/evidence/T20-CHIEF-REVIEW.md` on integration. No actual saved-solver execution/isolation was established. Local `.local/opus-t20` material was not pushed.

Historical design paths: `D:/UserData/reader/Downloads/marginalia-v1-package/design` and adjacent `design-pass-2`. Developer routing references: `C:/Users/reader/.codex/skills/codex-mcp-router/SKILL.md` and `C:/Users/reader/yasb-personal/scripts`; automatic complementary-account routing, no fixed account label or token-file access. These machine-local paths were recorded previously, not re-inspected in this documentation task.

Root `CONTEXT.md` and `README.md` were previously dirty/user-owned. Old worktrees, untracked packets/design ZIPs and profiles must not be blanket-added, cleaned, reset or deleted. The historical snapshot-helper path was missing; no successful snapshot is claimed. Verify live workspace/process state before future execution and preserve user-owned work. This GitHub-only documentation handoff inspected no local checkout or process state.
