# Marginalia — project submission

18 September 2026. Written against the repository at `codex/marginalia-v2`, head `e55406f`.

This document says what Marginalia is, what it promises, what actually runs today, and what is still unproven. Where a claim has evidence, the evidence is named. Where it does not, the document says so. The founding whitepaper, `PRODUCT.md` and `docs/BUILD-PLAN.md` outrank this file; nothing here amends them.

## What it is

Marginalia is a margin beside whatever you are reading. You select a passage or write a note, and the margin gives you help anchored to those exact words. The page itself is never rewritten. Your notes, highlights and threads live on your computer in SQLite and export as plain files. The work stays as a thread you can reopen next week.

It is three parts: a Chrome extension that draws the margin, a small local helper that holds the store and talks to your Codex, and a library page served on localhost.

### The reading problem

A reader in a new field meets a sentence that assumes something they do not have. There are three things they can do today, and each loses something.

Paste it into a chat. The answer arrives in another window, detached from the sentence that prompted it. The model's claims and the author's claims become one block of prose. Next month the reader will not find it.

Open a sidebar. The reply is a paragraph beside the page rather than attached to the span. Nothing in it can be moved, and nothing says which part came from the page.

Save it for later. Read-later apps and annotators keep the page and the highlights well. The hard sentence is still just words.

The habit the project grew out of is narrower than any of these: every time the author reads a paper in a new field, he builds himself an annotated copy that fills in the gaps. Marginalia is that annotated copy, made as you read, kept beside the original, owned by you.

## The governing promises

Four rules govern the build. They are the ones a reviewer can check against the code, and they are the reason several otherwise convenient designs were refused.

**The page is never rewritten.** The source document's own DOM nodes are not edited. Marks are drawn with the CSS Custom Highlight API from a namespaced shadow host. Everything the agent makes lives in its own layer, anchored and removable. A selection captures the passage without mutating the page; an oversized capture fails closed rather than truncating quietly.

**The reader's notes are senior to model replies.** Notes and highlights sit in page order. A reply is indented beneath the note or selection that prompted it, never above it. A note is plain text that belongs to the reader; the margin can offer to ask about it, and never sends it on its own.

**Nothing is sent without reviewing the exact outgoing content and the recipient.** Before text from a new site leaves the machine, the margin shows the actual payload, the recipient and the scope, and asks once: this time, always on this site, or never on this site. A denial persists. Selecting sends nothing. Keeping, parking, reopening a page, reconnecting the helper and scrolling send nothing. The helper writes the egress record before dispatch and after outcome; the model never writes it.

**Four execution paths stay distinct, and are never passed off as each other.** Moving a slider runs in the margin's own packaged kernel at no cost. Where a model needs a range the margin cannot compute, samples the model authored are interpolated inside their declared envelope, and refused outside it. Where the reader goes outside that envelope, a solver the model already wrote is re-run on the reader's machine with new inputs and no model turn. Only a new question, or a change to the model itself, asks the provider again, and that is always a visible action.

## What is built and verified

### At head `e55406f`

The full suite was run on this machine today against `e55406f` with Node 24 on Windows:

```
npm test                    →  894 tests, 888 pass, 0 fail, 0 cancelled, 6 skipped  (29.2 s, exit 0)
npm run typecheck           →  exit 0
npm run extension:typecheck →  exit 0
```

The six skips are gated, not broken: they need a Chromium binary supplied through `T18_CHROMIUM`, which is absent in this environment.

### Cross-platform evidence

CI run [35311736674](https://github.com/yashgurbani/marginalia/actions/runs/35311736674) passed on Windows, macOS and Linux for source commit `babd2c2a5da58e08971fa2a9e207b0b832911559`, which recorded 840 tests, 834 passed, zero failed, six skipped. That is the last commit with three-OS receipts. Everything merged after it has local Windows evidence only. CI is command-level evidence; it is not a native install acceptance, and this document does not treat it as one.

### Integrated packets

| Packet | What it added | Landed at |
|---|---|---|
| E35 | Durable clarification budget: at most one clarifying question, enforced structurally with transactional rollback | `babd2c2` |
| E12 | Whole-library export of reader-owned threads as plain files | `babd2c2` |
| E07 | Interpreter pinning for the saved-solver path | `babd2c2` |
| E10 | Reader diagnostics packet | `942fc83` |
| E11 | Resume cue — the "you were here" return position | `cb5109a` |
| E19 | Attachment observation and recovery fences for moved and lost anchors | `f943f02` |
| E13/E30 | Reply origins union, with read compatibility for legacy saved replies | `31838af` |
| E25 | Explicit Keep and Highlight split, and saved-mark paint on the page | `e55406f` |

The brief for this submission pinned `cb5109a`, where the recorded suite was 856 tests, 850 pass, zero fail, six skipped. Main advanced past it while this document was being written. The numbers above supersede that checkpoint and were produced by running the suite, not by reading a report.

### What the tests actually cover

The suite is 84 test files. It exercises the store and its migrations, anchor capture and reattachment, the consent and egress contracts, the job pipeline including cancellation and unknown outcomes, the saved-solver adapter including cache, leases and confinement refusals, the renderer's host-authority rules, and the margin's own DOM behaviour against a fake document. Representative assertions, in the suite's own words: a selection "captures safe source identity without page mutation or implicit send"; an oversized capture "fails closed instead of truncating or sending"; the renderer "withholds a structurally bound but altered checked outcome"; a solver timeout "is reported without claiming the process was stopped".

What the suite does not cover is stated plainly in the next-to-last section. Deterministic fixtures are not a real provider, and a fake document is not a browser.

## Architecture

Three parts, one store, one reply contract.

**Extension** (`extension/`, WXT, Manifest V3). The content script captures the selection with W3C text-quote and text-position selectors, reads page metadata, and draws marks from a shadow host without touching the page's own nodes. The margin renders in Chrome's side panel. Replies are typed data rendered by code that ships inside the package; no generated markup or script is ever executed. That is both the Chrome Web Store rule for MV3 and the security boundary.

**Local helper** (`daemon/`, Node 24, TypeScript). It owns SQLite with WAL and FTS5 (`daemon/store.ts`), the consent and grant service (`daemon/consent/`), the job pipeline with attempts, outgoing budgets, workspace integrity and send checkpoints (`daemon/jobs/`), the solver execution environment (`daemon/solver/`), and the loopback HTTP routes (`daemon/routes/`). It binds to `127.0.0.1:43120` only, validates Host and Origin, and pairs the extension with a short-lived code exchanged for a revocable token. Provider credentials never enter the browser.

**Contracts** (`contracts/`). The seam every part codes against: `reply.ts` and `reply.schema.json` for the reply and its seventeen block types, `consent.ts` for outgoing parts, grants, exclusions and egress records, `jobs.ts` and `job-runner.ts` for the job lifecycle, `solver.ts` for the saved-solver handshake, `host-checks.ts` for the checks that must back a result sentence, `reply-origins.ts` for per-part provenance, `reader.ts` and `library.ts` for the reader-owned surface.

**Renderer and kernel** (`renderer/`, `kernel/`). The kernel is a bounded expression grammar with RK4 and adaptive RK45 integration under step and horizon caps. The renderer draws plots, diagrams, tables, steps, citations and media, and enforces host authority: a result sentence with no backing host check is withheld rather than shown.

**The four paths, in code.** Path 1 is the kernel running in the margin — sliders and hovers cost nothing. Path 2 is authored samples, interpolated inside a declared envelope; `tests/` asserts that interpolation "refuses extrapolation on both sides for every supported mode". Path 3 is the saved solver, defined in `contracts/solver.ts` and executed by `daemon/solver/`, re-run with new inputs and no model turn. Path 4 is new inference through `daemon/jobs/`, which is always an explicit action with its own consent review. The paths are separate types with separate provenance, so a weaker path cannot be reported as a stronger one.

## How to run it

Node 24 (`>=24 <25`) and npm.

```sh
npm ci
npm test                    # 894 tests
npm run typecheck
npm run extension:typecheck
npm run extension:build     # Chrome MV3 output in extension/.output/chrome-mv3
npm start                   # the local helper on 127.0.0.1:43120
```

To install the helper so it starts at login, run `.\scripts\install-helper.ps1` on Windows or `bash scripts/install-helper.sh` on macOS and Linux. Both take `-DryRun` / `--dry-run`, and `-Uninstall` / `--uninstall` removes the login task while keeping reader data. Then load `extension/.output/chrome-mv3` unpacked, open the extension options and pair with the code the helper prints.

Installing, starting and pairing send nothing to a provider and do not change your Codex sign-in. Without an authorized Codex runtime, reading, notes, saved threads and the library still work, and the margin says what is unavailable instead of pretending.

Environment: `MARGINALIA_DATA_DIR` for the database, `MARGINALIA_PORT` for the loopback port, `MARGINALIA_CODEX_EXECUTABLE` and `MARGINALIA_CODEX_HOME` together for the dedicated runtime (the home must be disjoint from `~/.codex`), and `T18_CHROMIUM` to enable the browser test gate.

## What is honestly still open

These are gates, not bugs. Tests and CI do not close them.

**Q03 and Q04 — real-provider evidence.** No run against a real model provider has been recorded. Every reply behaviour in this repository is proven on deterministic fixtures. The flagship demonstration on an unseen passage, and the claim that the four paths behave as described under a real provider, are unproven.

**Q06 — positive confinement.** The saved solver's isolation is requested and its refusals are tested: missing isolation evidence returns unavailable rather than running anyway. What is missing is the positive observation — a closed session proved to reach no network, and an open session proved to fetch only through the broker. Requested restrictions are not observed confinement, and the evidence files say so.

**Native install and browser acceptance.** Native installation is proven on Windows. macOS and Linux have command-level CI receipts only. The real loaded-extension walk on a live page was attempted and blocked by browser policy on the QA surface; no loaded-extension paint has been independently observed at this head.

**H17 — runtime direction.** The direction for physical inference at runtime is undecided. It is an open product decision, not a missing implementation.

**H15 — the reading verdict.** Yash has not yet sat with two real pages for twenty minutes and answered the four questions. Agent fixtures and unit tests cannot substitute for that. It is a release gate alongside the automated checks, and it is open.

Smaller open items are listed in `docs/evidence/consolidation-2026-09-18/final/source-gates.md`, which names every governing promise, its ticket ownership and what remains to be proven.

## The gap audit, and three features in flight

A promise-by-promise audit read the whitepaper against the code at this head. Its findings fall into three states.

**Built but unreachable — the work exists and nothing opens it.** The FTS5 search index is created in `daemon/store.ts` and faithfully maintained on every write path, and nothing anywhere reads it: there is no `MATCH` query in `daemon/`, no `/api/search` route, and no search field on the library page. The vocabulary table, its list and delete routes, its client and its full settings section all exist, and no code inserts a row, so the page is permanently empty and says so in its own copy.

**Partial — the promise is half-kept.** Ask opens a fixed row of five offers in a fixed order; the additive suggestion score described in the whitepaper has no implementation and `contracts/suggestions.v1.json` does not exist. The selection card is real but lives in the margin column rather than at the passage, and arrives on a 1.5-second poll rather than on the selection event. Correction lineage is stored and made immutable in the database, and nothing propagates it to the replies derived from a withdrawn one.

**Missing — announced and withdrawn in the same line.** The margin renders the literal strings "Related items · not available in this version." and "Hear it · not available in this version." The exposure-log hook is called in `ui/asking/mount.ts` and no production mount passes a handler, so nothing is written and nothing can be audited. Journeys and topics — threads grouped around a question, proposed by the margin and renamed by the reader — have no implementation.

The audit's honesty is itself a finding: in several places the interface names a promise and then states its own absence rather than hiding it. That is better than a silent gap, and it is still a gap.

Three of these are being closed now. Each is small, test-backed, and touches no daemon, provider or install path. All three are **in flight** at the time of writing and are not claimed as built.

**1. A note can ask without ending in a question mark.** Today `ui/note-editor.ts` gates the Ask affordance on `field.value.trimEnd().endsWith('?')`, in both the input listener and `update()`. A real note — "not sure why the second term drops out" — never shows Ask at all, so the promised route from a stuck note to a reply is invisible exactly when the reader is stuck. The fix is one exported pure helper, `askOffered(text)`, returning true when the trimmed note has at least three characters, called from both sites so they cannot drift. Everything else stays: the label, the announce-once behaviour, the disabled state while saving, and the rule that the affordance is an offer and never a send.

**2. The rail's sending dot lights while the passage is in flight.** This is the one signal that says "your text is leaving now", and it is the boundary the whole product is built on. `ui/margin.ts` is the only writer of `data-sending`, and every call site passes `false` — including the one where the durable host record already shows a handoff in flight and the label already reads "Request passed to Codex". The lit CSS exists and is dead. The fix passes that recorded handoff state through as the argument, leaves the optimistic and error paths at `false` so interface optimism can never light the dot, and gives the collapsed rail words for it, since the rail's activity element has `font-size: 0`.

**3. A corrected reply, and everything derived from it, is marked.** The whitepaper's single rule about saved explanations is that if a reply is corrected, everything derived from it is marked. Half of it exists: `supersedes` is defined, validated on insert, and protected by an immutability trigger. Nothing propagates it, so a withdrawn reply sits unlabelled beside its replacement and a follow-up built on it says only "follow-up". The fix is a pure host-computed function over stored lineage that classifies each reply as current, withdrawn, or derived from a withdrawn one, and writes a line into each reply. Nothing is greyed out, collapsed, reordered or hidden: mark, never hide.

## The road ahead

In order, and each gated on the one before it.

**Close the open gates.** A real-provider run on the flagship passage and one unseen passage, with the four paths independently proven. Positive confinement evidence for closed and open sessions. A fresh native install on macOS and Linux, and a loaded-extension walk on a live page. Then Yash's twenty minutes with two real pages.

**Make the library pay back.** Search is the largest single gap and the cheapest of the large ones: the index is already written on every save and only needs a query, a route and a field. Related items and the vocabulary trail follow it. Until those land, the tenth paper opens exactly like the first, which is the one claim in the whitepaper the current build does not support.

**Make the offers reasoned.** The suggestion tables, the additive score, and the exposure log that makes the score auditable from inside the product. Three offers rather than five, chosen rather than fixed.

**Then the surfaces.** The PDF viewer page on the Semantic Reader overlay model, since Chrome's built-in viewer blocks extensions. Local models and the official Claude CLI behind the same router. A hosted library with its own privacy contract.

This is a personal tool first. It is worth building because its author reads papers in fields he does not know and builds the annotated copy by hand every time. That is the test it has to pass, and it has not been given that test yet.

---

**Evidence index.** Verified suite and typecheck at `e55406f`, this machine, Windows, Node 24 · CI [35311736674](https://github.com/yashgurbani/marginalia/actions/runs/35311736674) for `babd2c2` on three platforms · [Consolidation handoff](CONSOLIDATION-HANDOFF-2026-09-18.md) · [Source promises and release gates](evidence/consolidation-2026-09-18/final/source-gates.md) · [Wayfinder ticket matrix](evidence/consolidation-2026-09-18/final/wayfinder-matrix.md) · [Fidelity ledger](archive/FIDELITY-LEDGER-2026-09-18.md) (120 promise rows pinned at an older commit; its line numbers are stale) · [Contract](CONTRACT.md) · [Interaction acceptance](INTERACTION-ACCEPTANCE.md) · [Install and recovery](INSTALL-RECOVERY-EXPERIENCE.md).
