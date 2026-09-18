<!-- Extracted verbatim from docs/PRO-REVIEW-TRANSCRIPT-2026-09-18.md (GPT-6 Pro long-horizon review, single-message variant of docs/PRO-LONG-HORIZON-2026-09-18.md). Pinned by the reviewer at commit 0360a1c; the branch head at extraction was dc94636. Line numbers cited inside refer to 0360a1c and must be re-resolved before use. Findings are claims to verify (ticket E14), not decisions. -->

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
