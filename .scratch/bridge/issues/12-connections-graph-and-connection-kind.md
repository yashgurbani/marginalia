# 12 — `connection` kind + Connections graph tab + `get_connections`
**What to build:** The agent links a passage to a vault note or knowledge entry with a relation and reason; the Connections tab renders the graph (Cytoscape); `get_connections` returns it. Concepts are agent-proposed nodes the reader confirms.
**Blocked by:** 06
**Status:** ready-for-agent
- [ ] Relation enum enforced; target must exist (note path from `search_notes` or knowledge id)
- [ ] Graph updates live; clicking a node scrolls to the passage
