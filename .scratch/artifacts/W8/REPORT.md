# W8 visual-layer report

Status: PASS

## Result

Marginalia now uses the light reader layout from the five `.scratch/design/*.dc.html` mockups. The source remains immutable. Reader marks stay in the source column. Agent artifacts stay in the margin.

## Files changed

- `index.html`: replaced the dashboard shell with the 44px reader bar, four-column document grid, overlay Notes drawer hook, honest WebMCP status, and footer layer rule.
- `src/style.css`: added the complete token set, light and dark schemes, 640px source column, 320px margin, 360px drawer, narrow layout, motion, and reduced-motion behavior.
- `src/render.js`: changed sections and artifacts from cards to plain reader and margin blocks. Preserved marks, highlights, folds, pending changes, figures, sources, removal, term taps, cursor updates, and layer behavior.
- `src/knowledge.js`: changed the knowledge pane to the Notes drawer. Preserved Knowledge and Activity tabs, confirmation, rejection, confirm-all, artifact removal, and export behavior.
- `tests/render.test.html`: updated visual terminology and added the Agent-off depth-word assertion.
- `tests/e2e.test.html`: updated selectors and status text for the new visual layer.
- `.scratch/artifacts/W8/desktop.png`: final 1440x900 desktop capture.
- `.scratch/artifacts/W8/narrow.png`: final 390x844 narrow capture.
- `.scratch/artifacts/W8/REPORT.md`: this report.

## Verification commands and results

### Static checks

```powershell
node --check src\render.js
node --check src\knowledge.js
git diff --check
rg -n "eyebrow|status-pill|depth-chip.*border|linear-gradient|radial-gradient|text-transform:\s*uppercase|thesis|judge-hint|border-left:\s*[2-9]" index.html src\style.css src\render.js src\knowledge.js
```

Result: both JavaScript syntax checks passed. `git diff --check` passed. The forbidden-pattern search returned no matches.

### Root browser tests

```powershell
python "C:\Users\yashg\.codex\skills\webapp-testing\scripts\with_server.py" --server "python -m http.server 8765 --bind 127.0.0.1" --port 8765 -- powershell -NoProfile -Command "& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu --virtual-time-budget=7000 --dump-dom http://127.0.0.1:8765/tests/render.test.html | Select-String 'ALL PASS|FAILURES'; & 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu --virtual-time-budget=7000 --dump-dom http://127.0.0.1:8765/tests/e2e.test.html | Select-String 'ALL PASS|FAILURES'"
```

Result:

- `tests/render.test.html`: `ALL PASS`
- `tests/e2e.test.html`: `ALL PASS`, `FAILURES: 0`

### Subpath browser tests

```powershell
python "C:\Users\yashg\.codex\skills\webapp-testing\scripts\with_server.py" --server "python -m http.server 8766 --bind 127.0.0.1" --port 8766 -- powershell -NoProfile -Command "& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu --virtual-time-budget=7000 --dump-dom http://127.0.0.1:8766/Marginalia/tests/render.test.html | Select-String 'ALL PASS|FAILURES'; & 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu --virtual-time-budget=7000 --dump-dom http://127.0.0.1:8766/Marginalia/tests/e2e.test.html | Select-String 'ALL PASS|FAILURES'"
```

Result:

- `/Marginalia/tests/render.test.html`: `ALL PASS`
- `/Marginalia/tests/e2e.test.html`: `ALL PASS`, `FAILURES: 0`

### Headless screenshots

```powershell
python "C:\Users\yashg\.codex\skills\webapp-testing\scripts\with_server.py" --server "python -m http.server 8765 --bind 127.0.0.1" --port 8765 -- python D:\CodexTokenOp\capture_marginalia.py
```

The Playwright capture used Microsoft Edge in headless mode. It waited for the Rutherford fixture and final WebMCP status. It added representative margin artifacts and folds through the public tools. It also opened and closed the Notes drawer and checked its width and controls.

Result:

- `.scratch/artifacts/W8/desktop.png`: 1440x900
- `.scratch/artifacts/W8/narrow.png`: 390x844

Both screenshots were inspected at original resolution. The desktop source and margin columns align. The narrow artifact blocks sit under their source sections with a 20px indent. The narrow top bar fits without horizontal clipping.

## Deviations

- Below 900px, the fixture picker and WebMCP status are hidden. `Narrow.dc.html` omits both controls, and hiding them keeps the 390px top bar on one line. Source, You, Agent, and Notes remain available.
- The screenshot state contains representative agent output. This makes margin alignment, artifact anatomy, folded sections, and shortened sections visible in the required captures.

## Unverified

- A real ChatGPT WebMCP host was not available. The existing end-to-end mock registered all nine tools and passed.
- The dark token set exists and preserves the reader, agent, and link hues. The required screenshot review covered the light scheme only.

No dependency, framework, web font, commit, or push command ran.
