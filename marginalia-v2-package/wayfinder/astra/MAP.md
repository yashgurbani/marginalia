# Astra execution map

label: wayfinder:map
charted: 2026-09-18 by Fable (Claude Fable 5.1), at `codex/marginalia-v2` caa010c
supersedes: the v1 decision map in `../MAP.md` (closed, "Way is clear") for everything after Stage 1

## Destination

Marginalia v2 ships as the whitepaper describes it: a quiet margin beside whatever the reader is reading, durable on their machine, honest about every byte that leaves it, with the flagship interactive reply, installed by a new reader on Windows, macOS or Linux and verified by Yash's own twenty minutes of reading. Every stage gate 0 to 5a in `docs/QA-HANDOFF-ASTRA.md` §10 has an evidence file, and every decision only Yash can make is recorded here.

## Notes

- **This map carries execution tickets.** Yash's instruction: "Chart the remaining work with precise tickets for Astra, including testing and QA work so that everything happens in parallel and in an optimized way. Do higher level judgement, and decide." Plan-only mode is overridden; E and Q tickets are built, not just decided.
- **Governing decisions (unchanged):** source unchanged; notes senior to replies; no implicit send on select, "?", reopen, reconnect or recover; review exact outgoing content and recipient before inference; four execution paths distinct; fetched evidence is not support; requested sandbox is not confinement; Windows, Linux and macOS; preserve the design system.
- **Founding documents outrank derived artifacts:** `Marginalia — Research Whitepaper.md`, `PRODUCT.md`, `docs/BUILD-PLAN.md` (all untracked at repo root, do not commit them), then `docs/FEATURE-STRATEGY-2026-09-18.md`, `docs/ENGINEERING-STANDARDS-2026-09-18.md`, `docs/STATE-AND-PLAN-2026-09-18.md`, `docs/PRODUCT-QUALITY-PLAN-2026-09-18.md`, `docs/QA-HANDOFF-ASTRA.md`.
- **Routing:** Astra low is the technical lead. Sol medium takes bounded engineering packets, Luna max mechanical batches, Luna xhigh QA checklists. At most two premium runs at once unless Yash says otherwise. Every worker reports actual model, effort, changed paths, checks with totals, and uncertainty; a claim without a test name or evidence path is unverified (H11).
- **Git rules:** work in isolated worktrees under `D:/Projects/Marginalia-worktrees/fable-<name>` with a `node_modules` junction to the main package; commit source and tests only; never `.local/`; never force-push, reset or delete worktrees; root `CONTEXT.md` and `README.md` carry Yash's uncommitted edits and stay uncommitted.
- **Three streams run in parallel:** E (engineering), Q (QA and evidence), H (decisions with Yash). Q tickets start as soon as E01 lands; H tickets need no code and can be resolved in one sitting with Yash. Nothing in E waits on H except E11 (H11) and Q06 (H01).
- **Suggested first wave (day 1):** E01, E02, E03, E09, E14, Q01, Q03, Q07 in parallel; Yash resolves H01, H09, H11, H12 in one sitting. Second wave: E04, E05, E06, E08, E10, E16, E17, E18, Q02, Q04, Q05, Q09; Yash resolves H02, H03, H10, H13, H16. Third wave: E07, E11, E12, E13, E15, E19, E20, Q06, Q08, then H15.
- **The GPT-6 Pro review has landed** (2026-09-18, Downloads file `GitHub-Audit-Design.md`, split into `docs/FIDELITY-LEDGER-2026-09-18.md`, `docs/OWNER-DECISIONS-2026-09-18.md`, `docs/STAGE1-PACKETS-2026-09-18.md`, `docs/STAGE2-3-DESIGNS-2026-09-18.md`, transcript in `docs/PRO-REVIEW-TRANSCRIPT-2026-09-18.md`). It is pinned at `0360a1c`, 39 commits behind head, and ran no code. Treat every row as a claim: E14 triages, E16 to E20 carry its seven Stage 1 packets (M3 waits on H02, M6-M7 is E11), H16 carries its dropped-promise list. Its G1 to G11 recommendations agree with Fable's H01 to H11 except G5 (local files before PDF) and G10 (a small local selection card); both are noted as second opinions, not decisions.
- **Claiming:** set `status: claimed (<who>, <date>)` in the ticket header before work; on completion set `status: closed` and add `## Resolution` with evidence paths; append one line to Decisions so far here.

## Decisions so far

- 2026-09-18: E02 closed: portable instruction digests and canonical OS aliases; three-OS CI 35303008259 green at 7b8f7c0. Published types remain 9.6.0; 13.x does not exist. Evidence: docs/evidence/qa-2026-09-18/e02-ci/.
- 2026-09-18: E09 closed with two accessible rail dot types and named target/hit-box tests; evidence: docs/evidence/qa-2026-09-18/e09-rail/.
- 2026-09-18: E16 closed with honest consent/calculation copy; integrated 797/791/0/6 and clean typechecks. Evidence: docs/evidence/qa-2026-09-18/e16-copy/. E24 owns H12 disclosure.
- 2026-09-18: E14 closed after independent reconciliation of all120 findings (89 confirmed,29 unverified,1 superseded,1 refuted). E30-E38 track gaps; E36 is duplicate implementation, Q02 owns observation. Evidence: docs/evidence/pro-review-triage/.
- 2026-09-18: E22-E29 translate owner decisions and the real-runtime blocker into bounded packets. E29 confirms default runtime unavailable; fixture results cannot close real-provider gates. User now requests one task per remaining ticket, with MCP bounded workers and native integration reviewers; queued tasks are not counted as running.

- 2026-09-18: E01 integrated installer recovery `5083e15`; all four original packet outcomes accounted for. Windows integration: 791 tests / 785 pass / 0 fail / 6 skipped on the authorized retry; known concurrent-click failure retained for Q09. Both typechecks clean. Evidence: `docs/evidence/qa-2026-09-18/e01-installer/`. Real service installation still belongs to Q05/Q08.
- 2026-09-18: E21 closed with reproducible transcript/extraction verification and the byte-preserved historical `integrate_pro_review.py`; evidence in `docs/evidence/pro-review-triage/`. E14's 120 code findings remain independent claims until triaged.
- 2026-09-18: Yash resolved H04 (underline Keep/tint Highlight), H05 (interim PDF prioritized after installation), and delegated H06 judgment: retain current journal/consent/solver functionality and require dependency-specific review before removal. No blanket deletion authorized.
- 2026-09-18: Yash expanded concurrency to about 10–15 agents. Eleven independent MCP packets dispatched through the official complementary router; request/result and process ledger at `.local/router/`. Conflicting source changes are integrated sequentially. QA remains bound to its inspected commit.

- 2026-09-18: Yash resolved H02 (explicit remember action only), H03 (See it / What supports this, overriding Fable's labels), H13 (ask before changing a draft's anchor, Keep/Switch). Implementation remains open. Latest routing: Sol medium/high by difficulty, Luna max for QA/computer use/bulk, Astra low for hard technical judgment, complementary MCP routing when available.

- 2026-09-18: Yash resolved H01 (correct copy now, defer web path), H09 (keep FTS with erasure), H11 (unsupported receipts stay unverified), and H12 (one simulate decision with local execution shown before sending). Implementation and QA obligations remain open.
- 2026-09-18: Astra independently reproduced `bdfe8d7` baseline: 785 tests, 780 pass, 0 fail, 5 skipped; both typechecks clean. Raw logs: `../../.local/astra-baseline/`. The unfinished M13 installer is being completed by Sol high; the original worktree is preserved. Technical packets use Sol high per Yash's current instruction, superseding dated medium routing.
- 2026-09-18: E21 tracks the supplied `integrate_pro_review.py` and exact transcript extraction provenance; E14 still owns substantive review triage. Initial D: worktree creation failed for lack of space; the two first packets use isolated C: worktrees. Yash subsequently freed D: space. No existing worktree was removed.

- Head `dc94636` pushed to origin on 2026-09-18 with this map, the handoff, the lead prompt and the next build plan; the GPT-6 Pro review landed the same day and is filed under `docs/` with tickets E14, E16 to E20 and H16.
- Stage 1 position, egress record and retention, per-note removal, one-branch-open, migration message, alarm reconnect and workspace-key cleanup are merged on `codex/marginalia-v2` (d420221..fdb12dc, including P4 indexes, P9/P1/P7 hardening and CI, M14/M18 sheet and library) with suite 785/780/0/5 and both typechecks clean; see `../../docs/ASTRA-HANDOFF-2026-09-18.md` for the list and the installer run still in flight at handoff.
- 2026-09-18: E04 closed at `81eff23`/`1c231a2`: one scoped production digest literal remains, named checks and integrated suite 797/791/0/6 pass, and the reviewed non-string rejection is accepted boundary hardening preserving typed-input behavior; it is not claimed as zero runtime-input change. Evidence: `docs/evidence/qa-2026-09-18/e04-digest/`.
- 2026-09-18: E24 closed at `848c5d9`/`f88f651`: the digest-bound Simulate review discloses “can run the model locally” before consent, retains exact outgoing text and explicit approval, and passes its named regressions plus 800/794/0/6 integration checks. Evidence: `docs/evidence/qa-2026-09-18/e24-capability/`.
- 2026-09-18: E05 closed at `29a4730`/`5892e65`: route extraction preserves the served surface, 94/94 focused route checks pass before and after, `server.ts` is 130 lines, independent review accepted, and CI 35307863347 is green on three OSes. Evidence: `docs/evidence/qa-2026-09-18/e05-routes/`.

- 2026-09-18: E32 closed on `d472442` / `89a6335`: eight retained-copy classes disclose location/remove/export behavior, logical FTS erasure and retained versions are tested, and secure physical erasure is disclaimed. Independent review 47/47; combined main suite 815/809/0/6. Evidence: `docs/evidence/qa-2026-09-18/e32-e37-settings/`.
- 2026-09-18: E37 closed on `d472442` / `89a6335`: typed provider capability is separate from model selection, unsupported providers cannot dispatch, and credentials remain outside the browser. Independent review 42/42; combined main suite 815/809/0/6. Evidence: `docs/evidence/qa-2026-09-18/e32-e37-settings/`. Live-runtime acceptance remains open.
- 2026-09-18: E34 remains claimed after `2c9a27b` / `b1ce21f`: inert unavailable footer behavior passes 28/28 review and main suite 802/796/0/6, but the literal E31 attributed-match acceptance bullet is unfulfilled. Need E31 integration/verification or explicit chief deferral of that bullet; review ACCEPT covers the implemented footer. Evidence: `docs/evidence/qa-2026-09-18/e34-availability/` and `e32-e37-settings/independent-review.md`.

## Tickets

### Stream E: engineering
- [E21 Pro review integration provenance](tickets/E21-pro-review-integration-provenance.md) · AFK · Luna max · closed
- [E01 Integrate the Sol runs in flight](tickets/E01-integrate-the-four-sol-runs-in-flight.md) · AFK · blocked by (none) · Astra low
- [E02 P7 remainder: type parity and CI green on three OSes](tickets/E02-p7-remainder-type-parity-and-ci-green-on-three-oses.md) · AFK · blocked by E01 · Sol medium
- [E03 P1(a): extension icons at 16, 32, 48 and 128](tickets/E03-p1a-extension-icons-at-16-32-48-and-128.md) · AFK · blocked by (none) · Astra low (visual), Opus 4.8 taste check optional
- [E04 P8: one digest literal exported from contracts](tickets/E04-p8-one-digest-literal-exported-from-contracts.md) · AFK · blocked by E01 · Luna max
- [E05 Route table extraction from daemon/server.ts](tickets/E05-route-table-extraction-from-daemonserver.ts.md) · AFK · blocked by E01, E04 · Sol medium
- [E06 Decompose ui/margin.ts](tickets/E06-decompose-uimargin.ts.md) · AFK · blocked by E01, E04 · Sol medium
- [E07 Solver-interpreter pinning and the jobs pipeline map](tickets/E07-solver-interpreter-pinning-and-the-jobs-pipeline-map.md) · AFK · blocked by E01 · Sol medium
- [E08 T13-P5 confinement evidence collector](tickets/E08-t13-p5-confinement-evidence-collector.md) · AFK · blocked by E01 · Sol medium
- [E09 W2.3: two rail dots and the CSS specificity and hit-target fix](tickets/E09-w2.3-two-rail-dots-and-the-css-specificity-and-hit-target-fi.md) · AFK · blocked by E01 · Sol medium
- [E10 W2.9: diagnostics surfaced in reader language](tickets/E10-w2.9-diagnostics-surfaced-in-reader-language.md) · AFK · blocked by E01, E05 · Sol medium
- [E11 M6: the 'You were here' resume line](tickets/E11-m6-the-you-were-here-resume-line.md) · AFK · blocked by E01, H11 · Sol medium
- [E12 M15: whole-library export as Markdown and W3C Web Annotation](tickets/E12-m15-whole-library-export-as-markdown-and-w3c-web-annotation.md) · AFK · blocked by E01 · Sol medium
- [E13 Stage 3 non-gated renderer items](tickets/E13-stage-3-non-gated-renderer-items.md) · AFK · blocked by E01 · Sol medium
- [E14 Triage the GPT-6 Pro fidelity ledger against the current head](tickets/E14-integrate-the-gpt-6-pro-long-horizon-review-when-it-lands.md) · AFK · blocked by E01 · Astra low triages, Sol medium verifies
- [E15 Docs refresh to the final heads and totals](tickets/E15-docs-refresh-to-the-final-heads-and-totals.md) · AFK · blocked by E01 · Luna max (retry Sol medium if Luna reports capacity)
- [E16 S1-COPY: remove false availability and isolation claims](tickets/E16-s1-copy-remove-false-availability-and-isolation-claims.md) · AFK · blocked by E01, H01 · Sol medium
- [E17 M4: a record behind the sending status](tickets/E17-m4-a-record-behind-sending-status.md) · AFK · blocked by E01 · Sol medium
- [E18 S1-REPLY-REMOVE: discard a reply without discarding the note](tickets/E18-s1-reply-remove-discard-a-reply-without-discarding-the-note.md) · AFK · blocked by E01 · Sol medium
- [E19 REATTACH: persist attachment observations without replaying questions](tickets/E19-reattach-persist-attachment-observations-without-replaying.md) · AFK · blocked by E01, E07 · Sol medium
- [E20 SUGGESTIONS: three stable offers with an exposure record](tickets/E20-suggestions-three-stable-offers-with-an-exposure-record.md) · AFK · blocked by E01, H03 · Sol medium

### Stream Q: QA and evidence
- [Q01 Gate 0 contract evidence](tickets/Q01-gate-0-contract-evidence.md) · AFK · blocked by E01 · Luna xhigh
- [Q02 Gate 1 durable reader evidence](tickets/Q02-gate-1-durable-reader-evidence.md) · HITL · blocked by E01 · Luna xhigh drives, Yash confirms the feel
- [Q03 Gate 2 real definition evidence](tickets/Q03-gate-2-real-definition-evidence.md) · AFK · blocked by E01 · Luna xhigh
- [Q04 Gate 3 interactive reply evidence](tickets/Q04-gate-3-interactive-reply-evidence.md) · AFK · blocked by E01 · Luna xhigh
- [Q05 Gate 4 install and release evidence](tickets/Q05-gate-4-install-and-release-evidence.md) · HITL · blocked by E01, E02, E03 · Luna xhigh drives, Yash performs the fresh install
- [Q06 Gate 5a evidenced expansion evidence](tickets/Q06-gate-5a-evidenced-expansion-evidence.md) · AFK · blocked by E08, H01 · Luna xhigh
- [Q07 Real-browser extension QA](tickets/Q07-real-browser-extension-qa.md) · AFK · blocked by E01 · Astra low (exploratory), Luna xhigh (checklist)
- [Q08 Per-OS command matrix](tickets/Q08-per-os-command-matrix.md) · AFK · blocked by E02 · CI, then Luna xhigh reads the runs
- [Q09 Make the three known flakes deterministic](tickets/Q09-make-the-three-known-flakes-deterministic.md) · AFK · blocked by E01 · Sol medium

### Stream H: decisions only Yash can make
- [H01 G1 / M5: the network promise](tickets/H01-g1-m5-the-network-promise.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H02 G2 / M3: does help accumulate as a vocabulary](tickets/H02-g2-m3-does-help-accumulate-as-a-vocabulary.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H03 G3: reader-language labels for simulate, evidence and the time word](tickets/H03-g3-reader-language-labels-for-simulate-evidence-and-the-time.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H04 G4 / M8: Keep versus Highlight on the page](tickets/H04-g4-m8-keep-versus-highlight-on-the-page.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H05 G5 / M12: reader-supplied documents](tickets/H05-g5-m12-reader-supplied-documents.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H06 G6: journal, sync, solver and consent code: keep, park or delete](tickets/H06-g6-journal-sync-solver-and-consent-code-keep-park-or-delete.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H07 G7: grid versus samples](tickets/H07-g7-grid-versus-samples.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H08 G8 / M16: automatic definitions under a site grant](tickets/H08-g8-m16-automatic-definitions-under-a-site-grant.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H09 G9: the FTS second copy of page text](tickets/H09-g9-the-fts-second-copy-of-page-text.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H10 G10: selection dead ends and the copy table](tickets/H10-g10-selection-dead-ends-and-the-copy-table.md) · HITL · blocked by H03 · Fable with Yash; Astra executes the outcome
- [H11 G11: receipts versus source](tickets/H11-g11-receipts-versus-source.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H12 G12: does the simulate intent grant solver capability](tickets/H12-g12-does-the-simulate-intent-grant-solver-capability.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H13 G13: a replacement selection does not re-anchor](tickets/H13-g13-a-replacement-selection-does-not-re-anchor.md) · HITL · blocked by (none) · Fable with Yash; Astra executes the outcome
- [H14 M10: multiple anchors per thread](tickets/H14-m10-multiple-anchors-per-thread.md) · HITL · blocked by H06 · Fable with Yash; Astra executes the outcome
- [H15 Release verdict: Yash's experiential gate](tickets/H15-release-verdict-yashs-experiential-gate.md) · HITL · blocked by Q02, Q03, Q04, Q05, Q07 · Fable with Yash; Astra executes the outcome
- [H16 Nineteen whitepaper promises the spec dropped silently](tickets/H16-nineteen-whitepaper-promises-the-spec-dropped-silently.md) · HITL · blocked by E14 · Fable with Yash; Astra executes the outcome

## Not yet specified

- The open-session web path itself (if H01 chooses to build it): its consent copy, its evidence record shape and its Gate 5a proof are one design once E08 exists.
- Chrome Web Store listing copy and screenshots: sharp only after E03 and Q05.
- Hosted home, PDF viewer, local models, library search (BUILD-PLAN stage 5b roadmap): each needs its own fidelity, permission, persistence and failure contract before it can be ticketed.
- Whatever E14's head-by-head triage of the 120 ledger rows surfaces beyond E16 to E20 and H16.

## Out of scope

- Any change to the source page's text or layout (governing decision).
- Automatic sends of any kind, including on site grant (H08 recommendation; if Yash decides otherwise it re-enters as a fresh effort).
- Deleting the solver, consent or journal code before H06 is resolved.
- Market or competitor framing in product identity; personal utility is the moat.

- 2026-09-18: Consolidation checkpoint for Fable: reviewed E35/E12/E07 merged and pushed at babd2c2; main 840 tests / 834 pass / 0 fail / 6 skip, both typechecks and preparation clean, three-OS CI 35311736674 green. All 143 worktrees preserved and all 64 ticket headers accounted for. Remaining reviews, corrections, unions and closure bookkeeping pass to Fable under Yash's wrap-up instruction; this entry closes no additional ticket or release gate. See ../../docs/CONSOLIDATION-HANDOFF-2026-09-18.md.
