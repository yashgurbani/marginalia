<!-- Extracted verbatim from docs/PRO-REVIEW-TRANSCRIPT-2026-09-18.md (GPT-6 Pro long-horizon review, single-message variant of docs/PRO-LONG-HORIZON-2026-09-18.md). Pinned by the reviewer at commit 0360a1c; the branch head at extraction was dc94636. Line numbers cited inside refer to 0360a1c and must be re-resolved before use. Findings are claims to verify (ticket E14), not decisions. -->

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
