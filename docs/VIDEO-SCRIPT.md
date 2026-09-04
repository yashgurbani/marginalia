# Marginalia final demo — 2:20

No music. Keep the attribution visible. Start with the full seven-section, 7,180-word Rutherford paper. Prepare a local folder with two harmless Markdown notes. One note must mention gold-foil scattering.

| Time | Screen action | Narration | Exact prompt or action |
| --- | --- | --- | --- |
| 0:00–0:12 | Open Rutherford. Show the untouched source, empty margin, and WebMCP status. | “Marginalia lets a reader and an agent work on the same page. The paper stays source. Everything the agent adds stays visible in the margin.” | None. |
| 0:12–0:32 | Ask for an interview. Answer: “I understand Coulomb force and inverse-square laws, but I have not studied Rutherford’s gold-foil experiment.” | “The page knows where I am and what I marked. The agent knows this conversation. WebMCP connects them.” | “Call `get_reading_state` first. Interview me about what I know for this Rutherford paper. After I answer, record exactly one proposed knowledge entry. Do not reshape the document yet.” |
| 0:32–0:42 | Open Notes, then confirm the proposed Knowledge entry. | “The agent can propose what I know. Only I can confirm it.” | Click **confirm**. |
| 0:42–0:58 | Fold a non-current section. Keep its reason visible. | “Now a section shortens with a reason that I can inspect. Expand restores the complete original text.” | “Read the state and confirmed knowledge first. Shorten one non-current Rutherford section that I understand to a stub. Cite my confirmed knowledge in the visible reason.” |
| 0:58–1:13 | Open **Vault**. Drop or select the prepared notes folder. Show the file count. | “My archive stays inside this browser. Loading and searching these Markdown notes sends nothing to a server.” | Drop or select the local folder. |
| 1:13–1:29 | Search the notes. Show Activity with the returned path. | “The page ranks local title and body matches. The returned path stays auditable.” | “Use `search_notes` for ‘gold foil scattering’. Report the best local result path without quoting more note text than necessary.” |
| 1:29–1:44 | Add a connection to the returned note path. | “A connection can target only confirmed knowledge or a path returned by the search. Its relation and reason stay in the margin.” | “Connect the Rutherford scattering section to the best returned note path. Use relation `bridge` and a visible reason. Do not alter the source.” |
| 1:44–1:58 | Add a figure beside the scattering passage. | “The margin can hold safe inline diagrams and rendered formulas. If a CDN is blocked, the raw formula remains readable.” | “Use `insert_figure` to add a simple labeled SVG of a beam, thin gold foil, mostly straight trajectories, and one large-angle deflexion. Keep it schematic.” |
| 1:58–2:08 | Open **Connections**. Click the section node or the fallback connection line. | “This view derives its graph from removable margin artifacts. The connection list remains usable without the optional graph library.” | None. |
| 2:08–2:20 | Toggle Agent off, then on. End with the source visible. | “Agent off: the full paper remains. Agent on: the help returns. No tool can write the source. The agent lives in the margin.” | Toggle **Agent** off and on. |

## Recording checks

- Use the path from the immediately preceding `search_notes` result.
- If KaTeX is blocked, show the raw formula fallback.
- If Cytoscape is blocked, show the explicit unavailable message and the connection line.
- Do not show a failed tool call.
- Keep the final take below three minutes.
