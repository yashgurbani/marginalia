# Q07 Real-browser extension QA

label: wayfinder:task
mode: AFK
status: open
blocked_by: E01
route: Astra low (exploratory), Luna xhigh (checklist)

## Task
Load `extension/.output/chrome-mv3` unpacked in Chrome 116+ and Edge. Check: no CSP violations in any console after P1(b); assets load after the WAR narrowing; evict the service worker at `chrome://serviceworker-internals` and confirm the alarm reconnect fires within about one minute (P10); open and close 50 workspaces and confirm `storage.session` keys return to baseline (P11); narrow the window under 900px and confirm the sheet opens, stays open, closes on Escape and returns focus (M14); the Library action appears only with a paired helper and opens the web app library (M18).

## Acceptance
- `docs/evidence/qa-2026-09-18/extension-browser.md` with console screenshots and the key-count numbers.
- Any failure becomes a new E ticket with file and line.
