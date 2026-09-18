# Handoff to Astra: take Marginalia to the founding vision

Written by Fable on 2026-09-18. You are `gpt-6-astra`, the technical lead. Start at low effort. Use medium only for coupled reasoning. Every statement below about worker output is a claim until you check it against files.

## Your job
Work the tickets in `wayfinder/polish/tickets/` until the product matches the founding documents. Yash's words: "review the whole product against the vision and bring it to the level of an actual polished product", with simulations, Ask and every envisioned feature built.

## Read first, in this order
1. `docs/sources/RESEARCH-WHITEPAPER-v3.md`, `PRODUCT.md` and `docs/BUILD-PLAN.md`. These govern. Never rewrite their words or promises. Re-read them at every milestone.
2. `wayfinder/polish/MAP.md` (destination, notes, ticket table, decisions, open fog).
3. `wayfinder/polish/PACKET-PREAMBLE.md` (worker rules, the four checks, report format).
4. `D:\Projects\Marginalia\.local\polish\audit.md` (the gap ledger with file and line; an unverified worker claim beyond three spot-checks).

## Hard rules
- No git writes until Yash says so: no commit, push, reset, stash pop, worktree change or branch change. Work in the main working tree. `main` is at `6b3b246`.
- No pushes to `main` and no Pages change before 2026-09-21 17:00 PT. Never touch the `webmcp-v1` branch or `archive/v1-webmcp/`.
- Never touch: root `README.md`, `CONTEXT.md`, the root whitepaper, untracked founding documents, the stash `7be304e`, the Edge profiles under `.scratch/artifacts/W8/`.
- Never print token or auth contents. Never show a pairing code. Never dispatch on the gs account (Codex-11). Yash signs in himself.
- Product invariants: the source page is never changed. The reader reviews the exact outgoing content and recipient before any send. Nothing is looked up or inferred on load, selection, reopening, reconnecting or recovery. Four distinct execution paths stay distinct. Never show a reply that was not received live.
- Reader-facing text: no em dashes, no negation constructions, no exclamation marks, no invented facts. Link the whitepaper.
- At most two writers at once, on disjoint owned paths. One child layer. Children never delegate. Makers never self-certify: run the four checks yourself before closing a ticket.
- Tickets that own `ui/margin.ts` run one at a time.
- Stop and ask Yash on anything that changes what the product is.

## The four checks
`npm test` (read the `ℹ` lines), `npx --no-install tsc --noEmit`, `npm run extension:typecheck`, `npm run extension:build`. Baseline at `6b3b246`: 964 tests, 958 pass, 0 fail, 6 skipped. A ticket closes only at zero failures.

## State at handoff (verify before acting)
- **Related saved passages in the margin (P01):** code is in `ui/margin.ts` and `tests/margin-entry.test.ts`, uncommitted. It reads on page load, which breaks `tests/margin-recovery.test.ts` :181 :198 :230 :258 and `tests/e33-webapp-open.test.ts:7`. Those tests stay. The full correction is now in the ticket under "Correction 1": Related starts closed and looks up only when the reader opens it. It never ran (account cap). Do it first.
- **Solver authoring contract (P04):** code is in `skills/simulate/`, `contracts/solver.ts`, `daemon/jobs/solver-bindings.ts` and two tests, uncommitted. The full correction is in the ticket under "Correction 1": manifests for nine old solver fixtures, plus a plain refusal for a saved solver with no manifest. A worker was partway through it at handoff, so inspect the tree first. Read `.local/polish/reports/P04.md` and `logs/P04-c1.log`, then run the checks.
- Last worker count: 981 tests, 959 pass, 16 fail, 6 skipped. Fable accepted nothing.
- Pre-existing uncommitted edits by Yash or earlier work exist in `contracts/solver.ts`, `daemon/jobs/solver-bindings.ts`, `tests/margin-entry.test.ts`, `ui/margin.ts`. Do not revert them.

## Yash's decisions (2026-09-18, in the G tickets)
1. Three offers, the rest under More, plus a line to type your own. The leaders come from the whitepaper's additive score at `RESEARCH-WHITEPAPER-v3.md:131` to `:145`: block fit, page fit, stated preference, a useful reply nearby, minus a dismissal penalty. Eligibility is the only hard filter. Positions never move once drawn. Build this score inside "Three offers plus More" (P02); no hardcoded trio.
2. Single-parameter assumptions change locally. Structural changes are a new ask. Provisional ("yes?").
3. Vocabulary keeps explicit Remember and also gathers locally from use over time, with origins shown.
4. The journal integrates the day's reading. Journeys are its automatic topics with notes, bookmarks, highlights and transforms.

## Order of work
Each line is one ticket file. Finish, verify, record `## Resolution` in the ticket, add one line to the map's Decisions so far.

1. Finish P01 and P04 corrections.
2. Simulation chain: P05 solver continuation, P06 real solver recompute, P08 parameter source binding (shares `skills/simulate/IO.md` with P04), P09 local assumptions, P10 provisional first frame.
3. Ask kinds: P03 unsure bundle, P13 instantiate and derive acceptance, P12 evidence reconcile, P11 explore shelf, P02 three offers by score.
4. Rendering proof: P07 real diagrams and equations in a browser, then P17 keyboard, zoom and reduced motion.
5. Margin and library: P14 Hear it, P15 page Save and Park, P16 BibTeX export, P20 vocabulary gathers from use, P21 daily journal view, P22 journeys by topic.
6. Health: P18 extract reading position from `ui/margin.ts`, P19 copy refresh.
7. Live runs with Yash present: L01 one real definition, L02 one real simulation, L03 four paths on one thread. Prepare the checklist; Yash drives the signed-in runtime.

Parallel pairs that do not collide: P05 with P03; P06 with P13; P07 with P16; P12 with P20; P21 with P08.

## Still fog (in the map's Not yet specified; ask before building)
PDF reading, runtime readiness (seven gaps in `daemon/consent/evidence-host.ts`), web evidence fetching, Firefox, the WebMCP adapter, other providers, cited search, sharing, the sixth offer's label, model-written journey synthesis.

## Open release gates that code cannot close
Real-provider evidence (Q03, Q04), positive observed confinement (Q06), native browser and install evidence, runtime direction (H17), and Yash's own twenty-minute reading verdict (H15).

## Dispatch mechanics
`D:\Projects\Marginalia\.local\polish\launch.ps1 -Id P03 -TicketFile P03-unsure-bundle.md -CodexHome <home> -Ethos "<one line from PRODUCT.md>" -OtherPaths "<the other writer's paths>"`. Logs land in `.local/polish/logs/`, reports in `.local/polish/reports/`. Account caps at 10:30 on 2026-09-18: allen until 2:02 PM, robi until 1:27 PM, Codex-30 until Sep 19 10:17 AM; lrh was working. Smoke-test an account with a one-word prompt before use.

## Report back
Per ticket: status, actual model and effort, changed paths, the `ℹ` lines, every remaining failure by file and line, what stays unverified. Keep failures and dissent on record.
