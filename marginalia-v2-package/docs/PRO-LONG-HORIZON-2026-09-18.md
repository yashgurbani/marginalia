# GPT-6 Pro long-horizon task: whitepaper fidelity ledger and Stage 1 to 3 designs

Prepared by Fable on 2026-09-18 for a single long GPT-6 Pro run. Paste section 1 as the first message. Attach the three files listed in section 2 that are not on GitHub. Then paste sections 3 to 7 as follow-up messages, one at a time, after each phase completes. Pro reads and writes documents; it does not run code.

Repository: https://github.com/yashgurbani/marginalia, branch `codex/marginalia-v2`, pinned at commit `0360a1c`. Every link below uses that commit so the text does not move under you.

---

## 1. Opening message (paste first)

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
- Spec: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/wayfinder/SPEC-FINAL.md
- Design brief: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/wayfinder/DESIGN-BRIEF-FINAL.md
- Feature inventory: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/wayfinder/FEATURE-INVENTORY.md
- Map of tickets: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/wayfinder/MAP.md

Current state, derived and lower-ranked:

- State and plan (start here for orientation): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/STATE-AND-PLAN-2026-09-18.md
- Feature strategy: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/FEATURE-STRATEGY-2026-09-18.md
- Product quality plan: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/PRODUCT-QUALITY-PLAN-2026-09-18.md
- Engineering standards: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/ENGINEERING-STANDARDS-2026-09-18.md
- QA handoff: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/QA-HANDOFF-ASTRA.md

Code you will need most often:

- Daemon entry: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/main.ts
- HTTP server and routes: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/server.ts
- Job service (the four paths): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/jobs/service.ts
- Job store: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/jobs/store.ts
- Saved-solver gate (new): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/jobs/solver-gate.ts
- Codex policy (sandbox request, network false): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/codex-policy.ts
- Solver transport: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/solver/transport.ts
- Solver service: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/daemon/solver/service.ts
- Consent: https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/daemon/consent
- Reply contract and `capabilitiesForIntent`: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/contracts/reply.ts
- Margin UI (the reader's surface): https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/ui/margin.ts
- Asking flow: https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/ui/asking
- Consent sheet copy: https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/ui/consent.ts
- Reply renderer (grid, slider): https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/renderer
- Extension: https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/extension
- Tests (node:test, one file per concern): https://github.com/yashgurbani/marginalia/tree/0360a1c/marginalia-v2-package/tests

Work in flight that you must not design around as if it were absent (it will be merged before your output is used): Stage 0 wiring (daemon grants capabilities per intent; "Move it" and "Check this" doors in the margin; follow-ups on saved replies), T13-P5 confinement evidence collector (falsify-only, three reader states, never "confined"), and the engineering standards packets P2, P3, P5, P6, P8, P10, P11. Their scope is described in the state-and-plan document, section 5.

Working rules for this conversation:

- Read the whitepaper fully before anything else. Then SPEC-FINAL. Then the state-and-plan. Only then the code.
- Do not summarise documents back to me. Produce the deliverable for each phase and nothing else.
- Write in plain prose. Short sentences. No filler. When you propose copy the reader will see, use reader language, never engineering words ("sandbox", "payload", "digest", "capability").
- Do not use the word "verified" for anything you did not read in the linked source.
- Where a question is one only the product owner can answer (identity, what the product is), do not decide it. Present the options, the consequence of each, and one recommendation with its reason.

Confirm you have read the three attachments and the spec by naming the whitepaper's central claim in one sentence and the spec's list of the four execution paths with their line numbers. Then wait for the Phase 1 message.

---

## 2. Attach these files (not on GitHub)

From the repository root on Yash's machine, `D:\Projects\Marginalia`:

1. `Marginalia — Research Whitepaper.md`
2. `PRODUCT.md`
3. `docs/BUILD-PLAN.md`

Optionally also `CONTEXT.md` and `README.md` from the root; their GitHub copies are older than the local ones.

---

## 3. Phase 1 message: the fidelity ledger

Build the fidelity ledger. One row per promise the whitepaper makes to the reader, in the whitepaper's own order. A promise is any sentence that says what the reader will be able to do, see, or rely on. Aim for completeness, not brevity; expect 60 to 120 rows.

Columns:

1. Promise, quoted from the whitepaper, at most 15 words, with the section it comes from.
2. Spec treatment: where SPEC-FINAL keeps, narrows, or drops it, with a line reference. Write "silent" if the spec never mentions it.
3. Code path: the file and line range where it is implemented, or "none".
4. Reachability from the reader: one of `reachable` (a reader action leads to it), `built-unreachable` (code and tests exist but no reader control leads there), `partial`, `missing`, `contradicted` (the code does the opposite or the copy claims what the code does not do).
5. Evidence marker: [V] or [U].
6. Test coverage: the test file that exercises the reader-facing behaviour, or "none". A unit test on an internal function does not count.
7. One-line note on what would close the gap, or "identity question" if only the owner can decide.

After the table, three lists:

- Contradictions: every row marked `contradicted`, with the exact copy and the exact code line. The consent sheet's network promise versus the policy's `networkAccess: false` is one known case; find the others.
- Built but never asked for: code with no whitepaper or spec promise behind it. Give module, approximate line count, and which spec item, if any, it serves.
- Promises the spec dropped silently: whitepaper rows where the spec is "silent" and the code is "none".

Then a self-check: pick the ten rows you are least sure of and re-read their sources. Correct the table in place and list what changed.

---

## 4. Phase 2 message: the eleven owner decisions

The state-and-plan document lists eleven decisions (G1 to G11) that only the owner can make. For each, produce a decision brief of at most 200 words:

- What the whitepaper says, quoted.
- What the code does today, with file and line.
- The options, two or three, each with its consequence for the reader and for the code (files touched, rough size).
- One recommendation and the single reason for it, anchored in the whitepaper rather than in effort.
- What is blocked until it is decided.

Give G1 (the network promise: build a consented web path, or correct the consent copy) the most care. Read `daemon/codex-policy.ts`, the consent directory, and `ui/consent.ts` fully before writing it. If a consented web path is chosen, sketch how it stays a distinct fourth execution path: what the reader reviews before send, what the egress record contains, how the sending indicator is driven by that record, and how "fetched is not support" shows in the reply.

End the phase with a one-page summary the owner can read in five minutes: eleven lines, one per decision, each line "Gn: recommend X because Y."

---

## 5. Phase 3 message: Stage 1 design packets

Write implementation packets for Stage 1, in the exact format below, one packet per item. These are handed to a bounded model worker (GPT-5.6 Sol at medium) that has the repository, runs the tests, and cannot ask questions. A packet is good when the worker can finish it without inventing anything.

Items:

- M4: egress record behind the sending indicator. Every outbound request writes a record (recipient, byte count, digest of reviewed content, timestamp, path) that the margin reads to drive the sending dot; a route to read records; a test that the dot never shows without a record.
- M3: vocabulary write path. Only if G2 recommends it; otherwise write the packet as "deferred" with the reason.
- M6 and M7: "You were here" and persisted reading position. The reader returning to a page sees where they were, with no request sent.
- Reattach: `/api/reattach` exists on the server with zero clients. Design the client side so that reconnecting never sends anything.
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

Before writing, read the packets that already shipped, to match register and level of detail: the T20 mount and P4 work described in https://github.com/yashgurbani/marginalia/blob/0360a1c/marginalia-v2-package/docs/T20-OPUS-WORKER.md and the state-and-plan section 5.

---

## 6. Phase 4 message: Stage 2 and 3 designs

Stage 2 (finish the product): installer and fresh-machine first run on all three platforms; rail sheet under 900px; two rail dots; Keep versus Highlight (G4); per-note removal with undo (`notes.deletedAt` exists in the schema and is never written); one branch open at a time; daemon startup errors surfaced in the extension; extension library route; diagnostics visible to the reader.

Stage 3 (the whitepaper's larger promises): multi-anchor notes (G5 adjacent); PDF and own documents (G5); export; automatic definitions under a site grant (G8); grid versus samples naming (G7).

For each item produce a short design, not a packet: what the reader sees, the smallest complete version, which files it touches, what it must not change, what evidence would show it works, and whether it is gated on an owner decision. Order the items by reader value divided by size, and say why the top three are first. Mark any item where the whitepaper and the spec disagree, and side with the whitepaper.

For the installer, write the fresh-machine test script as a numbered checklist per platform. It will be run by a human and by a QA worker; it must contain no step that assumes a developer environment.

---

## 7. Phase 5 message: refute yourself, then deliver

Take your Phase 1 ledger and Phase 3 packets and attack them.

1. For every ledger row marked `reachable`, name the exact reader action chain (click, key, or selection) that reaches it, with file and line for each handler. Downgrade any row where you cannot.
2. For every packet, list what a worker would still have to invent. Fix the packet so the list is empty, or mark the item as needing a decision.
3. For every recommendation in Phase 2, write the strongest one-paragraph case against it. Where the case against wins, change the recommendation and say so.
4. Check every quoted copy string against the rule: no engineering words in reader-facing text.

Then deliver, as separate fenced Markdown documents ready to save into `marginalia-v2-package/docs/`:

- `FIDELITY-LEDGER-2026-09-18.md`: the corrected Phase 1 ledger and lists.
- `OWNER-DECISIONS-2026-09-18.md`: the Phase 2 briefs and the one-page summary.
- `STAGE1-PACKETS-2026-09-18.md`: the Phase 3 packets after Phase 5 fixes.
- `STAGE2-3-DESIGNS-2026-09-18.md`: the Phase 4 designs and installer checklists.
- `PRO-RUN-NOTES-2026-09-18.md`: what you could not verify, where the sources disagreed, and what you changed after refuting yourself.

Each document starts with a two-line header: the commit you read (`0360a1c`), and the sentence "Items marked [U] were not verified against source."

---

## 8. Notes for Yash

- Pro runs read-only. Fable integrates its documents, converts packets into worker dispatches, and puts the owner decisions in front of you.
- If Pro asks for a file that is on GitHub, give it the pinned link; if it asks for the whitepaper, PRODUCT.md, or BUILD-PLAN.md, it needs the attachment.
- If the branch moves past `0360a1c` before Pro finishes, that is fine; the pinned links stay valid and Fable reconciles the delta on integration.
- Expected shape of a good run: Phase 1 is the longest; Phases 2 and 5 are where the judgment is. If Phase 1 comes back under 50 rows, reply "the whitepaper makes more promises than that; re-read sections on the reading minute and on notes, and extend the ledger."

## 9. Single-message variant (use this if the run pauses after section 1)

The opening message ends with "wait for the Phase 1 message", so a Pro run that stops there is behaving as designed; pasting section 3 continues it. If you would rather queue the whole task in one message, paste section 1 with its final paragraph replaced by this:

> Do not pause between phases. Run Phases 1 to 5 from the phase descriptions appended below in one response, in order, each phase building on the previous one. Do not run code or tests; you have none. Do not stop to ask whether to continue. Write the four deliverable files in full in your answer, each under its own heading and filename, and end with the self-refutation pass from Phase 5. If the answer runs long, finish every phase at reduced length rather than stopping early.

Then append sections 3 to 7 below it in the same message, removing each section's "Reply with" or "wait" instruction. Attach the section 2 files as before.
