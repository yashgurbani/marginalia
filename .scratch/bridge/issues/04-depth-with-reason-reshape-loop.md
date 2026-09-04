# 04 — `set_section_depth` with reason; the reshape-as-you-talk loop (RECORD VIDEO HERE)

**What to build:** After an interview answer is confirmed, the agent collapses a section to a stub with a reason citing the knowledge entry, and expands another. Stub text is page-generated. `hidden` requires ≥1 confirmed knowledge ref. Fold animation + reason types in.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `hidden` without confirmed refs → `validation_failed` with next_step "ask the reader to confirm"
- [ ] Stub shows heading, reason, cited entry ids, "expand"; one click restores full text
- [ ] The demo beat (interview → fold) recorded as a rough take before continuing
