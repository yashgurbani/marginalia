# BibTeX export

status: closed
type: build
blocked by: none

## Goal
The feature inventory (`wayfinder/FEATURE-INVENTORY.md:49`) lists BibTeX. `ui/library/export.ts` exports Markdown and W3C annotations only.

## Owned paths
`ui/library/export.ts`, `ui/library/index.ts` (one export action), `tests/library-export.test.ts`.

## Acceptance
- One entry per captured source, using only fields the capture holds. A missing field is left out and never guessed.
- Keys are stable across exports and unique. Special characters are escaped. A test covers braces, ampersands, percent signs and non-ASCII names.
- Removed sources follow the same retention rule as the Markdown export.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P16.md`

## Technical preflight
One explicit Export BibTeX action uses the same complete retained record set and async identity/disposal fences as Markdown. Citations group by source version and URL; captured fields only, generic misc type, stable injective encoded keys. UTF-8 names are retained; text and URL escaping are separate. Legacy bibliography processor compatibility is not assumed; no installed bibtex/biber executable was found on PATH.

## Resolution
Closed2026-09-18: explicit UTF-8 BibTeX export, one entry per source capture, stable unique keys, captured metadata only, text/URL escaping and existing removed-record retention. Independent14/14; chief stable1063/1057pass/0fail/6platformskip, all four checks exit0. Report D:/Projects/Marginalia/.local/polish/reports/P16.md; receipt SHA256 125B42FE1A6035DD793AF7658903909235665F8F809456BCA7671F7C83DD627D. Native compiler/import/file-save proof remains unverified.
