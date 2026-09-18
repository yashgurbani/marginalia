<!-- Opus 5 workflow synthesis, 2026-09-18. Refuter stages were skipped after a rate-limit outage; items are labelled verified-by-synthesizer or unverified. Saved unedited by Fable. -->

## Marginalia v2 — Strategic Synthesis

**Verification note.** The ten area audits arrived unrefuted. I re-opened the load-bearing citations myself this session. Items below are labelled **[V]** = verified-by-synthesizer (I read the file/line or ran the grep this session), **[U]** = unverified (rests on the area audit alone). Line numbers in **[V]** items are as printed by grep. SPEC-FINAL content was confirmed by reading `D:/Projects/Marginalia/marginalia-v2-package/wayfinder/SPEC-FINAL.md` lines 1–60; its *content* is verified, its *line numbers* are not.

---

### 1. Feature matrix

Grades: **spec** (a founding source asks for it) / **impl** (code exists) / **wired** (a reader can reach it) / **test** / **honest** (on-screen copy matches behaviour). y = yes, p = partial, n = no.

| Feature | spec | impl | wired | test | honest | Evidence |
|---|---|---|---|---|---|---|
| Anchoring (exact/moved/unsure/lost) | y | y | y | y | y | `contracts/reader.ts:28-46` [U]; states confirmed in SPEC-FINAL vocabulary [V] |
| Notes at a passage | y | y | y | y | p | `daemon/store.ts:66` [V]; no per-note delete (§below) |
| Notes senior to replies | y | y | y | y | y | `ui/margin-model.ts` ordering [U] |
| Define (intent) | y | y | y | y | y | `ui/margin.ts:392` [V] |
| Instantiate / Derive | y | y | y | y | y | `ui/margin.ts:392` [V] |
| **Simulate (reader entry point)** | y | y | **n** | y | n | `ui/margin.ts:392` offers only define/instantiate/derive; `ui/margin.ts:379` `pageQuestion(intent:'unsure'\|'explore')` — no reader action sets `simulate` [V] |
| **Evidence / "Check this"** | y | y | **n** | y | n | same [V]; transform `daemon/transforms/evidence/reconcile.ts:124` has only test callers [V] |
| Explore / shelf | y | y | n | y | n | `daemon/transforms/explore/shelf.ts:146,203` — only `tests/explore-transform.test.ts` calls them [V] |
| Capability gating | y | y | y | y | y | `contracts/reply.ts:490` [U] |
| **Daemon capability grant** | y | y | **n** | — | n | `daemon/main.ts:76` `capabilities: []` [V] — citations/shelf/samples can never validate |
| `capabilitiesForIntent` | y | y | **n** | y | — | `contracts/reply.ts:130`; every caller is in `tests/reply.test.ts` [V] |
| Samples grid (path 2) | y | y | p | y | p | hard-coded `capabilities:['samples']` at `ui/margin.ts:685`, `ui/asking-host.ts:227` [V]; spec calls the block `grid`, code calls it `samples` [V] |
| Saved-solver recompute (path 3) | y | y | **n** | y | y | `renderer/index.ts:230-232`; no production caller passes `onRecompute` [V]; prints an honest "not connected in this view" |
| Ask again / follow-up | y | y | p | y | y | `ui/asking/surfaces.ts:100` passes `onFollowup`; the saved-margin mount does not [V] |
| Vocabulary (accumulation) | y | p | n | — | n | zero `INSERT INTO vocabulary` package-wide [V]; `daemon/jobs/packet.ts:38` hardcodes "No vocabulary or library matches were included" [U] |
| Library pane | y | y | p | p | y | webapp only; extension supplies no `onLibrary` [U] |
| Consent envelope + verbatim parts | y | y | y | y | y | `daemon/jobs/envelope.ts`, `ui/consent.ts` [U] |
| **Open-session web access** | y | p | n | — | **n** | `daemon/codex-policy.ts:16-18,174-178`: `ClosedSandbox`, `networkAccess:false` on both branches, `web_search:'disabled'` [V] — while consent copy promises "separate web access for this site" [U] |
| Egress record | y | p | **n** | — | n | zero `egress` hits in `daemon/server.ts` and `ui/` [V] |
| Two rail dots (sending vs working) | y | p | p | n | p | one activity element; CSS specificity conflict [U] |
| "You were here" | y | **n** | n | n | n | zero hits across `ui/ webapp/ extension/ renderer/` [V]; receipt claims delivery [U] |
| Reading position | y | p | n | n | p | position always snapped to section start [U] |
| Reattachment history (`/api/reattach`) | y | y | **n** | p | y | route at `daemon/server.ts:186`, zero clients [V] |
| Keep vs Highlight on the page | y | p | n | n | n | `ui/margin.ts:775-780` ignores `highlighted` [U] |
| Host authority / withheld headline | y | y | y | y | y | `renderer/host-authority.ts` [U] |
| Illustration declaration | y | p | y | p | p | `contracts/reply.ts:98,472` optional, absent from the required-keys list at `:466` [V] — an undeclared stand-in validates |
| Export | y | p | p | p | y | two unrelated shapes [U] |
| PDF / open your own document | y | **n** | n | n | — | zero `\bpdf\b` hits package-wide [V] |
| WebMCP | p | **n** | n | n | — | zero hits package-wide [V] |
| Install on a fresh machine | y | **n** | n | n | — | no `scripts/`; `package.json:9-17` has no install target [V] |
| Diagnostics for the reader | y | p | n | p | n | `ui/helper.ts:100-106` discards the payload [U] |
| Suggestion set (≤3, time word) | y | p | p | p | n | `ui/asking/mount.ts:33-35` is a static 8-label table in transform vocabulary, no time word [V]; `onExposure` never passed by a production caller [V] |

---

### 2. What works, and what is present but not yet useful

**Works well (keep, do not touch).**
- **Anchoring.** Exact substring with prefix/suffix confirmation, four honest states, never fuzzy. This is the differentiator "help is anchored" and it is genuinely built. [U, high confidence]
- **Capability gating and reply validation.** `contracts/reply.ts` is strict, tested, and refuses rather than degrades. [V for the intent map, U for `:490`]
- **Host authority.** Withholding a headline claim that is not itself a host check is the honest behaviour the whitepaper asks for. [U]
- **Consent envelope.** Per-part sha256 over frozen outgoing bytes, shown verbatim. [U]
- **The transform layer.** `reconcileEvidence` and `assessShelf`/`prepareOpen` are complete, pure and well-tested. [V]

**Output present but not yet useful — and the concrete fix.**

1. **Every non-define intent.** Evidence, explore and the samples grid are built, tested, and unreachable, because `daemon/main.ts:76` sets `capabilities: []` and `contracts/reply.ts:490` then rejects their blocks. *Fix:* pass `capabilitiesForIntent(intent)` — which already exists at `contracts/reply.ts:130` — instead of a literal. One line at the daemon, one each at `ui/margin.ts:685` and `ui/asking-host.ts:227`. [V]
2. **Simulate has no door.** The whitepaper's flagship minute — select the vortex sentence, the illustration builds, move the slider — cannot be started, because no reader control sets `intent:'simulate'`. *Fix:* add a fourth suggestion button at `ui/margin.ts:392`. [V]
3. **Saved-solver recompute.** `renderer/index.ts:230-232` is correct and honestly disabled; nothing passes `onRecompute` or the `solver` capability. *Fix:* pass both from the margin mount. Execution path 3 then exists. [V]
4. **Follow-up on saved replies.** The live asking surface has `onFollowup`; the saved-margin mount omits it, so re-asking works during the session and dies on reload. *Fix:* pass the same callback. [V]
5. **Reattachment history.** `/api/reattach` and the `attachments` table are built with zero clients; the margin recomputes attachment state each render and throws it away. *Fix:* persist the result of the render-time computation through the existing route. Drift history — "help accumulates" — then exists. [V]
6. **Suggestions.** `ui/asking/mount.ts:33-35` shows transform vocabulary ("Simulate this idea", "Explore further") with no time word, violating the forbidden-words line and the ≤3-with-a-time-word rule. `onExposure` is never passed, so every exposure event is dropped. *Fix:* replace the static table with reader-language labels plus a time word, cap at three, and pass `onExposure`. [V]
7. **Diagnostics.** Sanitised, served at `daemon/server.ts:118-121`, discarded at `ui/helper.ts:100-106`. *Fix:* render it and add "Copy diagnostics". [U]

---

### 3. Missing from the vision (deduplicated)

| # | Source | Proposed feature | est_lines | human_gate | Slots at |
|---|---|---|---|---|---|
| M1 | whitepaper:202 (flagship demo) | A "Move it" / simulate suggestion in the margin | 15 | no | Stage 0 |
| M2 | SPEC-FINAL intents ("Check this") | An evidence suggestion + its deny copy | 20 | no | Stage 0 |
| M3 | whitepaper:13 "help accumulates" | Write path for `vocabulary` on each accepted define | 60 | **yes** — what counts as a learned term is identity | Stage 1 |
| M4 | whitepaper:171 (four boundaries) | `/api/egress` + the record behind the sending dot | 120 | no | Stage 1 |
| M5 | `ui/consent.ts:45-46` vs `codex-policy.ts` | Either an open-session network path, or corrected copy | 10 (copy) / 250 (path) | **yes** — which promise Marginalia keeps | Stage 1, first |
| M6 | SPEC-FINAL top zone | "You were here" resume line | 40 | no | Stage 1 |
| M7 | whitepaper:70 | Persisted reading position | 50 | no | Stage 1 |
| M8 | SPEC-FINAL:17 | Keep vs Highlight visibly distinct on the page | 30 | **yes** — a visual-identity call | Stage 2 |
| M9 | SPEC-FINAL vocabulary | Per-note removal with undo (`notes.deletedAt` is never written) | 25 | no | Stage 2 |
| M10 | SPEC-FINAL:80 | Multi-anchor ("additional passages") | 180 | **yes** — changes the data model | Stage 3 |
| M11 | FEATURE-INVENTORY:23 | One branch open at a time; persist `expanded` | 30 | no | Stage 2 |
| M12 | whitepaper:217 | Open a reader-supplied document (PDF interim fallback) | 300 | **yes** — scope call | Stage 3 |
| M13 | BUILD-PLAN-24H.md:127 (T19) | Installer + `tests/fresh-machine.test.ts` | 200 | no | Stage 2 |
| M14 | SPEC-FINAL rail | Below-900px rail sheet; fix the open-then-collapse click | 60 | no | Stage 2 |
| M15 | whitepaper:159 | Whole-library export incl. Markdown / W3C Web Annotation | 150 | no | Stage 3 |
| M16 | SPEC-FINAL asking | Automatic contextual definition under a site grant | 80 | **yes** — default-on behaviour | Stage 3 |
| M17 | `daemon/main.ts:80-86` | Handle `ReaderMigrationError` without a raw stack; call `resolveRecoveryBackup` | 40 | no | Stage 2 |
| M18 | extension parity | `onLibrary` route in the extension | 25 | no | Stage 2 |

---

### 4. Recommended wayfinder order

**Stage 0 — without this, the product is not itself (≈1 day).**

| T | Move | Reason vs BUILD-PLAN-24H.md |
|---|---|---|
| W0.1 | `daemon/main.ts:76` → `capabilitiesForIntent` | One line unlocks evidence, explore and path 2; nothing later matters until this lands. [V] |
| W0.2 | Same at `ui/margin.ts:685`, `ui/asking-host.ts:227` | The two mounts that hard-code `['samples']` would otherwise override the fix. [V] |
| W0.3 | Add simulate + evidence suggestions (M1, M2) | The plan assumes the flagship demo is reachable; it has no door. [V] |
| W0.4 | Pass `onRecompute` + `solver` from the margin | Turns a built, honest-but-dead path 3 on. [V] |
| W0.5 | Pass `onFollowup` on saved replies | Otherwise "ask again" silently depends on not reloading. [V] |
| W0.6 | End-to-end: select → simulate → grid → slider → recompute | The plan has no test that walks the whitepaper's own minute. |

**Stage 1 — completes the founding promise (≈3 days).**

| T | Move | Reason |
|---|---|---|
| W1.1 | Resolve M5 (network promise vs `ClosedSandbox`) | Truthfulness defect: the consent screen promises web access the policy forbids. Fix the copy the same day even if the path waits. [V] |
| W1.2 | `/api/egress` + sending-dot record (M4) | whitepaper:171 makes the record the reader's proof; `ui/margin.ts:219` currently opens the asking card instead. [V for absence] |
| W1.3 | Vocabulary write path (M3) | "Help accumulates" is one of three named differentiators and is currently zero code. [V] |
| W1.4 | "You were here" + persisted position (M6, M7) | Named in the spec's top zone; a receipt falsely claims delivery, so it will not be caught by audit. [V] |
| W1.5 | Wire `/api/reattach` from the margin | Built, zero clients; gives drift history for free. [V] |
| W1.6 | Suggestion set: ≤3, reader language, time word, `onExposure` | Forbidden on-screen words appear today. [V] |

**Stage 2 — completes the build plan's own never-droppable items (≈3 days).** W2.1 installer + fresh-machine test (M13, the plan's own non-droppable T19); W2.2 rail sheet and the 900px click bug (M14); W2.3 the two rail dots and the CSS specificity/hit-target fix; W2.4 Keep vs Highlight (M8); W2.5 per-note removal (M9); W2.6 one-branch-open + persistence (M11); W2.7 daemon startup errors (M17); W2.8 extension library route (M18); W2.9 diagnostics surfaced.

**Stage 3 — polish and scope (later).** Classification title suppression at `renderer/index.ts:237-257` [U]; `illustration` required when a model block is present [V — it is optional today]; a second criterion beside `growth-v1`; multi-anchor (M10); reader-supplied documents (M12); whole-library export (M15); automatic definitions (M16); the `grid`/`samples` naming drift.

**Where this differs from `wayfinder/BUILD-PLAN-24H.md`.** The plan sequences by ticket area. This order sequences by *reachability*: roughly six one-line wiring changes stand between the reader and several thousand tested lines. Everything in Stage 0 is cheaper than any single ticket in the plan and gates more.

---

### 5. Built, but never asked for (flag only — Yash decides)

- **`ui/journal.ts` (639 lines) + `ui/persistence.ts` (477) = 1,116 lines** of device-vs-helper conflict resolution for a sync model the whitepaper explicitly defers. Larger than the whole extension; ten times `daemon/library.ts` (113). [V — line counts]
- **`ui/journal.ts` also occupies the name the whitepaper reserves for the reader's own journal.** A naming collision in the product's vocabulary. [V — file exists; U — reservation]
- **`daemon/solver/` ≈ 2,522 lines** consuming an artifact nothing currently emits. [V — line count]
- **Consent / send-authorization ≈ 840+ lines** across seven modules (`send-checkpoint`, `outgoing-budget`, `send-binding`, `preparation-authority`, `policy-gate`, `provider-authorization`). Rigorous, and larger than the reading surface it protects. [U]
- **Helper management mounted inside the reading margin** (`ui/margin.ts:7`) — infrastructure in the reader's attention. [U]
- **`ui/library-entry.ts`** (28 lines) duplicating `webapp/main.ts:78-89`. [U]
- **The v1 WebMCP prototype** at `D:/Projects/Marginalia/src/tools.js` publishes nine mutating tools to arbitrary page script. Not in v2 [V — zero hits], but it is still on disk and `set_section_depth` lets a page hide a section. [U]

---

### 6. Questions only Yash can answer

1. **M5, the sharpest one.** `ui/consent.ts` tells the reader that an open session permits separate web access; `daemon/codex-policy.ts` forbids all network access on both branches. Which is the real Marginalia — do you build the network path, or correct the promise? [V]
2. **Is "help accumulates" a first-class feature or a nice-to-have?** It has zero write path today. If it is one of the three differentiators, it belongs in Stage 1, and you must say what earns a vocabulary entry.
3. **Does the reader open their own documents?** No PDF, no file open, `webapp/main.ts` substitutes a demo page. This is the largest silent scope reduction in the build. [V]
4. **Journal, sync, solver, consent: keep, park, or delete?** Roughly 4,500 lines serve futures the founding sources defer. I flag; I do not propose removal.
5. **Is the whitepaper's vortex minute still the product's centre?** The whole Stage 0 argument assumes yes.
6. **Keep vs Highlight** — should they look different on the page, and how?
7. **Automatic definitions under a site grant**: on by default, or always a click?
8. **`grid` (spec) vs `samples` (code)** — which word is the real one?
9. **A receipt at `docs/evidence/pro-t05-fixes/FULL-RECOVERY-REPORT.md:59` claims "You were here" was delivered; it does not exist in the source.** [V for absence] How do you want derived receipts reconciled against source going forward?

---

**Uncertainty ledger.** Unverified this session and load-bearing if promoted: the `contracts/reply.ts:490` gate mechanism; the CSS specificity conflict on the activity dot; the classification title suppression; the reading-position snap; `ui/consent.ts:45-46`'s exact wording; the export shape mismatch; the `expanded` set's missing `delete`; the map-segment anchor brittleness; all `est_lines` figures, which are my estimates, not measurements.

**Path root:** `D:/Projects/Marginalia/marginalia-v2-package/`. Founding sources: `D:/Projects/Marginalia/Marginalia — Research Whitepaper.md`, `D:/Projects/Marginalia/marginalia-v2-package/wayfinder/SPEC-FINAL.md`.
