# Next build plan, advisor view, 2026-09-18

Fable's read of where Marginalia v2 stands and what to build next, written for Yash and Astra. Inputs: the whitepaper, `PRODUCT.md`, `docs/BUILD-PLAN.md`, the four dated docs from this week (`FEATURE-STRATEGY`, `ENGINEERING-STANDARDS`, `STATE-AND-PLAN`, `PRODUCT-QUALITY-PLAN`), `QA-HANDOFF-ASTRA.md`, and the reports from every worker run this session. Facts are marked verified where a test or file backs them. Everything else is judgment and says so.

## 1. Where the product is against the vision

The whitepaper promises a margin that is quiet until asked, that keeps the reader's place and words on their own machine, that answers with something the reader can push on, and that never lets a byte leave without the reader seeing it first.

| Promise | State | Evidence |
| --- | --- | --- |
| Quiet until asked | Built | No implicit send paths; `tests/journey-e2e` and consent tests |
| Keeps the reader's place | Built this session | Precise position (`4517a21`), one thread open remembered per page (`5d6f9b7`) |
| Keeps the reader's words | Built | Reader store with migrations, note remove and Undo (`026b945`), migration failure with backup path |
| Knows what left the machine | Built this session | `JobAttempt.sentContent` retained atomically with handoff (`9337135`) |
| Interactive reply the reader pushes on | Built for the flagship demo | Solver, renderer, saved bindings; interpreter pinning open (E07) |
| Installs on a fresh machine | In flight | M13 installer scripts and fresh-machine test (worktree at handoff) |
| Comes back after the browser evicts the worker | Built this session, unverified in a browser | Alarm reconnect (`a0c3f4f`); Q07 verifies |
| Honest about the network | Not yet | Consent copy promises an open-session path that does not exist (H01) |
| Whole library the reader owns | Partial | Single-thread export exists; whole-library export open (E12) |
| Reader's own documents and PDFs | Not built | H05 |
| Help accumulates as vocabulary | Not built | H02 |

Judgment: the durable-reader core is real and tested. The remaining distance to the vision is not more engine; it is honesty (H01), install (M13, E02, E03), evidence (Q tickets), and three reader-facing features the whitepaper names (vocabulary, own documents, whole-library export) that all wait on identity decisions only Yash can make.

## 2. Strategy: what to build next and why

**First: make every existing claim true.** Two items cost almost nothing and remove the largest honesty gaps. H01 corrects the network promise in consent copy (ten lines). H11 sets the rule that a receipt without a test or evidence path is unverified. Do these before any new feature; a quiet product that overstates itself is not quiet.

**Second: install.** M13 scripts, E02 type parity and CI on three OSes, E03 icons. Until a new reader can run one script and pair, nothing else can be judged by anyone but the builder. Gate 4 (Q05) is the first gate that involves a real second person.

**Third: evidence over engine.** Q01 to Q07 turn the stage gates from a table into files. Expect Q07 (real-browser extension checklist) to be the most productive ticket of the plan: it is the first time anyone loads the extension after this week's CSP, WAR, alarm and sheet changes. Budget for two or three new E tickets from it.

**Fourth: the three gated features, in the order they unlock.** Whole-library export (E12) has no gate and matches whitepaper line 159; ship it. Vocabulary (H02) is the whitepaper's "help accumulates" claim and is the smallest of the three once Yash chooses explicit keep. Own documents (H05) is the largest silent scope cut; build the interim PDF path only after install is proven.

**Do not build:** automatic definitions under a site grant (H08), multi-anchor threads before the FTS and export decisions land (H14), or any deletion of the parked journal, solver and consent code before H06.

## 3. Product experience: the five things a reader will feel

1. **Coming back.** Position restores to the first fully visible line. E11 adds the one-line "You were here" so the return is announced, not silent. Keep it one line, one click, gone after use.
2. **Removing a note.** Remove, toast, Undo. The pattern is right; apply the same pattern to thread removal if Q02 shows readers expect symmetry.
3. **The narrow sheet.** Root cause of the open-then-collapse bug is fixed (rail click no longer closes the sheet it just opened). Focus returns to the opener. Q07 must confirm the shadow, the transition and reduced motion in a real browser; jsdom cannot.
4. **Knowing what was sent.** The "What was sent" sheet can now show the exact parts because they are retained. E08 adds the confinement record so the closed-session claim is shown, not asserted.
5. **Dead ends.** G10's copy table (H10) fixes the selection states that end nowhere. Every selection must lead to Keep, Note or Ask, or to one sentence saying why not.

Design-system rule for every ticket: the register is `.m-meta`, the vocabulary is Keep, Note, Ask, Library. No "annotation", no "AI", no gradients, no mascots. E03 icons follow the wordmark's plainness.

## 4. Engineering standards: what held and what is owed

Held this session (verified): every merged change carried tests; the suite reached 785 tests with zero failures at each of the eight merges; contracts changed before stores and stores before UI; migrations are by membership so two owners can share the database; the extension manifest is now minimal (WAR is `panel.html` only) and CSP is explicit on both surfaces.

Owed, in priority order:
- **CI has never run.** P7's workflow was committed but not exercised. E02 pushes and reads it. Until then "three OSes" is a claim.
- **Type parity.** `@types/better-sqlite3` 9.6.0 against runtime 13.0.3. E02.
- **Three files carry most of the risk.** `ui/margin.ts` (1,183 lines), `daemon/server.ts` (419, one handler), `daemon/jobs/service.ts` (674, six entry points). E05 and E06 are pure refactors gated on E04 so the digest literal moves once. E07 documents the pipeline before anyone refactors it.
- **Flakes.** Three known. Q09 makes them deterministic; until then every red run costs a rerun and a judgment call.
- **Reports.** The H11 rule applies to workers and to reviews alike. Fable applied it this session: every accepted report named model, effort, paths, totals and uncertainty. Keep it.

## 5. What the dynamic workflows taught

Eight worker runs merged this session across four Codex accounts, one is in flight, and one Luna max attempt failed twice; every merged run was Sol at medium effort. Observations, for planning the next runs:

- **Bounded packets with allowed and forbidden file lists produced clean merges.** Eight merges, zero conflicts needing hand resolution, including two runs that both touched `ui/margin.ts`. The packet format (why, task, allowed files, checks with baseline totals, report path, line limit) is worth keeping verbatim.
- **Sol medium was sufficient for every engineering packet here.** No packet needed escalation. Reserve Astra medium and above for coupled ambiguity, not for size.
- **Luna max failed on capacity, not on ability.** Two "at capacity" responses on the lrh account. Plan Luna work with a Sol fallback stated in the packet.
- **The GPT-6 Pro long-horizon review stalls on multi-phase prompts.** It paused after Phase 1 twice waiting for a "continue". The single-message variant (§9 of `PRO-LONG-HORIZON-2026-09-18.md`) is the fix; treat its output as findings to verify, not as decisions.
- **Account cycling worked when each account carried one run at a time.** Five-hour windows on Plus accounts cycled without a stall once gs was reserved for Yash. Grep for "usage limit" or "401" in worker logs matches repository text; read the header lines and the tail instead.
- **Worktrees plus a `node_modules` junction cost seconds and saved every parallel run.** Keep it. Never delete worktrees; they hold the reports.
- **What did not work:** waiting on a long review, and Bash heredocs with backticks for packet files (use a file-writing tool). Both are cheap to avoid.

## 6. The plan in one table

| Wave | Engineering | QA | Yash |
| --- | --- | --- | --- |
| 1 | E01, E02, E03, E09 | Q01, Q03, Q07 | H01, H09, H11, H12 |
| 2 | E04, E05, E06, E08, E10 | Q02, Q04, Q05, Q09 | H02, H03, H10, H13 |
| 3 | E07, E11, E12, E13, E15 | Q06, Q08 | H04, H05, H06, H07, H08, H14 |
| Release | E14 as the Pro review lands | | H15 twenty-minute verdict |

Two premium runs at once. Every merge green before push. Every ticket closed with evidence paths. Yash's four yes answers on H15 release the build; each no becomes a ticket in his words.
