# TICKET T-03 — export to vault and copy as question

Status: open  
Model / effort: Sol, Medium — clear technical work  
Outcome: Export the margin, reader marks, and knowledge deltas as Obsidian-friendly Markdown and copy a selected passage as a pending question.

## OWNS

- `src/export.js` — new Markdown serializer and clipboard helper.
- `src/state.js` — additive `pending_questions` reader-state support if the frozen API does not already expose it.
- `src/render.js` — additive selection action and export wiring.
- `.scratch/agora/results/T-03-export-to-vault-copy-as-question/` — report and evidence.

Do not edit source text, `knowledge.js`, fixtures, tests, or deployment files. Preserve dropped note paths as wikilinks without sending their contents to a provider.

## Depends on

`T-02-density-chips`. The original issue also depends on the connection surface, which the Pro expedition or T-06 must provide.

## Acceptance check

Run both existing test pages. Both must print `ALL PASS`. Export a document with one mark, one knowledge entry, one artifact, and one dropped-note connection. Open the Markdown in a plain text viewer. Confirm that the source citation, margin data, marks, knowledge delta, and resolving wikilink are present. Select text, invoke “copy as question,” and confirm that clipboard text plus `get_reading_state` contains the pending question.

## Stop condition

Stop if clipboard permission or download behavior needs a new dependency, provider, or source mutation. After two distinct failures, return the Markdown and state evidence without a broader UI rewrite.

## Size estimate

Small to medium, about 1.5–3 hours.
