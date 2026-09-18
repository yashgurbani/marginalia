# E06 Decompose ui/margin.ts

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: E01, E04
route: Sol medium

## Task
Deferred refactor: `ui/margin.ts` is above 1,100 lines with `mountMargin` and `readReplies` holding most of the state. Split by concern without changing behaviour: threads rendering, composer and drafts, asking and review sheet, settings and helper management, reading position and rail, sheet behaviour under 900px. Keep `mountMargin` as the single entry, keep every `data-focusKey`, aria label and class name, keep `ui/margin.css` unchanged.

## Acceptance
- All margin tests pass unchanged; `npm run extension:typecheck` clean.
- No file above 400 lines in `ui/margin/`; the public `MarginOptions` and returned API are identical.
