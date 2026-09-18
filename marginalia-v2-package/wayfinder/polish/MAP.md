# Polish map: from competition build to the product the whitepaper describes

Charted 2026-09-18 at `6b3b246`. Local markdown tracker. Nothing here is committed yet, by Yash's instruction.
This map continues `wayfinder/astra/MAP.md`. The Astra map's decisions H01 to H13 still stand. Its open H tickets (H07, H08, H10, H14, H15, H16, H17) stay where they are and are referenced here by name.

## Destination

Provisional, in Yash's words: "review the whole product against the vision and bring it to the level of an actual polished product", with "simulations, ask, and all the features we envisioned".
Concretely: every whitepaper promise for the launch scope is either working for a real reader with recorded evidence, or carries an honest label and a ticket. Yash's own twenty-minute reading verdict (Release verdict, H15) closes the map.

Yash can amend this destination at any time. It restates the founding documents and adds nothing to them.

## Notes

- Founding documents govern: `docs/sources/RESEARCH-WHITEPAPER-v3.md`, root `PRODUCT.md`, `docs/BUILD-PLAN.md`. Re-read them at each gate. Never rewrite their words.
- The gap ledger is `D:\Projects\Marginalia\.local\polish\audit.md` (Codex audit, 2026-09-18). It is a worker claim. Spot-check a row before building on it.
- This map carries execution. Under Yash's current handoff, Codex leads local implementation and independently verifies returned packets. Makers never self-certify. Fable receives coordination in agents-talk.md.
- Delegation: `mcp__codex__codex`, selected `gpt-5.6-luna` at `max` or `gpt-5.6-sol` at `medium`, per Yash's latest direction. Use the existing complementary account route, `agora=off`, one child layer. Actual serving backend/account remain unverified unless exposed. Never the gs account (Codex-11).
- Git: no commits, no pushes, no resets, no new worktrees until Yash says so. Writers work in the main working tree on disjoint owned paths. At most two writers at once.
- Every packet starts from `wayfinder/polish/PACKET-PREAMBLE.md`.
- Checks: `npm test`, `npx --no-install tsc --noEmit`, `npm run extension:typecheck`, `npm run extension:build`. Baseline: 964 tests, 958 pass, 0 fail, 6 skipped.
- Invariants: source immutability, senior reader notes, review of exact outgoing content and recipient, four distinct execution paths, no implicit inference on selection, reopening, reconnecting or recovery.
- Reader-facing text follows the-humanizer rules. No em dashes, no negation constructions, no exclamation marks.
- Devpost hold until 2026-09-21 17:00 PT: no pushes to `main`, no Pages switch, `webmcp-v1` and `archive/v1-webmcp/` untouched.
- Claiming: set `status: claimed (<who>, <date>)` in the ticket header. On completion set `status: closed`, add `## Resolution` with evidence paths, and append one line to Decisions so far.

## Tickets

Order is reader-visible value. "Blocked by" names tickets that must close first. Tickets that own `ui/margin.ts` run one at a time.

| Ticket | Type | Blocked by |
| --- | --- | --- |
| [Related saved passages in the margin](tickets/P01-related-in-margin.md) | build | none |
| [Three offers plus More](tickets/P02-three-offers-plus-more.md) | build | Suggestion count decision |
| [Not sure gets a reply contract](tickets/P03-unsure-bundle.md) | build | none |
| [Solver authoring contract](tickets/P04-solver-authoring-contract.md) | build | none |
| [Reviewed solver artifacts survive continuation](tickets/P05-solver-continuation.md) | build | Solver authoring contract |
| [One real saved-solver recompute](tickets/P06-real-solver-recompute.md) | build, live | Reviewed solver artifacts survive continuation; One real declarative simulation |
| [Real diagrams and equations in a browser](tickets/P07-real-diagram-acceptance.md) | build | none |
| [Parameter controls light the source phrase](tickets/P08-parameter-source-binding.md) | build | none |
| [Bounded assumptions adjust locally](tickets/P09-local-assumptions.md) | build | Assumption edit decision; Parameter controls light the source phrase |
| [Provisional visual first frame](tickets/P10-provisional-first-frame.md) | build | none |
| [Go further shelf and return path](tickets/P11-explore-shelf.md) | build | none |
| [Evidence reconciliation on saved replies](tickets/P12-evidence-reconcile.md) | build | none |
| [Completed-reply acceptance for worked example and derivation](tickets/P13-instantiate-derive-acceptance.md) | build | none |
| [Hear it, local speech](tickets/P14-hear-it.md) | build | Related saved passages in the margin |
| [Whole-page Save and Park](tickets/P15-page-save-park.md) | build | Hear it, local speech |
| [BibTeX export](tickets/P16-bibtex-export.md) | build | none |
| [Keyboard, zoom and reduced-motion acceptance](tickets/P17-a11y-acceptance.md) | build | Real diagrams and equations in a browser |
| [Extract the reading-position and rail controller](tickets/P18-extract-reading-position.md) | build | Whole-page Save and Park; Three offers plus More |
| [Reader-facing copy matches the build](tickets/P19-copy-refresh.md) | build | none |
| [Vocabulary gathers from use](tickets/P20-vocabulary-gathers.md) | build | none |
| [Daily journal view](tickets/P21-daily-journal-view.md) | build | none |
| [Journeys group the day by topic](tickets/P22-journeys-by-topic.md) | build | Daily journal view |
| [One real definition](tickets/L01-real-definition.md) | live, Yash present | none |
| [One real declarative simulation](tickets/L02-real-simulation.md) | live, Yash present | One real definition |
| [Four movement paths on one thread](tickets/L03-four-paths.md) | live, Yash present | One real saved-solver recompute |
| [Suggestion count decision](tickets/G01-suggestion-count.md) | grilling, Yash | none |
| [Assumption edit decision](tickets/G02-assumption-edits.md) | grilling, Yash | none |
| [Vocabulary scope decision](tickets/G03-vocabulary-scope.md) | grilling, Yash | none |
| [Journeys and journal shape](tickets/G04-journeys-journal.md) | grilling, Yash | none |

## Decisions so far

- 2026-09-18 remaining acceptance audited:15closed polish tickets have resolutions/reports;7polish and3live tickets remain open. P18 extraction preflight preserves its P02 dependency; canonical P02/P18 reports now record incomplete scope. P22 availability wording corrected in owned docs; no runtime/Git/publication change. Fable decision queue and evidence limits: .local/polish/reports/REMAINING-ACCEPTANCE.md.

- 2026-09-18 P22 saved-activity components verified, full ticket OPEN: deterministic local groups, durable reader names/members, paired edits, journal controls/export;1087/1081/0/6 and all four checks0, sourceStable. Independent19/19+2/2, controlled Chrome360px/200%zoom. Source-link and full reading-history evidence remain absent; model synthesis off. Full receipt and retained dissent in .local/polish/reports/P22.md.

- 2026-09-18 P19 partial checkpoint: package README/listing and allowed status cells match the local build; full cross-surface alignment remains open for site/demo owners. Stable1076/1070/0/6, independent copy review and protected-file hashes recorded in P19.md.

- 2026-09-18 P21 partial checkpoint: expose factual saved activity only; full all-reading/revisit acceptance stays open until dated visit evidence and recording scope exist. Stable1076/1070/0/6, independent8/8+1/1 and real Chrome keyboard evidence in P21 report.

- 2026-09-18 P16 closed: explicit captured-metadata BibTeX, stable source keys, separate text/URL escaping and retained removed records; independent14/14 and stable1063/1057/0/6 four-check gate. Native compiler/import compatibility remains unverified.

- 2026-09-18 P15 closed: local whole-page Save/Park, immutable capture identity, local return cue and explicit helper Library sync; independent50/50 and stable1057/1051/0/6 four-check gate. Cross-tab dedup and native/live evidence are separate limits.

- 2026-09-18 P14 closed: explicit local-voice Hear it for selection or reading position, Stop/Escape/teardown and voice-loss fences; independent7/7 and stable1051/1045/0/6 four-check gate. Native audible/network proof remains open.

- 2026-09-18 P17 closed: real keyboard journey at desktop,200% zoom,360px and reduced motion; visible consent focus entry/return fixed, slider status coalesced; independent review and stable1044/1038/0/6 four-check gate. Native/provider/live gates remain open.

- 2026-09-18 P07 closed: real Chrome Dagre/KaTeX/CSS, light/dark screenshots, source-focus/blur and immutable DOM; stable1037/1031/0/6 four-check gate with both browser suites enabled. P17 and live extension/provider gates remain open.

- 2026-09-18 P11 closed: passive assessed shelf, explicit durable open/return context, duplicate/private refusal and restart; independent20/20 review and stable1023/1016/0/7 four-check gate. Native navigation/referrer and live provider gates remain open.

- 2026-09-18 P12 closed: durable exact-attempt evidence receipt, source-bound quotation labels, semantic support unverified; independent23/23 review and stable1019/1012/0/7 four-check gate. Web/provider gates remain open.

- 2026-09-18 P10 closed: real bounded provisional plot frame, explicit illustration and provisional disclosure, cancel/replacement fences; independent review and stable1012/1005/0/7 four-check gate. Standalone browser evidence remains separate from native/provider gates.

- 2026-09-18 P09 closed: bounded local assumption edits persist and synchronize controls; independent correction review4/4 and stable1009/1002/0/7 four-check gate. Structural changes stay explicit asks.

- 2026-09-18 P05 closed: nearest current-workspace solver authority survives continuation, newer solver and removed old history; stable independent1009/1002/0/7 four-check gate. Live solver execution remains P06/L02.

- 2026-09-18 P03 closed: eighth unsure bundle, bounded clarification and canonical instruction binding; stable independent1004/997/0/7 four-check gate.
- 2026-09-18 P08 closed: exact source binding on parameter controls, native semantics retained, local-only interaction; same gate and independent48/48 focused checks.
- 2026-09-18 P13 closed: worked-example/derivation job-to-reopen acceptance, no second synthetic request; same gate. Live/native evidence remains open.

- 2026-09-18 P01 closed: explicit Related disclosure, immutable saved source, local-only regression and stable four-check gate986/980/0/6; browser/provider limits remain documented.
- 2026-09-18 P04 closed: default declarative, explicit host authoring opt-in, manifest admission and typed legacy refusal; same independent four-check gate. P05 continuation and P06 live execution remain separate.

- Suggestion count decision: three offers chosen by the whitepaper's additive fit score, the rest under More.
- Assumption edit decision: single-parameter assumptions change locally; structural changes stay a new ask (Yash answered "yes?").
- Vocabulary scope decision: explicit Remember plus local gathering from use over time, with origins shown.
- Journeys and journal shape: the journal integrates the day's reading; journeys are its automatic topics holding notes, bookmarks, highlights and transforms.

## Historical Fable handoff, 2026-09-18 ~10:30 (superseded by accepted decisions above)

- Related saved passages in the margin: built, then sent back. Correction 1 makes the lookup run only when the reader opens Related. Log `.local/polish/logs/P01-c1.log`, report `.local/polish/reports/P01.md`.
- Solver authoring contract: built, then sent back. Correction 1 adds manifests to nine old solver fixtures and defines the no-manifest refusal. Log `.local/polish/logs/P04-c1.log`, report `.local/polish/reports/P04.md`.
- Neither is accepted. Fable has not run the four checks on either. Last worker count: 981 tests, 959 pass, 16 fail, 6 skipped.
- To dispatch the next ticket: `.local/polish/launch.ps1`. Next up: Unsure skill bundle, Real diagrams and equations in a browser.
- Tickets still to write: Vocabulary gathers from use; Daily journal view; Journeys group the day by topic.

## Not yet specified

- Default runtime readiness. Seven evidence gaps in `daemon/consent/evidence-host.ts` keep it false. It waits on Runtime inference admission (H17) and on confinement probes per operating system.
- Web evidence through the retrieval broker. Stock sandbox policy closes tool network. It needs an observed broker path first.
- PDF path, Firefox build with a privileged asking surface, WebMCP `insert_reply`, local and other-vendor providers, image replies.
- "assumes:" terms in the header and any Semantic Scholar lookup. A remote lookup needs its own grant and egress record.
- Cited search answers across the library, sharing, sync, import, Obsidian and Zotero.
- Windows equivalents of the four POSIX-only skipped tests (ACLs, junctions, special files).
- Time words for deep actions other than See it. No measured latency exists yet.
- Separate sending dot. `transmissionObserved` is hardcoded false until an adapter reports a real transmission event.
- The twelve source contradictions in `docs/SCOPE-COVERAGE.md`. Several need Yash.

## Out of scope

- Any change to the source page, automatic sends, deletion of solver, consent or journal code, and market framing. Carried from the Astra map.
- Product Hunt, Devpost and investor-form work. Those are Yash's and live outside this map.

## Historical initial Codex continuation, 2026-09-18

Yash's latest handoff assigns Codex technical leadership and independent acceptance, with bounded Sol-medium workers through the complementary MCP route. This supersedes the older worker model and Fable-only verification notes above. Product work stays local in the shared dirty main tree; no git writes are authorized.

P01 is under chief acceptance: focused80/80 passes and standalone desktop disclosure/keyboard behavior was observed. P04 remains claimed while default declarative authoring and the visible legacy refusal are corrected. Neither ticket is closed. Existing failed logs and earlier claims above remain historical evidence, not current acceptance.

P20/P21/P22 ticket files exist and are now included in this table. G01-G04 are resolved by Yash. Model-written journey synthesis remains a separate unanswered decision. Live checklist: D:/Projects/Marginalia/.local/polish/reports/LIVE-ACCEPTANCE-CHECKLIST.md. L01/L02/L03 and all unproven live gates remain open.


