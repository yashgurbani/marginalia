# 09 — STRETCH: Cloudflare Worker `/snapshot?url=` with Readability

**What to build:** A Worker that fetches a URL, runs Readability, returns title + sanitized HTML/markdown. The page's "Open URL" field calls it and ingests. Honest failure states: paywall / non-article / fetch error shown as such.

**Blocked by:** 01 (independent of 02–08; only if Gate 1 landed early)

**Status:** ready-for-agent

- [ ] Worker deployed; CORS allows the page origin only
- [ ] Snapshot stored with hash; re-opening the same URL after change yields a new hash
