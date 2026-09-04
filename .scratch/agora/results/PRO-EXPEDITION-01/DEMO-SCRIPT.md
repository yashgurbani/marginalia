# Marginalia long-horizon demo script — 2:20

No music. Keep attribution visible. Use the Rutherford fixture first. Prepare a local folder containing at least two harmless Markdown notes, including one whose title/body mentions gold-foil scattering. Do not show private note content beyond the demo fixture.

| Time | Screen action | Narration | Exact prompt / action |
|---|---|---|---|
| 0:00–0:12 | Open Rutherford. Point to untouched source, empty margin, and WebMCP status. | “Marginalia lets a reader and an agent work on the same page. The document is source. Everything the agent adds stays visible in the margin.” | None. |
| 0:12–0:32 | Ask for an interview; answer: “I understand Coulomb force and inverse-square laws, but I have not studied Rutherford’s gold-foil experiment.” | “The page knows where I am and what I marked. The agent knows this conversation. WebMCP is the handshake between them.” | **Prompt:** “Call `get_reading_state` first. Interview me about what I know for this Rutherford paper. After I answer, record exactly one proposed knowledge entry and do not reshape the document yet.” |
| 0:32–0:42 | Confirm the proposed entry in Knowledge. | “The agent may propose what I know. Only I confirm it.” | Click **Confirm**. |
| 0:42–0:58 | Fold a non-current section and leave its reason visible. | “Now an eligible section folds with a reason. The source was not summarized away, and Expand restores it.” | **Prompt:** “Read the state and confirmed knowledge first. Fold one non-current Rutherford section I already understand to a stub. Cite my confirmed knowledge in the visible reason.” |
| 0:58–1:13 | Open **Vault** and drop/select the prepared notes folder. Show file count. | “My archive stays inside this browser. Loading and searching these Markdown notes sends nothing to a server.” | Drop/select the local folder. |
| 1:13–1:29 | Search notes. Briefly show Activity containing the returned path. | “The page ranks local title and body matches and makes the returned path auditable.” | **Prompt:** “Use `search_notes` for ‘gold foil scattering’. Report the best local result path without quoting more note text than needed.” |
| 1:29–1:44 | Add a connection card to the returned path. | “A connection can target only a knowledge id or a note path that this search actually returned. The relation and reason stay on the card.” | **Prompt:** “Connect the Rutherford scattering section to the best returned note path with relation `bridge` and a visible reason. Do not alter the source.” |
| 1:44–1:58 | Show a source formula and request a diagram. | “Physics remains physics: formulas render in the source and margin, while the raw LaTeX survives if the CDN is blocked.” | **Prompt:** “Use `insert_figure` to add a simple labeled SVG of a beam, thin gold foil, mostly straight trajectories, and one large-angle deflection. Keep it schematic.” |
| 1:58–2:08 | Open **Connections**. Show Cytoscape if loaded; otherwise show the connection list. Click the section node/list row. | “The graph is derived from removable margin artifacts. Even without the optional CDN, the connection list remains usable.” | No prompt. |
| 2:08–2:20 | Toggle Agent off, then on. End on full source. | “Agent off: the source is still here. Agent on: the help returns. No tool can write the source. The agent lives in the margin.” | Toggle **Agent** off/on. |

## Recording guardrails

- If KaTeX is blocked, deliberately point to the raw formula fallback rather than waiting.
- If Cytoscape is blocked, show the explicit unavailable message and use the fallback edge list.
- Never show a failed call. Use the connection path copied from the immediately preceding `search_notes` result.
- Keep the final take below three minutes.
