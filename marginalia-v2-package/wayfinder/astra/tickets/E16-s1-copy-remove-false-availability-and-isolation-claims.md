# E16 S1-COPY: remove false availability and isolation claims

label: wayfinder:task
mode: AFK
status: closed
blocked_by: E01, H01
route: Sol medium

## Task
From `docs/STAGE1-PACKETS-2026-09-18.md` packet S1-COPY and ledger contradictions 47, 102, 103, 120. Three places tell the reader something the code does not do:
- `ui/consent.ts` lines 49 to 50 (at 0360a1c): "Tool network access stays closed for this request" states a requested policy (`networkAccess: false` in `daemon/codex-policy.ts`) as an observed fact, and "This also permits separate web access for this site" describes a web path that no accepted operation uses. H01 decides the network promise; this ticket implements whichever copy H01 chooses and, in either case, stops presenting the request as confinement.
- `ui/margin.ts` line 761 (at 0360a1c): "Saved-solver execution is not connected here" while the callback exists and the gate refuses. Replace with gate-supplied state, proposed: "This example cannot run again here yet. Your notes and current inputs are unchanged."
- `renderer/index.ts` lines 258 to 260: "packaged renderer", "host verification", "host report" in reader copy. Proposed: "The calculations run on this device." / "No checked conclusion is available for these inputs." / "This conclusion was checked for the inputs shown." (the third only when a matching check authorizes it).

Hard limits from the packet: no authority change, gate refusals stay, the exact outgoing review `<pre>` in `ui/consent.ts` lines 42 to 46 stays byte-exact (it may legitimately contain technical words). Re-resolve every line number at head first.

## Acceptance
- Tests asserting the new copy and asserting the outgoing review text is unchanged.
- `npm test` green; `.m-meta` register and the Keep / Note / Ask / Library vocabulary preserved.

## Resolution

2026-09-18: Integrated de49a90: H01 honest network copy, state-dependent saved calculation availability, and reader-language checked conclusions. Exact outgoing pre text and recipient are unchanged. Named regression: ui: network copy is honest and leaves reviewed outgoing bytes and recipient unchanged. Evidence docs/evidence/qa-2026-09-18/e16-copy/worker-report.md and integrated-suite.log: 797 total, 791 pass, 0 fail, 6 skip; typecheck, prepare and extension:typecheck passed. Worker requested Sol medium; exact MCP runtime model/effort unobservable. H12 disclosure is separately implemented in E24 pending independent integration review.
