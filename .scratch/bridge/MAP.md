# Wayfinder map — Marginalia (was Bridge)

Label: wayfinder:map · Tracker: local markdown (`.scratch/bridge/issues/`) · Owner: Yash

## Destination

A submitted WebMCP Challenge entry (live URL, public MIT repo, ≤3-min video, description) that
demonstrates the reader reshaping a public-domain paper around an interview and the reader's own
notes, under the layer rule — AND a product map for Bridge beyond the hackathon whose next
decisions are ticketed.

## Notes

Domain: adaptive reading; two shores + bridge; layer rule (ADR-0001). Skills every session
consults: /grilling, /domain-modeling (CONTEXT.md here), /prototype for UI questions. Standing
preferences: honest states over polish; no agent writes to source; reuse FeynmanILE / Noether
IRE / content-analysis / LocalComms patterns before inventing (SPEC.md Part III). Hard deadline
for tickets 01–10: 2026-09-04 10:00 CEST.

## Decisions so far

- [Destination: Bridge, not Feynman](MAP.md) — Feynman slices read as provenance layers; the reader is the WebMCP-native product; Feynman and Noether IRE re-enter through it.
- [Layer rule](../../docs/adr/0001-agent-layer-never-writes-source.md) — source layer has no write tool; compactify = stub+reason; vocabulary = gloss.
- [Shore B has three sources, one slot](../../SPEC.md#2-the-two-shores) — interview (built first), archive (client-side index), agent memory (free).
- [Knowledge entries are proposed until confirmed](../../SPEC.md#6-personalization-model) — Waypoint memory-inbox pattern; `hidden` depth requires confirmed refs.
- [Honesty rules for caveat/perspective](../../SPEC.md#5-honesty-rules) — four-way stance, sources required, no-coverage ≠ verified (from content-analysis assistant).
- [Fixture: Einstein 1905 Brownian motion, PD translation](../../SPEC.md#12-fixture-and-demo) — verify translation status before recording.
- [Hackathon repo posture](../../SPEC.md#9-scope) — new public repo, all hackathon-period commits, README distinguishes prior work (rule §76–77).
- [Ingestion today = paste/upload; Worker snapshot is stretch](../../SPEC.md#7-ingestion).
- [Widgets are stretch; figures are SVG](../../SPEC.md#10-tools).

## Not yet specified (fog, in scope)

- **Library / snapshot store.** Local-first, content-addressed, one reader-layer + agent-layer per hash; how re-snapshots of changed articles are shown; export/import format. Pocket-like UX.
- **Connectors with consent.** Drive (private docs), Zotero, Gmail newsletters: which patterns from LocalComms (loopback gating, redacted digest) and providers.md (grants) apply when there is no local daemon — does Bridge need one?
- **Voice interview.** Does ChatGPT Voice reach WebMCP tools? If not, what is the transcript-return seam (Feynman voice packet precedent) and is it acceptable?
- **The Feynman seam.** When does a knowledge entry ("I know this") become evidence ("I showed this")? Which Bridge operations may emit Feynman evidence at which rung? Coach-mode gating on Bridge (tools unregistering by level) — worth it or gimmick?
- **Taste memory.** Reader removes/edits agent artifacts → improvement-ledger records → preferences fold. What is learned, what is never learned (no vocabulary substitution regardless of taste).
- **Multi-agent parity.** Same page, different agents (ChatGPT, Chrome/Gemini, others): tool description phrasing that survives across models; per-agent attribution in the activity log.
- **Council-backed perspectivize.** Noether IRE Quorum verdicts rendered as perspective annotations with dissent; where the council runs when the page is static.
- **PDF fidelity.** Locator schema v1 adoption; page-region anchoring; figures in source PDFs.
- **Sharing a layer.** Sending someone your agent layer + reader layer for a document they must fetch themselves (no source redistribution).
- **Name.** "Bridge" is a codename.

## Out of scope (this map)

- Rewriting or summarizing source text in place — ruled out by ADR-0001, permanently.
- Any mastery/XP ledger in Bridge — belongs to Feynman; the seam is fog, the ledger is not.
- E-commerce / Shopify angle despite sponsor presence — no fit.

## Decisions added 2026-09-04 (brainstorm round 2)
- Name: **Marginalia** — margin is the product; source is the page.
- Contextual density replaces any global dial: density = f(knowledge entries for the section's concepts) + per-section chips + taste (SPEC §6).
- Pending-reshape rule: never reshape the section the reader is in (SPEC §4).
- Connections graph + `connection` kind built today (SPEC §18); Feynman edge vocabulary reused.
- Math (KaTeX) today; artifact registry with source-preference order web → archive → generated (SPEC §17).
- Three fixtures: Einstein (or CC-BY paper), Wikipedia article, own document (SPEC §21).

## Not yet specified — added
- **W7 Web journal** (see SPEC §22). **W8 Modalities** (audio/video/people/timeline/code/data).
- Fixtures final (06:45): Rutherford 1911 (PD) · The Conversation essay (CC BY-ND — layer rule = ND compliance) · Chrome WebMCP docs (CC BY 4.0). Einstein/Feynman Lectures/Aeon/Marginalian/Vaswani rejected with reasons in SPEC §21.
