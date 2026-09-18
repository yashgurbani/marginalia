# E03 P1(a): extension icons at 16, 32, 48 and 128

label: wayfinder:task
mode: AFK
status: open
blocked_by: (none)
route: Astra low (visual), Opus 4.8 taste check optional

## Task
`docs/ENGINEERING-STANDARDS-2026-09-18.md` §2 P1(a): no `icons` key and no PNG under `extension/`; Chrome Web Store submission is blocked on this alone. Design a quiet mark in the margin's register (the wordmark is plain text "Marginalia" in `ui/margin.css`; the palette is the `--m-*` tokens). Produce `extension/public/icon/{16,32,48,128}.png`, add `icons` and `action.default_icon` to `extension/wxt.config.ts`, build with `npm run extension:build`, load unpacked and screenshot the toolbar and the extensions page into `docs/evidence/qa-2026-09-18/extension-icons.png`.

## Acceptance
- Four PNGs present, manifest references them, build succeeds.
- Screenshot shows the icon legible at 16px.
- Preserve the design system; no gradients, no mascots.
