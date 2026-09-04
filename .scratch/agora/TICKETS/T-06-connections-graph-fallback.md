# TICKET T-06 — connections graph fallback

Status: open, conditional fallback only  
Model / effort: Terra, High — graph semantics and mid-judgment UI work  
Outcome: Add the optional Cytoscape Connections tab when `PRO-EXPEDITION-01` returns without it.

## OWNS

- `src/graph.js` — graph projection and Cytoscape adapter.
- `src/render.js` — additive Connections tab and node-click wiring.
- `src/tools.js` — additive connection validation or `get_connections` exposure only when the frozen tests remain green.
- `.scratch/agora/results/T-06-connections-graph-fallback/` — report and evidence.

Do not dispatch this packet while Pro is active. Do not edit `state.js`, tests, fixtures, or deployment files. Use a pinned Cytoscape CDN version and derive edges from attributed `connection` artifacts. Enforce relations `prerequisite`, `analogy`, `contradiction`, `enables`, `bridge`, and `example`.

## Depends on

`PRO-EXPEDITION-01`. Dispatch only when its report explicitly says the graph tab is omitted or blocked. If Pro passes the graph gate, mark this packet superseded without dispatch.

## Acceptance check

Run the two existing test pages and require `ALL PASS`. Add two valid connection artifacts. The tab must show section, note, and knowledge nodes, update live, enforce the relation enum, and identify the linked passage on node click. If a pinned CDN load fails, show a truthful unavailable state and preserve all Must behavior.

## Stop condition

Stop if graph work requires a simultaneous writer, an unpinned dependency, a new test-file edit, or a source mutation. Stop after two distinct failed graph hypotheses and return a fallback report.

## Size estimate

Medium, about 2–4 hours.
