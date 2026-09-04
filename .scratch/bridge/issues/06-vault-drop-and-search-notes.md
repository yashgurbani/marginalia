# 06 — Archive shore: drop `.md` folder, client-side index, `search_notes`

**What to build:** Drag-and-drop a folder of `.md` (or multi-file select). The page builds a lexical index (title + body, simple BM25 or token overlap). `search_notes` returns path/title/snippet/score. The agent cites a note path in a stub reason.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] No network request is made during indexing or search (verify in devtools)
- [ ] `search_notes` with no vault → `ok:true, results:[]`, detail "no vault loaded"
- [ ] Vault tab shows file count and last query
