# Marginalia v2: glossary and orientation

This repository's product is Marginalia v2. The code lives in `marginalia-v2-package/`. The governing document is `marginalia-v2-package/wayfinder/SPEC-FINAL.md`; its Vocabulary table is canonical, and this file is a short view of it. Where they differ, the spec wins. The `archive/` folder holds the retired first version. It is kept for history and is never a source for v2 work.

## The margin
A Chrome side panel beside whatever page the reader has open. It holds the reader's notes, highlights and threads for that page. The page itself is never rewritten.

## Source
The page the reader is reading. Source content is immutable. Marks on it use the CSS Custom Highlight API and change no page markup.

## Thread
A durable conversation attached to a source location. States: open, parked, done, archived.

## Note
Text the reader wrote. Notes are senior to replies.

## Highlight
A saved selection. On screen: Highlight or Keep.

## Asking
The reader selects a passage or writes a note and asks for help. The kinds of help (internal name `intent`) are define, simulate, instantiate, derive, diagram, evidence, explore and unsure. On screen, `simulate` is labelled "Simulate it". The Library calls groups of related reading "Journeys", its dated page "Activity", and its summary card "Daily recap".

## Reply
A generated, immutable response version (`reply_version`). A reply is made of typed blocks: text, equation, model, plot, derived, classification, table, diagram, citations, shelf, grid. Packaged code renders the blocks. Replies answer first.

## Assumptions, source facts, execution facts
Three separate records. The reader can edit assumptions. Source facts and host-recorded execution facts cannot be edited.

## Reattachment
When a page changes, each mark reattaches as exact, moved, unsure or lost. The word shows only when the result is not exact.

## The local helper
The Node process on the reader's machine (internal name `daemon`). It stores everything in a local SQLite database and talks to Codex. "The local helper" appears only in setup copy.

## Codex
The reader's own Codex sign-in, reached by the local helper. There are no API keys, and no credential lives in the browser.

## Instant help
A reader-controlled first layer: quick definitions and simple explanations from a warm Codex thread for the open page. It is on by default, the reader can turn it off, and excluded sites never send anything. It runs on the reader's Codex plan and shows the day's usage (decision D18). See `.local/redesign/OWNER-DECISIONS-2026-09-18.md`, decisions D1 and D5 to D7.

## Auto assist mode
An opt-in mode where the margin underlines likely hard passages and keeps help ready. Decisions D11 and D12.

## Excluded site
A site the reader has excluded. Nothing from it is ever sent.

## Words that never appear on screen
artifact, provenance, ledger, transform, tier, job, schema, sandbox, MCP, AI, confidence. No badges, pills or sparkles.
