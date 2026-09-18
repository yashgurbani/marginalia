# E36 Closed: answered-note version is already rendered

label: wayfinder:task
mode: AFK
status: closed
blocked_by: (none)
route: Q02 observation only

## Disposition
Fidelity-ledger row 58 claimed that retained reply presentation did not consistently quote the historical note revision. That implementation gap is refuted at the pinned source head `bdfe8d7`; do not create a duplicate renderer change.

The store validates and persists immutable `answeredNote` content (`daemon/store.ts:315-336`). Returned replies render the note version and text at `ui/asking/surfaces.ts:87-92`; reopened saved replies render them at `ui/margin.ts:815-818`. `tests/store.test.ts:152-163` edits the live note and verifies that the reply retains the original note text.

## Remaining observation
Q02 owns the real reopen journey: send from note revision 1, edit to revision 2, reopen the saved reply, and observe revision 1 quoted on the reply while revision 2 remains the current note. It must also observe that removing/restoring either item does not silently replace the other and that edit, reopen and restore send no request. This is runtime acceptance of existing behavior, not E36 implementation.
