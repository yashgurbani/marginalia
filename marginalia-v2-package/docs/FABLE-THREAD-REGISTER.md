# Thread and worker register for Fable

18 September 2026. This register distinguishes delivery history from current liveness. The desktop task list and native agent registry were checked during handoff: only this chief was active in the native agent tree. Desktop `notLoaded` means not loaded, not proof of terminal execution. Old MCP/headless reports must be recovered before any retry; an observation timeout is not a failed job.

## Chief and early source conversations

| Task / source | Recovery reference | Disposition |
|---|---|---|
| Coordinate Marginalia v2 build | `codex://threads/01a0adaf-dd71-7583-8307-b877547c9189` | This chief; handing steering to Fable. No new builders launched during takeover. |
| Review Marginalia Astra pivot | `codex://threads/01a0ad72-bb74-7012-b863-a388430f24f6` | Earlier source/architecture critique; desktop notLoaded. |
| Evaluate Marginalia prototype vision | `codex://threads/01a0747c-0220-7983-a82a-2d2e6f15137d` | Earlier prototype and vision context; desktop notLoaded. |
| Inspect product idea and competition | `codex://threads/01a0abe4-c374-7d41-95f9-4176fac3c5e4` | Earlier product/competition context; desktop notLoaded. |
| T19 Fable documentation task | `01a0aed1-9ba4-7e90-a37c-5d68a344021f` | Desktop notLoaded; delivered three documentation files; long original task title preserved by desktop. Code findings transferred to T01/T05/T07/T11/T19. |
| # T20 — saved solver execution, Opus 5 implementation | `codex://threads/01a0aed1-9bef-7290-b00d-01ef93ab7c77` | Desktop notLoaded; original solver worktree preserved, later implementations integrated. |

Older ticket-owner IDs found in receipts include T04 `01a0add2-39b2-7591-b86b-9635b85c5d1c`, T05 `01a0adc8-a066-7d11-8248-9cb5a63cd737`, T06 `01a0ae02-dc03-7ec2-ae86-26b6be5bf319`, T07 `01a0adcb-25bd-7451-831f-40197dade46a`, T13 `01a0ae07-41af-7b83-ae7f-d73ecb608090`, T18 `01a0addb-ef93-77e0-8a57-45873cead42e`, and T03 samples `01a0ae01-0695-7b61-bd4d-0bacdbce172f`. Their absence from the current desktop listing does not delete their work: use receipts, Git history and FABLE-HISTORICAL-THREAD-INDEX.txt. Do not create duplicate implementations because an old task is not visible.

## Pro chats

All were in the shared Marginalia project; access can depend on the signed-in account. Use existing shared project links in historical evidence if a plain conversation URL is inaccessible. Never switch accounts silently.

| Scope | Conversation | Outcome / next action |
|---|---|---|
| Project review / T01 / T07 | https://chatgpt.com/c/6aab6e88-3804-83ed-9f27-3f02572b2d98 | Historical findings incorporated; source review not blanket acceptance. |
| T05 final recovery | https://chatgpt.com/c/6aabdd09-e160-83ed-81f7-62035edcdbfe | Final output/ZIP recovered, reconciled and integrated at96eef734. No pending worker to wait for. |
| T06 final recovery | https://chatgpt.com/c/6aabdcaf-f6bc-83ed-bc66-df4d621fe32e | Final output/ZIP recovered; source merged at6fb78e0 under review waiver. Old remote M1 branch is not the final source. |
| T08 asking implementation | https://chatgpt.com/c/6aabde38-af2c-83ed-926e-e41976f3afb4 | Final source plus two UI fixes integrated at8a08853. |
| New independent T06 review | https://chatgpt.com/g/g-p-6aabdbd64d848191bf91223b096ffb3f-marginalia/c/6aac70c6-e44c-83eb-bdae-9645c45f5b8a | User said ignore. Stop clicked. No verdict or delivered correction. Last progress reported FIFO/shutdown defect. Branch only points to2e77f3a at inspection. Preserve finding; no automatic restart. |
| Whole-project post-consolidation review | `docs/PRO-CONSOLIDATED-REVIEW-PROMPT.md` | Prepared, **not submitted**. No live chat exists. Fable decides when to use it on a fresh exact base after urgent repair. |
| T02 protocol | https://chatgpt.com/c/6aab7cff-9ba4-83eb-9ad5-8e3a536800f8 | Historical protocol review and corrections; T06 later supersedes runtime seams. |
| T18 renderer | https://chatgpt.com/c/6aab7cd5-31fc-83ed-9125-c1c2057277e2 | Historical renderer review; see T18 evidence. |
| T11 library | https://chatgpt.com/c/6aab8b40-15d0-83eb-9cc4-36ac77efa475 | Historical review/corrections; library regression integrated. |
| T03 samples | https://chatgpt.com/c/6aab860a-43c8-83ed-92f3-c4333316fc73 | Sample contract review; trusted generation remains separate. |
| Initial design | https://chatgpt.com/c/6aab2c60-ca84-83ed-9595-8af72a2d6ba1 | Source/design intent; user reading-position/map decisions govern. |

Other historical Pro chats and their source paths are indexed in FABLE-HISTORICAL-THREAD-INDEX.txt; original reports remain in docs/evidence. The three original implementation chats are delivered, not active parallel owners.

## Opus and dynamic MCP runs

| Run / branch | Identity and durable evidence | Disposition |
|---|---|---|
| T14/T15 Opus 4.8 Medium | Session `a46d658f-b846-49ef-9dbc-fd7c8d579611`; `codex/opus-t14-t15-evidence-explore`; docs/evidence/T14-T15-opus | Delivered86d6581; initial hold resolved by Sol corrections. Original worktree preserved. |
| T20 original Opus 5 | `codex/opus-t20-saved-solver`, c144506; t20-saved-solver worktree | Original revisions retained; later continuation supersedes them. Do not remerge old module over corrected one. |
| T20 Opus 4.8 Medium | Session `af738698-b39f-422c-9112-1ab5a8266650`; `codex/opus-t20-completion`, c4a6744 | Delivery integrated through later host-adapter branch. Crash/interruption history is resolved in the delivered revision, not a still-pending follow-up. |
| T20 Opus 5 host adapters | `codex/opus5-t20-host-adapters`, finald2a67b5 | Includes sourcefda8dba, review3bdbe7c, Sola8a3a34 and independent closured2a67b5. Ancestor of integration. Runtime mounting remains open. |
| Four Luna Max regression workers | wave-luna-capture380c51c; librarye5a1864; persistence55e89c2; renderer37bd4c4 | All patch-equivalent deliveries integrated; evidence under docs/evidence/parallel-wave. Capture fixture subsequently corrected. |
| Two Sol Medium correction workers | wave-sol-evidence053a203 → integration4616150; wave-sol-explorebead552 +184c12a | Corrected production/skill/test source verified present. No outstanding delivery from these two. |
| T14/T15 Luna initial review | `01a0af66-87d7-76c1-b566-36920079d7bc` | Session later unavailable; findings recovered, not silently rerun. |
| T14/T15 Luna report recovery | `01a0af83-c2bb-7971-8f90-3891295ffa3b` | Completed report only; original HOLD led to corrections. See T14-T15-LUNA-FINAL-REVIEW.md and chief reconciliation. |
| T07 native Luna verification | `01a0af0b-ec6a-7dd2-8df4-7034e9f49bcc` | Completed42checks; integrated. |
| T05 final Sol correction | `01a0b16e-11ba-7001-a82c-94e8f99f8d1c` | Completed source41207c4; outer timeout was not failure. |
| T05 final Luna review | `01a0b176-8a2a-78c3-ab0d-a82997260340` | Completed independent closure51655d8 after earlier052f271 findings. |
| T06 native verification | `01a0b16d-5eb8-78f0-8d11-bb189eebc066`; reporte838488 | Report recovered and now merged. Verification report, not independent acceptance. |
| T06 independent Luna review | `01a0b170-eada-7072-a823-eefcae6ab901` | Terminal usage-limit error; no verdict. Do not keep polling or label complete. |
| T06 replacement Sol review | `01a0b192-07ef-7a71-b87c-f794eb1fb68e` | Terminal usage-limit error; no verdict. Review subsequently waived. |

Local `.local/opus-worker` and `.local/` recovery material remains in the inventoried worktrees. Native MCP public session records are under the configured MCP home; the router skill describes discovery. Never publish authentication data or hidden reasoning. Live processes were not killed as part of this handoff; no launch should be repeated solely because a report lacks a current status timestamp.

Native subagent names previously mentioned (interaction_review, library_integration_review, renderer_integration_review, reply_contract, router_auth_diagnosis, scope_inventory) were not active in the registry at takeover. Their outputs were folded into chief history; use the chief task and historical reports for recovery.
