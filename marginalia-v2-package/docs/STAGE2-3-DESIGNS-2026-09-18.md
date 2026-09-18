<!-- Extracted verbatim from docs/PRO-REVIEW-TRANSCRIPT-2026-09-18.md (GPT-6 Pro long-horizon review, single-message variant of docs/PRO-LONG-HORIZON-2026-09-18.md). Pinned by the reviewer at commit 0360a1c; the branch head at extraction was dc94636. Line numbers cited inside refer to 0360a1c and must be re-resolved before use. Findings are claims to verify (ticket E14), not decisions. -->

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

