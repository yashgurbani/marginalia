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
