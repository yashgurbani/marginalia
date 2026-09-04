# W5 integration report

Status: PASS. Integration work stopped at 09:16 CEST, before the 09:35 cutoff.

## Files changed
- `src/tools.js`: added immediate and five-second delayed WebMCP host discovery, outcome events, duplicate-host protection, and registration error reporting.
- `index.html`: made the status pill use the real registration outcome; added the visible thesis, exact layer rule, and README judge hint.
- `tests/e2e.test.html`: added a real-page, real-module, real-fixture browser integration test.
- `.scratch/artifacts/W5/REPORT.md`: recorded this handoff.

No source-layer mutation tool was added. No package, build, commit, or push command ran.

## Commands run
- `python -m http.server 8765 --bind 127.0.0.1` from the repository root.
- `python -m http.server 8766 --bind 127.0.0.1` from `D:\Projects` for the `/Marginalia/` subpath test.
- `node --check src\state.js; node --check src\tools.js; node --check src\render.js; node --check src\knowledge.js; node --check src\ingest.js`
- `msedge.exe --headless=new --disable-gpu --virtual-time-budget=7000 --dump-dom http://127.0.0.1:8765/tests/tools.test.html`
- `msedge.exe --headless=new --disable-gpu --virtual-time-budget=7000 --dump-dom http://127.0.0.1:8765/tests/render.test.html`
- `msedge.exe --headless=new --disable-gpu --virtual-time-budget=7000 --enable-logging=stderr --v=0 --dump-dom http://127.0.0.1:8765/tests/e2e.test.html`
- `msedge.exe --headless=new --disable-gpu --virtual-time-budget=7000 --enable-logging=stderr --v=0 --dump-dom http://127.0.0.1:8766/Marginalia/tests/e2e.test.html`
- `git diff --check`
- `rg -n 'Origin-Agent-Cluster|Content-Security-Policy|(?:src|href)="/|fetch\("/|from\s+"/' _headers netlify.toml index.html src tests`

## Results
- Existing tool test: `ALL PASS` (24 assertions).
- Existing render test: `ALL PASS`.
- E2E root URL: `ALL PASS` / `FAILURES: 0`.
- E2E subpath URL: `ALL PASS` / `FAILURES: 0`.
- All three fixture entries loaded through `fixtures/index.json`, `loadFixture()`, and the visible picker. Each `##` boundary rendered as a section; each attribution rendered below the title.
- The E2E test covered every requested tool flow, confirmed state, folds and reasons, artifact removal controls, inline sanitized SVG, no-vault state, and Agent-layer restoration.
- A late `window.modelContext` mock received all nine `{name, description, inputSchema, execute}` tools. The pill showed the actual host and count.
- With no host, the pill changed from waiting to `WebMCP: no host detected` after five seconds.
- `_headers` contains no OAC or CSP directive. All application imports, fetches, and links use relative paths.

## Remaining risk
- This machine has no real ChatGPT in-app WebMCP host. Edge covered initial mock registration, late mock registration, UI behavior, sanitization, and static hosting only.
- The code assumes the in-app host accepts the documented synchronous `registerTool({...})` call. A host-specific rejection will appear in the status pill and console.
