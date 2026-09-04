# W6 fallback report

Status: COMPLETE. Priorities 1–4 landed. No commit, push, install, or build ran.

## Landed

1. KaTeX 0.16.11 loads from pinned jsDelivr CSS and JS URLs. Section and margin math use `renderToString` with `throwOnError:false`. Raw delimiters remain if KaTeX is unavailable.
2. The top bar accepts dropped or selected `.md` and `.txt` notes. `src/vault.js` builds an in-memory lowercase token index with term-frequency scores and installs the frozen `window.marginaliaVault.search` result shape after load.
3. `annotate` exposes and validates `connection` fields. Margin cards show the relation and a linked note path or section ID.
4. `tests/fallback.test.html` covers Rutherford math, margin math, seeded vault search, and connection rendering.

## Files changed

- `index.html`, `src/render.js`, `src/tools.js`, `src/style.css`
- New: `src/vault.js`, `tests/fallback.test.html`
- New samples: `fixtures/sample-vault/{rutherford-notes.md,atomic-structure.md,webmcp-notes.txt}`
- `fixtures/index.json` and `src/state.js` remain unchanged. `src/figure.js` was not needed.

## Exact commands

- `node --check src\vault.js; node --check src\render.js; node --check src\tools.js`
- `git diff --check`
- `python -m http.server 8881 --bind 127.0.0.1` from the worktree root, launched with `Start-Process -WindowStyle Hidden`.
- `msedge.exe --headless=new --disable-gpu --user-data-dir=<temporary-profile> --virtual-time-budget=15000 --dump-dom http://127.0.0.1:8881/tests/fallback.test.html`
- The same Edge command ran for `tests/e2e.test.html`, `tests/render.test.html`, and `tests/tools.test.html`.

## Test output

- `fallback.test.html`: `ALL PASS` / `FAILURES: 0`
- `e2e.test.html`: `ALL PASS` / `FAILURES: 0`
- `render.test.html`: `ALL PASS`
- `tools.test.html`: `ALL PASS`
- Syntax checks and `git diff --check`: exit 0.

## Regressions and risks

- No regression appeared in the existing browser suites.
- KaTeX needs CDN access for formatted math. A CDN error leaves readable raw math and does not throw from rendering.
