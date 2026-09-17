# Build plan — stage-gated (v2; supersedes the hour plan)

Destination: a working extension + daemon in which selecting a passage on a real page opens the margin, suggestions appear instantly, a definition arrives, a deep transform runs through the reader's own Codex, the reply streams into the margin as typed blocks the browser runs, the assumptions and the egress record are visible, and the thread survives a reload and a daemon restart. Hours are gone; gates remain. Publish the scope that passed its gate on launch day.

## Default decisions (override any; otherwise these stand)

| Decision | Default | Why |
|---|---|---|
| Daemon stack | Node 24 LTS + TypeScript; `better-sqlite3` (WAL, FTS5); `ws` loopback with Host/Origin checks | Node 20 is EOL; one file store; official pieces |
| Codex transport | `JobRunner` {start, resume, cancel, inspect}; `codex app-server` over stdio primary; `codex mcp-server` second adapter; Codex version pinned and checked at pairing | interrupt, resume and events are core requirements; app-server has them; mcp-server has no interrupt |
| Extension scaffold | WXT, MV3, TypeScript | cross-browser; MV3 constraints handled; worker disposable |
| Margin host | Chrome side panel (opened on user gesture); floating panel elsewhere; content script owns selection, selectors, page signals, namespaced shadow host and Custom Highlight marks | native home; no page edits; one design, two hosts |
| Reply rendering | typed blocks rendered by packaged code: expression parser (bounded grammar), RK4/RK45 with caps, iterated maps, KaTeX, diagram layout (dagre or elk, MIT), plot, steps, compare, media; no generated HTML/JS executes in v1; the grammar describes models and content, never interface behaviour | validation and zero-token interaction; Chrome's MV3 policy exempts isolated sandboxes but warns against command interpreters, so the renderer stays a bounded content renderer |
| Execution paths | 1 local kernel · 2 precomputed samples inside a recorded envelope · 3 re-run the saved solver in the daemon's isolated environment (no model tokens) · 4 ask Codex again (explicit action) | execution and inference are different axes; nothing unsupported is silently replaced |
| Anchoring | Hypothesis `dom-anchor-text-quote` + `dom-anchor-text-position` (MIT); explicit source versions; separate attachment records; no nearest-match guessing | proven selectors; honest reattachment |
| Capture | Mozilla Readability for the reflowed view; original text hash as version; no SingleFile (AGPL) | licence-clean |
| Store | SQLite; entities per SPEC.md §10; outbox for replay | one file, easy export |
| Transforms in the build | define, simulate (plot / model / diagram / instantiate share the renderer), keep, park, unsure; evidence and explore behind stage 5a | the corrected Navier–Stokes demo plus reader marks |
| Context packet | SPEC.md §7; preview shows the actual payload | bounded and inspectable |
| Sessions | closed (network off, tested) for define/simulate; open (brokered fetch, separate per-site grant, fetched-URL record) for evidence/explore | two policies, one manager |
| Consent | four boundaries (storage, cloud inference, tool network, retrieval); nothing automatic before the site grant | one promise per boundary |
| Reply contract | `marginalia.reply.v1` below | the seam between Codex, daemon and margin |
| Fixture | corrected toy: y' = y² − γy + f, analytic classification; kinematic vortex field u = (−ax−ωy, ωx−ay, 2az) as a second illustration if time allows | scientifically true demo |
| WebMCP | experimental adapter, `insert_reply`, capability-checked | kept, nothing depends on it |

## Reply contract v1 (write this file first)

```json
{
  "schema": "marginalia.reply.v1",
  "intent": "define | simulate | instantiate | derive | diagram | evidence | explore | unsure",
  "status": "partial | complete",
  "title": "Self-amplifying growth against damping",
  "summary": "one sentence",
  "illustration": {"value": true, "statement": "Illustration of self-amplifying growth. Not the paper's fluid model or a reproduction of its result."},
  "sourceBindings": [{"name": "gamma", "meaning": "damping rate", "relation": "interpreted", "selector": {"exact": "…", "prefix": "…", "suffix": "…"}}],
  "parameters": [{"name": "gamma", "label": "damping", "default": 0.5, "min": 0, "max": 2, "unit": "1/s"},
                 {"name": "f", "label": "forcing", "default": 0.07, "min": 0, "max": 1, "unit": "1/s²"},
                 {"name": "y0", "label": "start", "default": 0, "min": -2, "max": 2, "unit": ""}],
  "assumptions": [{"id": "a1", "text": "Constant forcing; a single scalar stands in for the flow's amplitude.", "editable": true}],
  "limitations": ["No spatial structure, pressure, incompressibility or energy bound; nothing about the proof."],
  "blocks": [
    {"type": "text", "md": "…"},
    {"type": "equation", "tex": "y' = y^2 - \\gamma y + f"},
    {"type": "model", "id": "m1", "kind": "ode", "state": ["y"], "rhs": {"y": "y^2 - gamma*y + f"}, "initial": {"y": "y0"}, "horizon": 8, "method": "rk45", "maxSteps": 20000},
    {"type": "plot", "from": "m1", "x": "t", "y": ["y"], "yRange": [-1, 10], "labels": {"y": "amplitude"}},
    {"type": "derived", "id": "T", "label": "time to diverge", "when": "y0 == 0 && f > gamma^2/4", "expr": "(pi/2 - atan((y0 - gamma/2)/sqrt(f - gamma^2/4))) / sqrt(f - gamma^2/4)", "unit": "s"},
    {"type": "solver", "id": "s1", "file": "solver.py", "inputs": ["gamma", "f", "y0", "horizon"], "outputs": ["t", "y"], "limits": {"cpuSeconds": 20, "memoryMb": 256}},
    {"type": "classification", "id": "c1", "cases": [
      {"when": "y0 == 0 && f > gamma^2/4", "label": "Diverges at {T} s{T > horizon ? ' (beyond the shown 8 s)' : ''}"},
      {"when": "y0 == 0 && f == gamma^2/4", "label": "On the threshold: rises toward {gamma/2} and stays"},
      {"when": "y0 == 0 && f < gamma^2/4", "label": "Settles near {gamma/2 - sqrt(gamma^2/4 - f)}"},
      {"else": "Start changed: the from-rest rule no longer applies; see the curve"}],
      "check": "chk-class"}
  ],
  "checks": [
    {"id": "chk-y0", "kind": "host", "expect": "solution at t=0 equals y0", "result": "pass"},
    {"id": "chk-class", "kind": "host", "expect": "label agrees with the closed-form criterion for the current parameters", "result": "pass"},
    {"id": "chk-T", "kind": "host", "expect": "numeric divergence time within 2% of T when T < horizon", "result": "pass"},
    {"id": "chk-self", "kind": "model", "expect": "model reports it checked units", "result": "pass"}
  ],
  "provenance": [
    {"part": "equation", "source": "generated", "relation": "analogy"},
    {"part": "gamma", "source": "document", "relation": "interpreted"},
    {"part": "T", "source": "generated", "relation": "computed"}
  ],
  "staticFallback": "text"
}
```

Rules: Codex writes `reply.partial.json` then `reply.json` atomically inside the job workspace (size, depth, array limits; no path escape). The daemon validates (schema → bounds → selectors → kind fields → host checks → renderer restrictions) and commits an immutable `reply_version`; the margin renders only committed versions and shows `partial` as provisional. A `classification` block must reference a host check or its label is withheld. Blocks never contain code; expressions use the bounded grammar (arithmetic, comparison, `pi e sqrt exp log sin cos tan atan abs min max`, no calls otherwise, no loops). `samples` blocks carry declared axes, coverage, sampling, interpolation method, error evidence and forbidden regions; the renderer never interpolates outside that envelope. `solver` blocks reference a file inside the job workspace that the daemon may re-execute (path 3) with new inputs under the job's grants and limits.

## Lanes

- **Astra:** daemon (T01, T02, T03, T06, T07, T13, T17), skills (T08, T09, T14, T15), fixture correction (T00)
- **Fable:** extension (T04, T05, T16, T17 UI), renderer kernel (T18), WebMCP (T10), webapp (T11)
- **Yash:** decisions, integration tests on real pages, fixture review, video and listing (T12)

One lane per file tree; "tested" means a screenshot or console transcript; the integrator rejects claims.

## Tickets

| # | Ticket | Lane | Blocked by | Done means |
|---|---|---|---|---|
| T00 | Fixture correction: rename ν→γ; analytic classification with closed-form T; regression set (divergence beyond horizon, convergence, threshold equality, zero forcing, changed y0); illustration statement; drop the Euler causal line | Astra | — | probe script agrees with Astra's science-probe.json on all four rows plus the regression set |
| T03 | Reply contract + validator + host checks runner + renderer restrictions; malicious and invalid fixtures | Astra | — | valid fixture accepted; oversized, path-escaping, code-bearing and headline-without-check fixtures rejected with reasons |
| T01 | Daemon skeleton: loopback WS/HTTP with Host/Origin checks, challenge→token pairing with revoke, health, config, logging without page text | Astra | — | extension pairs; `/health` reports Codex login, pinned version, sandbox availability |
| T04 | Extension scaffold: content script, selection with selectors, page meta, namespaced shadow host, Custom Highlight marks, disposable worker with reconnecting client | Fable | — | selecting on arXiv HTML and a news page sends nothing; Ask sends a packet the daemon logs by hash |
| T18 | Renderer kernel: expression parser (bounded grammar), RK4/RK45 with caps, derived/classification evaluation, plot, equation (KaTeX), diagram layout, table, steps, compare, citations, shelf, samples interpolation inside the envelope, media stubs; stable prefixed IDs | Fable | T03 | the T00 fixture renders and the slider re-solves locally; classification matches the closed form; a request outside a samples envelope offers recompute; no eval anywhere |
| T20 | Saved-solver execution (path 3): the daemon re-runs `solver` files from a job workspace under the Codex sandbox runner with new inputs, no model turn; grants, limits, cancellation, provenance, caching; results validated into the same blocks | Astra | T02, T06 | change y0 beyond the samples envelope → the margin offers "recompute" → the daemon returns new data in seconds with no model call logged |
| T05 | Margin panel (side panel + floating host): column in anchor order, ask card (Keep · Ask; document quote first), suggestions (static v1 table, no reorder), build states with provisional first frame, reply with illustration line, "Source passage" / "How this was made", "What this example assumes (n)", follow-up, back; held reading position; rail | Fable | T18, design frames 1–5 rev 2 | the fixture reply renders live on the Navier–Stokes page; scrolling with a slider focused does not move the item |
| T07 | Store + threads: SQLite entities, notes/highlights persisted before replies, explicit anchors, attachment records, tombstones with undo, outbox, resume on reload and after daemon restart | Astra | T03 | reload and daemon restart reattach; an edited page shows moved/unsure, never a guess |
| T16 | Notes: explicit anchor frozen on start with "Change"; whole-page option; Save + Enter accelerator with draft recovery; notes above replies; Ask on a note; reply quotes the note version; vocabulary entries with origin and delete | Fable + Astra | T05, T07 | a note's anchor survives drafting elsewhere and reload; Ask on it yields a reply quoting it |
| T02 | JobRunner + app-server adapter (thread/start, resume, turn/interrupt, events) + mcp-server adapter; pinned version check; integration test | Astra | T01 | both adapters pass start / interrupt / resume / recover-after-restart; app-server chosen if green, otherwise mcp-server with abandon+tombstone |
| T06 | Job engine: persisted job before execution, attempts, states incl. outcome_unknown, cancel fence, progressive reply watch, WS events with replay | Astra | T02, T03 | margin shows Working → provisional → Ready from a real run; cancel after completion does not replace the view; unknown outcome offers retry only |
| T13 | Consent + sessions: first-send sheet (exact context, recipient, scope; this time / always here / never here), persisted denial, closed sessions with network-off test, open sessions via observed broker with private-address refusal and fetched-resource record | Astra + Fable | T01, T05 | excluded site sends nothing; closed session cannot fetch; open session lists what it read or says "incomplete" |
| T08 | Define: document quote first (no send); skill folder; fast tier via Codex read-only, model=Luna, under grant | Fable + Astra | T02, T05, T13 | an unseen term gets a real reply; a term the page defines shows the quote with no send |
| T09 | Simulate: skill folder with instructions, schema, checks; Codex authors blocks; optional grid job; T00 fixture and one unseen passage | Astra | T06, T18 | demo passage yields the corrected model; second passage yields a correct model; slider costs no inference |
| T17 | Page header: identity from page meta (local); assumed terms and Semantic Scholar only under grant, cached by hash; "you were here" | Astra + Fable | T05, T13 | header within 2 s with no send; assumed terms only after grant; nothing on excluded sites |
| T14 | Evidence: skill folder; claim vs dated support; abstains when it cannot cite; claim-level citations | Astra | T13 | on "Concurrent work" (captured version noted), the reply separates the claim from dated support with fetched items marked |
| T15 | Explore: skill folder; three to five items with reasons; parked by default | Astra | T13 | end of the post yields a shelf with the PDF, the Lean repo and the Clay statement |
| T10 | WebMCP adapter: capability check, `insert_reply`, typed blocks only | Fable | T05 | ChatGPT desktop browser inserts a validated reply on a non-fixture page, or the adapter reports unsupported |
| T11 | Localhost webapp: thread list, open thread, settings (models, grants, exclusions, vocabulary, export JSON) | Fable | T07 | saved threads listed; a revoked grant stops sends |
| T19 | Install and recovery: daemon installer per OS, first-run pairing, diagnostics page, upgrade path, fresh-machine test | Astra + Yash | T01, T11 | a new reader installs, pairs, recovers from daemon stop and Codex sign-out without losing notes |
| T12 | Launch: fresh-machine recorded run, second unseen passage, failure and cancel exercised, video, listing copy, README with the honest scope and alpha distribution | Yash | gates | the eight gates recorded with evidence; listing matches the run |

## Stages and gates

| Stage | Tickets | Gate before continuing |
|---|---|---|
| 0 Contract | T00, T03 | one valid fixture and the malicious/invalid fixtures establish what is accepted and rejected; probe agrees with the closed form |
| 1 Durable reader | T01, T04, T07, T16, design rev 2 | save a note on a real page; restart daemon and browser; recover it; edit the page text and see moved/unsure |
| 2 Real definition | T02, T06, T13, T08, T17 | an unseen term gets a real reply; excluded page sends nothing; unknown outcome does not auto-retry; sending indicator separate from working |
| 3 Interactive reply | T18, T05, T09, T20 | correct model on the demo and a second passage; slider costs no inference; malformed output cannot run; headline withheld without its check |
| 4 Install and release | T11, T19, T12 | a new reader installs and recovers; all public claims match the recorded run |
| 5a Evidenced expansion (launch if green) | T14, T15 | closed session provably offline; open session's fetched record complete or labelled incomplete; no fabricated sources |
| 5b Roadmap | T10, PDF viewer, library search, local models, hosted home | each with its own fidelity, permission, persistence and failure contract |

## Cut order if the day runs short

Drop in this order: T10, T15, T14 (both become an honest "needs web access, coming" state, never a dead action), T17's assumed terms (keep identity), the assumptions editor (show read-only), the kinematic second illustration. Never T00, T03, T18's classification path, T20 (without it a changed input outside the envelope becomes a model turn, which is the token burn we set out to avoid), T13's closed-session guarantee, T19's fresh-machine test, or T12.
