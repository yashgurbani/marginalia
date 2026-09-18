# Journeys and journal shape

status: resolved 2026-09-18 by Yash
type: grilling, Yash
blocked by: none

## Question
The whitepaper's home (`docs/sources/RESEARCH-WHITEPAPER-v3.md:159`, and the after-launch list) names journeys and a journal. Neither exists. `ui/journal.ts` is a mutation queue and `tests/journey-e2e.test.ts` is a test harness.

1. What is a journey to Yash: a named collection the reader builds by hand, a path across papers, or something the margin proposes and the reader accepts?
2. What is the journal: a factual weekly view of what was read and asked, or written synthesis?
3. The audit's smallest slices are a reader-made named collection, and a local factual activity view with no model call. Are those the right first steps?

This shapes what the product is, so it waits for Yash.

## Resolution
Yash, 2026-09-18: "journal is a way to integrate whatever you read across the web/pdf that day structured in topics automatically called journeys with your own notes and bookmarks and highlights and transforms to look back to and save".

Decision: the journal is the day's reading across web and PDF, brought together. Journeys are its topics, formed automatically. Each journey holds the reader's own notes, bookmarks, highlights and transforms, to look back on and to save. Open points for the build tickets: how topics form without a send (local grouping first; any model call is a reviewed ask), and PDF reading, which sits in Not yet specified. New build tickets needed: "Daily journal view" and "Journeys group the day by topic".
