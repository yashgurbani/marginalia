# Claude steering handoff

17 September 2026. Outgoing chief: Codex task `01a0adaf-dd71-7583-8307-b877547c9189`. User asks: “Wrap up the existing tickets and commit to git, leave a detailed handoff and status report for Claude to continue steering.” This is a handoff, not a claim that the product or all tickets are finished. No new work should start in the outgoing chief after this checkpoint.

## Start here

Repository: `D:/Projects/Marginalia`, package: `marginalia-v2-package`, remote `https://github.com/yashgurbani/marginalia.git`, integration branch `codex/marginalia-v2`. The last verified product source before this handoff is `0111589`. Handoff-only commits follow it. Read `BUILD-STATUS.md`, this document, and `docs/evidence/INTEGRATED-VERIFICATION.md`. Older paragraphs in the build report are chronology, not fresh acceptance. Consult the source and receipt before repeating a claim.

Source authority: `wayfinder/SPEC-FINAL.md`, `wayfinder/SPEC.md`, `wayfinder/FEATURE-INVENTORY.md`, `wayfinder/MAP.md`, `wayfinder/tickets`, package documents and the root `Marginalia — Research Whitepaper.md`. The full 71-feature/21-ticket vision remains required. Challenge priority changes sequencing, never silently removes capability. Source/spec contradictions need disposition, not arbitrary engineering simplification.

Claude design pass 1: `D:/UserData/reader/Downloads/marginalia-v1-package/design`; pass 2: adjacent `design-pass-2`, including `DESIGN-PASS-2.md`. Preserve the design system. User resolved two conflicts: editor at reading position as SPEC-FINAL says; one vertical map preserving density, boundaries, notes and current position. Pass-2 fixtures are not scientific/runtime evidence.

## What is committed and verified

Integrated product source includes helper/storage, journal, provider adapters, extension, reply contract/renderer, consent, jobs and library foundations. These are not a complete working asking/recompute experience.

Recent commits:

| Commit | Change | Evidence |
|---|---|---|
| `3fc161e`, `4e6d211` | Exact authenticated POST read aliases and client mapping, lock typing | Server checks and real extension pairing/read/save/reload |
| `3fb9e8e` | Honest unconfirmed helper request wording | Focused tests and actual offline-save DOM/local-note reload |
| `5507874` | Calm configured-port collision startup | Actual CLI regression, 16 launch/server tests, typecheck |
| `2af10d5` | Offline Disconnect persists local removal before revoke; newer pairing retained | 11 focused tests, builds/typecheck, actual extension disconnect/reload/no-network Save |
| `87b451d` | Trusted helper-only code/list/revoke routes, immediate socket invalidation | 23 management/pairing/server/read tests and typecheck |
| `0111589` | Real browser metadata verification for management routes | Actual Chromium relative fetch code/pair/list/revoke succeeds; no synthetic forbidden headers |

Full suite at `0111589`: 282 tests, 281 pass, 0 fail, 1 optional browser skip, 0 cancelled. Windows Node 24.14.1. Log `.local/consolidation-current/tests-recovery-management.log`. Full typecheck and both production builds passed on preceding bounded source checks. Built output is generated/ignored, not proof of a fresh clone build. Browser checks use isolated Chromium 147 with fixture data, not personal browsing or model execution.

Evidence directories: `docs/evidence/t04-integrated-reader`, `t04-recovery-copy-browser`, `t05-offline-disconnect`, `t01-helper-management-browser`, and `T01-helper-management.md`. They contain reports/hashes/harnesses/screenshots. A screenshot sometimes omits below-viewport status; exact DOM text is in JSON. Do not infer broader visual/accessibility/platform acceptance.

## Unfinished branches and ownership

### T20 saved solver: checkpoint only, do not merge as accepted

Branch `codex/opus-t20-saved-solver`, pushed commit `c144506`. Worktree `D:/Projects/Marginalia-worktrees/t20-saved-solver`, package subfolder. Base `6987e64`, substantially behind current integration.

First-party Opus 5 High session `163a228c-e0a6-4723-9a7d-285c8bda36a2`. Old process 56457 was lost in a host transition while compacting. Resumed handle 20245 was deliberately stopped for this handoff; exit 1, no completion receipt. Process inspection found no remaining Claude CLI command for this session. Other Claude desktop processes belong to the user and were untouched.

Chief independently ran current three solver suites after stopping the writer: **123/123 pass**. This does not prove final review closure. See `docs/evidence/T20/HANDOFF-CHECKPOINT.md` and `PENDING-CHIEF-REVIEW.md` ON THAT BRANCH. Older REPORT/SESSION files describe revision 3 and are historical. Partial revision 4 includes transport malformed-output corrections. Service still awaits finalization and a separate journal record before execution; atomic attempt-claim/actual-send remains unresolved. Reconcile state-key bounds, fixed-input solvers and termination wording against the current code. Preserve local recompute as zero model turns; never consume cloud-inference permission for local solver/cache work.

Route is unmounted; host context, authority, evidence, generation/attempt gate and durable journal implementations are missing. No real Codex saved-solver execution or host isolation is demonstrated. Resume only after reconciling source and one-writer ownership; original session logs/briefs are in worktree `.local/opus-t20` (not pushed).

### T05 helper management UI: committed checkpoint, not integrated

Task `01a0adc8-a066-7d11-8248-9cb5a63cd737`, existing Astra Medium owner. Worktree `D:/Projects/Marginalia-t05-helper-management`, branch `codex/t05-helper-management`, base `87b451d`. Assigned only helper-page Settings Show code/list/Forget UI, scoped style, numeric pairing input and focused tests. No daemon/jobs/provider edits. Checkpoint `e2fb6c2b61cce004c2c2964f9db146f73fac32fc` is committed and pushed. Worktree is clean; owner stopped expansion. Owner reports 8 UI/backend tests, full typecheck and webapp build passed. The chief has not independently reviewed this diff or run its visible UI acceptance. See branch receipt `docs/evidence/T05/helper-management-ui.md`.

Do not expose privileged management controls in extension/floating margins. Exact endpoint contract is `docs/evidence/T01-helper-management.md`. Real browser transport passes; visible control flow must still prove Show code → extension Pair → Forget, including expiry/failure and note preservation. Preserve any unfinished changes rather than re-implementing over them.

### T06 actual-send boundary: clean preserved worktree, no active Sol

Task `01a0ae02-dc03-7ec2-ae86-26b6be5bf319`. Worktree `D:/Projects/Marginalia-worktrees/t06-actual-send-boundary`, branch `codex/t06-actual-send-boundary`, base `da1992f`. Previous original Sol session could not resume. Two fresh attempts were terminal model-capacity refusals; latest `01a0aec6-c498-7fc2-9cb0-f5eb742f8d96` exposed gpt-5.6-sol/medium but did no implementation. No active worker, no source diff. Packet and task context retained. Account usage headroom is not proof of model capacity.

Required next slice: async non-consuming preparation/bootstrap; opaque single-use prepared request bound to attempt, provider/transport generation, workspace/home/model/policy and exact payload; synchronous same-DB finalization of current authority/cancel/deadline, attempt/CAS, cloud grant/egress/handoff and initial canonical checkpoint, followed by immediate RPC handoff without await/queue. Any ambiguous post-commit error is unknown, never refunded/replayed automatically. T02/T13 are reviewers. Existing durable transaction through `da1992f` is verified but does not close this later asynchronous provider boundary.

## Remaining product work by ticket

T00 fixture needs final live/rendered acceptance. T01 C4 UI/entry and C12 usable extension admission remain. T02 real dedicated-provider asking/recovery remains. T03 real host-owned reports/delivery remain. T04 Firefox/macOS/Linux and full provider reader flow remain. T05 major Pro UI/design changes, job/consent/library wiring and current live statuses remain. T06 actual send, runtime evidence and recovery remain. T07 C8 backups/newer-schema refusal and durable device-conflict choice remain in unpublished Pro continuation. T08 contextual definitions, T09 real simulation, T10 WebMCP, T14 evidence, T15 Explore and T17 page header still need complete implementation/entry verification. T11 library is implemented but not fully mounted; export-everything and sanitized diagnostics missing. T12 release/video/listing/fresh-machine gates remain. T13 confinement evidence and actual boundary remain. T16 versioned note Ask/vocabulary/recovery remains. T18 real sidecar delivery/host arbitration remains. T19 installers on all three OSes and install/recovery evidence remain. T20 as above. Do not close these from unit tests or documentation alone.

## Pro and model routing

Use 6 Pro substantially as executor/advisor, with isolated Git branches or ZIPs, not advice-only. Existing pending chats: T05 `https://chatgpt.com/c/6aab9408-941c-83ed-b5ea-8e8a7ea14b7d`; T07 `https://chatgpt.com/c/6aab93df-8f84-83eb-b0b7-d5780aef4e22`; chief `https://chatgpt.com/c/6aab9618-74b8-83eb-9518-da28543f1429`. Do not submit duplicates before recovering existing output. Last automation state: Chrome visible, in-app browser unavailable; open_in_codex queued. User has already been asked to reconnect. Verify fresh state. Quota banner alone is not proof Pro is unavailable; user says refresh exposes it. Verify visible model.

Current desktop account is for Astra. ALL Sol implementation/review through automatic complementary-account Codex MCP Router, never pin gs/jill or native Sol fallback. Skill `C:/Users/reader/.codex/skills/codex-mcp-router/SKILL.md`; router scripts under `C:/Users/reader/yasb-personal/scripts`. Read actual current route; do not touch token files. Luna Max for mechanical work, Sol Medium through MCP for technical work. Existing Astra owner may do explicitly assigned small corrections; do not quietly label native Sol as routed work. At most two active delegated runs, one writer per path. Claude always first-party; user selected Opus5 High, no API/provider/account fallback. Meter remains stale Sept14; user authorized the same first-party route despite stale reading. Verify auth and actual model.

## Product decisions and next order

Windows/Linux/macOS are equal targets from outset. User can test Windows/Linux and will arrange Mac. Retain data by default on uninstall; offer export before deliberate deletion. Keep two verified SQLite pre-upgrade backups plus unresolved recovery copy. Minimal public health only; detailed diagnostics protected. Reading, local saving and asking must remain separate truthful states. Never auto-send a note ending in '?'. Unknown execution/request outcomes remain unknown.

1. Collect and review T05 checkpoint, integrate only coherent tested UI, then run actual helper-page/extension pairing lifecycle.
2. Finish T06 actual-send and T20 contract/gate integration together, keeping local compute separate from cloud inference. Use available authorized routes; no blind capacity retry loop.
3. Recover existing Pro T05/T07 output, then complete real dedicated-runtime sign-in, consent preview, Ask/reply and saved solver user flow. Do not assert confinement from settings alone.
4. Continue full feature inventory, recovery/installers/platform evidence and challenge launch deliverables. Test meaningful public boundaries; earlier test deferral was superseded after consolidation.

## Repository hygiene and recovery

Root tracked `CONTEXT.md` and `README.md` were already dirty/user-owned and remain untouched. Many old untracked design/review ZIPs, source packets, scratch artifacts and test profiles remain; do not blanket add, clean, reset or delete. Exact owned files only were committed. Existing worktrees must not be removed as cleanup. Main repo remote has integration; solver checkpoint is separate and pushed. No PR merge or release is implied.

The handoff skill's `C:/Users/reader/.Codex/hooks/snapshot-helper.ps1` is missing, and bounded search found no replacement. Git/process facts were read directly; no successful helper snapshot is claimed. A compact machine-local ACTIVE.md will reference this detailed handoff. Recheck HEAD/status, worktrees, task state and process ownership before any resume. Preserve user-owned dirty state.
