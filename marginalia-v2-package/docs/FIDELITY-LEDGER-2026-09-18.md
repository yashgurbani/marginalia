<!-- Extracted verbatim from docs/PRO-REVIEW-TRANSCRIPT-2026-09-18.md (GPT-6 Pro long-horizon review, single-message variant of docs/PRO-LONG-HORIZON-2026-09-18.md). Pinned by the reviewer at commit 0360a1c; the branch head at extraction was dc94636. Line numbers cited inside refer to 0360a1c and must be re-resolved before use. Findings are claims to verify (ticket E14), not decisions. -->

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
