# 10 — STRETCH: `insert_widget` sandboxed simulation

**What to build:** The agent inserts a self-contained HTML/canvas sim into a sandboxed iframe (`sandbox="allow-scripts"`, CSP no network, no parent access), one per section, size-capped. Demo: a gold-foil alpha-scattering widget for Rutherford §2 (deflection angle vs impact parameter).

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Widget attempting `fetch` or `parent.` access fails silently (verified)
- [ ] Payload accepts a paper-viz scene schema wrapper (FeynmanILE `skills/paper-viz/`) — stub OK
