# 15 — Export to vault (Markdown) + "copy as question" → `pending_questions`
**What to build:** Export margin + marks + knowledge deltas as one Markdown file (Obsidian-friendly, wikilinks to note paths); selection → "copy as question" writes into `pending_questions` in reading state and copies a prompt to clipboard.
**Blocked by:** 12
**Status:** ready-for-agent
- [ ] Exported file opens in Obsidian with links resolving to dropped vault paths
- [ ] `get_reading_state` shows the pending question; agent can answer it as a `question`/`expand` artifact
