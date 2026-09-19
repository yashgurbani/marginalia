# Marginalia documentation

[Research whitepaper](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/Marginalia-Research-Whitepaper.pdf) ([source](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/sources/RESEARCH-WHITEPAPER-v3.md)) · [Credits](../../CREDITS.md) · [Third-party notices](../../THIRD-PARTY-NOTICES.md) · [Build scope](SCOPE-COVERAGE.md)

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
| [Build scope](SCOPE-COVERAGE.md) | Implemented scope and remaining gaps; raw historical receipts are omitted from this public tree |

Library search and “Related saved passages” are available in the local library page. Code and automated tests support this claim; native browser acceptance has not been recorded.

## Known limits

These gates are open. Tests and CI do not close them.

- A [reader-authorized real-ask path](READER-AUTHORIZED-RUNTIME.md) exists, but no recorded real run is in the evidence folder yet.
- Real asks run in a reader-authorized mode where solver confinement is requested but not observed.
- Native install is proven on Windows only. macOS and Linux have command-level CI evidence.
- The runtime direction for inference is undecided.
- The owner's twenty-minute reading verdict on two real pages is pending.

## Design

[design/](design/) holds the design pass briefs and their reconciliation.

## Process history

Historical handoffs, plans and review records are omitted from this public tree. Their earlier conclusions remain scoped to the revisions and checks they describe.
