# E34 Make bottom actions honest and complete

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01
route: Sol medium

## Task
Close the confirmed gap in fidelity-ledger row 26: “Threads on this page, related things in your library, save, park, hear it.”

At source head `bdfe8d7`, Save/Park and Library paths exist, while the footer explicitly renders `Hear it · not available yet` (`ui/margin.ts:315`) and no related-items implementation exists. Keep unavailable actions honest. Implement listening only when its source, transport, controls and persistence boundaries are specified; related items belong to E31.

## Acceptance
- Every bottom action either works through a tested reader path or states one plain unavailable reason.
- Hear it never starts playback or network work implicitly.
- Related items use E31's attributed local-match contract.

