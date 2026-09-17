# Marginalia — Final Spec v2

17 September 2026, revised after Astra's review. This file governs. SPEC.md holds the numbered requirements R1–R30 (now a derived view with Astra's corrections applied); BUILD-PLAN-24H.md holds the stage-gated build; the whitepaper explains why. Where anything differs, this file wins. The release capability table in §Release decides what ships; nothing else in this file or elsewhere overrides it.

## Purpose

Marginalia is a margin beside whatever you are reading. Select a passage, or write a note, and get real help in the form that fits: a definition in this context, a worked instance, a small model you can move, a diagram whose parts point back into the sentence, an evidence check, a link to your own notes. The source is never rewritten. The work stays as a thread you can come back to. Your own Codex authors the help; your browser runs it.

Product goals: invite thinking, reflection and organization. Assistance beyond summarization. Clarity first. Friendly to a first-time web reader and useful to a researcher. No AI theatre. Where the product competes: inspectable, interactive explanations attached to passages, at the source.

## Vocabulary (canonical; code, tickets and UI)

| Concept | Internal | On screen |
|---|---|---|
| Durable conversation at a source location | `thread` (states `open`, `parked`, `done`, `archived`) | Thread · Open / Parked / Done / Archived |
| Reader-authored text | `note` | Note |
| Saved selection | `highlight` | Highlight / Keep |
| Generated immutable response version | `reply_version` | Reply |
| Removal | `deleted_at` tombstone with undo | Remove / Undo |
| Reattachment result | `exact`, `moved`, `unsure`, `lost` | same words, shown only when not exact |
| What was asked | `intent`: `define`, `simulate`, `instantiate`, `derive`, `diagram`, `evidence`, `explore`, `unsure` | plain action label (Define, Show me, Check this, Go further) |
| What came back | typed `blocks`: text, equation, model, plot, derived, classification, table, diagram, citations, shelf, grid | no schema words |
| Execution | `job` / `attempt` states `queued`, `running`, `validating`, `succeeded`, `failed`, `cancelled`, `timed_out`, `outcome_unknown` (+ `cancel_requested`) | Working · Ready · Cancelled · Failed · Unknown, try again |
| Local process | `daemon` | "the local helper" only in setup copy |

Intent and block type are separate axes: a simulate reply may carry text, a model, a plot and a table; an explore reply carries a shelf and citations. Editable assumptions, uneditable source facts and host-recorded execution facts are three different records.

Words that never appear on screen: artifact, provenance, ledger, transform, tier, job, schema, sandbox, MCP. No badges, pills, sparkles, "AI", confidence.

## Surfaces

- Extension (WXT, MV3, Node 24 toolchain): content script (selection, W3C selectors, page signals, namespaced shadow host for marks via the CSS Custom Highlight API; source content and layout preserved — the host adds nodes, never edits the page's), margin host, service worker treated as disposable (a reconnecting daemon client with no state it cannot rebuild). The margin is a Chrome side panel where the API exists (opened on a user gesture), an injected floating panel elsewhere; identical content either way. Supported pages: http(s) pages with extractable text; not browser pages, credential fields, private windows when policy says so, or excluded sites.
- Daemon (Node 24 LTS, TypeScript): store (SQLite, WAL, FTS5), jobs, router, Codex adapters behind one `JobRunner` interface, validator, egress record; serves a small localhost page for threads and settings. Loopback only; Host and Origin validated; a port is not authentication.
- PDF viewer: the extension's own page on PaperCraft's overlay model, same margin (designed now; built in stage 5).
- Later: hosted home.

## The margin

A column in page order that scrolls with the page. Three zones.

Top: page identity in one or two lines (kind of page, date, author or venue); an optional one-line context summary, collapsed; "Assumes:" three to five terms the page uses without defining, only after the site grant (see Privacy); "You were here" if a thread exists. The top zone never takes more than a quarter of a 360 px panel by default.

Middle: your notes and highlights, the agent's replies indented beneath them, one marker per section. Order is anchor order, always. The item at your reading position is full size; one section away is one line; further is a tick. Compactness is by size and excerpt, never by fading ink. A one-line "write here" affordance follows your position and expands on focus.

Reading position follows the page while you are idle. It holds while a note, a slider, an assumption editor or keyboard focus is inside an item; a quiet "follow reading" action returns it. Hovering a source binding lights the phrase in the page; only an explicit action scrolls the page.

Bottom: threads on this page, related in your library, save, park, hear it. At the end of the page: "think with it" (reflect) and "go further" (explore).

Collapsed, the margin is a rail: ticks for your marks, rule lines for sections, one dot while something is building, a hairline density strip, and (held decision) the coloured page map. Below 900 px the rail opens a sheet showing one passage and its reply, with a quoted breadcrumb back; features are never merely hidden.

## Asking

Select text or use Ask on a note. A small card appears at the anchor: Keep, and Ask. If the document itself defines the term, that quoted definition shows at once with "from this page"; nothing is sent. If the site grant exists and you have chosen automatic definitions, a fast contextual definition arrives without a click and can be read and dismissed. Otherwise Ask opens at most three suggested helps, with a time word on deep ones, and a free-text line. Selecting sends nothing; only Ask (or an enabled automatic definition under an existing grant) sends.

Deep help builds while you keep reading: Working (with the plan line), first frame (visibly provisional until checks pass), Ready; cancel always visible; elapsed time after 30 s. One clarifying question at most; otherwise a sensible default the reply shows in "What this example assumes (n)", which you can open and change — a change creates a new reply version. A follow-up field inside a reply continues the same thread.

Suggestions come from what the block is (term, equation, mechanism, claim, procedure, page), what the page is, and what you wrote. They never reorder under your hand; new ones appear as a quiet "more ideas" line. Keep and Park work without any provider.

## Replies

**Codex authors the model; the margin runs it.** A reply is data — typed blocks — rendered by packaged code. Execution and inference are different axes, and a reply's interaction can take four paths, in this order of preference:

1. Packaged local evaluation (default; zero model tokens per interaction): a bounded expression parser, integrators (RK4, adaptive RK45 with step and horizon caps), iterated maps, closed-form evaluation, KaTeX, a layout engine for diagrams, step and comparison views. Sliders, hovers, stepping and re-plots happen here.
2. Precomputed samples (zero tokens per interaction; one execution): results over declared parameter axes with a recorded envelope (axes, coverage, sampling, interpolation method, error evidence, forbidden regions). The renderer interpolates only inside the envelope and offers recomputation outside it; it never extrapolates silently.
3. Re-run the saved solver (zero model tokens; time and compute): the solver Codex wrote is a file in the job workspace; the daemon executes it in the same isolated environment with new inputs, under the same grants, limits, cancellation and provenance, and returns validated results to the same blocks. This is how a changed initial condition outside the grid, a reproduce-figure, or an executable skill runs without asking the model anything.
4. Ask Codex again (a model turn): only when a new question must be interpreted or the model itself revised. Shown as an action ("ask again with this change"), never as a slider.

Governing requirement (from Astra's coverage review, accepted): every original transform remains in scope. The kernel is the default execution path, not the ceiling on what Marginalia can explain. Unsupported computation moves to an explicit alternative backend (path 3, or a later sandboxed surface) while preserving the same source attachment, assumptions, controls and saved thread. No reduced substitute is presented as equivalent; an unsupported case says so.

Store policy, stated precisely: Chrome's MV3 rule requires executable code to ship in the package, exempts remote code in contexts isolated from extension APIs (sandboxed pages, qualifying iframes), and warns that an interpreter for complex remote commands can violate the policy even when the commands arrive as data. Firefox requires self-contained add-ons and is assessed separately. Consequences: the block grammar describes models and content (equations, parameters, nodes, claims, media), never interface behaviour, so the renderer is a bounded mathematical and content renderer rather than a command interpreter; no generated script executes in v1; a sandboxed page for runtime-invented interfaces is a later, explicitly labelled capability, not a fallback the kernel quietly uses. Zero tokens per local interaction is a design property we enforce; lower total authoring cost than generated code is plausible and is measured, not assumed.

Every reply is validated before it renders: schema → numeric and resource bounds → selector existence → kind-specific fields → host checks → renderer restrictions. Host checks and model self-reports are stored and shown with different authority. **A reply's headline claim (a classification, a result sentence) must itself be one of its host checks**; a reply whose headline has no check renders with the headline withheld.

A reply shows, in order: the thing itself; when the model is an illustration, one visible sentence under the title saying so ("Illustration of self-amplifying growth. Not the paper's fluid model or a reproduction of its result."); two short text actions, "Source passage" and "How this was made", with the where-from glyph line as a supplement; "What this example assumes (n)"; a follow-up field; a way back to the anchor. A failed check is a plain sentence ("The calculation did not reproduce its starting value. Try again."). A partial reply is visibly provisional. A wrong reply can be removed; removal is a tombstone with undo and stays in thread history.

Block set at launch: text, equation, model (declared solver classes: scalar and small-system ODEs, iterated maps; families, not a promise for every equation in them; event, stability and horizon handling declared per model), plot, derived (a named closed-form quantity), classification (label + rule + the check that backs it; a model with no closed-form criterion reports "no conclusion beyond the shown interval" rather than settling), table, diagram (nodes, edges, groups), steps (a derivation revealed one step at a time; revealing needs no inference), compare (side-by-side variants), question (one clarifying question with answer controls), turn (a versioned conversational follow-up), citations (claim · support · source · date · fetched?), shelf (title · reason · link), samples (precomputed results with their envelope), solver (a reference to the saved executable for path 3), media (audio, image, video with transcript or alt text and timecodes; capability-gated by provider, declared now).

## Notes

A note is yours, anchored to an explicit passage or a chosen section, written in the margin. The anchor freezes when you start writing and is shown as text ("Note on 'Viscosity pulls toward…' · Change"); "whole page" and additional passages are deliberate choices. Notes sit above any reply at the same anchor. Ask on a note (or a "?" ending, which offers Ask and never sends by itself) opens suggestions with the note as context; the reply quotes the note version it answers. Notes feed a vocabulary the margin uses to decide what needs defining; entries say looked-up / used / stated familiar, show their origin, and can be deleted.

## Privacy: four boundaries, four promises

1. Storage: everything is stored on your machine and exports as JSON (Markdown next). Reading, notes and highlights work with no helper and no account.
2. Cloud inference: Codex is a service. Asking sends the passage, your note, page facts and bounded context to it. The first time on a new site you see the exact outgoing text, the recipient and the scope, and choose this time / always on this site / never on this site. Denial persists and is editable in settings. A dot in the rail lights while something is sending (separate from "working").
3. Tool network: closed sessions (define, simulate) run with the sandbox's network off, verified by a test. Evidence and explore need an open session, which is a second, narrower consent per site.
4. External retrieval: fetched URLs are recorded by an observed broker; if a session could fetch outside the broker, the record says "incomplete". Fetches refuse local/private addresses, unsupported schemes and oversized responses.

Nothing automatic (assumed terms, metadata lookups, automatic definitions) runs before the site grant. Sites you exclude never send anything, checked before extraction and again in the daemon. No credential for Codex is ever in the browser; the extension holds only its own pairing token. Page text, fetched pages and skill instructions are untrusted data: they cannot add grants, tools or policy.

## Codex

The daemon drives your own Codex through a `JobRunner` interface {start, resume, cancel, inspect} with two adapters: `codex app-server` over stdio (primary: thread/start, thread/resume, turn/interrupt, live events) and `codex mcp-server` (second adapter; interrupt degrades to abandon + tombstone). The Codex version is pinned and checked at pairing; both adapters pass one integration test (start, interrupt, resume, recovery after daemon restart) before either is trusted. One provider thread per marginalia thread where the adapter supports it; fork on provider or permission change. Job folder holds the packet, the skill instructions and the reply schema; sandbox workspace-write; network per session policy; approval-policy never; model per tier (fast: Luna; deep: Astra). Results are files, `reply.partial.json` then `reply.json`, written atomically inside the workspace with byte, depth and array limits; a file has no authority until validation commits a version. Cancel fences late output. A disconnect is not a provider failure; an unknown outcome is shown as unknown with an explicit retry, never auto-retried. If Codex is unavailable the margin says so and reading continues; the ChatGPT desktop path (WebMCP) is an experimental extra, not a fallback the product depends on.

## Release

| Capability | Launch | Gate |
|---|---|---|
| Keep, Park, notes with explicit anchors, highlights, threads, reload/reattach, export JSON | yes | stage 1 |
| Pairing, site grants, exclusions, egress record, calm states | yes | stages 1–2 |
| Define (document quote first; Codex fast tier) | yes | stage 2 |
| Simulate / plot / diagram / instantiate via typed blocks with local interaction | yes | stage 3 |
| Corrected Navier–Stokes fixture with analytic classification | yes | stage 0 |
| Evidence, Explore (open sessions, brokered fetch) | in the build; listed only if stage 5a gate passes on launch day | stage 5a |
| Assumed-terms header, situate | after site grant; ships with stage 2 if green | stage 2 |
| PDF viewer, library search, local models, hosted home | roadmap | stage 5 |

Distribution at launch is an alpha path (unpacked extension + daemon installer); the listing says so. Public claims match a recorded fresh-machine run.

## Definition of done (v2)

1. On the Navier–Stokes post and on one unseen page: select → card → definition → deep help builds live → reply with the illustration line, assumptions, a way back → reload reattaches the thread.
2. A note with Ask produces a reply that quotes the note; a note's anchor survives reload and page edits show as moved/unsure, never guessed.
3. The fixture classifies (0.5, 0.07, 0) as diverging at ≈32.4 s beyond the shown 8 s, (0.5, 0.2, 0) at ≈5.84 s, (0, 0.01, 0) at ≈15.7 s, and settling cases as settling; the check backing the label is visible; the slider costs no inference.
4. If shipped: an evidence reply separates the claim from dated support and lists what it fetched; an explore shelf parks three to five reasoned items; a closed session provably cannot reach the network.
5. Cancel, failure, malformed reply, unknown outcome, disconnect, excluded site each show a calm state; nothing is auto-retried.
6. No Codex credential in the browser; the record shows what left the machine, to whom, under which grant.
7. Keyboard-only; screen reader hears "ready" without losing focus; both themes; 200 % zoom; reduced motion; targets ≥ 24 px hit area.
8. Listing, video and README describe the recorded run.
