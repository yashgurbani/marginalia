# HANDOFF — Marginalia v1 build (read this first)

17 September 2026, 07:00 CEST (rev 2, after Astra's review). Owner: Yash. Builders: Astra (daemon, skills), Fable (extension, webapp), Claude (PM, review, compliance). Design: Claude Design session in parallel.

## Read in this order

1. SPEC-FINAL.md — what we are building, the canonical vocabulary, the four privacy boundaries, the release capability table. Governs.
2. SPEC.md — numbered requirements R1–R30 with Astra's corrections, transform contracts, ranking rule, packet limits, store entities, security list. Derived.
3. BUILD-PLAN-24H.md — default decisions, the reply contract JSON (`marginalia.reply.v1`), lanes, tickets T00–T19, stages 0–5 with gates, cut order. No hours.
4. DESIGN-BRIEF-FINAL.md — the margin's structure, screens 1–14, craft rules, pass-2 acceptance criteria. Fable builds against it. DESIGN-FEEDBACK-PASS2.md is the paste for the design session.
5. MAP.md and tickets/ — every decision and why; open tickets resolve inside build tickets.
6. FEATURE-INVENTORY.md — everything in scope, tiered S/A/B/C/D. Nothing is cut; the letter is order.
7. The whitepaper (Claude Doc) — the reasoning and the review record; consult, do not re-litigate.
8. Astra's review package (docs/pivot-review/) — companion, not authority; MAP.md records what was accepted and rejected.

The existing repo's docs/BUILD-PLAN.md and PROJECT-REVIEW are superseded by this package. The Sep 4 reader (index.html, src/) stays as /reader and as the WebMCP assisted path.

## Non-negotiables (Claude refuses to merge without them)

- Source content is never rewritten; the content script adds only a namespaced shadow host and Custom Highlight marks; the margin renders in the side panel or an isolated panel.
- Replies are data. No generated HTML or script executes in v1; blocks render through the packaged kernel, whose grammar describes models and content, never interface behaviour. A slider never costs inference; a changed input outside a samples envelope re-runs the saved solver in the daemon without a model turn (T20); only a changed model asks Codex again, as an explicit action. Nothing unsupported is silently replaced.
- Nothing renders unless validated (schema → bounds → selectors → kind fields → host checks → renderer restrictions) and committed as an immutable reply version. A failed check is a plain visible sentence. A headline claim without its host check is withheld.
- Nothing automatic before the site grant. Closed sessions provably cannot reach the network; open sessions need a separate per-site grant and an observed fetch record (or say "incomplete").
- No provider credential in the browser (only the pairing token); the egress record shows what left, to whom, under which grant. Unknown outcomes are never auto-retried.
- Node 24; JobRunner with app-server primary and mcp-server second; pinned Codex version.
- Notes sit above replies; the reader's layer is senior.
- No on-screen words: artifact, provenance, ledger, transform, tier, job. No badges, pills, sparkles, "AI", confidence.
- One clarifying question at most before a build; assumptions visible and editable after.
- "Tested" means a screenshot or console transcript in the PR. The integrator rejects claims.

## Lanes and files

One lane per file tree. /daemon and /skills: Astra. /extension and /webapp: Fable. /contracts: Astra writes, both read; changes need Claude's review. /extension/renderer (the kernel): Fable, with the contract's bounded grammar as its test suite. /reader: frozen except T10.

## Checkpoints

Every lane writes `.scratch/checkpoints/<stage>-<lane>.md` at each stage gate and on any blocker: done_since_last, evidence, on_live_build (what the owner would see now), blockers, merge_request, risk. Claude returns GREEN / AMBER / RED per lane.

## Definition of done

SPEC-FINAL.md §Definition of done (v2) and §Release, plus the eight gates in the entry packet. The demo is the corrected Navier–Stokes fixture and one unseen page, recorded on a fresh machine.
