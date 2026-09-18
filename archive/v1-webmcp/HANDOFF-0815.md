# HANDOFF — 08:15 realignment (supersedes the schedule in HANDOFF.md)

Deadline 10:00 CEST. **Submit 09:35. Freeze 09:15. Merge window closes 09:10.** No decisions
after 08:20; anything undecided is out. The only currency now is: what runs on the live URL in the
ChatGPT desktop browser at 09:15, and what is on the video.

## Submittable core (critical path — Opus + Fable, nothing else touches these files)
C1 `state.js` + `tools.js`: `get_reading_state`, `get_section_text`, `get_knowledge`,
   `upsert_knowledge`, `set_section_depth` (with reason; `hidden` needs confirmed ref; pending on
   cursor section), `annotate` (all kinds, minimal validators), `search_notes` (returns [] if no
   vault), `insert_figure` (basic sanitizer). Registered via shim on both API names. **08:15–08:45**
C2 `index.html` + `render.js`: three fixtures loaded from a picker, source column, margin gutter,
   layer toggles, known/lost marks, knowledge panel with confirm / confirm-all, stubs with reason +
   expand, remove-all. Plain CSS, dark. **08:15–08:55**
C3 Deploy on every merge; Fable integrates C1+C2 at **08:55**. Gate: tools visible in ChatGPT
   browser by **09:00** (Yash verifies). If NOT visible by 09:00 → all hands on the shim/headers
   until 09:10; if still not → submit with the Inspector-extension recording and say so honestly
   in the description (judges may test in Chrome with the flag — that is allowed).

## Parallel lanes (feature branches; merge ONLY if green by 09:10, else they stay in the repo
## as branches and are named in README "next")
L1 Codex A — KaTeX in source + margin (small), SVG figure renderer. 08:15–09:05
L2 Codex B — vault drop (`<input webkitdirectory>` + drag) + lexical `search_notes` + `connection`
   kind rendering as margin card (skip the Cytoscape graph tab unless done by 09:05). 08:15–09:05
L3 Codex C — fixtures: Rutherford text, Conversation text-only + attribution line, Chrome WebMCP
   docs page text + CC BY line, `fixtures/ATTRIBUTION.md`; README (what/why/layer rule/tools/
   how to test/prior-vs-new/licenses); LICENSE visible in repo About. 08:15–08:50, then Devpost
   description draft in a gist. **Fixtures must be in main by 08:40 — they are on the critical path.**
L4 Gemini (via Agora) — three demo prompts tested for tool-calling wording; video script v1 (2:15,
   timed); QA the tool descriptions against the ChatGPT browser at 09:00 with Yash. 08:15–09:05
L5 Yash — repo public now; Netlify site now; ChatGPT desktop ready; 09:00 gate; **09:05–09:15
   record the video on whatever works** (screen + voice, no music, no logos); upload immediately,
   public; 09:20 paste description; 09:25 check License in About + repo public + video public;
   **09:35 submit**; 09:36 confirmation email screenshot.

## Video (record at 09:05 regardless of feature state; ≤2:30)
Thesis line → pick Rutherford → "Interview me about what I know here" → confirm → a section folds
with a reason (the beat) → open Curious Kids article → "Read this as me, not as Joshua" → stubs +
one connection/annotation → if L1 green: "draw the gold-foil geometry" → toggle Agent layer off/on →
close on the layer rule. If the vault works, drop it before the article beat. Cut anything that
isn't working at 09:05; never demo a broken tool.

## Description (L3 drafts, Yash pastes 09:20) — first sentence must say it:
"Marginalia is a reader where a human and their agent work on the same page: the page holds the
document, your marks and your notes; the agent brings what it knows about you; WebMCP tools are
where they meet. No tool can write to the source — the agent lives in the margin."
Then: why WebMCP (shared live state, tool absence as enforcement), better UX (reshapes as you say
what you know; visible, reasoned, reversible), newly possible together, implementation (imperative
API, N tools, validators with `next_step`, three-layer state, client-side index), prior-vs-new
(entirely submission-period; Feynman/Noether IRE separate, design lineage linked), licenses.

## Kill list for this window
No Worker. No widgets. No Cytoscape graph unless L2 finishes early. No export-to-vault. No
density chips. No prerequisite insets (the `expand` kind covers the demo). All stay as tickets.

## Coordination rules (Fable enforces)
One file per lane; PR per lane; Fable merges; deploy on merge; a lane that is not green at 09:10
is not merged, no exceptions; "tested" = screenshot/console in the PR.

## Checkpoint protocol (added 08:25) — Claude is PM, time reviewer, and compliance auditor

Every lane writes a checkpoint file at **08:45, 09:05, 09:15 (freeze), 09:30 (pre-submit)** —
and on any blocker, immediately. Path: `.scratch/bridge/checkpoints/<HHMM>-<lane>.md`. Yash
pastes them into the Claude chat; Claude audits and returns a one-line verdict per lane:
GREEN (merge) / AMBER (merge with named caveat) / RED (do not merge; do this instead).

Template (fill every field; "n/a" is allowed, blank is not):
```
lane: <C1|C2|C3|L1|L2|L3|L4|L5>   time: <HH:MM>   ticket(s): <ids>
done_since_last: <bullet list, behaviour-level>
evidence: <PR link / screenshot path / console transcript path — required for anything claimed "working">
on_live_url: <yes|no|partial — what a judge would see at the URL right now>
blockers: <what stops the next step; who can unblock>
merge_request: <yes|no>   risk_to_freeze: <none|low|high — why>
compliance_touch: <fixture text / license / video / description / README — any of these changed?>
```

Fable additionally writes `checkpoints/<HHMM>-integrator.md` listing: commits merged since last,
deploy URL + commit hash, what Yash should test in the ChatGPT browser in the next 5 minutes.

## Compliance checklist (Claude audits at 09:15 and 09:30; Yash confirms at 09:33 before submit)
Rules refs are to the official rules paste.
- [ ] Live URL loads in ChatGPT desktop in-app browser; tools listed (§85–86). Evidence: screenshot.
- [ ] Repo public; OSS license file; **license visible in the About section** (§92–95).
- [ ] Repo contains everything needed to run (§93): fixtures, `_headers`, README run steps.
- [ ] README "Prior work vs. new work" section; commit history entirely inside the window (§76–77).
- [ ] Video < 3:00, audio narration, public on YouTube, shows WebMCP use (§108–111).
- [ ] Video contains no music, no third-party logos/trademarks in title cards, only licensed
      content on screen beyond a glance (§112).
- [ ] `fixtures/ATTRIBUTION.md` + on-screen attribution for The Conversation (CC BY-ND, text only)
      and Chrome docs (CC BY 4.0); Rutherford marked PD.
- [ ] Description: first sentence states human + agent on the same page (Stage One theme gate);
      covers the four required points (§ "Text description"); mentions Chrome-with-flag testing path.
- [ ] Submission form: live URL, repo URL, video URL, description, no credentials needed.
- [ ] Submitted with confirmation email before 09:50; screenshot kept.

## Nothing important is cut — deferral order (pull from here when a lane is green early)
The kill list defers; it does not delete. Priority for early-finishing lanes, in order:
1. Cytoscape connections graph tab (L2)   2. `prerequisite` insets (L1)   3. per-section density
chips (C2)   4. export-to-vault (L2)   5. Worker snapshot   6. widgets.
Everything deferred is listed in README "Next" with its ticket file, so judges see scope, not gaps.

## What Claude will refuse to let slip (the non-negotiables for THIS submission)
- The interview → knowledge → fold-with-reason beat on video.
- The layer rule visible: Agent toggle off shows untouched source; no tool writes source.
- At least one artifact per level: paper (fold/expand), article (stub + connection or annotation),
  docs (one connection or annotation).
- Honest states: validator refusals with `next_step`; "no vault loaded" is a state, not an error.
- Attribution on screen; licenses in repo; prior-vs-new in README.
