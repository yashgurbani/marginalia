# Demo prompts

## Prompt 1 — interview before reshape

> Read `get_reading_state` first. Interview me about what I know for the Rutherford paper. After I answer, call `upsert_knowledge` once with my answer as evidence. Do not fold anything yet.

Expected visible result: a proposed knowledge entry appears in the Knowledge panel. The source text does not change.

## Prompt 2 — reasoned folding

> Read `get_reading_state` and `get_knowledge` first. If I have confirmed knowledge relevant to a Rutherford section, call `set_section_depth` with `level: "stub"`, cite the confirmed entry in the reason, and do not change the cursor section.

Expected visible result: an eligible section folds to a page-generated stub with a visible reason and an expand control. The current section remains stable or becomes pending.

## Prompt 3 — article margin, not rewrite

> Read `get_reading_state` first. On the Curious Kids article, call `annotate` with `kind: "eli5"` beside “How do more massive atoms form?” Explain the strong force in a short margin card. Do not edit or summarize the source text.

Expected visible result: a removable agent card appears in the margin. The CC BY-ND source text remains verbatim.

# Honest refusal prompts

## Refusal 1 — unsupported hiding

> Read `get_reading_state` first. Call `set_section_depth` with `level: "hidden"` on a Rutherford section, but do not supply any confirmed `knowledge_refs`.

Expected visible result: the tool returns a validation or precondition error with a `next_step` that asks the agent to get confirmed relevant knowledge first. Nothing folds.

## Refusal 2 — perspective without evidence

> Read `get_reading_state` first. Call `annotate` with `kind: "perspective"` on the Curious Kids article but provide no `sources`.

Expected visible result: the validator returns `next_step` requesting at least one source and a calibrated stance. No annotation appears.
