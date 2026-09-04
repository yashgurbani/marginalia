# Final demo integration report

Status: PASS.

## Result

The final demo combines three completed lanes:

- PR #1 long-horizon features: KaTeX, sanitized SVG figures, local vault search, attributed connections, and the optional graph.
- W7B: the full 7,180-word Rutherford paper with seven parsed sections and corrected attribution.
- W8: the light serif reader, anchored right margin, responsive section margins, and Notes drawer.

The merge kept the source layer immutable. The imported feature UI now follows the light visual system. The final recording sequence is in `docs/VIDEO-SCRIPT.md`.

## Integration changes

- `src/render.js`: kept the light reader and added safe figure rendering, math enhancement, and plain connection artifacts.
- `src/knowledge.js`: added Vault and Connections to the light Notes drawer.
- `src/style.css`: added shared aliases and plain styles for the imported views.
- `src/graph.js`: replaced dark graph labels and card fallback controls with theme-token styles.
- `docs/VIDEO-SCRIPT.md`: combined the interview, full Rutherford fixture, vault, connection, figure, and graph into one 2:20 demo.
- `.scratch/artifacts/W9/validate_final.py`: browser acceptance and screenshot script.

## Checks

Syntax and contract commands:

```powershell
node --check src/render.js
node --check src/knowledge.js
node --check src/tools.js
node --check src/figure.js
node --check src/vault.js
node --check src/graph.js
node .scratch/agora/results/PRO-EXPEDITION-01/diagnostics/renderer-contract.mjs
node .scratch/agora/results/PRO-EXPEDITION-01/diagnostics/tool-contract.mjs
node .scratch/agora/results/PRO-EXPEDITION-01/diagnostics/integration-contract.mjs
git diff --check
```

Result: all syntax checks passed. All three diagnostics printed `ALL PASS`. The diff check passed.

Root browser command:

```powershell
python .scratch/artifacts/W9/validate_final.py http://127.0.0.1:8780 --capture
```

Subpath browser command:

```powershell
python Marginalia/.scratch/artifacts/W9/validate_final.py http://127.0.0.1:8781/Marginalia
```

Both commands used headless Microsoft Edge through Playwright. At both paths:

- `tests/render.test.html`: `ALL PASS`
- `tests/tools.test.html`: `ALL PASS`
- `tests/e2e.test.html`: `ALL PASS`, `FAILURES: 0`

The root run also passed these browser gates:

- Seven Rutherford sections loaded.
- Local vault search returned `physics/rutherford.md`.
- A sanitized SVG appeared in the margin.
- A connection artifact appeared in the margin.
- The Notes drawer exposed Knowledge, Activity, Vault, and Connections.
- Vault and Connections mounted.
- The 390px reader had no horizontal overflow.

## Visual evidence

- `.scratch/artifacts/W9/desktop.png`: 1440×900 combined reader and margin.
- `.scratch/artifacts/W9/narrow.png`: 390×844 shortened source with an anchored interview question.
- `.scratch/artifacts/W9/drawer.png`: 1440×900 light Connections drawer with live graph and plain fallback line.

All three images were inspected at original resolution. No drawer fragment remained after its close motion. The narrow artifact was readable after its entrance motion. The graph uses the light theme tokens.

## Merge record

- PR #1 merged normally into `main` as `2a9c18d635f53c5cd4a97f58b5d739814c915579`.
- The final demo integration used branch `codex/final-demo`.
- No force operation or direct push to `main` was used.

## Limitations

- Headless Edge had no real ChatGPT WebMCP host. The page honestly showed `WebMCP · checking`, and the mock host tests passed.
- Edge requested `/favicon.ico`; the static server returned 404. This does not affect the app or tests.
- The W7B paper could not be checked page by page against a journal scan. `.scratch/artifacts/W7/REPORT.md` records the source limitation.
