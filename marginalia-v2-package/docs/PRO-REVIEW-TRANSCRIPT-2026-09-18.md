> From: https://chatgpt.com/c/6aac953b-980c-83eb-9886-3e8a38c39520

# you asked

message time: 2026-09-18 03:34:51

Use @GitHub 

You are working on Marginalia, a personal reading tool: a browser extension plus a local helper daemon. The reader selects a passage on a web page and gets help in the margin (definitions, worked examples, simulations with sliders, evidence checks). Notes stay with the reader; the source text is never changed; nothing is sent to a model until the reader reviews the exact outgoing content and chooses to send it.

Your job over this conversation is a long-horizon audit and design task in five phases. You read; you do not run code or claim to have tested anything. Every claim you make about the code must cite a file path and a line range from the pinned commit. Where you cannot verify, write [U] after the claim. Where you did verify against the linked source, write [V]. Keep verified fact, inference, and recommendation in separate sentences.

Governing product decisions, not open for debate:

1. The reader's source text is never modified.
2. Notes are senior to model replies: a note survives, a reply can be discarded.
3. No implicit send. Selecting text, pressing "?", reopening a page, reconnecting the helper, or recovering a session never sends anything.
4. The reader reviews the exact outgoing content and the recipient before any model request.
5. Four execution paths stay distinct: definition (structured final), generation (workspace files), saved-solver recompute with zero model turns, and consented web access.
6. Fetched evidence is not support. A page that was retrieved is not thereby endorsed.
7. A requested sandbox is not confinement. Only observed evidence counts, and today none proves confinement.
8. Windows, Linux and macOS are all first-class.
9. The existing design system is preserved.

Founding documents, in rank order. Earlier outranks later; when a derived document contradicts the whitepaper, the whitepaper wins and you say so.

- Research whitepaper: attached as a file (not on GitHub).
- PRODUCT.md: attached.
- Spec: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/wayfinder/SPEC-FINAL.md
- Design brief: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/wayfinder/DESIGN-BRIEF-FINAL.md
- Feature inventory: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/wayfinder/FEATURE-INVENTORY.md
- Map of tickets: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/wayfinder/MAP.md

Current state, derived and lower-ranked:

- State and plan (start here for orientation): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/STATE-AND-PLAN-2026-09-18.md
- Feature strategy: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/FEATURE-STRATEGY-2026-09-18.md
- Product quality plan: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/PRODUCT-QUALITY-PLAN-2026-09-18.md
- Engineering standards: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/ENGINEERING-STANDARDS-2026-09-18.md
- QA handoff: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/QA-HANDOFF-ASTRA.md

Code you will need most often:

- Daemon entry: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/main.ts
- HTTP server and routes: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/server.ts
- Job service (the four paths): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/jobs/service.ts
- Job store: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/jobs/store.ts
- Saved-solver gate (new): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/jobs/solver-gate.ts
- Codex policy (sandbox request, network false): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/codex-policy.ts
- Solver transport: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/solver/transport.ts
- Solver service: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/solver/service.ts
- Consent: https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/daemon/consent
- Reply contract and `capabilitiesForIntent`: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/contracts/reply.ts
- Margin UI (the reader's surface): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/ui/margin.ts
- Asking flow: https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/ui/asking
- Consent sheet copy: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/ui/consent.ts
- Reply renderer (grid, slider): https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/renderer
- Extension: https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/extension
- Tests (node\:test, one file per concern): https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/tests

Work in flight that you must not design around as if it were absent (it will be merged before your output is used): Stage 0 wiring (daemon grants capabilities per intent; "Move it" and "Check this" doors in the margin; follow-ups on saved replies), T13-P5 confinement evidence collector (falsify-only, three reader states, never "confined"), and the engineering standards packets P2, P3, P5, P6, P8, P10, P11. Their scope is described in the state-and-plan document, section 5.

Working rules for this conversation:

- Read the whitepaper fully before anything else. Then SPEC-FINAL. Then the state-and-plan. Only then the code.
- Do not summarise documents back to me. Produce the deliverable for each phase and nothing else.
- Write in plain prose. Short sentences. No filler. When you propose copy the reader will see, use reader language, never engineering words ("sandbox", "payload", "digest", "capability").
- Do not use the word "verified" for anything you did not read in the linked source.
- Where a question is one only the product owner can answer (identity, what the product is), do not decide it. Present the options, the consequence of each, and one recommendation with its reason.

Confirm you have read the three attachments and the spec by naming the whitepaper's central claim in one sentence and the spec's list of the four execution paths with their line numbers. Then wait for the Phase 1 message.

[svg](https://github.com/yashgurbani/marginalia/blob/codex/marginalia-v2/marginalia-v2-package/docs/PRO-LONG-HORIZON-2026-09-18.md#3-phase-1-message-the-fidelity-ledger)

Build the fidelity ledger. One row per promise the whitepaper makes to the reader, in the whitepaper's own order. A promise is any sentence that says what the reader will be able to do, see, or rely on. Aim for completeness, not brevity; expect 60 to 120 rows.

Columns:

1. Promise, quoted from the whitepaper, at most 15 words, with the section it comes from.
2. Spec treatment: where SPEC-FINAL keeps, narrows, or drops it, with a line reference. Write "silent" if the spec never mentions it.
3. Code path: the file and line range where it is implemented, or "none".
4. Reachability from the reader: one of `reachable` (a reader action leads to it), `built-unreachable` (code and tests exist but no reader control leads there), `partial`, `missing`, `contradicted` (the code does the opposite or the copy claims what the code does not do).
5. Evidence marker: [V] or [U].
6. Test coverage: the test file that exercises the reader-facing behaviour, or "none". A unit test on an internal function does not count.
7. One-line note on what would close the gap, or "identity question" if only the owner can decide.

After the table, three lists:

- Contradictions: every row marked `contradicted`, with the exact copy and the exact code line. The consent sheet's network promise versus the policy's `networkAccess: false` is one known case; find the others.
- Built but never asked for: code with no whitepaper or spec promise behind it. Give module, approximate line count, and which spec item, if any, it serves.
- Promises the spec dropped silently: whitepaper rows where the spec is "silent" and the code is "none".

Then a self-check: pick the ten rows you are least sure of and re-read their sources. Correct the table in place and list what changed.


The state-and-plan document lists eleven decisions (G1 to G11) that only the owner can make. For each, produce a decision brief of at most 200 words:

- What the whitepaper says, quoted.
- What the code does today, with file and line.
- The options, two or three, each with its consequence for the reader and for the code (files touched, rough size).
- One recommendation and the single reason for it, anchored in the whitepaper rather than in effort.
- What is blocked until it is decided.

Give G1 (the network promise: build a consented web path, or correct the consent copy) the most care. Read `daemon/codex-policy.ts`, the consent directory, and `ui/consent.ts` fully before writing it. If a consented web path is chosen, sketch how it stays a distinct fourth execution path: what the reader reviews before send, what the egress record contains, how the sending indicator is driven by that record, and how "fetched is not support" shows in the reply.

End the phase with a one-page summary the owner can read in five minutes: eleven lines, one per decision, each line "Gn: recommend X because Y."


Write implementation packets for Stage 1, in the exact format below, one packet per item. These are handed to a bounded model worker (GPT-5.6 Sol at medium) that has the repository, runs the tests, and cannot ask questions. A packet is good when the worker can finish it without inventing anything.

Items:

- M4: egress record behind the sending indicator. Every outbound request writes a record (recipient, byte count, digest of reviewed content, timestamp, path) that the margin reads to drive the sending dot; a route to read records; a test that the dot never shows without a record.
- M3: vocabulary write path. Only if G2 recommends it; otherwise write the packet as "deferred" with the reason.
- M6 and M7: "You were here" and persisted reading position. The reader returning to a page sees where they were, with no request sent.
- Reattach: `/api/reattach` exists on the server with zero clients. Design the client side so that reconnecting never sends anything.
- Suggestion set: at most three suggestions in reader language, one of them a time word ("a minute", "a moment"), with an exposure record so that what was shown can be reconciled with what was chosen.
- Any Stage 1 item your Phase 1 ledger surfaced that the strategy document missed.

Packet format:

```
# <id>: <title> (<worker model and effort>)

Ethos line: one sentence quoted from the whitepaper that this packet serves.

## What the reader gets
Two or three sentences in reader language.

## Current state
File:line facts, each marked [V] or [U]. What exists, what is missing, what contradicts.

## Change
Numbered steps. Each names the file, the function, and the behaviour. Name every value the worker would otherwise have to invent (option names, defaults, limits, copy strings).

## Tests
Numbered. Each states the observable behaviour it proves and the file it lives in. At least one test must prove that no request is sent by the new control.

## Hard limits
Allowed files. Forbidden files. Behaviour that must not change. Baseline instruction: run the suite first and record totals.

## Report
Path, required contents, length cap.

```

Before writing, read the packets that already shipped, to match register and level of detail: the T20 mount and P4 work described in https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/T20-OPUS-WORKER.md and the state-and-plan section 5.


Stage 2 (finish the product): installer and fresh-machine first run on all three platforms; rail sheet under 900px; two rail dots; Keep versus Highlight (G4); per-note removal with undo (`notes.deletedAt` exists in the schema and is never written); one branch open at a time; daemon startup errors surfaced in the extension; extension library route; diagnostics visible to the reader.

Stage 3 (the whitepaper's larger promises): multi-anchor notes (G5 adjacent); PDF and own documents (G5); export; automatic definitions under a site grant (G8); grid versus samples naming (G7).

For each item produce a short design, not a packet: what the reader sees, the smallest complete version, which files it touches, what it must not change, what evidence would show it works, and whether it is gated on an owner decision. Order the items by reader value divided by size, and say why the top three are first. Mark any item where the whitepaper and the spec disagree, and side with the whitepaper.

For the installer, write the fresh-machine test script as a numbered checklist per platform. It will be run by a human and by a QA worker; it must contain no step that assumes a developer environment.


Take your Phase 1 ledger and Phase 3 packets and attack them.

1. For every ledger row marked `reachable`, name the exact reader action chain (click, key, or selection) that reaches it, with file and line for each handler. Downgrade any row where you cannot.
2. For every packet, list what a worker would still have to invent. Fix the packet so the list is empty, or mark the item as needing a decision.
3. For every recommendation in Phase 2, write the strongest one-paragraph case against it. Where the case against wins, change the recommendation and say so.
4. Check every quoted copy string against the rule: no engineering words in reader-facing text.

Then deliver, as separate fenced Markdown documents ready to save into `marginalia-v2-package/docs/`:

- `FIDELITY-LEDGER-2026-09-18.md`: the corrected Phase 1 ledger and lists.
- `OWNER-DECISIONS-2026-09-18.md`: the Phase 2 briefs and the one-page summary.
- `STAGE1-PACKETS-2026-09-18.md`: the Phase 3 packets after Phase 5 fixes.
- `STAGE2-3-DESIGNS-2026-09-18.md`: the Phase 4 designs and installer checklists.
- `PRO-RUN-NOTES-2026-09-18.md`: what you could not verify, where the sources disagreed, and what you changed after refuting yourself.

Each document starts with a two-line header: the commit you read (`0360a1c`), and the sentence "Items marked [U] were not verified against source."

---

# chatgpt response

I’ll follow the phases in order, beginning with the whitepaper and pinned spec.

I’ve finished the required reading and found the spec’s four paths differ from the governing dispatch paths. M4’s key gap is that its sending indicator ignores existing consent records.

---

# chatgpt response

I have read all three attachments in full—`RESEARCH-WHITEPAPER-v3(1).md`, `PRODUCT(1).md`, and `BUILD-PLAN(1).md`—and `marginalia-v2-package/wayfinder/SPEC-FINAL.md` at commit `0360a1c`. [V]

**The whitepaper’s central claim:** Marginalia combines help that changes form to fit a passage, can be inspected and manipulated without another model request, identifies each part’s origin, and remains anchored beside the unchanged source in a record the reader owns. [V]  

The spec’s four paths are listed in **`marginalia-v2-package/wayfinder/SPEC-FINAL.md:63–66`**, under **Replies**:

| Line at `0360a1c` | Path | Stated boundary |
|---|---|---|
| **63** | **Packaged local evaluation** | The default. Sliders, hovers, stepping and re-plots use packaged code, with zero model tokens per interaction. [V] |
| **64** | **Precomputed samples** | Explore within a declared envelope. Offer recomputation outside it; never extrapolate silently. [V] |
| **65** | **Re-run the saved solver** | Execute the saved solver with new inputs, without a model turn, retaining grants, limits, cancellation and provenance. [V] |
| **66** | **Ask Codex again** | A model turn for a new question or a revision to the model, presented as an explicit action, never hidden behind a slider. [V] |

These entries were read directly from the pinned spec. 

The spec’s list describes **reply-interaction paths**. It is not the same classification as your governing four execution paths: definition, generation, saved-solver recomputation and consented web access.

I have not run code or tests. Paused here for the Phase 1 message.

---

# you asked

message time: 2026-09-18 04:05:41

Do not pause between phases. Run Phases 1 to 5 from the phase descriptions appended below in one response, in order, each phase building on the previous one. Do not run code or tests; you have none. Do not stop to ask whether to continue. Write the four deliverable files in full in your answer, each under its own heading and filename, and end with the self-refutation pass from Phase 5. If the answer runs long, finish every phase at reduced length rather than stopping early.

---

# chatgpt response

I’ll audit `0360a1c` through all five phases without running code or tests, carrying findings into the deliverables before challenging action chains, recommendations, and packet details.

The audit will distinguish provider handoff from transmission and blocked execution from absence. It also finds no web operation, while current network restrictions do not prove confinement.

The existing egress store should be extended, while each request needs separate approval of current reviewed content. Reopening saved work is read-only, but saved-reply recompute remains inconsistently surfaced.

---

# chatgpt response

## `FIDELITY-LEDGER-2026-09-18.md`

```markdown
Commit: 0360a1c
Items marked [U] were not verified against source.

# Fidelity ledger

## Reading this ledger

All repository paths below are relative to marginalia-v2-package/ at the pinned commit.

W means the attached RESEARCH-WHITEPAPER-v3(1).md. Its line numbers are attachment line numbers.
S means wayfinder/SPEC-FINAL.md. Its line numbers are repository line numbers.

The whitepaper outranks PRODUCT.md and the derived documents. The governing decisions supplied for this audit outrank all of them.

“Reachable” means that the inspected source contains a reader-action chain. It does not mean that I ran that chain, that a browser accepted it, or that a live provider completed it.

The reachability column is an assessment. The code column contains source facts. The last column contains recommendations.

“None” means no implementation or qualifying test was established in the inspected sources. It is not a repository-wide absence proof. Those absence assessments are marked [U].

Test filenames are under tests/. A mounted-control test counts, with its fixture limitations. An API journey or an internal unit test does not establish browser-control reachability.

Repeated statements of the same promise are consolidated at their first occurrence. Later sections are cited where they materially extend that promise. Research findings and competitor claims are not treated as implemented features.

## Ledger

| ID | Promise: whitepaper quotation and section | Spec treatment | Code path | Reachability | Evidence | Reader-facing test coverage | What closes the gap |
|---|---|---|---|---|---|---|---|
| 01 | “a definition in this context” — Summary, W9 | Keeps, S7,53,101 | ui/margin-model.ts:21–26; ui/asking/flow.ts:153–190; daemon/jobs/service.ts:35–40 | partial | [V] | margin-entry.test.ts:125–157 covers asking entry, not a live contextual answer | Separate the reachable local quotation from the gated model definition. |
| 02 | “a worked example with real numbers” — Summary, W9 | Keeps, S7,76,102 | ui/margin.ts:384–421; contracts/reply.ts:35–66 | partial | [V] | none | Retain Stage 0 and require an actual reader-to-result acceptance record. |
| 03 | “a small model you can move” — Summary, W9 | Keeps, S63,76,102 | renderer/index.ts:278–325; ui/margin.ts:676–715 | partial | [V] | none | Demonstrate the production generation path, not just rendering saved data. |
| 04 | “a diagram whose parts point back into the sentence” — Summary, W9 | Keeps, S7,76 | contracts/reply.ts:54–60; renderer/index.ts:200–217 | partial | [V] | none | Require and render meaningful bindings for edges as well as nodes. |
| 05 | “a check of what a claim rests on” — Summary, W9 | Keeps, with release gate, S76,104 | renderer/index.ts:416–431; daemon/codex-policy.ts:162–185 | partial | [V] | none | Build the separately consented retrieval path; retain support assessment as a separate operation. |
| 06 | “a link to something you already read” — Summary, W9 | Keeps “related,” S47; search deferred, S106 | webapp/main.ts:39–69 provides saved-thread navigation, not matching | partial | [V] | none | Add a bounded, attributed library match; do not substitute an unrelated reading shelf. |
| 07 | “The page itself is never rewritten.” — Summary, W9 | Keeps, S7,33 | extension/entrypoints/content.ts:24–37,86–105 | reachable | [V] | none | Preserve original page nodes; add real-browser source, selection and layout assertions. |
| 08 | “a thread you can come back to next week” — Summary, W9 | Keeps, S7,99,112 | ui/margin.ts:930–990; ui/persistence.ts:44–53 | partial | [V] | margin-entry.test.ts:42–62 covers draft remount, not the whole week-later promise | Complete durable attachment reporting and return-position navigation. |
| 09 | “Your own Codex authors the help; your browser runs it.” — Summary, W9 | Keeps, S61,93 | daemon/jobs/service.ts:325–425; renderer/index.ts:43–75 | partial | [V] | none | Do not call the configured-but-gated provider route operational. |
| 10 | “a browser extension” — Summary, W11 | Keeps, S33 | extension/entrypoints/content.ts:7–105; extension/entrypoints/panel/main.ts:20–59 | partial | [V] | none | Record installed-browser runs on all three operating systems. |
| 11 | “stored on your computer” — Summary, W11 | Keeps, S84 | ui/persistence.ts:22–53; daemon/store.ts:61–91 | partial | [V] | margin-entry.test.ts:24–62 covers controlled local persistence | Include source copies, caches and pending work in storage disclosure. |
| 12 | “export as plain files” — Summary, W11 | Narrows launch to JSON, S84,99 | ui/margin.ts:930–941; ui/library/index.ts:239–267,358–382 | partial | [V] | none | Keep existing JSON; add Markdown and explicit source-inclusion choices. |
| 13 | “shows you exactly what goes” — Summary, W11 | Keeps first-site review, S85 | ui/consent.ts:38–50; daemon/jobs/envelope.ts:35–78; daemon/jobs/send-checkpoint.ts:8–29 | partial | [V] | none; journey-e2e.test.ts:75–101 is API integration | Preserve every-request review, recipient binding and the final exact-request check. |
| 14 | “whose parts each say whether they were quoted, computed, an analogy or fetched” — Problem, W29 | Keeps, S27,72–76 | contracts/reply.ts:20–30,97–112; renderer/index.ts:246–265,416–431 | partial | [V] | none | Add complete per-part origin coverage; source bindings alone are not that coverage. |
| 15 | “a column that runs beside the page and scrolls with it” — What it does, W35 | Keeps, S39–49 | ui/margin.ts:170–185,788–835; extension/entrypoints/panel/main.ts:20–40 | partial | [V] | none | Distinguish synchronized reading position from literal page-coupled scrolling. |
| 16 | “One or two lines from the page's own metadata” — Top, W37 | Keeps, S41 | ui/margin.ts:94–105 | partial | [V] | none | Display available author/date/venue; do not invent missing metadata. |
| 17 | “three to five terms the page uses without defining” — Top, W37 | Keeps behind permission, S41,89,105 | none | missing | [U] | none | Add an explicitly reviewed operation and bounded cache; a site grant alone cannot authorize it automatically. |
| 18 | “the venue comes from Semantic Scholar” — Top, W37 | Silent about this recipient and lookup | none | missing | [U] | none | Name the recipient and exact outgoing title before a lookup. |
| 19 | “'you were here' takes you back” — Top, W37 | Keeps, S41 | ui/margin.ts:94–126,818–822; ui/persistence.ts:38–41 | missing | [V] | none | Add M6/M7; draft position is not a reading bookmark. |
| 20 | “this collapses to one line” — Top, W37 | Narrows to a header size cap, S41 | ui/margin.ts:94–105 | partial | [V] | none | Collapse the header after reading begins without hiding its accessible identity. |
| 21 | “Your notes and highlights sit in page order, always.” — Middle, W39 | Keeps, S43 | ui/margin-model.ts:6–14; ui/margin.ts:533–607 | reachable | [V] | none | Add mounted tests for moved, ambiguous and same-position anchors. |
| 22 | “replies are indented beneath the note or selection” — Middle, W39 | Keeps, S43,80 | ui/margin.ts:570–607,676–715 | reachable | [V] | margin-entry.test.ts:145–171, controlled reply boundary | Preserve ordering when replies are removed, restored or replaced. |
| 23 | “A single 'write here' line follows your reading position.” — Middle, W39 | Keeps, S43 | ui/margin.ts:210–245,293–330 | reachable | [V] | margin-entry.test.ts:24–40 | Keep the one editor; add durable reading position separately. |
| 24 | “one section away is one line; further away is a tick” — Middle, W39 | Keeps, S43 | ui/margin.ts:245–292; ui/margin-model.ts:6–14 | partial | [V] | margin-entry.test.ts:172–190 is partly model-level | Add mounted and narrow-screen evidence for size, ordering and unfaded ink. |
| 25 | “nothing moves under your hands” — Middle, W39 | Keeps, S45 | ui/margin.ts:203–245,818–835; ui/note-editor.ts:54–68 | partial | [V] | margin-entry.test.ts:24–40; margin-note-editor.test.ts:47–54 | Cover sliders, assumptions, focus and asynchronous reply arrival in the same mounted view. |
| 26 | “Threads on this page, related things in your library, save, park, hear it.” — Bottom, W41 | Keeps, S47 | ui/margin.ts:219–225,334–341; webapp/main.ts:39–69 | partial | [V] | none | Keep working save/park; distinguish missing related items and listening from available actions. |
| 27 | “'think with it' and 'go further'” — Bottom, W41 | Keeps, S47 | ui/margin.ts:219–225,379–383 | partial | [V] | none | Preserve the draft entry; complete explicit review and the gated web path. |
| 28 | “ticks for your marks, rules for sections” — Rail, W43 | Keeps, S49 | ui/margin.ts:94–121,245–292 | partial | [V] | margin-entry.test.ts:24–40 checks one retained map | Add real layout and keyboard evidence; do not equate a map model test with the rail. |
| 29 | “Selecting sends nothing.” — Asking, W47 | Keeps, S53 | extension/entrypoints/content.ts:39–51; ui/margin.ts:343–350 | reachable | [V] | margin-entry.test.ts:125–144 | Preserve this when Stage 0 suggestions are merged. |
| 30 | “A small card appears at the anchor with Keep and Ask.” — Asking, W47 | Keeps, S53 | ui/margin.ts:343–359; extension/entrypoints/content.ts:24–51 | partial | [V] | margin-entry.test.ts:125–144 | The actions exist; replace automatic full-margin opening with the G10 selection treatment. |
| 31 | “quoted, marked 'from this page'” — Asking, W47 | Keeps, S53 | ui/margin-model.ts:21–26; ui/margin.ts:343–350 | reachable | [V] | none | Keep the literal detector’s limits visible; do not imply all page definitions are found. |
| 32 | “a short definition arrives on its own” — Asking, W47 | Keeps opt-in automatic definitions, S53,89 | none | missing | [U] | none | Identity question under G8; remote automatic sending conflicts with the governing review rule. |
| 33 | “at most three suggestions” — Asking, W47 | Keeps, S53 | ui/margin.ts:384–421; ui/asking/mount.ts:92–111 | partial | [V] | none | Unify the two suggestion surfaces; add the time word and exposure record. |
| 34 | “a first frame marked provisional until its checks pass” — Asking, W47 | Keeps, S55,74 | ui/asking/flow.ts:278–335; renderer/index.ts:239–244 | partial | [V] | none | Demonstrate partial-file arrival through the mounted production route. |
| 35 | “cancel always visible” — Asking, W47 | Keeps, S55 | ui/asking/mount.ts:137–190; daemon/jobs/service.ts:430–490 | partial | [V] | none | Test cancel during preparation, generation, validation and disconnection in the reader surface. |
| 36 | “one clarifying question at most” — Asking, W47 | Keeps, S55,76 | contracts/reply.ts:65–68; renderer/index.ts:396–416 | partial | [V] | none | Establish a thread-level limit; the existence of a question block does not prove the limit. |
| 37 | “a line you can open and change” — Asking, W47 | Keeps, S55,74 | renderer/index.ts:486–510 | partial | [V] | none | Distinguish changing a numerical input from asking to change the model. |
| 38 | “a prescribed incompressible velocity field” — Demonstration, W52 | Narrows to the scalar fixture, S103,114 | none established for the spatial illustration | missing | [U] | none | Build the spatial illustration or explicitly narrow the demonstration; the scalar model is not equivalent. |
| 39 | “Illustration of the mechanism.” — Demonstration, W53 | Keeps a visible illustration sentence, S74 | contracts/reply.ts:97–112; renderer/index.ts:239–244 | partial | [V] | none | Require an honest purpose statement; an optional flag does not establish illustration fidelity. |
| 40 | “Each variable name lights the phrase it stands for” — Demonstration, W53 | Keeps, S45 | renderer/index.ts:200–217; ui/margin.ts:788–816 | partial | [V] | none | Exercise actual bindings in the extension, including keyboard focus and ambiguous anchors. |
| 41 | “Its result sentence comes from the exact rule” — Demonstration, W54 | Keeps, S72,114 | renderer/index.ts:114–149,239–265; contracts/reply.ts:1–2 | partial | [V] | none | Keep the checked scalar criterion; do not claim an executed scientific reproduction. |
| 42 | “The picture updates in place; nothing is sent.” — Demonstration, W55 | Keeps local interaction, S63; model edits differ, S55 | renderer/index.ts:174–180,278–325 | partial | [V] | none | Preserve zero-model numerical changes and explicit model revision as different actions. |
| 43 | “Next month, on the Euler paper, the margin says” — Demonstration, W56 | Narrows to “related,” S47 | none | missing | [U] | none | Add a source-linked cross-document match, not generic recommendations. |
| 44 | “what supports it, with sources and dates, and what is contested” — Asking, W58 | Keeps support/source/date, S76; contention less explicit | renderer/index.ts:416–431; contracts/reply.ts:68–74 | partial | [V] | none | Add supported/contested/unresolved distinctions backed by inspected evidence. |
| 45 | “On a step in a procedure, it gives a runnable example.” — Asking, W58 | Keeps through blocks and solver, S65,68,76 | contracts/reply.ts:65–92; daemon/jobs/solver-gate.ts:60–116 | partial | [V] | none | Complete the gated saved-execution route; no silent model retry. |
| 46 | “A reply is data, not code.” — Replies, W62 | Keeps, with precise later-surface qualification, S70 | contracts/reply.ts:146–185; renderer/index.ts:43–75 | partial | [V] | none | Preserve bounded rendering; audit remaining accepted fields before making a universal security claim. |
| 47 | “the solver Codex already wrote is run again” — Replies, W62 | Keeps, S65 | ui/margin.ts:676–715,761; daemon/server.ts:38–52; daemon/jobs/solver-gate.ts:60–116 | contradicted | [V] | none | Replace “not connected” copy with the actual blocked state; do not bypass the gate. |
| 48 | “that is shown as an action, never hidden behind a slider” — Replies, W62 | Keeps, S66 | renderer/index.ts:174–185,220–235,486–510 | partial | [V] | none | Preserve separate “run again” and reviewed “ask again” routes after Stage 0. |
| 49 | “the margin's own engine is the default path, not the ceiling” — Replies, W62 | Keeps, S68 | contracts/reply.ts:65–92; daemon/jobs/solver-gate.ts:60–116 | partial | [V] | none | Keep explicit unsupported states while alternative execution remains gated. |
| 50 | “Every reply is checked before it renders” — Replies, W62 | Keeps, S72 | daemon/store.ts:254–286; renderer/index.ts:43–59 | partial | [V] | none | State which checks ran; shape validation is not scientific correctness. |
| 51 | “A result sentence must be backed by one of those checks” — Replies, W62 | Keeps, S72 | renderer/index.ts:239–244 | contradicted | [V] | none | Unclassified titles and summaries still render directly; require typed result claims or label them unassessed. |
| 52 | “no conclusion beyond the shown interval” — Replies, W62 | Keeps, S76 | renderer/index.ts:114–149; contracts/reply.ts:115–132 | partial | [V] | none | Cover unsupported criteria and changed parameters in the actual reader view. |
| 53 | “A reply that fails is a plain sentence” — Replies, W62 | Keeps, S74 | renderer/index.ts:43–59; ui/asking/flow.ts:278–335 | partial | [V] | none | Distinguish failed checks, unavailable checks and transport failure. |
| 54 | “'source passage' and 'how this was made'” — Replies, W62 | Keeps, S74 | renderer/index.ts:246–265 | reachable | [V] | none | Preserve these controls; replace their engineering-heavy explanatory copy. |
| 55 | “plain text attached to a passage or a section you chose” — Notes, W66 | Keeps, S80 | ui/margin.ts:227–245,293–330; ui/note-editor.ts:19–35 | reachable | [V] | margin-entry.test.ts:24–62; margin-note-editor.test.ts:80–91 | Add multiple attachments separately; retain the current single attachment. |
| 56 | “freezes when you start typing” — Notes, W66 | Keeps, S80 | ui/margin.ts:293–330; ui/persistence.ts:38–41 | reachable | [V] | margin-entry.test.ts:24–40 | Do not use future reading-position changes to rewrite a draft’s attachment. |
| 57 | “a question mark offers it; it never sends on its own” — Notes, W66 | Keeps, S80 | ui/note-editor.ts:34–49 | reachable | [V] | margin-note-editor.test.ts:55–74 | Preserve the explicit review step after the offer. |
| 58 | “the reply quotes the version of the note it answers” — Notes, W66 | Keeps, S80,113 | daemon/store.ts:254–286; ui/margin.ts:670–690 | partial | [V] | margin-entry.test.ts:145–171 covers selected note context | Test a note edited after send and the returned reply’s historical quotation. |
| 59 | “used the word, looked it up, or told it to skip” — Notes, W66 | Keeps, S80 | daemon/library.ts:78–91; ui/library/index.ts:220–237 | partial | [V] | none | G2 and M3: write distinct origins; do not collapse them into familiarity. |
| 60 | “It does not build a model of what you understand” — Memory, W70 | Purpose is compatible; not stated as clearly | ui/margin-model.ts:6–26 contains no comprehension model; wider absence not established | partial | [U] | none | Preserve this prohibition explicitly in contracts and product copy. |
| 61 | “The original is always visible.” — Rule 1, W76 | Keeps, S7,33 | extension/entrypoints/content.ts:24–37; renderer/index.ts:268–276 | partial | [V] | none | Test expanded replies and the narrow sheet without disguising the original. |
| 62 | “Nothing you can ask for is ever removed because of it.” — Rule 4, W79 | Implicitly keeps all transforms, S68 | contracts/reply.ts:135–141 | partial | [V] | none | Keep context out of eligibility; capability and permission are legitimate gates. |
| 63 | “stays quiet when you are not, and you set that dial” — Rule 5, W80 | Silent about the dial | none | missing | [U] | none | Identity question: retain the posture control as a future promise, not an inferred setting. |
| 64 | “A claimed reproduction stops when data is missing.” — Rule 6, W81 | Narrows to generic unsupported cases, S68 | none established | missing | [U] | none | Add a reproduction contract with required inputs and a stop state. |
| 65 | “A saved explanation is never later mistaken for evidence.” — Rule 7, W82 | Keeps authority distinctions, S72,76 | daemon/jobs/service.ts:300–323; renderer/index.ts:416–431 | partial | [V] | none | Preserve generated-work labels when library retrieval is added. |
| 66 | “Threads, journeys and the journal are your record” — Rule 8, W83 | Threads kept; journeys and reader journal silent | ui/journal.ts:1–44 is a mutation journal, not the promised reader journal | partial | [V] | none | Build the reader-facing grouping and journal later; retain the existing persistence machinery. |
| 67 | “Any provider, any key, local models, or your own agent” — Rule 9, W84 | Narrows launch to Codex; local models roadmap, S93,106 | daemon/main.ts:26–78; daemon/library.ts:8–74 | partial | [V] | none | Identity question: preserve provider portability without pretending adapters exist. |
| 68 | “Thread states are observations, not verdicts.” — Rule 10, W85 | Keeps state vocabulary, S15–24 | ui/margin.ts:570–607; ui/library/index.ts:93–129 | reachable | [V] | none | Keep “done” as a reader state, never a knowledge score. |
| 69 | “underline candidate terms from surprisal” — Research, W91 | Silent | none | missing | [U] | none | Keep opt-in and local; first measure download, memory and latency. |
| 70 | “a proxy that has to be validated against our own readers” — Research, W93 | Silent | none | missing | [U] | none | This needs a study, not a claim attached to an untested difficulty model. |
| 71 | “every form is checked before it renders” — Research, W95 | Keeps, S72,76 | contracts/reply.ts:146–220; daemon/store.ts:254–286 | partial | [V] | none | Separate structural checks from kind-specific fidelity and correctness. |
| 72 | “the dial is yours and the default is quiet” — Research, W97 | Silent about posture/default | none | missing | [U] | none | G8 must not turn a stored permission into an automatic remote action. |
| 73 | “the better first offer is a question or a critique” — Research, W99 | Narrows to context-sensitive suggestions, S57 | ui/margin.ts:384–421 | partial | [V] | none | Add explicit stated-context ordering, not inferred expertise. |
| 74 | “re-selection and scroll-back are logged” — Research, W101 | Silent | none | missing | [U] | none | Do not add this telemetry inside the position bookmark packet. |
| 75 | “an ambient policy, off by default” — Suggestions, W129 | Narrows to permission-gated automatic features, S89 | none | missing | [U] | none | Keep ambient activation separate from suggested-answer ranking. |
| 76 | “The score itself is additive and plain” — Suggestions, W131 | Narrows to inputs, S57 | ui/margin.ts:384–421 has fixed suggestions | partial | [V] | none | Stage 1 records honest fixed-policy exposure; do not call it learned ranking. |
| 77 | “The only hard filter is eligibility” — Suggestions, W143 | Partly keeps via provider and permission policy, S68,89 | contracts/reply.ts:135–141; ui/asking/flow.ts:153–190 | partial | [V] | none | Distinguish rendering permissions from an actually available execution route. |
| 78 | “they do not move under your pointer” — Suggestions, W143 | Keeps, S57 | ui/asking/mount.ts:92–111 | partial | [V] | none | Freeze one visible set and its labels; add a separate “More ideas” action. |
| 79 | “A note changes the score” — Suggestions, W145 | Keeps note/page context, S57,80 | ui/margin.ts:363–397 | partial | [V] | none | The note is attached, but that is not evidence of note-sensitive ranking. |
| 80 | “records what was eligible, what was shown where” — Suggestions, W147 | Silent about the exposure record | ui/asking/mount.ts:92–111,184–194; ui/asking-host.ts:210–245 | built-unreachable | [V] | none | Wire the existing hook, record actual visibility, and retain no-choice outcomes. |
| 81 | “a form you can open, edit and export” — Memory of work, W151 | Keeps threads/notes/export, S80,84,99 | ui/margin.ts:570–607,930–941; ui/library/index.ts:118–129,358–382 | partial | [V] | none | Extend ownership controls to individual replies, words and later journey records. |
| 82 | “the three origins are kept apart” — Vocabulary, W153 | Keeps, S80 | daemon/store.ts:61–75; daemon/library.ts:78–91 | partial | [V] | none | Support multiple origins for a word without replacing one with another. |
| 83 | “The fields you named at setup seed a weak prior.” — Vocabulary, W153 | Silent | none | missing | [U] | none | Identity question; keep optional and explicitly supplied. |
| 84 | “a page in settings you can edit or delete from” — Vocabulary, W153 | Keeps deletion, S80; editing less explicit | ui/library/index.ts:220–237,382–405 | partial | [V] | none | Keep existing deletion; add the approved write/edit path and origin links. |
| 85 | “It decides what gets underlined, nothing more” — Vocabulary, W153 | Narrows to “what needs defining,” S80 | none established for vocabulary-driven underlining | missing | [U] | none | Do not let vocabulary remove actions or assert comprehension. |
| 86 | “You supply context where it helps” — Stated context, W155 | Keeps note context, S57,80 | ui/margin.ts:384–421 | reachable | [V] | margin-entry.test.ts:125–144 | Keep context optional and visible in the exact outgoing review. |
| 87 | “reattaches when the page is reopened and survives edits” — Threads, W157 | Keeps, S99,112–113 | daemon/server.ts:192–197; daemon/store.ts:226–247; ui/margin-model.ts:10–19 | partial | [V] | none | Wire the persistence client without replaying questions or guessing ambiguous matches. |
| 88 | “accepted or renamed by you” — Journeys/topics, W159 | Silent | none | missing | [U] | none | Reader-confirmed grouping; no automatic reassignment of threads. |
| 89 | “A journal written for you, not consulted by the system” — Journal, W159 | Silent | none | missing | [U] | none | Keep it separate from the internal mutation journal and from model context. |
| 90 | “Save any page or PDF with a snapshot.” — Library, W161 | Narrows supported pages; PDF explicitly deferred, S33,35,106 | daemon/store.ts:176–196; webapp/main.ts:70–110 | partial | [V] | none | Add own-document import and a PDF viewer; do not call PDF a silent spec omission. |
| 91 | “in the W3C annotation format so they move to Hypothesis or back” — Library, W161 | W3C selectors kept, S33; interchange silent | none established for interchange | missing | [U] | none | Test real import/export compatibility, not merely similarly shaped selectors. |
| 92 | “Search across everything you saved, with answers that cite the passage” — Library, W161 | Explicitly deferred, S106 | daemon/store.ts:61–75,176–188; webapp/main.ts:65–69 | built-unreachable | [V] | none | FTS storage is not a reader search surface or a cited answer. |
| 93 | “'Related in your library' on every page you open” — Library, W161 | Keeps, S47 | none | missing | [U] | none | Add local matching and attributed source excerpts before model-assisted synthesis. |
| 94 | “Export to Markdown and JSON” — Library, W161 | JSON now, Markdown next, S84 | ui/library/index.ts:239–267,358–382; daemon/store.ts:359–377 | partial | [V] | none | Extend existing export; do not rebuild it. |
| 95 | “Obsidian and Zotero connections” — Library, W161 | Silent | none | missing | [U] | none | Start with explicit file export and tested interoperability; no replacement claim. |
| 96 | “Nothing is ever suppressed by it.” — Posture, W163 | Silent about posture | none | missing | [U] | none | Preserve all ask types when posture is eventually introduced. |
| 97 | “Which replies you tend to take ... is inferred from your clicks.” — Inference, W165 | Silent about learning preferences | none | missing | [U] | none | Collect valid local exposure first; no fitted-personalization claim in Stage 1. |
| 98 | “If a reply is corrected, everything derived from it is marked.” — Saved explanations, W167 | Parent/version concepts kept, S93; propagation silent | daemon/store.ts:254–286 stores relationships, not established invalidation propagation | partial | [V] | none | Add dependency marking without deleting the reader’s notes. |
| 99 | “reading and note-taking work with no helper and no account” — Privacy, W171 | Keeps, S84 | ui/margin.ts:293–341,930–990; ui/persistence.ts:44–65 | reachable | [V] | margin-entry.test.ts:24–62 | Retain helperless operation through every new Stage 1 control. |
| 100 | “separately from the dot that means 'working'” — Privacy, W171 | Keeps, S85 | ui/margin.ts:515–522; daemon/consent/service.ts:223–254 | contradicted | [V] | none | M4 must replace phase-derived “Sending”; Stage 2 provides two distinct indicators. |
| 101 | “this time, always on this site, or never on this site” — Privacy, W171 | Keeps, S85 | ui/consent.ts:51–65; daemon/consent/service.ts:201–254 | partial | [V] | none | Explain that remembered permission never removes the exact-request review. |
| 102 | “its network switched off, and a test proves it” — Privacy, W171 | Repeats, S86,115 | daemon/codex-policy.ts:174–185; daemon/consent/evidence-host.ts:1–35; ui/consent.ts:50 | contradicted | [V] | none | Correct the certainty in copy; retain the falsify-only collector and blocked execution. |
| 103 | “a second, narrower permission per site” — Privacy, W171 | Keeps, S86–87 | ui/consent.ts:49; daemon/codex-policy.ts:162–185; daemon/consent/service.ts:309–336 | contradicted | [V] | none | G1: a scope label and fetch-record method are not a functioning fourth path. |
| 104 | “Provider credentials never enter the browser” — Privacy, W171 | Keeps, S89 | extension/entrypoints/background.ts:10–18; ui/helper.ts:43–103 | partial | [V] | margin-entry.test.ts:102–114 covers embedded credential exclusion only | Preserve the trust boundary; complete installed-browser credential inspection. |
| 105 | “source excerpts excluded by default and previewed” — Sharing, W173 | Silent about sharing | none | missing | [U] | none | Do not label a full private JSON backup as a safe share. |
| 106 | “a settings pane that states each provider's retention terms” — Privacy, W175 | Silent | none | missing | [U] | none | Add dated provider-specific disclosures; do not invent retention guarantees. |
| 107 | “local logging does not authorize upload” — Evaluation, W189 | Silent about research upload | none established for a research-upload path | missing | [U] | none | Keep exposure records local; research export needs a separate content review and choice. |
| 108 | “an identical floating panel” — Surfaces, W197 | Keeps, S33 | extension/entrypoints/panel/main.ts:29–55; extension/entrypoints/background.ts:73–145 | partial | [V] | none | Preserve the trusted-tab handoff; do not grant an embedded page privileged sending. |
| 109 | “the vocabulary and the exposure log from the first day” — Alpha, W206 | Vocabulary kept; exposure silent | daemon/library.ts:78–91; ui/asking/mount.ts:92–111 | partial | [V] | none | M3 and the suggestion packet, with actual rather than synthetic exposure. |
| 110 | “a fresh-machine install is part of the recorded run” — Launch, W202 | Keeps, S108,119 | package.json:6–17 exposes development commands; no installer established | missing | [U] | none | Native first-run evidence on Windows, Linux and macOS. |
| 111 | “Local models and the official Claude CLI behind the same router” — After launch, W208 | Local models deferred, S106; Claude silent | none established | missing | [U] | none | Retain as future adapters; do not confuse model-name settings with provider support. |
| 112 | “cached by content hash, and show in a per-day spend line” — Risks, W218 | Silent about caching/spend | none | missing | [U] | none | Add only with the corresponding reviewed lookup operation. |
| 113 | “a short-lived six-digit challenge” — Appendix A, W260 | Pairing kept, S100 | ui/helper.ts:33–36,99–105; daemon/server.ts:105–150 | partial | [V] | none | Exercise challenge expiry and revocation through installed setup, not only route tests. |
| 114 | “truncation deterministic and flagged, never silent” — Appendix A/B, W270,337 | Narrows to bounded context, S85 | daemon/jobs/envelope.ts:35–78 | partial | [V] | none | Inspect the remaining context builder; test omissions in the actual consent sheet. |
| 115 | “never retried on its own” — Appendix A, W273 | Keeps, S93,116 | daemon/jobs/service.ts:85–145; ui/asking-host.ts:280–329 | partial | [V] | none; journey-e2e.test.ts:169–202 is API integration | Test reopening and reconnecting in the installed reader without start/resume calls. |
| 116 | “tombstoned rather than deleted on removal” — Appendix A, W276 | Keeps, S19,74 | daemon/store.ts:300–313; ui/margin.ts:570–607 | partial | [V] | none | Add per-reply and per-note removal without removing their parent thread. |
| 117 | “Page text, fetched pages and skill instructions are treated as data” — Appendix A, W280 | Keeps, S89 | daemon/jobs/envelope.ts:30–78; daemon/codex-policy.ts:174–185 | partial | [V] | none | Preserve external enforcement; prompt wording does not prove isolation. |
| 118 | “a diagram maps nodes and edges to source spans” — Appendix B, W331 | Narrows to diagram nodes/edges/groups, S76 | contracts/reply.ts:54–60 | partial | [V] | none | Edge-level source bindings and a fidelity test are still required. |
| 119 | “an update is a permission change” — Appendix C, W349 | Silent about installed-skill updates | none established | missing | [U] | none | Keep user-installed skills deferred behind a separate versioned permission design. |
| 120 | “Words used in code ... never appear on screen.” — Appendix A, W226 | Keeps a specific prohibited vocabulary, S29 | renderer/index.ts:258–260; ui/margin.ts:761 | contradicted | [V] | none | Replace product-authored engineering copy; never alter the exact outgoing review to conceal its contents. |

## Contradictions

### 47 — “not connected” versus a connected but blocked saved-execution route

Exact copy:
“Saved-solver execution is not connected here. Follow-ups require a separate host-prepared review.”

Copy: ui/margin.ts:761.
Connected callback: ui/margin.ts:676–715.
Mounted refusal gate: daemon/server.ts:38–52; daemon/jobs/solver-gate.ts:60–116. [V]

The callback exists. The production gate still refuses execution. These are separate facts.

Replace the sentence with a state supplied by the gate. Proposed reader copy:
“This example cannot run again here yet. Your notes and current inputs are unchanged.”

### 51 — universal checked-result promise versus unrestricted descriptive fields

Exact code:
const hasClassification = reply.blocks.some(block => block.type === 'classification');
const title = el(doc, 'h3', hasClassification ? 'Interactive explanation' : reply.title);
if (!hasClassification) article.append(el(doc, 'p', reply.summary));

Code: renderer/index.ts:239–244. [V]

The classification route protects its headline. A reply without a classification can still place a result claim in its title or summary.

This does not establish that every such title is wrong. It establishes that the universal admission rule is not enforced by this branch.

### 100 — one phase-derived status instead of two record-backed indicators

Exact code:
const text = value.sending ? 'Sending' : working ? 'Working' : ...
activityButton.hidden = !text;
activityButton.dataset.sending = String(value.sending);

Code: ui/margin.ts:515–522. [V]

The control receives asking-flow state. It does not read an egress record in this handler.

Existing durable records are written elsewhere:
daemon/consent/service.ts:223–254. [V]

Replace the sending source of truth. Do not merely add another differently coloured dot.

### 102 — a requested restriction presented as an observed fact

Exact copy:
“Codex is a cloud service. Tool network access stays closed for this request; necessary model-service traffic is separate.”

Copy: ui/consent.ts:50.

Exact requested policy:
networkAccess: false

Policy: daemon/codex-policy.ts:175–176.
Unobserved host boundary: daemon/consent/evidence-host.ts:1–35. [V]

The configuration request is established. Confinement is not.

### 103 — a web permission presented as a working web path

Exact copy:
“This also permits separate web access for this site. Fetched pages are recorded; the record says incomplete if another route could fetch outside the observed broker.”

Copy: ui/consent.ts:49.

Accepted operations are definition, generation and saved-solver:
daemon/codex-policy.ts:162–165.

Both resulting policy branches request network access off:
daemon/codex-policy.ts:174–185. [V]

Recording supplied fetch facts is not itself a broker:
daemon/consent/service.ts:309–336. [V]

### 120 — engineering language in product-authored explanations

Exact copy includes:
“The packaged renderer runs bounded local calculations.”
“No current host verification is displayed here.”
“A genuine host report is bound to this reply and current inputs.”

Code: renderer/index.ts:258–260. [V]

Proposed reader copy:
“The calculations run on this device.”
“No checked conclusion is available for these inputs.”
“This conclusion was checked for the inputs shown.”

The last sentence may appear only when the matching check actually authorizes that conclusion.

## Other source disagreements

PRODUCT.md:13 says that Marginalia learns what the reader knows and adapts section depth.
W70,151,165 reject a hidden understanding model and inferred hiding. The whitepaper wins.

S3 says the spec governs when documents differ.
The hierarchy supplied for this audit says the whitepaper wins. Apply the supplied hierarchy.

W55 changes an input range without sending. W275 says editing an assumption creates another request.
Resolve the distinction explicitly: numerical exploration stays local; changing the model or interpretation opens another review.

S35,106 explicitly defer PDF. The state document's description of PDF as a silent cut is inaccurate for this spec. General own-file opening is much less explicit.

The whitepaper and S53 permit opted-in automatic model definitions. The governing every-request review decision disallows that sending behaviour. G8 must respect the governing decision.

## Built but never asked for

No inspected module can be responsibly classified as unrequested merely because its reader surface is unfinished. A complete repository-wide orphan inventory was not established. [U]

The following apparent candidates should NOT be placed on a deletion list:

| Module | Approximate size | Promise served | Disposition |
|---|---:|---|---|
| ui/journal.ts | roughly 500 lines [U] | Helperless persistence and recovery, S84,93; its actual state contains threads, pending mutations and conflicts at lines 1–44 [V] | Keep. It is not the future reader-facing journal. |
| daemon/consent/service.ts | roughly 500 lines [U] | Exact approval, denial and egress, S85–89; dispatch transaction at lines 223–254 [V] | Keep. Extend, do not replace. |
| daemon/jobs/solver-gate.ts | roughly 140 lines | Explicit saved execution, S65; refusal and claim handling at lines 60–116 [V] | Keep gated. |
| ui/persistence.ts | total not counted [U] | Local drafts, retained work and conflict handling, S84,93; lines 22–65 [V] | Keep. Do not mistake recovery machinery for speculative sync. |

The state document's approximate “4,500 lines” is not a source-level deletion argument.

## Promises the spec dropped silently and for which no code was established

The provisional list is:
18 venue lookup; 63 posture dial; 69 optional surprisal underlining; 70 reader validation of that proxy; 72 quiet posture default; 74 behavioural signal log; 75 separate ambient policy; 83 setup field prior; 88 journeys/topics; 89 reader journal; 91 annotation interchange; 95 Obsidian/Zotero connections; 96 posture without suppression; 97 learned reply preference; 105 safe sharing; 106 provider retention disclosure; 107 separate research-upload consent; 112 lookup cache/spend; 119 installed-skill update permissions. [U]

These are absence assessments over the inspected material, not proof that no branch or archived implementation exists.

PDF and library search are excluded from this list because S106 explicitly defers them.

## Ten-row recheck

The corrected table above incorporates these changes:

1. Row 13: retained “partial.” Exact reviewed parts and final binding exist; no live transmission was observed.
2. Row 19: changed the interpretation of stored position. A note draft's position is not “You were here.”
3. Row 32: retained the missing implementation but added the governing-rule conflict. A site grant cannot replace each-send review.
4. Row 33: removed the stale claim that the margin shows an unbounded set. The inspected margin already shows three fixed suggestions.
5. Row 47: changed “unconnected solver” to connected-but-blocked, while retaining the contradictory copy finding.
6. Row 51: narrowed the defect. Checked classifications have protection; unclassified title/summary fields remain outside that protection.
7. Row 87: retained “partial,” not “missing.” The route and store operation exist; the inspected helper client lacks the call.
8. Row 94: changed “export absent” to JSON present, Markdown absent.
9. Row 100: changed “egress absent” to durable egress present, reader indicator not record-driven.
10. Row 103: separated permission storage, fetch-record storage and actual retrieval. Only the first two were established.

The API journey test was also removed from reader-control coverage. It invokes routes directly.
```

## `OWNER-DECISIONS-2026-09-18.md`

```markdown
Commit: 0360a1c
Items marked [U] were not verified against source.

# Owner decisions

All repository paths are relative to marginalia-v2-package/.
W refers to the attached whitepaper. S refers to wayfinder/SPEC-FINAL.md.

Recommendations below are not recorded owner approvals.

Size labels describe proposed changed code, not measured effort:
small: approximately 50–150 lines; medium: 150–500; large: more than 500. All size estimates are [U].

## G1 — The network promise

Whitepaper:
“what supports this and go further need it, which is a second, narrower permission per site” — W171.

Today:
ui/consent.ts:49 promises web access. daemon/codex-policy.ts:162–185 accepts three operations and requests network off for both policy branches. Consent and egress storage exist at daemon/consent/service.ts:223–254,309–336. [V]

Options:
A. Correct copy and withhold web execution. Readers get honest limits but not the promised evidence workflow. Small: ui/consent.ts and related state copy.
B. Correct copy now and build a distinct brokered web operation. Readers later inspect both their question and each external destination. Large: policy, consent, jobs, a broker, reply evidence and UI.
C. Give ordinary generation general network access. This weakens the four-path contract. Reject.

Recommend B because checking what a claim rests on is a founding form of help, not an optional synonym for explanation.

Blocked:
Web execution, complete-fetch claims and web-dependent suggestions. Closed definition/generation must not acquire web access as a shortcut.

## G1 — Required shape of the fourth path

The fourth path is `consented-web`. It is not `generation` with a different boolean.

Its operation identity remains distinct from:
definition, workspace generation and saved-solver recomputation.

Before a model turn, the reader reviews the actual question, excerpt, context, instructions and recipient. Before a retrieval, the reader reviews the proposed URL or query, the receiving service, the request body where applicable, and any source text included.

A changed destination or newly proposed query requires another review. A redirect must either remain within an explicitly reviewed redirect rule or stop for review. Do not treat an initial permission as approval for an unlimited browsing session.

A retrieved page is untrusted input. Sending its contents to a model is another model request whose exact outgoing content is reviewed. “The reader approved fetching it” is not permission to send it elsewhere.

Each outbound record contains:
operation path; request identity; parent operation; reviewed-content identity; recipient; reviewed byte count; observed transmitted byte count when available; approval time; dispatch observation; outcome; grant identity; fetched URL and final URL; response size and content identity; completeness and its reason.

Unknown transmitted byte counts remain unknown. Provider handoff is not relabelled as observed internet traffic.

The sending indicator reads these records. A queued operation, model-generated statement or missing record cannot light it. A lost connection produces “Sending status is unavailable,” not a continuing animated claim.

The reply has separate sections:
“What the source claims”
“What supports it”
“What remains unresolved”
“Pages opened”

Each support statement points to an inspected passage and date. “Pages opened” reports retrieval only. A fetched page may appear there without appearing under support.

Reader copy while unavailable:
“Web checks are not available yet. Nothing will be looked up.”

Reader copy for an incomplete retrieval record:
“Some web activity may be missing from this record. Opening a page does not show that it supports the claim.”

## G2 — What earns a vocabulary entry?

Whitepaper:
“Using a word in a note is evidence of use, not of mastery” — W153.

Today:
The service lists and deletes vocabulary at daemon/library.ts:78–91. The settings view displays origins and deletion at ui/library/index.ts:220–237,382–405. A writer was not found there. [V]

Options:
A. Automatically collect every word in every note. Broad accumulation, but many meaningless entries; medium/large local extraction and correction work.
B. Record completed explicit definition requests, reader-selected words from notes, and explicit skip choices. Clear origins; medium/large contract, service and settings changes.
C. Park vocabulary. Simpler product, but weakens second-document continuity.

Recommend B because the whitepaper asks for memory with visible origins, not inferred mastery.

Blocked:
M3, vocabulary-based underlining and any claim that note-taking already personalizes later documents. Automatic extraction remains a later, separately evaluated extension.

## G3 — Suggestion labels

Whitepaper:
“see it (~1 min), define, what supports this” — W51.

Today:
The pinned margin uses Define this, Show me an example and Explain step by step at ui/margin.ts:384–421. Stage 0 is scheduled to add provisional Move it and Check this in docs/STATE-AND-PLAN-2026-09-18.md:47–57. [V]

Options:
A. Keep Move it / Check this. Short, but “Move it” implies an interaction before one exists.
B. Use See it / Check this, with “about a minute” on See it. Fits the whitepaper's invitation; small shared-copy change.
C. Use Simulate / Evidence. Precise internally, less natural to a general reader.

Recommend B because the label should describe the help the reader seeks, not the machinery producing it.

Blocked:
Final labels and the frozen exposure-policy version. The time phrase is an approximate category, not a measured completion guarantee.

## G4 — Keep versus Highlight

Whitepaper:
“Your notes and highlights sit in page order, always.” — W39.

Today:
Keep creates retained work at ui/margin.ts:334–341. paintHighlights does not consult each thread's highlighted flag at ui/margin.ts:803–807. [V]

Options:
A. Keep and Highlight mean the same thing. Simple, but two names imply a distinction that does not exist; small copy consolidation.
B. Keep saves the passage; Highlight adds a persistent source mark. Readers choose visual emphasis; medium contract, mutation and rendering work.
C. Keep marks every retained passage, with Highlight changing colour. Adds visual vocabulary without a clear need.

Recommend B because ownership of a record should not force a visual change in the reading surface.

Blocked:
Final labels, the persistent-highlight toggle and its migration behaviour. Do not silently clear existing marks.

## G5 — Own documents

Whitepaper:
“Save any page or PDF with a snapshot.” — W161.

Today:
Saved captures can reopen through webapp/main.ts:70–110. The extension content entry accepts HTTP(S) pages at extension/entrypoints/content.ts:7–10. [V]
PDF is explicitly deferred in S35,106; it is not silent.

Options:
A. Web-only product. Smaller, but excludes an explicit whitepaper surface.
B. Add local text/Markdown opening first, then an own-page PDF viewer. Earlier own-document value; large staged import/viewer work.
C. PDF first. Better scientific-paper fidelity, but more parsing, coordinate and accessibility work before ordinary file opening.

Recommend B because the reader's record should attach to their material, while PDF must preserve the original page rather than flatten it.

Blocked:
Import scope, supported file types, PDF acceptance criteria and the release wording. The PDF promise remains on the plan.

## G6 — Keep, park or delete future-facing machinery?

Whitepaper:
“the work stays as a thread you can come back to” — W9.

Today:
ui/journal.ts:1–44 stores pending reader changes and conflicts. Consent finalization is transactional at daemon/consent/service.ts:223–254. The saved-solver gate refuses unsupported execution at daemon/jobs/solver-gate.ts:60–116. [V]

Options:
A. Delete code grouped under “journal, sync, solver, consent.” Risks deleting current ownership and safety mechanisms; large destructive change.
B. Keep active persistence/consent/gates; park unfinished reader features behind explicit availability states. No false availability; small inventory, later bounded wiring.
C. Keep everything and describe all of it as delivered. Misleads readers.

Recommend B because durable work requires these mechanisms even before every reader surface exists.

Blocked:
Deletion packets and claims that a line-count estimate identifies waste. A module-by-module dependency and promise map is required before removal.

## G7 — Grid versus samples

Whitepaper:
“results once over a declared range” — W62.

Today:
The contract's discriminator is `samples`, at contracts/reply.ts:75–86,146. The renderer calls its expandable table “Recorded sample grid” at renderer/index.ts:430–462. [V]

Options:
A. Make grid the canonical contract type. Adds migration and compatibility work without changing the reader's ability.
B. Keep samples as the contract; use grid only for the arrangement of values. Small terminology alignment.
C. Accept both as independent types. Ambiguous validators and persisted data.

Recommend B because the promise is bounded exploration of sampled results, not a particular table shape.

Blocked:
Documentation cleanup and any compatibility migration. Reader copy should describe the usable range, not expose either internal type.

## G8 — Automatic definitions

Whitepaper:
“If you have allowed the site and turned on automatic definitions” — W47.

Today:
Literal local definitions exist at ui/margin-model.ts:21–26. Selection displays them at ui/margin.ts:343–350. No automatic model-definition implementation was established. [V]

Options:
A. Automatically show definitions quoted from the current page. No external recipient; small preference/UI work.
B. Automatically prepare a draft suggestion, but require review and an explicit send for a model definition. More interruption; medium work.
C. Send model requests automatically under a site grant. Conflicts with the governing every-request review rule.

Recommend A, with B available only as draft preparation, because immediate local help serves the whitepaper without taking away the reader's sending decision.

Blocked:
Remote automatic definitions. This recommendation does not authorize option C.

## G9 — The FTS copy and erasure

Whitepaper:
“your record, exportable, on your machine” — W83.

Today:
The search table exists at daemon/store.ts:61–75. Source text is inserted into the search index at daemon/store.ts:176–188. [V]

Options:
A. Drop the index. Reduces one copy but weakens the promised library search; medium migration.
B. Keep it and include it in a documented erase transaction. Preserves search; large work once caches, jobs and backups are included.
C. Retain it but call ordinary Remove an erase. Misleading.

Recommend B because an owned reading library needs both useful retrieval and an honest account of retained copies.

Blocked:
Any permanent-erasure claim. Tombstones, SQLite recovery files, browser caches and exports must be distinguished from secure physical erasure.

## G10 — Selection and dead ends

Whitepaper:
“Select text. Selecting sends nothing. A small card appears at the anchor” — W47.

Today:
Selection calls hold and showPanel at ui/margin.ts:343–350. The extension also opens a surface on selection at extension/entrypoints/content.ts:39–51. [V]

Options:
A. Keep automatic full-margin opening. Discoverable, but changes the reading surface for every selection.
B. Show a small local selection card; open the full margin only for a chosen action. Medium extension/UI work.
C. Require the extension icon before any selection help. Quiet, but less immediate.

Recommend B because help should begin at the passage without taking over ordinary selection.

Blocked:
Final gesture behaviour and related copy. Keep keyboard access, native copying and the no-send guarantee.

## G11 — Receipts versus source

Whitepaper:
“each is written so a reviewer can check the build against it” — W74.

Today:
The pinned header and reading handler contain no “You were here” implementation: ui/margin.ts:94–126,818–822. The state document flags the contrary receipt at docs/STATE-AND-PLAN-2026-09-18.md:59–75. [V]

Options:
A. Trust completion receipts until disproved. Cheap, but stale receipts become product claims.
B. Require each completion claim to name commit, reader action, source path, test scope and observed platform. Small report-template change.
C. Discard all receipts. Loses useful runtime history.

Recommend B because a checkable promise needs evidence tied to the build it describes.

Blocked:
Using unmatched receipts as current acceptance. A stale claim is not proof that an earlier observation was fabricated.

## Five-minute decision summary

G1: recommend correcting copy now and retaining a distinct brokered web path because evidence checking is a founding form of help.
G2: recommend origin-specific vocabulary writes because the product remembers work, not mastery.
G3: recommend See it / Check this with an approximate time word because labels should name the reader's purpose.
G4: recommend Keep as retention and Highlight as optional marking because saving should not force visual emphasis.
G5: recommend local file opening followed by a faithful PDF viewer because the record belongs beside the reader's own material.
G6: recommend keeping active persistence, consent and refusal gates while parking unfinished surfaces because durable ownership depends on them.
G7: recommend samples as the contract and grid as a view description because bounded exploration is the promise.
G8: recommend automatic local quotations, not automatic remote requests, because sending remains the reader's decision.
G9: recommend retaining FTS with an explicit erase inventory because ownership includes knowing which copies remain.
G10: recommend a small selection card before opening the margin because assistance should not commandeer ordinary reading.
G11: recommend commit-bound acceptance receipts because promises must be checkable against the build that makes them.
```

## `STAGE1-PACKETS-2026-09-18.md`

```markdown
Commit: 0360a1c
Items marked [U] were not verified against source.

# Stage 1 implementation packets

All paths are relative to marginalia-v2-package/.

These packets are proposed implementation instructions. They are not statements that the changes exist.

## Shared preconditions

Apply these after the in-flight Stage 0, T13-P5 and standards work has merged. Their planned scope is recorded in docs/STATE-AND-PLAN-2026-09-18.md:47–57. [V]

Do not reimplement Stage 0 capability wiring, saved-reply follow-ups, the confinement collector, retry identity repair, shutdown, workspace file modes, reconnect alarms or session cleanup.

Read the merged source before editing. Record its full commit. If a required seam changed incompatibly, report the exact mismatch; do not invent a parallel service.

Owner-gated choices must be recorded before dispatch. A recommendation in OWNER-DECISIONS is not an owner approval.

For every packet:
- Run the existing suite first and record pass/fail/skip totals.
- Distinguish baseline failures from introduced failures.
- Never describe an unexecuted test as passing.
- Do not alter the source page, weaken consent, change provider policy or enable execution.
- Use the existing design tokens and mounted-test fixtures.
- “No request” tests count model start/resume, saved execution and external retrieval separately. Local persistence or an authenticated helper read is not a model turn.
- Do not add dependencies or package changes unless the packet explicitly allows them.

# M4: A record behind sending status (GPT-5.6 Sol, medium)

Ethos line: “A dot in the rail lights while data is leaving, separately from the dot that means ‘working’, and it opens the record of what went where.” — W171.

## What the reader gets

The reader can open a record showing who received a request and which reviewed content it concerned. Working and sending no longer mean the same thing. When actual sending cannot be observed, the margin says so.

## Current state

daemon/consent/service.ts:223–254 already writes egress and authorization records in the dispatch transaction. [V]

daemon/jobs/send-checkpoint.ts:8–29 binds that transaction to the exact prepared provider request. It explicitly preserves the crash gap before an external write. [V]

ui/margin.ts:515–522 currently derives “Sending” from asking-flow state. [V]

daemon/jobs/envelope.ts:35–78 includes several reviewed parts. Their combined size is not an observed network-byte count. [V]

## Change

1. In daemon/consent/service.ts, extend the existing egress record. Add nullable legacy-compatible fields:
   `path`: definition | generation | consented-web;
   `reviewedContentDigest`;
   `reviewedBytes`;
   `observedSentBytes`;
   `observation`: legacy-unknown | handoff-recorded | send-observed;
   `sendStartedAt`;
   `sendEndedAt`.
   Existing rows receive null measurements and `legacy-unknown`. Never backfill invented observations.

2. In daemon/jobs/envelope.ts, calculate `reviewedBytes` as the sum of UTF-8 bytes of the exact reviewed part texts. Reuse the prepared envelope's binding digest for `reviewedContentDigest`. Call this “Size of reviewed content,” not bytes transmitted. Do not store raw page text in the egress table.

3. Extend finalizeDispatch and its existing checkpoint inputs to receive these host-prepared values. Write them in the existing transaction before provider handoff. A failed record write prevents handoff. Definition and generation remain distinct. A local saved-solver run creates no model-egress record.

4. Add a read operation in daemon/server.ts:
   `GET /api/egress`
   and the extension-safe mirror
   `POST /api/read/egress` with an empty object body.
   Require exactly one of `jobId` or `threadId`.
   Require `after` to be a nonnegative integer; default 0.
   Require `limit` from 1 through 100; default 50.
   Return `{records, nextAfter, hasMore}` ordered by the existing SQLite row sequence.
   Apply the existing pairing and real-Origin checks. Return no credentials, raw prompts or workspace paths.

5. Add HelperClient.egress in ui/helper.ts. Use the read-route mechanism, not a synthetic Origin header. Reject records whose requested job/thread identity does not match.

6. Add ui/egress.ts with `mountEgressRecord` and a pure `sendingPresentation(records, connectionState)`.
   A sending indicator requires a current record with `observation=send-observed`, a start time and no end time.
   A handoff record alone displays “Request passed to Codex.”
   No record displays no sending indicator.
   A lost record connection displays “Sending status is unavailable.”
   Old records never reanimate on reopen.

7. Replace the `value.sending` branch in ui/margin.ts with that presentation. Continue deriving Working from work state. Opening the record is a read-only action.

8. Do not fabricate a network observer. The current checkpoint can establish handoff, not physical internet transmission. Until an actual observer supplies `send-observed`, the sending light stays off and the handoff text remains available.

## Tests

1. tests/margin-egress.test.ts: mount the margin, emit queued/running/sending flow states without a record, and prove no sending indicator appears.
2. The same file: handoff-only, observed-send, completed-send, stale record and disconnected-read cases produce the exact prescribed copy.
3. tests/egress-routes.test.ts: pairing, Origin, identity, pagination and unknown legacy measurements are enforced.
4. tests/jobs-send.test.ts: an egress transaction failure results in zero provider start/resume calls.
5. tests/margin-egress.test.ts: opening and reopening the record causes zero model, retrieval and saved-execution calls.

## Hard limits

Allowed: contracts/consent.ts, contracts/jobs.ts, daemon/consent/service.ts, daemon/jobs/envelope.ts, daemon/jobs/send-checkpoint.ts, daemon/server.ts, ui/helper.ts, ui/egress.ts, ui/margin.ts, and the named tests.

Forbidden: codex-policy.ts, provider execution policy, the confinement collector, solver admission and theme tokens.

Do not claim to close the whitepaper's physical-transmission promise merely by adding handoff metadata.

Baseline: run the suite first and record totals.

## Report

docs/REPORT-M4-2026-09-18.md, at most 900 words.
Include baseline and final totals, changed files, one record example with no private text, the negative indicator test, and whether actual transmission remains unobserved.

# M3: Vocabulary with visible origins (GPT-5.6 Sol, medium)

Ethos line: “Using a word in a note is evidence of use, not of mastery” — W153.

## What the reader gets

Words can enter the vocabulary because the reader asked for a definition, selected a word from a note, or asked to skip it. Each entry says why it is there. Removing a word does not remove the note that used it.

## Current state

daemon/library.ts:78–91 provides listing and deletion. [V]

ui/library/index.ts:220–237,382–405 provides display and deletion controls. [V]

The existing reader schema includes one vocabulary table at daemon/store.ts:61–75. [V]

The approved entry policy is G2 option B. Owner acceptance remains a dispatch prerequisite.

## Change

1. In contracts/library.ts, define origins `used`, `looked-up`, `stated`, and `legacy`.
   Display them as:
   “Used in your note”
   “You asked for a definition”
   “You asked to skip this word”
   “Earlier entry; origin not recorded”.

2. In daemon/library.ts, add `recordVocabularyObservation`.
   An observation contains an immutable operation ID, term, origin, timestamp and source reference.
   A used origin references note ID and note revision.
   A looked-up origin references a succeeded definition job and reply.
   A stated origin records an explicit reader action.
   Validate the references in the store; do not trust a client-supplied origin claim.

3. Store separate origins instead of replacing one origin with another.
   Preserve existing entries and original timestamps.
   Unknown historical origins become `legacy`, not evidence of use or familiarity.
   Normalize keys with Unicode NFC, trimmed ends and collapsed whitespace. Retain the reader's display spelling.
   Accept 1–300 characters. Reject control characters and empty terms. Never truncate silently.

4. Add authenticated `POST /api/vocabulary/observe`.
   Add HelperClient.observeVocabulary.
   Duplicate operation IDs return the original result; a changed body under the same ID conflicts.

5. In the note view, add “Add a word from this note”.
   It opens a local text field and an “Add word” button.
   Require the entered text to occur in the referenced saved note version.
   The control does not tokenize the whole note or send it to a model.

6. In Settings, add “Skip a word”.
   The explanatory sentence is:
   “This changes word suggestions. It does not say what you know.”
   No familiarity score or inferred mastery field is added.

7. After a definition has succeeded, record the selected term only when it satisfies the term limit. Do not harvest ordinary prose responses.
   Failure to record vocabulary must not discard the reply or note.
   Retry the local observation only through its same idempotent operation ID.

8. Deletion removes the visible entry and its origin rows.
   Keep only content-free operation receipts needed to prevent an old retry from recreating it.
   A new explicit action with a new operation ID may add it again.
   Do not backfill words from historical notes.

## Tests

1. tests/vocabulary-ui.test.ts: add a word from a saved note, inspect its origin, reload, and remove it while preserving the note.
2. The same file: a skip action changes no model, retrieval or execution counter.
3. tests/vocabulary.test.ts: one term retains multiple origins; wrong note revision and nonexistent definition result are rejected.
4. The same file: deletion followed by an old retry does not resurrect an entry; a new explicit action can.
5. tests/vocabulary-ui.test.ts: rejected or failed writes leave the field intact and do not claim success.

## Hard limits

Allowed: contracts/library.ts, daemon/library.ts, daemon/store.ts vocabulary migration only, daemon/server.ts, ui/helper.ts, ui/library/index.ts, ui/margin.ts, the narrowly required definition-completion hook, and named tests.

Forbidden: ranking models, ambient inference, provider policy, bulk historical extraction and knowledge scoring.

Baseline: run the suite first and record totals.

## Report

docs/REPORT-M3-2026-09-18.md, at most 800 words.
Include the adopted G2 policy, migration behaviour, origin examples, deletion/retry evidence and zero-send observations.

# M6–M7: You were here (GPT-5.6 Sol, medium)

Ethos line: “The margin remembers your work: threads, notes, highlights, the terms you looked up, what you removed, where you left off.” — W70.

## What the reader gets

Returning to a page offers “You were here” with the saved section name. The page does not jump until the reader chooses it. Notes keep their own attachments while the reader moves elsewhere.

## Current state

ui/margin.ts:818–822 tracks the current section in memory. [V]

ui/persistence.ts:38–41 stores a position in a note draft. That is not a general reading bookmark. [V]

extension/entrypoints/content.ts:52–59 supplies section-based position to the panel. [V]

## Change

1. Add a versioned `ReadingPositionRecord` in ui/persistence.ts:
   schema `marginalia.reading-position.v1`;
   source URL;
   extraction version;
   SHA-256 of the captured text;
   section title;
   section-start quote anchor;
   savedAt;
   monotonically increasing local revision.
   This is one current bookmark, not a scroll history.

2. Store it under `reading-position:<source URL>` in the existing local persistence namespace.
   Use the existing cross-document locking pattern.
   The most recent visible, focused reading surface may write.
   Hidden, suspended and held surfaces may not write.

3. In ui/margin.ts, call `saveReadingPosition` after 750 ms of stable section position.
   Do not write on every scroll event.
   Do not use note-draft position as a fallback.
   Do not require a note or thread to exist.

4. On mount, read the bookmark without scrolling.
   Show “You were here · <section title>”.
   On click, resolve the stored quote against the current capture.
   One exact or moved match may navigate.
   Multiple matches or no match do not navigate.

5. For an unresolved position, show:
   “Your saved place could not be located on this version of the page.”
   Offer “Show saved passage” and “Forget this place”.
   Show the original quote as text. Do not choose a candidate automatically.

6. Existing note, slider, assumption and keyboard holds continue to block reading-position updates.
   “Follow reading” releases the hold; it does not send anything.

7. Keep this bookmark local in Stage 1. Do not add helper synchronization, analytics or dwell-time logging.

## Tests

1. tests/reading-position-ui.test.ts: read without making a note, move sections, remount, and find the saved section offer.
2. The same file: reopening performs no scroll and makes zero model, retrieval or saved-execution calls.
3. Clicking the offer navigates once only for one safe match.
4. Changed and ambiguous pages preserve the old bookmark and do not guess.
5. A focused note or slider prevents bookmark movement while source scrolling continues.
6. A hidden tab cannot overwrite the foreground reader's position.

## Hard limits

Allowed: ui/persistence.ts, ui/margin.ts, ui/margin-model.ts, and tests/reading-position-ui.test.ts.
Extension position transport may change only if required to preserve its existing section identity.

Forbidden: note-anchor mutation, provider requests, telemetry, new databases and automatic scrolling.

Baseline: run the suite first and record totals.

## Report

docs/REPORT-M6-M7-2026-09-18.md, at most 700 words.
Include storage shape, no-note return evidence, ambiguous-page behaviour and the zero-send/zero-auto-scroll assertions.

# REATTACH: Persist attachment observations without replaying questions (GPT-5.6 Sol, medium)

Ethos line: “Anchored to a version of the source, so it reattaches when the page is reopened and survives edits to the live page.” — W157.

## What the reader gets

A reopened thread says when its passage moved or cannot be located confidently. Reconnecting the local helper does not ask the question again. The original quotation remains available.

## Current state

daemon/server.ts:192–197 exposes POST /api/reattach. [V]

daemon/store.ts:226–247 records an attachment against a target version without changing the original anchor. [V]

ui/helper.ts:122–164 has no reattach method. Local matching exists at ui/margin-model.ts:10–19. [V]

## Change

1. Add HelperClient.reattach:
   input `{threadId, text, tabCapture, capture}`;
   POST to the existing route.
   Preserve the route's one-million-character and 100-character identity limits.
   `tabCapture` is a UUID allocated once per mounted source-document lifetime.

2. Add a response validator accepting only `exact`, `moved`, `unsure`, `lost` and bounded candidate ranges within the current text.
   Require response identity to remain associated with the requested thread and current source generation.
   A stale response must not update a replacement page.

3. On reopening, perform local attachment matching first.
   Reconnection itself performs reads only. It never drains the mutation queue, creates a job, retries a job or uploads a newly captured page.

4. Add “Remember this attachment” to a thread whose current attachment has not been recorded by the helper.
   This deliberate local-save action calls reattach after checking the current exclusion, pairing epoch and source identity.
   It is not a model request.
   Already recorded identical observations are not duplicated.

5. Use these reader states:
   exact: no extra label;
   moved: “This passage moved”;
   unsure: “More than one passage could match”;
   lost: “This passage could not be found”.
   In unsure/lost, keep “Show original passage” and disable navigation to a guessed location.

6. Changing the page invalidates pending client updates, not the saved original anchor.
   Removal, pending note edits and unknown model outcomes remain unchanged.

## Tests

1. tests/reattach-ui.test.ts: exact, moved, ambiguous and missing quotations render the prescribed states.
2. The same file: reopen and helper reconnect cause zero prepare/start/retry/follow-up, external retrieval and saved-execution calls.
3. The explicit attachment-save action reaches /api/reattach once and preserves the original source version.
4. A late response from another tab/document lifetime is ignored.
5. Reconnecting with unsent local notes does not upload those notes or a fresh page capture.

## Hard limits

Allowed: ui/helper.ts, ui/margin.ts, ui/margin-model.ts, ui/persistence.ts for observation caching, and tests/reattach-ui.test.ts.

Forbidden: changes to attachQuote's matching policy, original anchors, job recovery or the in-flight reconnect scheduler.

Baseline: run the suite first and record totals.

## Report

docs/REPORT-REATTACH-2026-09-18.md, at most 700 words.
Include the action chain, unchanged original anchor, late-response test and separate local-helper versus model-request counts.

# SUGGESTIONS: Three stable offers with an exposure record (GPT-5.6 Sol, medium)

Ethos line: “Every time suggestions are shown, the margin records what was eligible, what was shown where, what you chose or did not” — W147.

## What the reader gets

The reader sees no more than three stable suggestions. One can say “See it · about a minute”. Choosing a suggestion prepares a question; it does not send it.

## Current state

ui/margin.ts:384–421 contains a fixed three-button set. [V]

ui/asking/mount.ts:92–111 has a limited suggestion set and an optional exposure hook. Its production mount at ui/asking-host.ts:210–245 does not supply that hook. [V]

The existing mount reports exposure during construction, at ui/asking/mount.ts:184–194; construction is not proof that the reader saw it. [V]

## Change

1. Add contracts/suggestions.ts with policy version `marginalia.suggestions.v1`.
   Use these labels:
   define: “Define this”;
   simulate: “See it · about a minute”;
   instantiate: “Work an example”;
   derive: “Show the steps”;
   diagram: “Draw the connections”;
   evidence: “Check this”;
   explore: “Go further”;
   unsure: “Help me choose”.

2. Retain Stage 0's intent/capability wiring. Centralize its labels rather than adding a second set.

3. Stage 1 uses an explicitly fixed policy, not a learned score.
   Priority order: define, simulate, evidence, instantiate, derive, diagram, explore, unsure.
   Show the first three currently eligible operations.
   Eligibility requires the actual route, provider and current permission state. A citation-rendering capability is not a web-execution route.

4. Keep all ask types discoverable under “More kinds of help”.
   Unavailable entries explain why and cannot dispatch.
   With no eligible operation, show:
   “Keep a note, or connect help in Settings.”
   Do not invent a duration estimate from runtime state.

5. Freeze labels, order and identities once visible. Changes appear through “More ideas”, never by moving existing controls.

6. Add a local exposure record:
   exposureId; policyVersion; contextHash;
   eligible intent IDs;
   shown `{intent,label,position}` entries;
   shownAt; resolvedAt;
   choice intent or null;
   resolution `chosen | dismissed | replaced | page-closed`;
   latencyMs;
   optional resulting thread/job identity;
   eventual outcome or `unknown`.
   No raw excerpt or note text is stored in this log.

7. Record only when the suggestion surface becomes visible in the active document, not on construction.
   Resolve once when chosen, dismissed, replaced or closed.
   An unresolved record found after restart becomes `page-closed`, choice null, latency unknown. Do not fabricate its duration.

8. Store exposure records in the existing local persistence namespace.
   Never upload them automatically.
   Pass exposureId through the retained question so later explicit sends can be reconciled with the original choice.

## Tests

1. tests/suggestion-ui.test.ts: at most three visible suggestions, exact labels and a time word.
2. The same file: permission changes do not reorder the visible set.
3. Hidden construction creates no exposure; visible display creates exactly one.
4. Choice, no choice, replacement and crash recovery retain distinct outcomes.
5. Selection, choosing a suggestion, More and reopening a draft produce zero model, retrieval and execution calls.
6. A later explicit send links to the correct exposure without rewriting what was originally shown.

## Hard limits

Allowed: contracts/suggestions.ts, ui/margin.ts, ui/asking/mount.ts, ui/asking-host.ts, ui/persistence.ts, and tests/suggestion-ui.test.ts.

Forbidden: trained ranking, behavioural mastery inference, telemetry upload, implicit web permission and changes to final consent binding.

Baseline: run the suite first and record totals.

## Report

docs/REPORT-SUGGESTIONS-2026-09-18.md, at most 800 words.
Include one chosen and one no-choice record, visibility evidence, final labels and the zero-send control test.

# S1-COPY: Remove false availability and isolation claims (GPT-5.6 Sol, medium)

Ethos line: “A reply that fails is a plain sentence ... not a quiet card.” — W62.

## What the reader gets

Unavailable actions say what is missing without making a safety promise the product cannot support. The reader can keep reading and keep their work.

## Current state

ui/consent.ts:49–50 overstates available web access and observed network restriction. [V]

ui/margin.ts:761 says saved execution is unconnected despite its callback at ui/margin.ts:676–715. [V]

renderer/index.ts:258–260 uses product-authored engineering language. [V]

## Change

1. In ui/consent.ts, replace the open-path explanatory sentence, while the route is unavailable, with:
   “Web checks are not available yet. Nothing will be looked up.”
   Do not offer an enabled action that implies this permission can presently run a web check.

2. Replace the closed-path sentence with:
   “Your question is sent to Codex. Other internet access has not been established as blocked on this device.”
   Where the execution gate refuses the operation, add:
   “This action is unavailable here. Nothing was sent.”
   Do not claim that this copy itself authorizes an otherwise refused request.

3. Replace the unconditional saved-execution sentence with the actual gate result translated into one of:
   “This example cannot run again here yet.”
   “Permission is needed before this example can run again.”
   “The saved example is no longer available.”
   Preserve current inputs in every case.

4. Replace product-authored “host report”, “packaged renderer” and “saved-solver” explanations with the reader copy in the fidelity ledger.
   Do not change the exact outgoing preview, quoted source text, user notes, stored scientific content or support exports.

5. Do not solve the unchecked-headline contract defect with a reassuring sentence. Leave that defect explicitly open for the Stage 2 correctness design.

## Tests

1. tests/reader-copy.test.ts: mount each unavailable state and assert the exact prescribed text.
2. The same file: unavailable controls cannot start a model request or saved execution.
3. tests/consent.test.ts: copy changes do not change reviewed bytes, recipient binding, permissions or denial.
4. The copy test must exclude exact outgoing/source/user content from the product-copy vocabulary rule.

## Hard limits

Allowed: ui/consent.ts, ui/margin.ts, renderer/index.ts product-authored copy only, tests/reader-copy.test.ts and relevant consent assertions.

Forbidden: policy changes, gate changes, data rewriting, weakening tests to hide real availability differences.

Baseline: run the suite first and record totals.

## Report

docs/REPORT-S1-COPY-2026-09-18.md, at most 600 words.
Include before/after strings, their state conditions and proof that outgoing content was unchanged.

# S1-REPLY-REMOVE: Discard a reply without discarding the note (GPT-5.6 Sol, medium)

Ethos line: “Everything the agent makes lives in its own layer, anchored, attributed, removable.” — W76.

## What the reader gets

A reader can remove one reply and immediately undo that action. The note, highlight, question and other replies stay where they were. Removal is not described as permanent erasure.

## Current state

daemon/store.ts:300–313 already provides setReplyRemoved with revision checking and a tombstone. [V]

ui/margin.ts:570–607 provides thread removal. The inspected saved-reply controls at ui/margin.ts:676–762 do not expose individual reply removal. [V]

ui/persistence.ts:12–20 already represents cached reply versions and local state. [V]

## Change

1. Add a paired POST /api/reply-removal route.
   Input: `{id, threadId, replyVersionId, removed, expectedRevision}`.
   Validate thread membership before calling ReaderStore.setReplyRemoved.
   Return the resulting reply version.
   Reuse the existing receipt/conflict semantics; do not create another reply store.

2. Add HelperClient.setReplyRemoved and an explicit local removal record in the existing reply cache.
   Fields: operation ID, replyVersionId, desired removed value, expected revision and status `local | pending | acknowledged | conflict`.

3. In each saved reply wrapper, add “Remove reply”.
   Flush already requested view saves, then retain the reply in local history and hide its normal presentation.
   Show “Reply removed. Undo”.
   Do not remove its parent note, thread or other replies.

4. Undo is available while the removal is visible and remains available from “Removed replies” after reload.
   Before helper acknowledgement, Undo reverses the unsent local intent.
   After acknowledgement, Undo creates a new revision-checked restore operation.
   It never reuses an operation ID with a different body.

5. Removal and Undo work locally when the helper is unavailable.
   Synchronization occurs only through an explicit “Save reply changes to helper” action.
   Reconnect does not drain this queue.
   A conflict keeps both the local intent and helper state available and says:
   “This reply changed elsewhere. Your choice is kept here.”

6. Export includes removed replies and their removal history, clearly labelled.
   No action recreates a reply through a model request.

## Tests

1. tests/reply-removal-ui.test.ts: remove the middle of three replies; the note and other replies remain.
2. Undo before and after acknowledgement restores the same reply, not a newly generated one.
3. Offline removal survives reload; reconnect does not upload or ask anything.
4. A stale revision preserves the reader's intent and shows the conflict.
5. Removal, Undo and opening removed history cause zero model, retrieval and saved-execution calls.

## Hard limits

Allowed: daemon/server.ts, ui/helper.ts, ui/persistence.ts reply-cache extension only, ui/margin.ts, contracts/reader.ts only if a shared removal type is needed, and tests/reply-removal-ui.test.ts.

Forbidden: changing ReaderStore.setReplyRemoved's authority semantics, deleting notes, permanent erasure, automatic queue flushing and provider changes.

Baseline: run the suite first and record totals.

## Report

docs/REPORT-S1-REPLY-REMOVE-2026-09-18.md, at most 800 words.
Include offline/online action chains, revision conflict evidence, note survival and separate outbound-call counts.
```

## `STAGE2-3-DESIGNS-2026-09-18.md`

```markdown
Commit: 0360a1c
Items marked [U] were not verified against source.

# Stage 2 and Stage 3 designs

All paths are relative to marginalia-v2-package/.
These are proposed designs. They are not implementation receipts.

Ordering is qualitative reader value divided by change size, within each stage. Installer acceptance remains a release blocker even though several smaller changes rank above it.

The first three are the library route, per-note removal and two truthful status indicators:
- The library route makes already-saved work useful again.
- Per-note removal restores ownership without requiring thread destruction.
- Two indicators prevent a working model from being confused with data leaving.

## Stage 2

### 1. Extension library route

Reader:
“Library” opens saved threads and settings in a browser-owned extension page. Returning preserves the original page and its draft.

Smallest complete version:
Reuse the existing library UI and helper adapters. Provide Open, Restore, Export and Settings. Do not claim full-library search.

Current seams:
webapp/main.ts:14–69 already mounts the localhost library.
ui/library/index.ts:93–129 supplies saved-thread actions.
extension/entrypoints/panel/main.ts:29–55 mounts the margin without a library callback. [V]

Files:
extension/entrypoints/panel/main.ts;
a proposed extension/entrypoints/library/ page;
extension/entrypoints/background.ts;
ui/library/index.ts;
ui/helper.ts.

Must not change:
The embedded-surface restriction, pairing-token ownership or source-bound trusted-tab handoff.

Evidence:
Click Library from native and fallback surfaces; open an existing thread; return to an unchanged draft. Library navigation and export produce zero model calls. Invalidated source identities do not expose another page's margin.

Owner gate:
No new identity decision. G6 must not remove the reused ownership machinery.

### 2. Per-note removal with undo

Reader:
“Remove note” removes only that note. “Undo” restores it. Replies that answered an older note retain their quoted historical context.

Smallest complete version:
A revision-checked note tombstone, local pending intent, explicit helper synchronization and a removed-note view. No permanent-erasure claim.

Current seams:
notes.deletedAt exists in daemon/store.ts:61–75.
writeNote updates text and revisions at daemon/store.ts:199–207.
The note controls at ui/margin.ts:570–607 offer editing and asking, not individual removal. [V]

Files:
contracts/reader.ts;
daemon/store.ts;
daemon/server.ts;
ui/journal.ts;
ui/persistence.ts;
ui/margin.ts.

Must not change:
Thread identity, original anchor, answered-note versions, other notes or replies. Undo must not overwrite a concurrent edit.

Evidence:
Remove one of several notes, reload, undo, and inspect a reply that quotes the removed revision. Exercise offline removal and a stale revision. No provider or retrieval call occurs.

Owner gate:
No. Permanent erasure remains gated by G9.

### 3. Two rail indicators

Reader:
One indicator means “Working”. Another means observed sending and opens the corresponding record. Text and accessible names distinguish them without colour.

Smallest complete version:
Reuse M4's record reader. A handoff-only record says “Request passed to Codex”; it does not activate an internet-transmission claim. Multiple active records open a list.

Current seam:
ui/margin.ts:515–522 combines sending and working into one activity control. [V]

Files:
ui/margin.ts;
ui/egress.ts from M4;
ui/margin.css.

Must not change:
Record authority, exact-request review, reduced-motion behaviour or source content.

Evidence:
Working without sending; observed sending without generation; both together; disconnected record service; completed historical records after reload. No record means no sending light.

Owner gate:
No new identity decision. Actual transmission display remains blocked until an observer establishes it.

### 4. Startup errors in the extension

Reader:
The extension says what can be done next while keeping notes usable.

Smallest complete version:
Show helper absent, helper reachable but model unavailable, incompatible installation, permission revoked and startup failed as distinct states.
Use:
“Open the local helper.”
“Connect Codex in the local helper.”
“Update the local helper.”
“Connect this browser again.”
“Open the local helper to see why it stopped.”

Current seams:
daemon/main.ts:79–94 handles startup and logs diagnostics.
extension/entrypoints/panel/main.ts:39–50 displays a short helper-status string. [V]

Files:
daemon/main.ts;
daemon/server.ts health/status response;
extension/lib/helper-reconnect.ts;
extension/entrypoints/panel/main.ts;
ui/helper.ts.

Must not change:
A failed connection must not become an automatic retry of a question. Do not expose filesystem paths, credentials or raw exception dumps to page content.

Evidence:
Fresh installation with no provider, occupied port, revoked pairing, failed startup and helper termination while editing. Each state preserves the draft and produces no implicit request.

Owner gate:
No. Reuse the in-flight reconnect and shutdown work.

### 5. Diagnostics the reader can inspect

Reader:
“Help with a problem” shows what is available, what was observed and what remains unknown.

Smallest complete version:
A local diagnostic view with version, operating system, pairing state, provider availability, execution availability and bounded recent errors. A separate preview precedes copying or exporting diagnostics.

Current seams:
daemon/server.ts:105–150 returns setup/diagnostic information.
ui/helper.ts:99–105 retains the pairing token but does not expose that information as a diagnostic view. [V]

Files:
daemon/server.ts;
ui/helper.ts;
ui/library/index.ts;
extension/entrypoints/panel/main.ts.

Must not change:
Never turn a successful startup, requested restriction or falsification probe into “confined”. No automatic upload.

Evidence:
Compare the displayed state with the returned host facts. Export contains no token, raw page, note or prompt. Unknown evidence remains explicitly unknown.

Owner gate:
No.

### 6. One branch open at a time

Reader:
Opening a thread expands its detail and compacts the previous thread. Unsent text remains preserved.

Smallest complete version:
One active expanded thread identifier. A focused editor prevents automatic replacement; opening another thread first preserves its draft and moves focus deliberately.

Current seam:
ui/margin.ts:137,570–607 uses an expanded set and thread expansion controls. [V]

Files:
ui/margin.ts;
ui/margin-model.ts;
ui/margin.css.

Must not change:
Do not destroy focused controls, cancel a running request or discard an unsaved draft merely to enforce the layout rule.

Evidence:
Open A, type, open B, return to A. The exact text, caret-relevant editor state and reply inputs remain. Keyboard and 200% zoom paths remain usable.

Owner gate:
No new identity decision.

### 7. Keep versus Highlight

Reader:
Keep saves the selected passage and its thread. Highlight optionally marks it on the source page.

Smallest complete version:
An explicit highlight toggle with stable local persistence and helper synchronization. Existing retained highlights remain marked after migration.

Current seams:
ui/margin.ts:334–341 retains passages.
ui/margin.ts:803–807 paints all ordered thread anchors without consulting the highlight flag. [V]

Files:
contracts/reader.ts;
daemon/store.ts;
ui/journal.ts;
ui/margin.ts;
extension/entrypoints/content.ts.

Must not change:
No source-node wrapping or rewriting. A temporary focus highlight is not a saved highlight. Removing a highlight must not remove the note or thread.

Evidence:
Keep without a persistent mark; add/remove a mark; reload; undo; inspect source serialization and selection continuity.

Owner gate:
G4.

### 8. Rail sheet below 900 px

Reader:
The rail opens one passage and its active reply in a sheet. A quoted breadcrumb returns to the source. Features are relocated, not hidden.

Smallest complete version:
At widths below 900 px, use the same margin content in a sheet with explicit Close and source-return controls. Preserve the active thread and focus across resizing.

Current seam:
ui/margin.ts:809–816,832–835 has narrow-screen close behaviour, not evidence of the complete single-passage sheet. [V]

Files:
ui/margin.ts;
ui/margin.css;
extension/entrypoints/panel/panel.css;
renderer/reply.css only where sheet containment requires it.

Must not change:
Do not create a second reply renderer, lose cancellation, hide provenance or alter source text.

Evidence:
899 px and 900 px boundary tests; 200% zoom; keyboard traversal; long equations; a running request; an open note; resize in both directions.

Owner gate:
No. S49 expressly requires this.

### 9. Installer and fresh-machine first run

Reader:
Install Marginalia, open the helper, connect the browser, and start reading. Notes work before a provider account is connected.

Smallest complete version:
A per-user native launcher and installer that bundle the required runtime and native dependencies. The setup screen handles provider absence without asking the reader to install Node, npm, Git or a compiler.

The alpha may still use an unpacked extension, as W202 and S108 state. That must be plainly labelled.

Current seams:
package.json:6–17 assumes a Node-based development/start environment.
daemon/main.ts:17–22 chooses platform-specific data locations. [V]

Files:
Proposed packaging/ directory;
daemon/main.ts;
daemon/server.ts;
extension options/setup entry;
installation documentation;
release manifest.

Must not change:
No broad filesystem permissions, disabled operating-system protections, automatic model requests, credential transfer into the extension or silent data deletion during upgrade/uninstall.

Evidence:
Separate native runs on Windows, Linux and macOS, recording package identity, architecture, browser, installation result, helperless notes, pairing, provider setup and the first deliberate request.
No platform inherits another platform's result.
Installation success is not confinement evidence.

Owner gate:
The alpha distribution wording needs acceptance. Provider redistribution and signing availability remain unestablished. [U]

## Fresh-machine acceptance scripts

These are proposed acceptance procedures, not completed runs.

Each release must supply a manifest naming its supported operating systems, architectures, browser package, installer identity and signing status. Proposed installer names below are placeholders, not claims that artifacts exist.

A tester needs an ordinary user account, a supported browser and, for the deliberate model-request step, their own supported provider account. No developer toolchain is a prerequisite.

### Windows

1. Start with a clean standard-user Windows account. Record Windows version, architecture and browser version. Confirm that Marginalia and its helper are absent.
2. Download the release's Windows installer and unpacked-extension archive. Record the manifest identity. Run the installer through the normal graphical interface. Do not disable SmartScreen, antivirus or other protections to make it run; a blocked package is a recorded failure.
3. Open Marginalia from Start. Confirm that the setup window appears and identifies whether the helper and provider are available. No terminal, Node, npm, Git or compiler step is permitted.
4. In the supported browser's extension-management page, enable the alpha's documented unpacked-extension mode and choose the extracted extension folder. This browser setting is the alpha distribution step, not a request to install a developer environment.
5. Before connecting a provider, open a readable page, keep a passage and write a note. Reload. Confirm that the note survives and that no model request was recorded.
6. Connect the browser using the helper's displayed pairing code. Close and reopen the browser and helper. Confirm that neither the saved passage nor pending question is sent.
7. Use the helper's graphical provider setup. Where a provider installation is required, the setup must provide an explicit supported action or an honest unavailable state. A hidden command-line prerequisite fails first-run acceptance.
8. Select a new passage, choose help and inspect the exact outgoing text and recipient. Choose Not now; confirm zero requests. Repeat and explicitly approve once. Record whether one request completes, fails or is blocked. Never call a blocked model path complete.
9. Exercise Cancel, disconnect the helper, edit a note, reconnect and reopen the page. Confirm no automatic retry. Export the note. Test keyboard-only use, dark mode and 200% zoom. Uninstall and confirm that retaining or deleting saved work is a separate explicit choice.

### macOS

1. Start with a clean standard-user macOS account. Record macOS version, architecture and browser version. Confirm that no existing Marginalia data or helper is being reused.
2. Download the macOS release package and extension archive. Record their manifest identity. Open the proposed disk image or installer through Finder. Do not disable Gatekeeper or remove protection attributes to manufacture a pass.
3. Install and launch Marginalia through the normal graphical path. Confirm that the runtime and native dependencies need no Homebrew, terminal, Node or compiler setup.
4. Load the alpha extension through the supported browser's documented unpacked-extension interface. Record the browser used; do not infer Safari support from a macOS pass.
5. With the provider disconnected, keep a passage and write a note. Close the tab, reopen it and inspect the retained work. No model request should be recorded.
6. Pair through the helper's displayed code. Quit and reopen both applications. Pairing recovery must not submit a pending question or drain unrelated local changes.
7. Complete graphical provider setup, or record the exact unavailable state. Account authentication must occur through the supported provider flow, not by copying provider credentials into extension settings.
8. Prepare a question, inspect its exact content and recipient, dismiss it, then repeat and explicitly approve once. Record actual outcome and request count. A successful request does not establish execution confinement.
9. Cancel an in-progress request, quit the helper, retain a local note and reconnect. Confirm no resend. Exercise export, keyboard access, dark mode and 200% zoom. Remove the application and confirm that saved-data deletion is separately explained and chosen.

### Linux

1. Start with a clean standard-user account on a distribution named in the release manifest. Record distribution, version, architecture, desktop session and browser. Do not generalize this result to all Linux distributions.
2. Download the distribution-supported graphical package or self-contained release. Record its identity. Install or open it using the desktop's normal interface.
3. Launch Marginalia from the application menu or file manager. If the package requires an undocumented runtime, FUSE component, compiler or terminal command, record first-run failure. The installer must explain and handle supported system prerequisites through its documented user path.
4. Load the alpha extension through the supported browser's unpacked-extension interface. No repository checkout or extension build is allowed.
5. Before provider setup, keep a passage, write a note, close the browser and reopen it. Confirm retained local work and zero model requests.
6. Pair with the graphical helper. Restart it and the browser. Confirm that reading and reconnection do not submit any pending question or automatically upload queued notes.
7. Complete the graphical provider setup or record the exact unsupported state. Do not substitute a developer shell setup and call the fresh-machine procedure passed.
8. Review a prepared question's exact content and recipient. Dismiss it and confirm zero requests. Prepare it again and explicitly approve once. Record the actual outcome, including a blocked execution boundary.
9. Exercise cancellation, helper loss, local note editing, reconnection, export, keyboard access, both themes and 200% zoom. Uninstall through the documented user path and inspect the separate saved-data choice.

## Stage 2 addition from the fidelity ledger: result claims outside classifications

Reader:
A result is either backed by a named check for the shown inputs or presented as an unassessed explanation. Fluent prose does not acquire checked authority merely by avoiding a classification block.

Smallest complete version:
Introduce an explicit distinction between descriptive copy and result claims in the reply contract. Legacy replies keep their original text available, but cannot gain new checked status through migration.

Current seam:
renderer/index.ts:239–244 protects classified replies' titles and summaries but renders unclassified ones directly. [V]

Files:
contracts/reply.ts;
reply schema/instructions;
daemon validation;
renderer/index.ts;
host-check contracts and tests.

Must not change:
No generic check may certify arbitrary prose. Do not pass the model's own declaration off as independent assessment.

Evidence:
Adversarial replies place the same unsupported numerical conclusion in title, summary, ordinary text and classification. Only a matching host-backed result may appear as checked.

Owner gate:
Not an identity decision, but the contract change needs a separate bounded engineering packet before implementation. This design does not pretend the change is a copy-only fix.

## Stage 3

### 1. Complete export, do not rebuild JSON

Reader:
Choose a private backup or a shareable note export. Review whether source excerpts are included.

Smallest complete version:
Retain full JSON backup. Add Markdown for notes and highlights. A share-oriented export excludes source excerpts by default and preserves links, origin labels, removed-state labels and reply limitations.

Current seams:
ui/library/index.ts:239–267,358–382 already previews and downloads JSON.
daemon/store.ts:359–377 exports source, note versions, replies and history. [V]

Files:
daemon/store.ts export functions;
ui/library/index.ts;
ui/margin.ts;
a proposed export formatter;
export tests.

Must not change:
Never label an incomplete backup complete. Never treat imported host-check records as newly executed checks. Do not silently omit removed work from a private backup.

Evidence:
Golden export fixtures, source-exclusion preview, round-trip identity checks and Unicode/mathematical text. No model request is involved.

Owner gate:
G9 only for erase-after-export claims. Sharing policy must remain distinct from private backup.

Whitepaper/spec:
Both promise JSON. The whitepaper also promises Markdown; S84 defers it rather than drops it.

### 2. Samples terminology and bounded exploration

Reader:
“Explore this example” shows the range that is available. Outside it, “Run this example again” is a separate action.

Smallest complete version:
Keep `samples` as the stored type. Use “Available range” and “Values calculated earlier” in reader copy. Preserve axis bounds, fixed inputs, forbidden regions and unknown units.

Current seams:
contracts/reply.ts:75–86,146;
renderer/index.ts:430–462. [V]

Files:
contracts/reply.ts only for clarified comments/compatibility;
renderer/index.ts;
renderer/sample-copy.ts;
documentation and tests.

Must not change:
No silent extrapolation, invented units, automatic saved execution or hidden model request.

Evidence:
Boundary, forbidden-region, changed-fixed-input and missing-record cases. A slider outside the range cannot send anything.

Owner gate:
G7.

Whitepaper/spec:
The whitepaper uses grid and sampled-range language. The spec's canonical block list uses samples. Preserve the capability, not two rival types.

### 3. Automatic local definitions

Reader:
A definition quoted from the current page may appear immediately. A model-written definition still requires review and an explicit send.

Smallest complete version:
A preference for automatic local quotation, on or off. No remote request is attached to selection. Missing local definitions lead to an ordinary explicit Ask action.

Current seam:
ui/margin-model.ts:21–26 uses a bounded literal detector. [V]

Files:
ui/margin-model.ts;
ui/margin.ts;
settings;
exposure handling if the automatic local offer is measured.

Must not change:
No inference from a site grant, no background metadata lookup, no silent replacement of the source definition.

Evidence:
Exact local quotation, unsupported selection, excluded site, repeated selection, reopened page and changed page. All automatic cases have zero provider and retrieval calls.

Owner gate:
G8.

Whitepaper/spec:
Both allow remote automatic definitions after permission. The governing every-request review decision is stricter and controls this design.

### 4. Multi-anchor notes

Reader:
A note can refer to several passages. Its attachment list is visible and editable. One uncertain attachment does not hide the whole note.

Smallest complete version:
Keep a primary anchor and add an ordered list of independently versioned secondary anchors. “Add another passage” is explicit. Removing an attachment does not remove note text.

Current seams:
ui/persistence.ts:38–41 retains one draft anchor.
ui/margin.ts:227–245 exposes single attachment choices. [V]

Files:
contracts/reader.ts;
daemon/store.ts migrations;
ui/journal.ts;
ui/persistence.ts;
ui/note-editor.ts;
ui/margin.ts;
export.

Must not change:
No retroactive mutation of an original anchor, no merged quotation that never existed, and no automatic cross-document upload.

Evidence:
Two passages on one page, passages on two source versions, one lost attachment, note edits while scrolling, reload and export. Each attachment retains its own state.

Owner gate:
The capability is already promised by S80. G5 affects cross-document sources, not whether one note may have several attachments.

### 5. Own files and PDF

Reader:
“Open a document” accepts a local file. The original stays visible and unchanged. Notes occupy a separate layer. A scanned page with no usable text says so.

Smallest complete version:
First, local plain-text/Markdown import with an immutable original file identity and a separate display representation.
Second, an extension-owned PDF viewer with page images, selectable text where available, page/region anchors and the same margin.

Current seams:
The live content script is HTTP(S)-only at extension/entrypoints/content.ts:7–10.
Saved-source views use captured text at webapp/main.ts:70–110. [V]

Files:
Proposed extension document/viewer entrypoints;
contracts/reader.ts source and anchor variants;
daemon/store.ts blob/source handling;
ui/margin.ts host adapter;
export;
viewer-specific tests.

Must not change:
Do not replace the original PDF with extracted prose.
Do not silently run OCR, upload a file, fetch external document resources or treat extraction coordinates as certain.
Opening a file is not permission to send its contents to a model.

Evidence:
A text PDF, two-column paper, equations, rotated page, scanned page, changed file and same filename with different bytes.
Notes survive reload. Text and region anchors remain distinguishable.
Compare the displayed original with the input file. Observe zero model and retrieval requests until explicit review and approval.

Owner gate:
G5 determines release sequence and supported formats.

Whitepaper/spec:
PDF is explicitly after launch in W200 and roadmap in S35,106. The conflict is not silent deletion; it is whether “after launch” receives a concrete, owned delivery plan.
```

## Phase 5 — Self-refutation and corrections

### 1. Reachability audit

The ledger contains **12 rows marked `reachable`**: **07, 21, 22, 23, 29, 31, 54, 55, 56, 57, 68 and 86**, plus **99** for helperless note-taking—**13 in total**. The following chains cover each one. These are source chains, not executed browser observations.

| Rows | Reader action chain | Source chain at `0360a1c` | Qualification |
|---|---|---|---|
| 07, 29, 31 | Select text with the pointer or keyboard → local capture → margin selection card → optional literal page definition | `extension/entrypoints/content.ts:39–51` → `extension/entrypoints/background.ts:45–67` → `extension/entrypoints/panel/main.ts:20–39` → `ui/margin.ts:343–350`; definition detector: `ui/margin-model.ts:21–26` | The detector recognizes a narrow literal pattern. It is not a comprehensive definition finder. |
| 21 | Select a passage → Keep → repeat at another passage → inspect retained items | `ui/margin.ts:343–359` → `ui/margin.ts:334–341` → `ui/margin-model.ts:6–14` → `ui/margin.ts:533–607` | Order is source attachment order. Ambiguous attachments require separate treatment. |
| 22 | Open retained work containing a saved reply → inspect the note and reply | `ui/margin.ts:570–607` → saved-reply mounting at `ui/margin.ts:676–715` | This is conditional on saved reply data. It does not establish that the gated provider can create a new reply today. |
| 23, 55, 56, 99 | Open margin → Write here, or select → Write a note → type → Save note → reopen | `ui/margin.ts:210–245,293–330,343–350` → `ui/note-editor.ts:34–49` → `ui/persistence.ts:44–65` → hydration at `ui/margin.ts:930–990` | The mounted tests exercise local persistence and retained editing. They do not establish browser storage conformance. |
| 54 | Open a saved reply → Source passage or How this was made | `ui/margin.ts:676–715` → `renderer/index.ts:246–265`; source navigation: `renderer/index.ts:200–217` → `ui/margin.ts:809–816` | Conditional on a saved reply. The technical copy remains a separate defect. |
| 57 | Type `?` at the end of a note → observe the review offer → explicitly choose it | `ui/note-editor.ts:34–49` → note-action wiring at `ui/margin.ts:227–245` | Typing invokes edit handling, not send handling. |
| 68 | Open a retained thread → choose its state; or Library → state filter | `ui/margin.ts:570–607`; library path: `webapp/main.ts:14–26,39–69` → `ui/library/index.ts:93–129` | The state labels are observations. No knowledge verdict is implied. |
| 86 | Select → Ask → Attach context → type context | `ui/margin.ts:343–350,363–421` | This reaches a retained draft. It does not claim successful inference. |

The local detector, selection actions and explicit context draft are directly present in the inspected source. The mounted note tests explicitly warn that their connected-tree fixture is not browser, accessibility or input-method conformance evidence. [V]   

**Downgrades made:** model generation, scientific-result delivery, cross-document recommendations, full reattachment, complete export and live-provider recovery remain `partial`, `missing` or `built-unreachable`. A callback, schema or API test was not promoted into a complete reader journey.

### 2. Packet invention audit

| Packet | What a worker could otherwise invent | Fix or remaining boundary |
|---|---|---|
| M4 | What “sending” means; whether reviewed bytes equal transmitted bytes; how to backfill old records | Fixed: separate reviewed size, handoff and observed transmission. Old measurements remain null. **Actual transmission observation remains blocked**, not delegated as an invented fact. |
| M3 | What counts as a vocabulary entry; whether use means mastery; whether old retries recreate deleted words | Fixed: three explicit origins, reference validation, no historical harvesting, content-free deletion receipts. Dispatch remains gated on G2 acceptance. |
| M6–M7 | Word-level versus section-level position; automatic jumping; cross-tab overwrite; whether it is telemetry | Fixed: section bookmark, explicit navigation, visible/focused writer, one retained position, no scroll history. |
| Reattach | Whether reconnect uploads a new capture or replays a question | Fixed: reconnect is read-only. Recording a new attachment is a separate deliberate local-save action. |
| Suggestions | Ranking weights, exposure timing, no-choice handling, timing claims | Fixed: honest fixed policy, actual visibility, explicit resolution states and an approximate category label. Learned ranking remains outside the packet. |
| S1-COPY | Whether a wording change can authorize execution or certify a result | Fixed: no authority changes; gate refusals remain; unchecked-result admission is a separate design. |
| S1-REPLY-REMOVE | Whether removal deletes a note; offline semantics; undo after acknowledgement | Fixed: reply-only tombstone, explicit synchronization, different pre/post-acknowledgement undo rules and revision conflicts. |

A further correction matters: **M4 does not fully deliver the whitepaper’s “data is leaving” claim without an actual observation source.** The existing checkpoint itself says a process can crash after committing the record but before writing the external stream. Calling that record a completed transmission would be false. [V] 

### 3. Strongest case against each recommendation

**G1 — Against retaining the web build:** A broker, per-destination review and separately reviewed model use of fetched content may make a small reading tool cumbersome. Correcting the copy and shipping without browsing could produce a more coherent first product. That argument wins for **current release availability**, but not for silently deleting a founding promise. The final recommendation therefore corrects copy immediately and leaves the distinct web path unshipped until its evidence exists.

**G2 — Against the explicit-origin vocabulary policy:** Requiring selection from a note may make accumulation too laborious to deliver second-document value. The whitepaper also envisages a vocabulary trail inferred from writing. This objection limits the recommendation: the packet is an honest first write path, not the complete personalization promise. It does not justify mining all prose or calling use mastery.

**G3 — Against See it and a time word:** “See it” can be vague, and “about a minute” may be mistaken for a measured service guarantee. More literal labels could be clearer. The recommendation stands only as an owner-approved provisional vocabulary. The exposure record must retain the exact label shown; no completion-time claim is inferred from it.

**G4 — Against separating Keep and Highlight:** Readers may expect Keep to mark the passage immediately, and an extra toggle can add friction. Existing marks could also appear to vanish after migration. The objection changes the migration requirement: preserve existing marks, offer the distinction for new actions, and never silently reinterpret retained work.

**G5 — Against text/Markdown before PDF:** The intended technical-reading audience may gain much more from faithful PDFs than from another text importer. This case can win for the first cohort. The recommendation remains a sequence proposal, not a decision: G5 must be settled using the documents the owner actually intends to support. PDF is explicitly deferred in the spec, not silently absent. [V] 

**G6 — Against keeping the machinery:** Complex recovery and consent code can make every small product change expensive. Some of it may truly be overbuilt. That does not support deletion by category or line count. The inspected `ReaderJournal` holds current threads, pending changes and conflicts, while the consent transaction consumes permission and records handoff. Deletion needs a dependency-specific case. [V]  

**G7 — Against samples as the canonical term:** “Grid” might be more recognizable to the original designers and easier to discuss visually. That is insufficient reason to create a second persisted type. The current contract already uses `samples`; the reader can receive plain range-oriented language without a storage migration. [V] 

**G8 — Against local-only automatic help:** The whitepaper’s complete glance-sized interaction is weaker when the page lacks a definition. A previously granted site permission could make remote help feel immediate. This argument loses against the governing requirement that the reader reviews every outgoing request. The final recommendation does not quietly reinterpret a site grant as that review.

**G9 — Against retaining FTS:** Until reader-facing search exists, the index increases the number of retained copies without delivering its intended benefit. Dropping it could simplify erasure. This is a legitimate temporary implementation option. The final recommendation retains it only with explicit disclosure and an erase inventory; it does not permit a present “Delete everything” claim.

**G10 — Against a small selection card:** A card on arbitrary pages has placement, selection and accessibility risks. The current margin is more controlled and easier to discover. The recommendation is therefore not to move privileged sending into an injected page card. The card remains local; privileged review stays in the browser-owned surface.

**G11 — Against source-bound receipts:** Runtime behaviour cannot always be settled from source. A disciplined receipt can contain evidence that static inspection lacks. This objection wins against treating source inspection as a replacement for runtime evidence. The corrected recommendation binds both kinds of evidence to a commit and scope; it does not discard either.

### 4. Reader-copy audit

The proposed product copy avoids *sandbox, payload, digest, capability, host report, schema,* and *saved-solver*. Technical terms remain in implementation instructions, where they belong.

The rule **must not** edit the exact outgoing review. That review may legitimately contain technical instructions, schemas or quoted source text. Concealing those words would undermine the reader’s ability to review what is being sent.

The existing consent sentences at `ui/consent.ts:49–50` and renderer explanations at `renderer/index.ts:258–260` require correction. The reviewed outgoing `<pre>` content at `ui/consent.ts:42–46` must remain exact. [V]  

### 5. Remaining uncertainty and source conflicts

The largest remaining uncertainty is **runtime acceptance**, not the existence of UI or storage code. I did not run code, tests, installation, a provider request or a confinement probe. Full implementation review of every provider adapter, every solver transport branch and every test was not completed. Those areas cannot inherit a positive result from this audit.

The most consequential corrections are:

**Egress exists; its UI authority is incomplete. Solver wiring exists; execution remains blocked. JSON export exists; broader export is unfinished. The API journey is not a browser journey. PDF is deferred explicitly. A local mutation journal is not the promised reader journal.**

Finally, the attached documents contain a real identity conflict. `PRODUCT.md:13` describes learning what the reader knows and adapting section depth. The whitepaper instead promises memory of work, not a hidden model of understanding. The older build plan also includes approved hiding and knowledge confirmation. Those older directions must not be silently reintroduced into this build. The whitepaper’s later distinction controls the design. [V]