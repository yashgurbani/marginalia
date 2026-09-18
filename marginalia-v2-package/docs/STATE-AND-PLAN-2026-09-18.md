# Marginalia state and plan, 2026-09-18 (Fable)

This is the integration view over the four Opus 5 workflow syntheses saved beside it (`PRODUCT-QUALITY-PLAN`, `FEATURE-STRATEGY`, `ENGINEERING-STANDARDS`, `QA-HANDOFF-ASTRA`), the refuter verdicts on the next packets, and the merges made on `codex/marginalia-v2` today. Where a synthesis is already stale because of a merge, this file says so. Facts marked (checked) were read from the tree at head; the rest rests on the syntheses.

## 1. Where the branch stands

Head: `f8df90b` on `codex/marginalia-v2`, local only, not pushed. Suite at head: 717 tests, 714 pass, 3 skipped (checked). One journey e2e case fails intermittently (2 of 4 runs); it is a QA item, not chased here.

Merged today, in order:

| Merge | What it gives the reader |
|---|---|
| journey (ddc5ac7) | Corrected transport report; the 16-char origin alarm was a malformed fixture |
| W1-A (b98f6f5) | Simulate skill and IO contract, per-intent host instructions |
| T20 mount (dcc8aa9) | Solver routes mounted, bindings pinned at reply acceptance, pairing sessions |
| W1-B (2510a91) | `capabilitiesForIntent`, second-passage fixture, slider-sends-nothing test |
| T20-P4 (ccd1a5c) | Reader can recompute a saved solver from an explicit click; a pairing serves any thread |
| journey e2e (3ddff9d) | Seven wire-level tests through a real daemon child process |
| docs (f8df90b) | The four syntheses |

## 2. What the four syntheses agree on

1. Several thousand tested lines are unreachable from the reader because of a handful of wiring literals. `daemon/main.ts:76` still grants `capabilities: []` (checked). `ui/margin.ts:687` and `ui/asking-host.ts:227` still hard-code capability lists (checked). `capabilitiesForIntent` has no production caller yet (checked; quality wave B is fixing this now).
2. Simulate, the whitepaper's flagship minute, has no door. No reader control sets `intent: 'simulate'` (checked: `ui/margin.ts:223,379` offer only unsure and explore).
3. Copy contradicts policy in one place that matters: the consent sheet promises separate web access while `daemon/codex-policy.ts` forbids network on both branches. This is a truthfulness defect and only Yash can pick which promise to keep.
4. The reader-facing surface (`ui/margin.ts`, ~1000 lines in one closure) is the least tested part and the one that decides whether the tool feels finished.
5. Chrome Web Store submission is blocked on mechanical items: no icons, incomplete extension CSP, broad web-accessible resources, no privacy policy, no CI.

## 3. Corrections to the syntheses after today's merges

- Strategy W0.4 (pass `onRecompute` and the `solver` capability from the margin) is done in T20-P4. Strategy still lists path 3 as dead.
- Strategy W0.2 (adopt `capabilitiesForIntent` at the two mounts) is in flight in quality wave B.
- The QA guide header says head `dcc8aa9` and 689 tests; both are older than this file. Astra: use the head and totals in section 1.
- T20-P4 shipped with the word "sandbox" in reader copy at `ui/solver-recompute.ts:118` (checked). The refuter flagged this; wave B's addendum removes it.
- The T20 `bindThread` permanent binding that the refuter would have caught was already fixed in T20-P4 (rebinding allowed).

## 4. Workers running now

| Worker | Model, account | Scope | Report path |
|---|---|---|---|
| quality wave B | Sol medium, "gs" via `codex exec` | capability source adoption, consent sheet trap, Escape in flight, note-editor announce, banned-word copy | `fable-quality-b/.local/fable-quality-b/report.md` |
| T20-P3 gate | Sol medium, "jill" via `codex exec` | JobStore-backed execution gate with durable claim, lease, honest confinement denial; resolves the refuter's contradictions | `fable-t20-p3/.local/fable-t20-p3/report.md` |
| quality wave A | Luna max, "jill" via `codex exec` | dark-mode fallbacks, frame geometry, focus ring clipping, build hygiene | `fable-quality-visual/.local/fable-quality-visual/report.md` |

The pinned Codex MCP account ("tw") is capped until 06:54. Workers run through the CLI with per-account homes until then.

## 5. Queue, in order

Two Sol slots at a time. Luna runs beside them.

1. **Stage 0 wiring (Sol).** `daemon/main.ts:76` grants `capabilitiesForIntent(intent)`; add "Move it" (simulate) and "Check this" (evidence) suggestions in the margin with provisional reader-language labels; pass `onFollowup` on saved replies. Labels are provisional pending Yash (gate G3 below). One end-to-end test walking select, simulate, grid, slider, recompute.
2. **T13-P5 confinement evidence (Sol).** Design and verdict are in the packets folder. The verdict is blocking as written: the collector must name `maxOutputBytes` and `executionAttemptId` for `transport.exec`, and the attempt id is not inert. The packet needs those two values fixed before dispatch.
3. **Standards mechanical batch (Luna).** P1 manifest icons and CSP, P3 error-string mismatch, P6 workspace file mode, P7 build hygiene and CI, P9 static CSP. All verified-by-synthesizer, none behaviour-changing except the WAR narrowing, which is verified before merge.
4. **Standards behaviour batch (Sol).** P2 `prepareRetry` omits the question so retry-after-failure likely never matches its digest; P5 shutdown signals and data-dir mode; P10 and P11 alarm-driven reconnect and session-key cleanup. Each is review-gated because it changes bytes sent or the exit path.
5. **Docs corrections (Luna).** After the verdict's fatal contradiction is resolved: acceptance test 5 must allow the literal that section E12 keeps.
6. **Stage 1 (Sol), after gates.** Egress record behind the sending dot, vocabulary write path, "You were here" and persisted position, `/api/reattach` client, suggestion set of three with a time word.
7. **Stage 2.** Installer and fresh-machine test, rail sheet under 900px, two rail dots, per-note removal with undo, one branch open, daemon startup errors, extension library route, diagnostics surfaced.

## 6. Decisions only Yash can make

Batched; nothing above waits on them except where marked.

- **G1 Network promise.** Build the open-session web path, or correct the consent copy. Stage 1 waits on this.
- **G2 Help accumulates.** Is the vocabulary a first-class feature, and what earns an entry.
- **G3 Suggestion labels.** Reader-language names for simulate and evidence, and the time word. Stage 0 ships provisional labels.
- **G4 Keep vs Highlight.** Whether they look different on the page.
- **G5 Own documents.** PDF or file open is the largest silent scope cut.
- **G6 Journal, sync, solver, consent.** Roughly 4,500 lines serve deferred futures. Keep, park or delete.
- **G7 Grid vs samples.** Which word is real.
- **G8 Automatic definitions** under a site grant: default on or always a click.
- **G9 FTS second copy** of page text in `daemon/store.ts:74`: drop or document as an erasure target. Blocks any erase path.
- **G10 Selection and dead ends** from the quality plan (P1, P7), plus the copy table items.
- **G11 Receipts vs source.** A recovery report claims "You were here" was delivered; the source has none. How derived receipts get reconciled from now on.

## 7. For Astra (QA)

- The journey e2e suite is intermittently flaky on the development host. Run it three times and record all three totals.
- POSIX FIFO and link tests have never executed; this host has no WSL or Docker.
- `npm run extension:typecheck` needs `extension/.wxt/tsconfig.json`, generated by `wxt prepare`.
- The QA guide's sections 5 and 8 list the pending items; section 1 of this file supersedes its head and totals.
