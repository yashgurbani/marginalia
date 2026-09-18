# E22 M3: explicit Remember vocabulary with visible origins

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: H02
route: Sol medium

## Owner outcome

H02 is authoritative: only an explicit reader “Remember” action creates a new
vocabulary entry. Keeping a definition, using a word in a note, or skipping a word
does not imply familiarity or create an entry. Preserve visible origins and do not
harvest historical notes.

## Task

Adapt the M3 packet in `docs/STAGE1-PACKETS-2026-09-18.md` to that outcome. Add the
explicit local Remember action and retain origin wording that never claims mastery.
Use the packet's `stated` origin for this action; preserve `legacy` handling and any
compatible existing origin data without inventing an automatic write path.

Owned source areas: `contracts/library.ts`; `daemon/library.ts`; vocabulary
migration in `daemon/store.ts`; `daemon/server.ts`; `ui/helper.ts`;
`ui/library/index.ts`; `ui/margin.ts` only for the narrowly required explicit
Remember hook. Do not overlap E12's whole-library export.

## Tests

- `tests/vocabulary-ui.test.ts`: definition success, note save, and Skip create no vocabulary entry; clicking Remember creates one visible origin and survives reload/deletion while the note remains.
- `tests/vocabulary.test.ts`: origin references are validated, one term can retain separate origins, duplicate operation IDs are idempotent, old retries cannot resurrect a deletion, and a new explicit action can.
- Assert the Remember path performs only the local observation and zero model, retrieval, or execution calls.

## Acceptance

- No vocabulary row is created without an explicit Remember action.
- The reader sees the origin for each entry; no field or copy says the reader knows or mastered the word.
- Unknown historical data is `legacy`; no bulk backfill or prose harvesting occurs.
- `npm test` passes with baseline and final totals recorded in `docs/REPORT-E22-2026-09-18.md`.

## Hard limits

No ranking, ambient inference, provider-policy change, historical extraction, or new
identity decision. H02 is the closed owner decision; this ticket implements it.
