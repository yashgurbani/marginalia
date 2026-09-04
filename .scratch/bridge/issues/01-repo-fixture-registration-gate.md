# 01 — Repo, fixture, first tool registered, deployed (GATE 1)

**What to build:** A public MIT repo `bridge` with `index.html` that loads the fixture paper, splits it into sections, and registers `get_reading_state` via the WebMCP imperative API. Deployed on Netlify (or GitHub Pages). Opened in the ChatGPT desktop in-app browser, the agent can call the tool and describe the document's sections.

**Blocked by:** 00. **Time cap: 45 min. If missed, stop and submit Amino Arcade tools instead.**

**Status:** ready-for-agent

- [ ] First commit timestamped inside the submission window (LICENSE + skeleton)
- [ ] `fixtures/rutherford-1911.md`, `fixtures/conversation-how-do-atoms-form.md` (CC BY-ND, text only, attribution line), `fixtures/chrome-webmcp-docs.md` (CC BY 4.0), `fixtures/ATTRIBUTION.md` present; PD/license status in README
- [ ] `get_reading_state` visible in Model Context Tool Inspector or callable from ChatGPT browser
- [ ] Live URL returns the page with `Origin-Agent-Cluster` not set to `?0`
