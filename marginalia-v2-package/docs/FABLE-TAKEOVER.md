# Fable takeover — consolidated Marginalia build

18 September 2026. This is the current chief handoff. It supersedes live-owner and merge-state claims in older handoffs and receipts, which remain as historical evidence. Read this together with FABLE-TICKET-STATUS.md and FABLE-WORKTREE-INVENTORY.md.

## Decision and exact checkpoint

Yash: **“Ignore the T06 review. Consolidate everything from the very beginning to now and write a detailed handoff of each ticket … Make sure no thread is lost between this handover.”**

Repository: https://github.com/yashgurbani/marginalia . Local root: `D:/Projects/Marginalia`. Product package: `marginalia-v2-package`. Continue from **`codex/marginalia-v2`**, product consolidation merge **`6fb78e0894467726d98ebca615965fba44accd62`** plus the subsequent handoff documentation commits. The GitHub default branch is not assumed to be current. Fetch the named branch explicitly.

T06 source from `codex/t06-final-consolidation` (`e838488`) merged cleanly. There were no conflict resolutions to improvise. Its production/test directories match the tested combined candidate `2e77f3a`. The native integration report, absent from that candidate, is now included. **The independent T06 review was waived, not passed.** There is no T06 independent acceptance verdict. This is a consolidated development checkpoint, not a release approval.

Before cancellation, Pro reported a concrete potential defect: replacing a checked reply file with a FIFO could block before validation and delay shutdown; it said it was adding nonblocking open and a regression. That was a progress statement, not a delivered patch or independently reproduced result. Treat it as the first high-priority investigation. At handoff inspection, remote `codex/pro-t06-integration-review` still pointed to unchanged candidate `2e77f3a`. Do not claim a fix exists there. Review URL: https://chatgpt.com/g/g-p-6aabdbd64d848191bf91223b096ffb3f-marginalia/c/6aac70c6-e44c-83eb-bdae-9645c45f5b8a . Stop was clicked at the user's direction; do not restart it automatically.

## Product destination and governing sources

Marginalia is a contextual reading companion beside the source: the reader writes or selects, receives useful help in the form that fits, interacts locally, and returns to durable threads. The extension margin is the primary work surface; the localhost webapp is its library/settings companion. It is not a dashboard or a generic chat wrapper.

Start with `docs/SOURCE-DOCUMENT-INDEX.md`. Direct user decisions outrank `wayfinder/SPEC-FINAL.md`; that spec outranks derived plans and worker opinions. Read the unchanged whitepaper at `docs/sources/RESEARCH-WHITEPAPER-v3.md`, `wayfinder/FEATURE-INVENTORY.md`, `BUILD-PLAN-24H.md`, `MAP.md`, design brief and pass-2 reconciliations. All **21 build tickets T00–T20 and 71 inventory entries** remain in scope. Stage gates order delivery; they do not authorize cuts. The numbered `wayfinder/tickets/` files are design decisions and do not map one-to-one to the build-ticket numbering.

Non-negotiables:

- Source stays unchanged. Notes are primary and visually senior to replies. Editor stays at the reading position, not in the header. One page map preserves density, marks, sections and current position.
- Reading, saving to the local helper and asking are separate. A question mark offers Ask; selection, reopening, recovery, reconnection and unknown outcomes never silently send.
- Review the exact outgoing content and recipient before inference. Preserve immutable source and the exact note version answered. A saved reply need not match today's selection: retain its original context and safely reattach or refuse uncertain navigation.
- Four execution paths stay distinct: packaged local kernel; saved samples inside their envelope; explicit rerun of the saved solver without a model turn; explicit Ask again. Local arithmetic must not consume a cloud inference grant.
- Host evidence is separate from model claims. Fetched does not mean supported; a requested sandbox flag or signed-in account is not confinement proof. Withhold unchecked result sentences without hiding the useful curve.
- Windows, Linux and macOS are intended platforms. Yash can test Windows/Linux and will arrange a Mac. Do not interpret “Windows first” as a platform scope reduction.
- Keep the established design system. Fix concrete problems through existing store, contracts, broker and renderer. No replacement framework, parallel state authority or speculative architecture.

Original design exports remain at `D:/UserData/reader/Downloads/marginalia-v1-package/design` and `design-pass-2`; pass 2 covers frames 6–14, light/dark/narrow and frame 5 addendum. The handoff is design intent, not accessibility/runtime acceptance. Fixture documents/PDFs are labelled placeholders. The editor/map decisions above override the conflicting pass-2 options. Docs Run, Hear it availability and recipient copy must reflect actual capabilities; do not ship promises inferred from mockups.

## Progress from the beginning

1. Earlier prototype/contest work and the Astra pivot review established the daemon + extension + webapp direction. The root repository also contains older experiments and branches. Preserve them, but use the v2 package and final spec for this build. Root `CONTEXT.md`, `README.md`, the original whitepaper and historical untracked assets were deliberately not swept into commits.
2. T01/T02/T03/T04/T05/T07/T11/T13/T18 work built the helper, contracts, provider adapters, capture, journal, consent, renderer and library. Early testing was deferred by the user, then later explicitly authorized. Their original receipts describe that historical pause; it is not a current prohibition on tests.
3. Pro reviewed the policy, protocols, capture/security, persistence, renderer and design. Concrete fixes were integrated. Source and evidence are in the package receipts and `docs/evidence/`; the historical thread index preserves links and task IDs.
4. T07 recovery and SQLite safety were consolidated through `dc0f963`, source `2464ce6`, with 42 native reader/store/journal tests. Device-version choice/absence and historical conflicts were preserved.
5. Four Luna regression slices and the two Sol Evidence/Explore corrections landed. Evidence no longer promotes retrieval into support; Explore keeps explicit navigation and original return context, including saved reopening. `docs/evidence/parallel-wave/BRANCH-CONSOLIDATION-AUDIT.md` proves source inclusion rather than assuming unmerged branch names mean missing work.
6. T08 final Pro source `a9a6a08`, corrected by `efb3031`, merged through `8a08853`: the review plan remains visible during work and labels describe actual connection methods. 56 asking checks were recorded at integration.
7. T20 progressed from original Opus 5 source `c144506`, to Opus 4.8 continuation `c4a6744`, to Opus 5 adapters `fda8dba`. Independent review found historical-attempt binding and unconfirmed claim release. Sol fixed them at `a8a3a34`; independent closure `d2a67b5`; merge `4466e32`. Module is integrated; real saved recompute remains unmounted/runtime-unaccepted.
8. Final T05 and T06 ZIPs were recovered after their GitHub write failures. T05 was reconciled with concurrent `c5d7d51` rather than overlaying stale files. An intermediate rollback and an overrestrictive historical-reply proposal were rejected. Final fixes `d216063`, `88700cf`, `41207c4`, independent closure `51655d8`, merge `96eef734` preserve question continuity, truthful retry state and original-source replies.
9. T06 final patch was preserved as `d1deedf` on exact base `1859681`, reconciled and natively checked, then merged at `6fb78e0` under the user's review waiver. The new FIFO concern remains open. This is the current handoff, not a declaration that all tickets are complete.

## Evidence and honest limits

The combined candidate `2e77f3a` had 669 passing tests, two skips, zero failures; full TypeScript check, webapp build, extension build and extension typecheck passed. T06 alone had 606 passing/two skipped and a focused 110 passing/one skipped. The two skip categories are an existing browser-only test and Windows link/reparse behavior. See final handoff validation for the fresh merged-head run.

T05's Pro sandbox recorded 43 focused checks and 10 offline Chromium app/DOM checks with labelled fixtures. That is not native extension-origin, real account, screen-reader or platform proof. T20 has module/regression evidence including exact producing-attempt and real second-retry logic, but not reader-reachable confinement or zero-model execution. The local native SQLite checks are stronger than a fake store but still not a power-loss or real Codex run.

No launch-ready claim: a complete real reader journey, both provider adapters, observed confinement/egress, saved solver runtime, installation and all-platform acceptance remain. No percentage is offered because source volume would obscure these missing outcomes.

A worker T06 report says 54 manifest postimages; chief intake verified **53 manifest-listed files**. Preserve that discrepancy rather than repeating the worker count. The original archive hashes are in PRO-FINAL-DELIVERIES.md and below. Do not rerun old patches onto the already-consolidated tree.

## First actions for Fable, in order

1. Read this handoff and the full ticket matrix, then fetch `codex/marginalia-v2`. Compare its HEAD with the handoff commit and check local dirtiness. Preserve all 37 worktrees. Read the latest Pro output only if useful for recovering the FIFO reproduction; do not wait on or restart the waived review.
2. Reproduce and fix the reported FIFO/file-type race in bounded workspace/reply reads and shutdown. Use a real platform-appropriate filesystem test, ensure it cannot hang the test process, and cover regular-file validation after open. Assess related loaders only where the same reachable primitive exists. Do not broaden into a filesystem framework. Commit the correction separately.
3. Trace the actual T05 → T08 → T13 → T06 → provider → reply → T07 persistence path. Inventory missing mounts/contracts first, then complete them. Confirm no-send paths before explicit real inference. Keep authentic account setup under user control and use the product's dedicated home.
4. Complete T20's remaining artifact-generation binding, host execution gate and public mount, reusing the accepted module. Demonstrate the reader can request saved-solver recompute with zero model turns and truthful cancellation/unknown results.
5. Finish T19 install/recovery and T11 global export/diagnostics, then actual generation and Evidence/Explore acceptance, WebMCP, header/vocabulary/PDF and other inventory gaps in the stage plan. These remain required, not “optional polish.”
6. When useful, use `PRO-CONSOLIDATED-REVIEW-PROMPT.md` for the requested comprehensive review/execution pass against the then-current exact SHA. **It was prepared but never submitted.** The latest handover transfers that orchestration to Fable; there is no other active comprehensive reviewer to wait for.
7. Update existing receipts per accepted change, record actual commands/platforms, and keep the ticket matrix honest. Do not infer complete from a decision ticket being closed or from a model saying it finished.

## Delegation and coordination rules

GitHub is the shared publication point. Work in isolated branches/worktrees; one owner per overlapping path; chief integrates coherent reviewed changes. Do not force-push, reset, delete worktrees or mass-commit untracked files. New work branches use `codex/` unless deliberately assigned otherwise.

User prefers Pro for substantial implementation/advisory/review, with long autonomous prompts and GitHub reads/writes or downloadable patches. Use native first-party Claude for difficult work; the user explicitly authorized ignoring only stale usage-meter readings, not actual authentication/quota errors. Last requests included Opus 5 challenging work, Sol Medium implementation and Luna Max bounded verification. Sol/Luna should use dynamic complementary-account MCP routing; no silent native fallback, hard-coded account choice, credential copying or API-billing substitution. Router skill: `C:/Users/reader/.codex/skills/codex-mcp-router/SKILL.md`; Claude skill: `C:/Users/reader/.codex/skills/consult-claude/SKILL.md`; Pro skill: `C:/Users/reader/.codex/skills/consult-chatgpt/SKILL.md`.

The last two independent T06 MCP attempts ended with actual usage-limit errors and no verdict. Do not blindly retry their old handles. A fresh authorized dispatch may use current routing once availability is checked; do not treat the old refresh-token incident as the current diagnosis. Router authentication had been repaired and automatic complementary selection restored earlier. Existing session routing is sticky until reconnect.

Installed routing paths: `C:/Users/reader/.codex/config.toml` section `[mcp_servers.codex]`; official launcher `C:/Users/reader/yasb-personal/scripts/Start-Active-Codex-Mcp.ps1`; router `C:/Users/reader/yasb-personal/scripts/Codex-Mcp-Router.mjs`. The registered tools are `mcp__codex__codex` and `mcp__codex__codex_reply` (client names may differ). Prefer that registered service. The skill's `scripts/invoke-router.mjs` is the documented fresh-transport fallback, still through the official launcher/dynamic routing. Explicitly select model/effort and owned paths; do not launch the bare router or infer configuration secrets from this handoff.

Use Ask Matt and Ponytail to keep implementation aligned and proportionate, and the existing Impeccable/taste design guidance for design changes. The user cares about complete reader behavior over engineering ceremony. Test boundaries were later authorized; no retrospective claim of TDD red-before-green is appropriate for previously written code.

## Recovery locations and no-lost-thread map

- `FABLE-TICKET-STATUS.md`: every T00–T20 ticket, implementation/evidence/remaining acceptance and next owner boundary.
- `FABLE-WORKTREE-INVENTORY.md`: all 37 local worktrees, branch/HEAD, all local/remote refs and dirty files as captured. Legacy branches are preserved; cherry-picked or superseded code must not be blindly remerged.
- `FABLE-THREAD-REGISTER.md`: important Codex, Pro, Opus and MCP runs with current dispositions.
- `FABLE-HISTORICAL-THREAD-INDEX.txt`: source-file/line index of 127 historical thread/session/Pro references. This preserves references that are no longer in the desktop's current task list. It is an index of evidence, not live-state proof.
- Previous canonical handoff is preserved as `FABLE-STEERING-HANDOFF-PRE-TAKEOVER.md`. Historical current-owner language there is superseded.
- Final T05 ZIP: `D:/UserData/reader/Downloads/pro-t05-full-recovery.zip`, SHA256 `6e1940fcfb5de714a0221e846c8800ae18181edd80a1d3bad754c26bd1805931`.
- Final T06 ZIP: `D:/UserData/reader/Downloads/T06-full-recovery-1859681.zip`, SHA256 `4b05c3fbfd0137dccdda5bb60d641ca5b645c3d899e01ebbc28993abcb0ebf20`.
- Extracted original intake: root `.local/pro-final-intake/t05` and `t06`. Final candidate logs remain in `D:/Projects/Marginalia-worktrees/final-pro-combined-check/marginalia-v2-package/.combined-*.log`; T06 native logs in its worktree package. Sensitive credentials and hidden reasoning are not handoff artifacts.
- Root user changes `CONTEXT.md` and `README.md` remain uncommitted. Numerous old/untracked prototypes, reports and local worker state are inventoried, not discarded. The machine-local handoff snapshot helper was absent; Git and desktop task state were inspected directly. No process is declared stopped merely because its report is old.

Fable is the next steering owner. Codex has not launched another ticket or a new comprehensive Pro chat during this handover.
