# Marginalia steering handoff — 17 September 2026

This is the current coordination entry point. It supersedes older active-owner tables and the earlier Pro-access blocker in `CLAUDE-STEERING-HANDOFF.md`. Codex is still coordinating: the user subsequently asked it to resume implementation. Do not start a second chief or duplicate these workers without an explicit handover. Read [the whole-project stocktake](PROJECT-CONSOLIDATION-REVIEW.md) for all-ticket direction, integration order and drift risks.

## Repository and source authority

- Repository: https://github.com/yashgurbani/marginalia. Integration: `codex/marginalia-v2`; last product checkpoint `dc0f963684fa616599cbe67ff183eebe6058ba7d`, documentation checkpoint `51e2473f5d26dd3a7e63d6823c9a89528b9d6ad3` before this handoff.
- Local repository `D:\Projects\Marginalia`; package `marginalia-v2-package`. Root `CONTEXT.md` and `README.md` contain unrelated user changes. Preserve these and existing untracked files/worktrees. Stage exact owned files only.
- Direct user decisions > `wayfinder/SPEC-FINAL.md` > derived spec/inventory/stage plan. Whitepaper explains product intent. All T00–T20, 71 inventory entries and R1–R30 remain scope; historical cut orders are not authority to remove features.
- Design sources: `D:\UserData\reader\Downloads\marginalia-v1-package\design` and `design-pass-2`, including `DESIGN-PASS-2.md`. Editor stays at reading position; one map preserves density, sections, marks and reading position. Source is never rewritten. Notes are senior to replies. No implicit sending. Reading, local saving and asking are distinct.
- Windows, Linux and macOS are implementation targets. No untested cross-platform or live-runtime acceptance claims. Local kernel, saved samples, zero-model saved-solver recompute and explicit Ask again are distinct execution paths.

## Current execution rules

GitHub is the shared update authority. Workers publish isolated branches and ticket receipts; chief fetches exact commits, verifies with dynamically routed MCP `gpt-5.6-luna` / `max`, then merges accepted work. Pro should receive substantial self-contained assignments spanning requirements, implementation, tests, self-review, correction and publication, rather than one prompt per small fix. One owner per file. Do not give workers integration-branch write authority.

User explicitly added first-party headless **Opus 4.8 Medium** implementation alongside Pro. This supersedes the previous no-new-Opus rule for the assigned scope. Claude API billing/account fallback remains prohibited. User explicitly said “Ignore stale meter, continue using”; preserve that authorization. The current worker uses a task-local wrapper permitting Medium and bypassing only `CLAUDE_METER_STALE`, not authentication or other quota failures. Runtime init confirmed `claude-opus-4-8`; Medium is the explicit launch argument.

Earlier blanket test deferral was superseded by later authorization. Use focused behavioral checks and actual user-entry verification, preserving exact SHA/environment evidence. No fixture-only claim of completed tickets. MCP timeout does not imply worker termination: inspect its report/session before redispatch. Do not recursively delegate inside an already routed verifier.

## Active owners — recover these exact runs

All paths below are relative to the package. Pro model was visibly `6 Pro` at each submission. Shared-project branching now gives the new account the previous history; the old private `/c/` links redirect, but project shared links work. No history upload from the user is needed.

| Owner | Branch and conversation | Exclusive boundary / status |
|---|---|---|
| T06 Pro | `codex/pro-t06-full-recovery`; [conversation](https://chatgpt.com/g/g-p-6aabdbd64d848191bf91223b096ffb3f-marginalia/c/6aabdcaf-f6bc-83ed-bc66-df4d621fe32e) | Running. Full T06 reconciliation, actual-send boundary, lifecycle and evidence-backed composition. Owns jobs/job-runner contracts, jobs/providers, main/diagnostics, T06 portions of server; minimal consent service/evidence adaptation; associated tests/evidence/T06 receipt. No other runtime collector may overlap. |
| T05 Pro | `codex/pro-t05-full-recovery`; [conversation](https://chatgpt.com/g/g-p-6aabdbd64d848191bf91223b096ffb3f-marginalia/c/6aabdd09-e160-83ed-81f7-62035edcdbfe) | Running; branch existence observed at51e2473. Owns margin/helper/persistence/helper-management, webapp main/service worker, T05 tests/receipt/evidence. Sole mount owner for asking/library. Reconcile old 17-file package and helper UI; wire integrated T07 keep-device semantics. |
| T08 Pro | `codex/pro-t08-full-recovery`; [conversation](https://chatgpt.com/g/g-p-6aabdbd64d848191bf91223b096ffb3f-marginalia/c/6aabde38-af2c-83ed-926e-e41976f3afb4) | Running. Owns ui/asking, asking tests, skills/define if needed, T08 evidence/receipt. Recover existing artifact first, finish definition/consent/ask controller and public mount contract. No T05 mount edits. |
| T14/T15 Opus | `codex/opus-t14-t15-evidence-explore`; published `86d658191cb6e8a6c1bd8bac45ec453c80a964e5`; local `D:\Projects\Marginalia-worktrees\t14-t15-evidence-explore` | Worker completed; merge HELD for Evidence authority and Explore public-contract/navigation corrections. Session `a46d658f-b846-49ef-9dbc-fd7c8d579611` is available for a bounded later correction. [Review disposition](evidence/T14-T15-CHIEF-RECONCILIATION.md). |
| T20 Opus | `codex/opus-t20-completion`; transferred source `ddbe72d`, brief `ea4ab42`; local `D:\Projects\Marginalia-worktrees\t20-completion` | Running, first-party Opus4.8Medium, session `af738698-b39f-422c-9112-1ab5a8266650`. Owns solver contract/modules/tests/evidence/receipt only; no T06 provider/main/server or T05 mount edits. Existing WIP is being completed, not replaced. [Brief](https://github.com/yashgurbani/marginalia/blob/codex/opus-t20-completion/marginalia-v2-package/docs/evidence/T20/OPUS-48-CONTINUATION.md). |

T05/T06 attempted an unrelated Agora MCPX workspace request; chief denied it and both resumed. Their authorized route is GitHub. Do not grant unrelated connector access merely to keep a worker moving. Capture their next result before any follow-up. Branch creation or progress text is not delivered implementation.

T14/T15 local report: package `docs/evidence/T14-T15-opus/REPORT.md`; launch state/result under that worktree `.local/opus-worker`; exec40974 completed successfully. T20 uses package `docs/evidence/T20/REPORT.md` and its worktree `.local/opus-worker`; exec38458 was running at launch. Both use existing package dependencies through ignored node_modules junctions without new installs. Do not allow package-manager mutation of the shared target. Read reports before raw logs; never copy credentials or hidden reasoning into GitHub.

Independent T14/T15 Luna review: runtime-confirmed `gpt-5.6-luna/max`, thread `01a0af66-87d7-76c1-b566-36920079d7bc`. Focused13+11 tests/typecheck reported passed, but visible probes found defects. The session disappeared before final report and one continuation returned Session not found. Preserved report folder: `D:\Projects\Marginalia\.local\t14-t15-luna-verification`. Bounded report-recovery run `01a0af83-c2bb-7971-8f90-3891295ffa3b` completed without repeating tests: [final review](evidence/T14-T15-LUNA-FINAL-REVIEW.md), verdict HOLD—CHANGES NEEDED. Chief accepted the concrete authority/navigation defects but rejected unnecessary open-permission machinery and forbidding useful thin-shelf links; read [the reconciled correction](evidence/T14-T15-CHIEF-RECONCILIATION.md).

The user requested leaving the three Pro chats working and checking in about half an hour. One follow-up was scheduled as `check-marginalia-pro-ticket-progress`; inspect the automation/current run before duplicating checks. Use this time for whole-project consolidation and independent review.

## Accepted work and preserved unfinished work

**T07 integrated:** merge `dc0f963`, Pro source `2464ce63862d70f6ec702f759f2bdd88e054839c`. Persistent keep-device choice/absence, conflict history and failure handling; SQLite-consistent preupgrade backups, unknown schema refusal and recovery retention. Known migration set `{1,2,3,4,13,7001}` requires coordination for new schema markers. See [native verification](evidence/pro-t07-fixes/NATIVE-VERIFICATION.md): reader13 + store11 + journal18 passed on identical runtime code; final type-only correction passed full project typecheck. Windows Node24.14.1, better-sqlite3 13.0.3. MCP runtime confirmed Luna/max, thread `01a0af0b-ec6a-7dd2-8df4-7034e9f49bcc`. No repeat broad verification without new changes. Browser conflicts, Mac/Linux and full recovery acceptance remain.

**T05 helper UI preserved:** `codex/t05-helper-management` at `e2fb6c2b61cce004c2c2964f9db146f73fac32fc`, worktree `D:\Projects\Marginalia-t05-helper-management`. Historical scoped8/8 and18/18, builds/typechecks and isolated Chromium147 management flow passed. Not combined-T05 acceptance; T05 now reconciles it. Original verifier model provenance was not independently exposed.

**T08 recovery:** [exact artifact/hash record](evidence/T08-PRO-RECOVERY.md). Existing patch `/mnt/data/T08-asking-checkpoint.patch`, generated root `/mnt/data/marginalia-t08/marginalia-v2-package`,14files1786additions against1517433. Old branch did not advance. New Pro is instructed to recover before reconstructing. Generated hashes are not proof of GitHub publication.

**T20 original preserved, new continuation active:** original `codex/opus-t20-saved-solver` at `c144506f32b67a27f2487426c24b79e4f606af16`, worktree `D:\Projects\Marginalia-worktrees\t20-saved-solver`, remains untouched. New Opus4.8Medium continuation is listed above. Its starting `prepareCommit()/commit()` interface and awaited `gate.finalize()` call site are inconsistent; five host dependencies/mount and real execution acceptance remain. Historical123tests do not prove real solver confinement. The worker must reconcile T06's public handoff contract without editing T06-owned files.

Historical whole-suite baseline at0111589:282total,281pass,0fail,1optional browser skip. It is not a current-head full-suite result. See [integrated evidence](evidence/INTEGRATED-VERIFICATION.md).

## Ticket status and next gates

| Ticket | Current progress and remaining gate |
|---|---|
| T00 | Corrected science fixture exists; final rendered/live acceptance remains. |
| T01 | Helper/pairing/management backend corrections integrated; trusted UI in T05; usable extension registration and full diagnostics acceptance remain. |
| T02 | Adapter fixes integrated; genuine dedicated runtime lifecycle/confinement remains, now coordinated with T06. |
| T03 | Contract/validation groundwork and prior focused checks; real host-owned revalidation, resealing and delivery remain. |
| T04 | Capture/authenticated reads and selected Chromium flows verified historically; Firefox/platform/provider journey remains. |
| T05 | Active full UI reconciliation above; no new accepted commit yet. |
| T06 | Active full backend run above; actual-send and usable truthful runtime are critical path. |
| T07 | Bounded continuation integrated and native-verified; whole-ticket/browser/platform gates remain. |
| T08 | Active artifact recovery and full asking module; T05 mount and T06 runtime needed. |
| T09 | Real unseen-passage simulation/checked interactive output remains; fixtures are not acceptance. |
| T10 | WebMCP integration remains beyond foundation; preserve typed validated insert/unsupported behavior. |
| T11 | Library/settings services and some UI implemented; T05 entry wiring, global export and full real flows remain. |
| T12 | Not launch-ready: installers, fresh-machine demonstrations, failure/cancel/video/listing evidence required. |
| T13 | Policy/consent groundwork integrated; observed runtime evidence and actual-send integration remain. |
| T14 | Published86d6581, merge held after independent review; fix semantic authority/attribution, then brokered journey and mount. |
| T15 | Published86d6581, merge held after independent review; fix public open/provenance/URL contract, then real explicit-open journey. |
| T16 | Basic notes; full frozen attachment/versioned replies/vocabulary/recovery acceptance remains. |
| T17 | Local page identity and explicit-grant enrichment/header work remains. |
| T18 | Renderer/kernel partly verified; real host sample generation/delivery/highlight arbitration remain. |
| T19 | Install/recovery spec and C1–C15 dispositions exist; live diagnostics/export/registration/installers/docs and cross-platform acceptance not all complete. |
| T20 | New Opus4.8Medium completion run on current-base isolated branch; original preserved; no real zero-model recompute acceptance. |

Use [detailed ticket review](PROJECT-STATUS-AND-TICKET-REVIEW.md), [build report](../BUILD-STATUS.md), and each Wayfinder receipt for historical findings; apply this handoff's newer ownership/status. No honest overall completion percentage is claimed.

## Next chief actions

1. Read the current Pro outputs and Opus report without restarting active turns. Resolve each published head and compare its diff to its declared base/ownership. Record any source deviation before integration.
2. Fetch a returned commit into an isolated worktree. Route exact-SHA native verification through `C:\Users\reader\.codex\skills\codex-mcp-router\SKILL.md`, explicitly `gpt-5.6-luna/max`, dynamic complementary accounts, no native fallback or recursive workers. Report requested vs observed model separately.
3. Return substantive failures to the same owner in a consolidated correction prompt; do not spend Pro turns on routine acknowledgments. Merge only verified owned changes, then test changed cross-ticket entry points and update receipts/handoff with exact SHAs and remaining gates.
4. Prioritize T06 → real evidence-backed runtime → T05/T08 reader Ask/reply, then T20 and remaining transforms/install/release. Opus T20 proceeds within solver-only ownership; T14/T15 correction follows its review hold. Do not ship a disabled action or a fixture as a completed feature. Apply the Standards + Spec review and simplicity guardrails in the whole-project stocktake.

The goal is active and unfinished. No running job's progress text or branch claim substitutes for completed, verified and integrated code.
