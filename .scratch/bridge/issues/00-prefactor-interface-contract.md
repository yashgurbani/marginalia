# 00 — Prefactor: module split + state.js contract (INTEGRATOR, 15 min)

**What to build:** The repo skeleton with one file per lane and the exact `state.js` API from HANDOFF.md §0, plus `index.html` shell and Netlify config with `_headers`. All other lanes code against this contract from minute 15.

**Blocked by:** None. Blocks: 01–10.

**Status:** ready-for-agent

- [ ] `state.js` exports every function in the contract; `loadDoc` deep-freezes the source layer
- [ ] `tools.js` shim registers on whichever of `navigator.modelContext` / `document.modelContext` exists and logs it
- [ ] `_headers` sets no `Origin-Agent-Cluster: ?0`; site deploys from `main`
