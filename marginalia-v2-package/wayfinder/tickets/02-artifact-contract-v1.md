# 02-artifact-contract-v1

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: (none)

## Question

Define artifact.json v1: kinds (gloss, plot, simulation bundle, diagram, evidence card), source bindings (variable -> selector), assumptions ledger, units, checks (host-run reference cases), limitations, partial-version rule, static fallback, and the iframe bundle format (srcdoc HTML+JS, no network, message schema). This is the contract between Codex, the daemon and the sidebar; everything else depends on it.

## Resolution

Resolved (rev 2, after Astra's review). `marginalia.reply.v1` replaces the artifact bundle: intent (define | simulate | instantiate | derive | diagram | evidence | explore | unsure) and typed blocks (text, equation, model, plot, derived, classification, table, diagram, citations, shelf, grid) are separate axes. Blocks are data rendered by packaged code; no generated HTML/JS ever executes (Chrome Web Store MV3 policy and the security boundary both). Interaction runs in the local kernel (expression parser with bounded grammar, RK4/RK45 with caps, maps, KaTeX, diagram layout) or over a precomputed grid; recompute is an explicit action. Editable assumptions, uneditable source facts and host-recorded execution facts are separate records; host checks and model self-checks carry different authority; a headline classification must reference a host check or is withheld. Filenames `reply.partial.json` / `reply.json`, atomic, bounded, no path escape; a file has no authority until validation commits an immutable reply_version. JSON in BUILD-PLAN-24H.md.
