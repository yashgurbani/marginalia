# Claude design pass 2 — chief intake

Received 17 September 2026 from `D:\UserData\reader\Downloads\marginalia-v1-package\design-pass-2`. The written source is `DESIGN-PASS-2.md`; the offline board is `marginalia-margin-pass2.html`, with `frames2.js`, `render.js` and `margin-p2.css`. Pass 1 remains unchanged. This is design intent, not implemented behavior or acceptance evidence. Claude reports a headless layout check only; chief has read the handoff and governing source documents without running the board or checks.

## Ownership and source order

T05 (Astra Medium, task 01a0adc8-a066-7d11-8248-9cb5a63cd737) owns the detailed reconciliation in `docs/DESIGN-PASS-2-RECONCILIATION.md`, combining the existing tokens, Impeccable/taste guidance and applicable Pro advice. That document is pending. Preserve the original export. SPEC-FINAL and direct user decisions govern; the design handoff does not itself approve deviations. All testing remains deferred.

## User decisions — confirmed 17 September

- **Composer location:** the user chose “Editor at the reading position, as in SPEC-FINAL.” This supersedes the head-editor treatment in the design export. Show and freeze attachment when writing starts, preserve focus, and retain anchor order for saved notes.
- **Rail:** the user chose “One map, preserving all of that information.” The single map must preserve note density, section boundaries, marks and current position; this authorizes combining the visual elements, not removing their functions.

T05 owns applying these decisions in the design reconciliation and subsequent implementation.

## Source-backed dispositions and proposed refinements

- **Hear it:** keep the plainly unavailable state. This is already explicit in `wayfinder/DESIGN-FEEDBACK-PASS2.md`, item 19. It must not behave as a successful action. This does not remove the eventual capability from scope.
- **Recipient:** revise the proposed “Codex on this computer, signed in to your ChatGPT account.” The helper and Codex process are local; asking sends context to a remote model service (SPEC-FINAL §Privacy, cloud inference). Both transports need this distinction. Proposed ready-state wording: “Sends this context to OpenAI through Codex on this computer.” Add account information only when observed and bound to the dedicated runtime. That runtime is currently signed out and dispatch is unavailable; never display ready-state copy as a current fact.
- **Docs Run:** the intended action is a real execution through the isolated daemon execution path, not a successful-looking stub or generated browser script. Show what will execute and the actual permitted network policy. Until that runtime exists and its required evidence is available, show the example with an honest unavailable Run state. T20 execution and the docs capability remain required.
- **Automatic definitions:** retain Off by default; an existing grant alone is insufficient. Enabling automatic definitions is a separate deliberate choice. Do not add a repeated post-grant prompt without a concrete UX need.
- **Evidence:** propose “Supports / Qualifies / Challenges” as relations to the displayed claim, with the source passage and date. These describe the cited material, not a truth verdict. “Fetched” must come from the host retrieval record, never from authored text alone. Keep abstention.
- **Explore:** proposing a source-page link locally and opening it on an explicit click are different from fetching new material. External retrieval needs its narrower grant; already captured links do not justify a blanket retrieval grant. Any cloud-authored shelf still needs inference consent. Keep the shelf parked and open nothing automatically.
- **PDF:** aim for one navigation overview, with page/section position and annotation information preserved. Do not simply hide a map and lose functions. T05 should reconcile viewer thumbnails with the margin rail before the PDF implementation.
- **Narrow windows:** distinguish the floating host's viewport from a native side panel's own width. Responsive layout should use the available surface, retaining all actions; 900 px is not an automatic trigger for every native panel.
- **Done / archived:** preserve durable history and restoration. Proposed behavior: Done collapses to a trace; Archive removes the item from the active column only after the explicit action, with Undo/history available. Neither should steal focus or overwrite an active draft. T05 must reconcile this with the full thread-state contract.
- **Shortcut:** Ctrl+Shift+Y remains a proposal. Do not present compatibility as verified while browser checks are deferred.
- **Simulation:** a host-bound check authorizes the result sentence; browser-only validation or an authored badge does not. Keep local controls, saved samples, saved solver and Ask again as four distinct paths. “No new work” is too broad for local computation; prefer “Uses saved results; no new request” where accurate. Recomputing may consume local compute while using zero model turns.
- **Accessibility:** focus/zoom/reduced-motion notes are requirements, not verified claims. A focus trap that also says it never blocks the page needs explicit keyboard behavior in the detailed reconciliation.

## Ticket mapping

| Frames | Implementation owners and outstanding scope |
|---|---|
| 5+ | T03/T18 authority and renderer; T05 real reply controls; T09 simulation; T20 saved solver and trusted generation records |
| 6 | T08 contextual definitions, T05 dismiss/trace and source links, T13 optional automatic-inference consent |
| 7–8 | T16 full notes/attachments and note-version Ask; T07 durable history; T05 thread controls, recovery, focus and source uncertainty |
| 9 | T13 exact consent and exclusions; T06 real jobs/unknown outcomes; T04 trusted browser handoff; T05 visible states |
| 10 | T11 library/settings, T01 pairing, T13 grants/egress, T05 entry point and mount, T19 install/recovery |
| 11 | PDF capture/viewer and math anchors remain required inventory work; T04/T05 surfaces plus library integration |
| 12–13 | T14 evidence and T15 explore, backed by T13 retrieval/consent and real host records |
| 14 | Docs/news source adaptation and T17 header; real execution through T20 where applicable |

The current basic UI and separately implemented modules do not make these frames complete. Fixtures, design rendering and source review do not establish working runtime flows.
