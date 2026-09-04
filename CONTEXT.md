# Bridge — glossary

## Shore A / document
The immutable snapshot of a text the reader opened. Content-addressed by hash. Lives in the source layer.

## Shore B / knowledge
What the reader knows, as knowledge entries from three sources: interview, archive (their notes), agent memory.

## Knowledge entry
`{concept, level, evidence, source, status}`. Proposed until the reader confirms. Levels describe what the reader says (unknown/heard/used/derived/taught), not what they have shown.

## Bridge operation
An agent action on the agent layer that uses Shore B to decide how to present Shore A: expand, compactify, visualize, teach, perspectivize, highlight, gloss.

## Layer
One of source (immutable), reader (human marks), agent (artifacts). Each toggleable. See ADR-0001.

## Stub
The page-generated placeholder for a collapsed section: heading + reason + "expand". Never agent-written prose.

## Reason
Required text on every reshape, citing knowledge entries by id. Makes every collapse and gloss explainable.

## Artifact
Anything the agent placed in the agent layer: annotation, highlight, figure, widget. Attributed, timestamped, removable.

## Reader mark
Human-only signal: known, lost, tapped term, confirmation, removal. The agent reads marks; it never writes them.

## Interview
The agent questioning the reader to produce knowledge entries; the engine that makes the document reshape as the reader talks.

## Archive
The reader's own notes (vault/md/Zotero) dropped into the page and indexed client-side; queried via search_notes; never leaves the browser.
