# E26 G5: interim PDF path after the install gate

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: H05, E02, E03, Q05
route: Sol medium

## Owner outcome

H05 is authoritative: prioritize an interim PDF path after the install gate. Preserve
source fidelity and unsupported-case copy. This ticket must not claim that the full
extension-owned PDF viewer shipped.

## Task

Design and implement the narrow interim path after Q05 install acceptance: open a
reader-supplied PDF through the supported browser path, retain immutable file
identity, and present a separate display representation where text is available.
Scanned or unsupported input must say so clearly. Keep original bytes conceptually
separate from extracted text and keep notes/anchors separate from the source.

Owned source areas: the proposed document/viewer entrypoint; `contracts/reader.ts`
source and anchor variants; `webapp/main.ts` saved-source adapter;
`daemon/store.ts` source/blob handling only if required; `ui/margin.ts` host adapter;
and viewer-path tests. The design seams are documented in
`docs/STAGE2-3-DESIGNS-2026-09-18.md` §Stage 3. Add no full viewer subsystem.

## Tests

- Install-gate tests prove the action remains an honest “needs the helper, coming” state until Q05 passes.
- Cover a text PDF, two-column paper, equations, rotated page, scanned page, changed file and same filename with different bytes.
- Original identity, displayed text, page/region anchors and notes remain distinguishable across reload.
- No OCR, upload, external document fetch, model request or retrieval occurs before exact review and explicit approval.

## Acceptance

- Browser/manual evidence compares the displayed original with the input; record totals and unsupported cases in `docs/REPORT-E26-2026-09-18.md`.

## Hard limits

No full PDF viewer claim, source replacement, silent OCR, external resources, or new
identity decision. This is later than the immediate deadline candidate.
