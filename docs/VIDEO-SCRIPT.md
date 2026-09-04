# Marginalia video script — 2:15

No music. No logos or title cards. Keep the fixture attribution line visible when a non-public-domain document is shown.

| Time | Screen action | Exact spoken narration | Exact ChatGPT prompt to type |
| --- | --- | --- | --- |
| 0:00–0:12 | Open Rutherford. Show the untouched source and empty margin. | “Marginalia is a reader where a human and their agent work on the same page. The source stays here. What the agent adds lives in the margin.” | — |
| 0:12–0:33 | Ask the interview prompt. Answer in chat: “I understand Coulomb force and inverse-square laws, but not the gold-foil experiment.” | “I am not asking an agent to rewrite this paper. I am telling it what I know, while the page holds the reading state.” | “Read the current reading state first. Interview me about what I know for this Rutherford paper, then record my answer as proposed knowledge.” |
| 0:33–0:48 | Confirm the proposed knowledge entry. | “I confirm the knowledge that is actually mine. That distinction matters before the document can adapt.” | — |
| 0:48–1:04 | Fold a completed Rutherford section. Keep its reason visible. | “Now the page folds a section with a reason I can inspect. The full source is one click away.” | “Read the current state and confirmed knowledge first. Use `set_section_depth` to fold one Rutherford section I understand. Give a visible reason that cites my confirmed knowledge.” |
| 1:04–1:20 | Open the Curious Kids fixture. Leave the attribution line visible. | “The next source is a Curious Kids article. Its text remains verbatim in the source layer, which also respects its no-derivatives license.” | — |
| 1:20–1:39 | Ask for a margin explanation or connection. Show the returned margin card. | “Now I ask it to read this as me, not as Joshua. It adds context beside the article, without changing a word of it.” | “Read the current reading state first. Add a short `annotate` explanation beside the section on the strong force. Do not change the source article.” |
| 1:39–1:50 | If figure support works, show Rutherford’s geometry. Otherwise leave the annotation visible. | “The margin can also hold a diagram, so a difficult relationship can become visible without becoming replacement text.” | “Read the current state first. Use `insert_figure` to draw a simple gold-foil scattering geometry beside the Rutherford section.” |
| 1:50–2:05 | Open Chrome WebMCP docs. Show the page’s activity or a margin card. | “The third document explains the browser tools that make this shared state possible. The agent calls page tools instead of guessing at clicks.” | “Read the current state first. Add an `annotate` connection between this WebMCP page and the tools registered by Marginalia.” |
| 2:05–2:15 | Toggle Agent off, then on. End with source visible. | “Agent off: the original documents remain. Agent on: the help returns. No tool can write the source. The agent lives in the margin.” | — |

If the figure does not work by recording time, skip its prompt and use the 1:39–1:50 beat to show the article annotation. Never show a failed tool call.
