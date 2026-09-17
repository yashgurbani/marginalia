# Marginalia build checkpoint

Updated 17 September 2026. Chief of staff: Codex task 01a0adaf-dd71-7583-8307-b877547c9189.

## Authority and outcome

Build the full v2 product in dependency order for the Astra challenge. SPEC-FINAL.md governs; SPEC.md, FEATURE-INVENTORY.md and BUILD-PLAN-24H.md define coverage and gates. Every inventory item remains in scope. "Marginalia is a margin beside whatever you are reading." Source stays unchanged; notes are senior; inference requires explicit consent; the reader owns the work. Flag identity/scope deviations to the chief and user. Apply minor improvements within these boundaries.

## Verified state and limits

- Repository: yashgurbani/marginalia; integration branch codex/marginalia-v2. Preserve unrelated root changes.
- Node 24.14.1, Codex CLI 0.153.4. No live provider or sandbox guarantee verified yet.
- T00 numerical kernel, T03 contract, initial helper/store and durable journal are present. T03 worker reports npm test 24/24 and typecheck passing. Scientific checks currently cover growth-v1 only; structural validation does not establish scientific truth.
- UI bootstrap is incomplete: webapp/main.ts references missing ui/margin.ts. No extension exists yet. No release or user-entry-point gate has passed.
- Pro initial review reconciled in docs/REVIEW-RESOLUTIONS.md. Existing Pro conversation: https://chatgpt.com/c/6aab6e88-3804-83ed-9f27-3f02572b2d98. Followup about T02/T13/T20 technical integration is pending.
- Finished Claude design source: D:\UserData\reader\Downloads\marginalia-v1-package\design. Preserve its design system, reconcile with governing spec and Pro advice. Root PRODUCT.md is stale and does not override SPEC-FINAL.

## Coordination

This task owns dispatch, acceptance, integration and vision decisions, not implementation. Each build ticket receives its own task, bounded files, acceptance evidence and stop condition. Default ticket owner Astra low; design owner Astra medium. Ticket owners may use Luna max for bulk work and Sol high for technical work as explicitly authorized. Pro is a substantial advisor, reviewer and GitHub executor. See wayfinder/PRO-COLLABORATION.md.

Current frontier: T01 helper hardening and T05 basic margin/design integration (basic margin split breaks original T05/T16 dependency cycle; no rich-reply completeness claimed). T04 extension follows stable margin and helper interfaces. T07 store completion and T02 provider adapters follow with individual ownership. Chief records task IDs after creation.

## Active ticket assignments

| Ticket | Owner task / conversation | Scope | State |
|---|---|---|---|
| T01 | 01a0adc8-8f4d-73a3-9e13-abdb015c842b (Astra low selected) | helper main/pairing/server/diagnostics and targeted tests | Running; dedicated Pro consultation required |
| T05 basic margin | 01a0adc8-a066-7d11-8248-9cb5a63cd737 (Astra medium selected) | ui except journal; webapp; package/build wiring; visual evidence | Running from finished Claude design; dedicated Pro consultation required |
| T13 policy preparation | existing chief-owned GPT-6 Pro conversation above | codex-policy.ts, its test, T13-pro receipt only on codex/pro-t13-policy | Prompt submitted; Pro thinking observed; GitHub read/write not yet verified |

Published baseline: bb5b5b8 on origin/codex/marginalia-v2. Includes v2 package only; unrelated root modifications excluded. Whitespace check reported one trailing blank line in SCOPE-COVERAGE.md; no functional implication, cleanup deferred to document owner. Chief does not claim tests freshly rerun after worker evidence.

Pro integration recipe received (advisory, not executed): generated 0.153.4 schema governs; read-only outputSchema final-message transport; private home does not eliminate inherited config or establish job-only reads; audited capabilities required. Native Windows command/exec lacks streaming/terminate; cancellation fences results and waits for timeout, no confirmed immediate kill. Main Pro assigned pure policy construction/audit preparation, not live sandbox certification. Third writer is remote-only and disjoint, bounded to those three files with stop after commit/report; local writers never touch them.

Pro access discrepancy: T01 reports its fresh Chat page exposes Latest/Sol/5.5 and a workspace-credit banner, not 6 Pro. No account or billing change authorized/performed. Existing chief Pro conversation accepted the T13 assignment and is thinking. Ticket owners may use an observed Branch in new chat action on a completed response to obtain separate Pro conversations, without changing original; otherwise chief routes their consolidated review packets through working Pro. Do not label advice as GPT-6 Pro without visible model verification.

T07 assigned to task 01a0adcb-25bd-7451-831f-40197dade46a (Astra low selected): daemon/store.ts, contracts/reader.ts, ui/journal.ts and storage tests only. Public signatures coordinated with T01/T05; bounded one-ticket implementation/review pass, at most one child, then stop. T03 dependency complete. This third local writer has a disjoint scope, with no shared package/config edits.

GitHub observation: codex/pro-t13-policy exists at baseline bb5b5b801b285d3f888dd47728be508501261724. Pro visibly processing implementation; branch creation is verified, implementation/test success is not.

Integration finding: T05 browser GET omits Origin. T01 owns secure supported browser read-route resolution and regression checks; no blanket missing-Origin exception permitted.

Fresh chief acceptance check: node --test tests/growth.test.ts tests/reply.test.ts passed 13/13 in the current checkout. Inspected host report binding and growth regression scope: tests cover divergence beyond plotted horizon, changed starts, equilibrium/threshold, malicious candidates, forged candidate host fields, stale input/report rejection and unsupported headline withholding. This does not verify rich renderer, live provider, extension or arbitrary scientific correctness. Stage0 core evidence is present; release gates remain open.

T04 assigned to task 01a0add2-39b2-7591-b86b-9635b85c5d1c (Astra low selected), owning extension/** and extension tests/evidence only. T05 confirmed stable mountMargin host adapter (capture/sections/source callbacks/helperOrigin/storageName; select/setReadingPosition/destroy). Extension uses trusted extension-origin side panel/floating iframe; no private notes in page DOM. Fourth writer is disjoint, bounded to T04 with one optional child and explicit stop; package/UI/daemon edits remain with existing owners. Actual extension pairing, real-page capture, worker recovery and privacy verification are required, not presumed.

Chief inspected T01 server, diagnostics, pairing and focused tests without identifying an additional blocker. Awaiting frozen receipt and final evidence before publishing implementation. Independent Pro branching stalled on Loading in multiple owner tabs; do not keep retrying or substitute another model. Chief routes exact-code review packets through working Pro conversation after its T13 commit.

T01 frozen receipt received. Chief freshly reran all10 focused helper tests:10/10 pass through real HTTP/WebSocket connections. Accepted for incremental integration; extension/browser pairing, independent Pro review and sandbox/provider gates remain open. Full shared suite not yet green while T05/T07 edits continue; do not claim all-build acceptance.

T05 reports successful actual built-webapp browser pairing, local note sync and reload recovery on isolated helper43125; T01 receipt records it as T05-reported evidence pending screenshot/artifact. Chief requested reproducible browser evidence in final T05 receipt. T07 exact-code review packet available locally at docs/evidence/T07-review-packet.md; final journal regression/freeze pending. Pro is finishing T13 GitHub blobs/commit; consolidated frozen T01/T07 review queues next, never against stale initial store.

T02 assigned to task 01a0add5-2436-7231-9727-63a11ab0c75a (Astra low selected), owning daemon/providers/**, contracts/job-runner.ts and provider tests only. T01 integrated302fe52 unblocks adapter work. App-server and mcp-server both required; cancellation/recovery differences explicit. Dedicated config/auth and live policy audits must not be faked. Pro's codex-policy.ts remains exclusively remote-owned; T02 uses a narrow injection boundary until reviewed integration. Four local writers remain disjoint; T01 is frozen. T02 budget one ticket plus required review fixes, one optional Sol High child, stop with evidence and limitations.

Chief visually inspected docs/evidence/T05/pairing-browser.png: saved-to-helper status visible; no model connection claimed. Sent T05 a concrete quote-excerpt readability issue (heading/body concatenated) while preserving exact selector offsets; requested final normal reading-state screenshot. Pro reports20 policy tests complete and is committing three assigned files; remote commit still to verify.

Pro delivered remote commit d63161635e8878d1307073551433b6d182feac79 on codex/pro-t13-policy, exactly three assigned files. Chief inspected and cherry-picked as3901dfe. Fresh Windows Node24 check:20/20 codex-policy tests pass; targeted strict TypeScript5.9.3 check passes. This proves pure policy construction/audit decisions only, NOT actual sandbox isolation or live provider. T02 notified to integrate real collector through createCodexPolicy/auditCodexPolicy/cancellationFor without copying requested values into observed evidence. Pro receipt records original Linux container tests and absent runtime gates separately.

T07 integrated and pushed3c72429 after chief fresh19/19 focused storage/journal/reader tests passed; reviewed original/target and journal recovery boundaries. Pro read-only review submitted against exact3c72429 for T01/T07 and concrete T02 tool-catalog collector question; visible6Pro thinking confirmed. Pro may not edit this review's files. Current T07 component acceptance does not establish browser/extension conflict UI or full stage1.

T18 assigned task01a0addb-ef93-77e0-8a57-45873cead42e (Astra low selected), owns renderer/** and kernel/** plus targeted renderer/kernel tests. T03 dependency complete. Full T18 block vocabulary, local interaction, samples envelope and explicit recompute required; no growth-only scope substitution. T05 retains ui/package ownership and receives coordinated mountReply interface. This independent writer replaces frozenT07, at most one technical child, stop at T18 evidence. Live Pro review queues after current bounded review.

USER CORRECTION ON PRO ACCESS: the workspace-credit warning does not apply to6Pro here; refreshing a fresh Chat page exposes6Pro. Prior classification of the banner as a Pro quota blocker is withdrawn. All active ticket owners notified to refresh their own fresh Chat, wait for hydration and verify/select6Pro before scoped consultation. No account/billing changes needed. Existing original Pro review continues; avoid duplicating its T01/T07 review. Chief verifying fresh route independently.

VERIFIED FRESH PRO ROUTE (supersedes all earlier access warnings): chief opened fresh Chat, refreshed and let hydration complete. Composer Extra High -> Select model Latest -> Power maximum Pro,5 of5 -> close menu produces explicit6Pro composer label. Workspace-credit banner remains but is not a Pro blocker. Submenu Latest/Sol/5.5 is model family selection; Pro is on Latest power slider. All six ticket owners T01/T02/T04/T05/T07/T18 notified with exact route and obligation to use their own scoped Pro chat, verify label and record URL. Original chief consolidated T01/T07 review remains running; avoid duplicate review. No account/billing setting changed. New task briefs must include this route.
