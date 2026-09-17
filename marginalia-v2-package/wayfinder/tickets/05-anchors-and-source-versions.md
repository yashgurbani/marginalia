# 05-anchors-and-source-versions

label: wayfinder:research
mode: AFK
status: closed
blocked_by: (none)

## Question

Which anchoring library to adopt (Hypothesis client anchoring vs Apache Annotator vs own) for W3C selectors with exact/prefix/suffix and text position; how to record HTML source versions (Readability/Defuddle extraction, SingleFile snapshot) and reattach with exact/relocated/ambiguous/orphaned states. Report options, licences, maintenance, and a recommendation.

## Resolution

Resolved. Hypothesis `dom-anchor-text-quote` and `dom-anchor-text-position` (MIT) for W3C selectors; Mozilla Readability for the reflowed view; SingleFile rejected (AGPL). Source identity (locator candidates), source version (immutable capture with text hash) and attachment (per target version and tab, with state exact / moved / unsure / lost and a candidate range) are three records; the original selector is never rewritten. Reattachment never guesses through ambiguity: it shows candidates or leaves the item unplaced. PDF quads later, same records.
