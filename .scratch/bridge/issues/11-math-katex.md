# 11 — Math: KaTeX rendering in source and margin
**What to build:** Source layer renders `$…$`/`$$…$$` and LaTeX from the fixture; margin prose kinds render math too; `expand` accepts Feynman paper-companion box grammar (verbatim pass-through).
**Blocked by:** 02
**Status:** ready-for-agent
- [ ] Rutherford scattering formula renders in source; an `expand` with the derivation renders in the margin
- [ ] KaTeX loaded from CDN with fallback to raw LaTeX text if blocked
