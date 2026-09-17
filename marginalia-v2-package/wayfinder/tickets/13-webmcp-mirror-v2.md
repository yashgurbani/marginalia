# 13-webmcp-mirror-v2

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: 02-artifact-contract-v1

## Question

Reconcile the Sep 4 tool surface (nine tools) with the new contract: which tools survive, what insert_artifact looks like, and how the extension registers the same tools on any page so a ChatGPT desktop user gets the assisted margin without the daemon. Decide what set_section_depth becomes now that agent-decided folding is retired.

## Resolution

Resolved. Keep get_reading_state, get_section_text, get_knowledge (→ get_context in alpha), upsert_knowledge (proposal only), search_notes, annotate, highlight, insert_figure. Add insert_artifact (accepts marginalia.artifact.v1, validated identically). set_section_depth becomes a reader-invoked fold; agent-decided hiding is retired. The content script registers the same tools on any page so a ChatGPT desktop user gets the assisted margin without the daemon.
