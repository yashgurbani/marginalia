# 02 — Three-layer renderer with toggles and reader marks

**What to build:** The document renders in the source layer; a gutter renders agent-layer artifacts; the top bar toggles Source / You / Agent. Clicking a paragraph offers "I know this" / "Lost me"; double-click a word records a tapped term. Marks appear in `get_reading_state`.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Toggling Agent off shows the untouched paper
- [ ] Marks persist in page state and appear in the next `get_reading_state`
- [ ] No code path exists that mutates source-layer text (grep-able: source array is frozen)
