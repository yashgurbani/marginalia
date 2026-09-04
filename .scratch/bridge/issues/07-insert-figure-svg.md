# 07 — `insert_figure` (SVG) with sanitization

**What to build:** The agent draws an SVG schematic into a section's gutter with a caption. Sanitizer strips `<script>`, event attributes, external hrefs; size-capped.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Malicious SVG fixture (script, onload, external image) is rejected with detail
- [ ] Figure renders within gutter width; caption shown; removable
