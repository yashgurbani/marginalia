# Product quality plan (Opus 5 synthesis, 2026-09-18)

Source: workflow wf_5603f4d1-3f6. Finder findings were NOT adversarially refuted (rate-limit outage); the synthesizer checked citations itself and labels items verified-by-synthesizer or unverified. Fable judgment applies before any packet dispatch.

MARGINALIA — SYNTHESIS PLAN (post-verification)
Root: `D:\Projects\Marginalia\marginalia-v2-package\`
Every item below is labelled. `verified-by-synthesizer` = I opened the file and matched the string. `unverified` = the citation did not hold, or I could not reach it cheaply. Refuter stages never ran, so anything unlabelled would be worthless; nothing unlabelled is promoted.

---

1. STRENGTHS TO PROTECT (all verified-by-synthesizer)

- Separation of acts is real in code, not only in the spec. `ui\margin.ts` `showQuestion()` prints "Draft only. Preparing a review is separate from authorizing a model request." and `ui\note-editor.ts` gates its Ask control on the note ending in `?` while Enter only saves. No path in `ui/` sends implicitly.
- The consent sheet shows the literal outgoing bytes in a `<pre>` and refuses to claim modality: `root.setAttribute('aria-modal','false')` with the comment that the page stays interactive. That is the "page is never an authorization surface" decision surviving contact with implementation.
- Immutability is enforced at the storage layer, not by convention: `daemon\store.ts:89` installs `CREATE TRIGGER reply_version_immutable … RAISE(ABORT,'Reply versions are immutable')`, and reader controls live in a separate `reply_views` table. The source is never rewritten.
- Fail-closed by construction. `daemon\server.ts` mounts the solver routes with `unavailableSolverExecutionGate(…)` and `unavailableSolverEvidence(…)`; `daemon\consent\evidence-host.ts` types readiness as `{ ready: false; reasons: string[] }`. An unfinished capability cannot accidentally become live.
- The design system is coherent and small: `--m-s1..--m-s6`, `--m-target:28px`, radius 6/4, a four-step type scale, two dark branches, compaction by size and excerpt with no fading, and no animation outside the reduced-motion block.
- Anchor honesty: `ui\margin.ts:577` shows attachment state only when it is not exact, and always keeps the saved quote.

---

2. IMPLEMENTATION PACKETS

Ordering is reader impact, then cost. P1, P7 and P9 all own `ui\margin.ts`; they are serialized (only one open at a time), which keeps ownership disjoint at every moment. Nothing here proposes dropping a feature.

P1 — Selection stops seizing the page
lens: ux-interaction, accessibility · files: `ui\margin.ts`, `tests\margin-entry.test.ts` · est_lines 110 · waits_on: `ui/margin.ts` · human_gate: yes (changes how the first moment of the product feels)
Change: `showSelection()` currently runs `hold(sectionFor(anchor.start)); showPanel(); selectionCard.hidden=false` for any selection (verified). Make a stray selection offer the card without forcing the panel open or latching the reading position; give the card `tabIndex=-1` and focus it when the reader opens it, so the existing Escape/k/p/'/' keydown handler is reachable (verified: it only fires when focus is already inside). Same packet: invoke the declared-but-never-called `onLibrary` (`ui\margin.ts:31`, supplied by `webapp\main.ts:17`/`:99`, verified never invoked) from a visible control — the library currently has no door.
Proving check: `node --test tests/margin-entry.test.ts` — a selection event leaves `panel` collapsed and `hold` uncalled; activating the card focuses it; the library control calls `onLibrary` once.

P2 — Consent sheet: no trap, readable payload, distinguishable decisions
lens: accessibility, ux-interaction · files: `ui\consent.ts`, `tests\consent.test.ts` · est_lines 90 · waits_on: none · human_gate: no
Change: the keydown handler wraps Tab unconditionally while `aria-modal="false"` (verified) — a keyboard trap against WCAG 2.1.2 and a contradiction of the sheet's own comment. Keep non-modality and drop the wrap. Give the outgoing `<pre>` `tabindex="0"` plus a label so a keyboard reader can scroll what is about to be sent (verified: no tabIndex today). Separate `This time` / `Always on …` / `Never on …`, which are three adjacent identical `action()` buttons (verified). Add a control that reaches Settings from the denied state, which today renders only a sentence telling the reader to go there (verified).
Proving check: `node --test tests/consent.test.ts` — Tab from the last control leaves the root; `<pre>` is in the tab order; denied state exposes a Settings control.

P3 — Asking host: Escape must not discard work in flight
lens: ux-interaction, accessibility · files: `ui\asking\mount.ts`, `tests\asking-mount.test.ts` (new) · est_lines 85 · waits_on: none · human_gate: no
Change: `ui\asking\mount.ts:114` destroys the host on Escape in every phase although `planPhases` is defined at `:37` (verified). Bind Escape to the phase: dismiss while drafting, ask for confirmation once a request is in flight. Remove `aria-label` from the `plan` and `elapsed` `<p>` elements (prohibited on role=paragraph; verified). Extract the intent-label table into a new `ui\intent-labels.ts` and consume it here.
Proving check: `node --test tests/asking-mount.test.ts` — Escape during a sending phase leaves the host mounted and emits no cancel.

P4 — Note editor tells you its rule
lens: accessibility, copy · files: `ui\note-editor.ts`, `tests\margin-note-editor.test.ts` · est_lines 40 · waits_on: none · human_gate: no
Change: the hint "Enter saves; Shift+Enter adds a line. Asking always needs a separate action." is an unassociated `<small>` and the field carries only `aria-label="Your note"` (verified). Associate it with `aria-describedby`. The Ask control appears and disappears as the text ends with `?` (verified in both the input listener and `update()`); announce that appearance once via the existing live region.
Proving check: `node --test tests/margin-note-editor.test.ts` — field has `aria-describedby` resolving to the hint; typing `?` announces once, not per keystroke.

P5 — Reply canvas stops assuming a light page
lens: visual-design-system · files: `renderer\reply.css`, `extension\entrypoints\panel\panel.css` · est_lines 45 · waits_on: none · human_gate: no
Change: `renderer\reply.css` falls back to light hexes throughout (`var(--m-ink-2, #4f5662)`, `.mr-conclusion` `#292f38`, `::backdrop #10182866`) so a dark host renders dark-on-dark if tokens are missing (verified). Point fallbacks at the token layer instead. `extension\entrypoints\panel\panel.css:1` uses `var(--paper,#faf8f3)`, and `--paper` is defined nowhere in the repo (verified) — replace with the real surface token.
Proving check (manual, for Astra): open the side panel and a reply dialog with the OS in dark mode, then with `prefers-color-scheme: dark` forced and `ui/tokens.css` deliberately unloaded; no dark-on-dark text, no light slab.

P6 — Floating frame matches the design system
lens: visual-design-system · files: `extension\entrypoints\content.ts` · est_lines 25 · waits_on: none · human_gate: no
Change: the frame is `width:min(420px,…)` with `border:1px solid #aaa` and no radius or shadow (verified; it already sets `color-scheme:light dark`, contrary to the finding). Move to the specified 440px, the 6px radius token and an elevation consistent with the panel.
Proving check (manual, for Astra): side-by-side against the webapp margin at 1280px and at 380px; frame edge matches panel edge treatment.

P7 — Dead ends become doors
lens: ux-interaction, copy · files: `ui\margin.ts` · est_lines 70 · waits_on: `ui/margin.ts` (serialize after P1) · human_gate: yes (copy shapes the four-path model)
Change: three verified dead ends. `:478` throws "Keep this context, then explicitly save queued changes to the helper. No inference has been prepared." with no control that performs either act. `:587-588` shows "Thread removed." with `undo.focus()` and no timer or dismiss — focus lands in a toast the reader cannot leave cleanly. `:755` states "Saved-solver execution is not connected here. Follow-ups require a separate host-prepared review." Each becomes a sentence plus the control it names. Also adopt `ui\intent-labels.ts` from P3.
Proving check: `node --test tests/margin-recovery.test.ts` is reserved; add assertions in `tests\margin-management.test.ts` instead — the removal toast is dismissible and returns focus to the thread list.

P8 — Map focus ring stops being clipped
lens: accessibility, visual · files: `ui\margin.css` · est_lines 30 · waits_on: none · human_gate: no
Change: `.m-map{width:36px;overflow:hidden auto}` with `.m-segment{width:32px}` and `outline-offset:3px` clips the focus ring on both sides (verified via the built bundle). Give the map padding or draw the ring inside. Also `.m-activity` is a 6px dot whose only state signal is `background: var(--m-accent)` when sending — pair it with the existing text so the signal is not colour-only.
Proving check (manual, for Astra): keyboard-tab the map at 100% and 200% zoom; the full ring is visible on every segment.

P9 — Build hygiene
lens: build-release-hygiene · files: `package.json`, `extension\wxt.config.ts`, `marginalia-v2-package\README.md` (new) · est_lines 55 · waits_on: none · human_gate: no
Change (all verified): the extension CSP has no `default-src`; `web_accessible_resources` publishes `assets/*` and `chunks/*` to `http://*/*` and `https://*/*`; `version:'0.2.0'` is duplicated from `package.json`; `extension/tsconfig.json` extends `./.wxt/tsconfig.json`, a generated path, while `package.json` has no `postinstall`/`prepare`, so `npm run extension:typecheck` cannot pass on a clean clone; the package has no README. There is no `.github` directory, so none of `test`/`typecheck`/`build` runs anywhere but a developer's machine.
Proving check: from a fresh clone, `npm ci && npm run typecheck && npm run extension:typecheck && npm test` all pass without a manual `wxt prepare`.

---

3. COPY TABLE

current → proposed → file · gate

1. "No definition found for this selection. Ask about a word or phrase." → single shared string → `ui\margin.ts` · GATE. It conflicts with `ui\asking\mount.ts` `noDefinition`: "No explicit definition found in the captured page. Ask to review a contextual question." Both verified. Pick one voice; the second is closer to the vocabulary but harder to read.
2. Intent labels `Define this / Show me an example / Explain step by step` (`ui\margin.ts`) vs `Explain this passage / Show a concrete example / Work through the steps` (`ui\asking\mount.ts`) → one table in `ui\intent-labels.ts` → both files · GATE (these name what the product does).
3. "Keep this context, then explicitly save queued changes to the helper. No inference has been prepared." → a reader sentence plus the two controls it names → `ui\margin.ts:478` · GATE. "No inference has been prepared" is jargon and near the banned list in spirit.
4. "Save all queued device changes to local helper" → "Save your notes to this device's helper" → `ui\margin.ts` · GATE. "queued device changes" is machine vocabulary.
5. "Outcome unconfirmed" (unknown / timed_out) → "Unknown, try again" → `ui\margin.ts:516` · no gate; SPEC-FINAL fixes this execution-state wording.
6. "Saved-solver execution is not connected here. Follow-ups require a separate host-prepared review." → plain sentence naming what the reader can do now → `ui\margin.ts:755` · GATE. "saved-solver", "host-prepared" are internal terms.
7. "Saved-solver recomputation is not connected in this view." → same treatment → `renderer\index.ts:230` fallback · GATE.
8. "Model choices, actual grants, exclusions and vocabulary are managed in the local library and settings." → shorter, second person → `ui\margin.ts:896` · GATE.
9. "Sending is denied for this site. Change that decision in Settings before asking again." → keep the sentence, add the Settings control (P2) → `ui\consent.ts` · no gate.
10. Title override: `renderer\index.ts:240` renders `'Interactive explanation'` instead of `reply.title` whenever a classification exists (verified) → keep the authored title · GATE, see section 5.

Dropped for failing verification: the claimed diagnostic string at `ui\asking-host.ts:130-140` (that range holds `snapshotQuestion`/`openNow`) and the "authenticated POST work-status bridge" string (`grep` across `ui/` returns nothing). Both `unverified`; not promoted.

---

4. REFACTORS WORTH DOING FIRST

- One vocabulary module (`ui\intent-labels.ts` + the no-definition string). Risk removed: the same act already has two names in two files; every new intent doubles the drift. verified-by-synthesizer.
- One capability source. `ui\margin.ts:685` and `ui\asking-host.ts:227` both hardcode `capabilities:['samples']`, and `reply_versions` has no capabilities column — the reply's own capabilities are ignored at both mount points. Risk removed: path 3 can never light up from data. verified-by-synthesizer. Touches a reserved file; waits_on `ui/asking-host.ts`.
- Settle the stateKey contract before more solver tickets land. `renderer\index.ts:230` sends `stateKey: canonicalReplyData({…})` — a canonical string — while `contracts\solver.ts:737`/`:762` reject anything that is not 64 hex, and `solverStateKeyFrom` (`:326`) has no production caller. Risk removed: every future recompute call fails validation with "The plan request has an invalid view state key." verified-by-synthesizer.
- Make `contracts\solver.ts` browser-importable. `:1 import { createHash } from 'node:crypto'` means the renderer cannot compute the key it must send. Risk removed: a hard architectural block discovered late. verified-by-synthesizer.
- Add CI before more tickets. No `.github` exists; `npm test`, `typecheck` and both extension scripts run only locally. Risk removed: silent regression across nine reserved files held by parallel workers. verified-by-synthesizer.

---

5. CONFLICTS AND MY RECOMMENDATION

- STALE FINDING. The code-quality lens claims path 3 has zero production entry points. False as of `5b12892`: `daemon\server.ts:17-18` imports `createSolverRoutes`, constructs `SolverExecutionService` with real `createJobSolverArtifactBindings(jobs.store)`, and calls `createSolverRoutes(solver)` at `:46`. Recommendation: discard the finding's premise; keep only its reader-facing half — the gate and evidence are still `unavailable*` stubs and no caller passes `onRecompute`/`onFollowup` into `mountReply` (verified). Inference, not fact: the remaining gap is one browser wiring change plus one gate implementation, not an architecture problem.
- OVERSTATED FINDING. "The consent sheet re-focuses on every refresh" — `update()` calls `focusEntry()` only `if (ownedFocus)` (verified). Keep the trap fix (P2), drop the refocus claim.
- CONFLICT WITH A GOVERNING DECISION. `renderer\index.ts:240` replaces the authored `reply.title` with `'Interactive explanation'`. The decision that the source is never rewritten, and the immutability trigger in `daemon\store.ts`, both point one way: show the authored title and label interactivity separately. Recommendation: fix in P5's successor; it is a one-line change but it is identity-shaping, so it is gated.
- CONFLICT BETWEEN LENSES. Code-quality wants the unused solver tree pruned; the rules forbid proposing a feature be dropped. Recommendation: keep every file, land the stateKey and `node:crypto` refactors, and treat path 3 as deferred wiring — Yash's call, not a cleanup.
- CONFLICT INSIDE `ui\consent.ts`. `aria-modal="false"` and an unconditional Tab wrap cannot both be right. Recommendation: keep non-modality (it encodes "the page is never an authorization surface") and remove the wrap.
- UNCERTAIN, NOT PROMOTED: `ui\asking\flow.ts` blocker table, `ui\journal.ts` strings, `daemon\jobs\runtime.ts` `reasons.join('; ')`, the renderer slider `step`/`aria-valuetext`, and whether the live region sits inside `.m-panel`. Verify these before any packet claims them.