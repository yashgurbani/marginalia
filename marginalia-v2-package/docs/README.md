# Marginalia documentation

Start here. Most files in this folder record how the project was built by a team of agents. Only a few describe the product.

## Read these to understand the product

| Document | What it tells you |
|---|---|
| [Package README](../README.md) | Install the helper, build the extension, run the tests |
| [CONTRACT.md](CONTRACT.md) | The rules the reader, helper and solver must keep |
| [INTERACTION-ACCEPTANCE.md](INTERACTION-ACCEPTANCE.md) | How the margin behaves, stated as checks |
| [INSTALL-RECOVERY-EXPERIENCE.md](INSTALL-RECOVERY-EXPERIENCE.md) | Install, pairing and recovery from the reader's side |
| [SOURCE-DOCUMENT-INDEX.md](SOURCE-DOCUMENT-INDEX.md) | Where the founding documents live and what each governs |
| [SCOPE-COVERAGE.md](SCOPE-COVERAGE.md) | Which promises are built, partial or deferred |

The founding documents sit at the repository root: the research whitepaper, `PRODUCT.md` and `docs/BUILD-PLAN.md`. They outrank everything in this folder.

## Read these to judge the current state

| Document | What it tells you |
|---|---|
| [BUILD-STATUS.md](../BUILD-STATUS.md) | What runs today |
| [CONSOLIDATION-HANDOFF-2026-09-18.md](CONSOLIDATION-HANDOFF-2026-09-18.md) | Latest verified checkpoint and the remaining merge queue |
| [Source promises and release gates](evidence/consolidation-2026-09-18/final/source-gates.md) | Every promise, its evidence, and what is still unproven |
| [evidence/](evidence/) | Test logs, review reports and QA receipts, kept with their original scope |

## Known limits

These gates are open. Tests and CI do not close them.

- No run against a real model provider has been recorded. Reply behavior is proven on deterministic fixtures only.
- Solver confinement is requested but not yet observed.
- Native install is proven on Windows only. macOS and Linux have command-level CI evidence.
- The runtime direction for inference is undecided.
- The owner's twenty-minute reading verdict on two real pages is pending.

## Design

[design/](design/) holds the design pass briefs and their reconciliation.

## Process history

[archive/](archive/) holds the handoffs, plans, reviews and ledgers written during the build. They are kept for provenance. You do not need them to use or evaluate Marginalia.
