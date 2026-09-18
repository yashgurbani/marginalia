# E14 Triage the GPT-6 Pro fidelity ledger against the current head

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Astra low triages; Sol medium verifies rows that need code reading

## Task
The GPT-6 Pro long-horizon review (Phases 1 to 5) has landed. Files, all in `docs/`: `FIDELITY-LEDGER-2026-09-18.md` (120 rows: 70 partial, 29 missing, 13 reachable, 6 contradicted, 2 built-unreachable), `OWNER-DECISIONS-2026-09-18.md` (G1 to G11 with a five-minute summary), `STAGE1-PACKETS-2026-09-18.md` (seven Sol packets), `STAGE2-3-DESIGNS-2026-09-18.md` (nine Stage 2 designs, one Stage 2 addition, five Stage 3 designs, Phase 5 self-refutation), and the raw transcript `PRO-REVIEW-TRANSCRIPT-2026-09-18.md`.

The reviewer pinned commit `0360a1c` and did not run code. Thirty-nine commits (21 non-merge) have landed since, several on the same files (`ui/margin.ts`, `daemon/store.ts`, `daemon/jobs/store.ts`, `ui/consent.ts` unchanged). Every file:line in the review is stale until re-resolved.

1. For each of the 120 ledger rows, re-resolve the code path at the current head and record a verdict: **confirmed** (still true at head, file and line named), **superseded** (a merged commit closed it; name the commit), **refuted** (the reviewer misread; say what), or **unverified** (needs a runtime check; name the Q ticket that will do it). Rows the reviewer marked `[U]` default to unverified.
2. The six contradictions (rows 47, 51, 100, 102, 103, 120) are pre-mapped: 47, 102, 103 and 120 are copy fixes in E16; 51 is the reply-contract change in E13 (Stage 2 addition); 100 is E17. Confirm or correct the mapping.
3. The 19 "dropped silently" promises (rows 18, 63, 69, 70, 72, 74, 75, 83, 88, 89, 91, 95, 96, 97, 105, 106, 107, 112, 119) go to H16 as one list with a one-line reader gist each. Do not ticket them individually.
4. Any confirmed finding not covered by an existing E, Q or H ticket becomes a new ticket in this map with the review row quoted and the head verification noted. Findings that contradict the whitepaper or Yash's words lose.
5. Compare the review's G1 to G11 recommendations with Fable's in H01 to H11. Where they differ (G5 ordering: local files before PDF; G10: a small local selection card), add the review's position and its strongest counter-argument (Phase 5 §3) to the H ticket as a second recommendation. Do not resolve.

## Acceptance
- `docs/evidence/pro-review-triage/TRIAGE-2026-09-18.md`: a 120-row table (row, reviewer status, head verdict, file:line at head or commit, ticket).
- Every new ticket links back to its ledger row.
- No code change inside this ticket.
