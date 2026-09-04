# W1 Core Report

Status: COMPLETE

## Files written

- `src/state.js`
- `src/tools.js`
- `tests/tools.test.html`
- `.scratch/artifacts/W1/REPORT.md` (required report)

## WebMCP host

The runtime uses the first available host in this order:
`navigator.modelContext`, `document.modelContext`, `window.modelContext`.
The browser test used `document.modelContext` and registered all nine tools.
The module logs the selected host and warns when no host exists.

## Tests

Command:
`& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --inprivate --disable-gpu --allow-file-access-from-files --virtual-time-budget=3000 --dump-dom 'file:///D:/Projects/Marginalia/tests/tools.test.html' | Select-String -Pattern 'final-result|FAIL:'`

Result: PASS. The page printed `ALL PASS` after 24 assertions.

Syntax command:
`node --check 'src\state.js'; node --check 'src\tools.js'`

Result: PASS. Both commands exited with code 0 and no syntax errors.

## Known gaps

- The test uses `--allow-file-access-from-files` because ES module imports run from a local file URL.
- SVG cleanup uses a strict sanitizer and XML-shaped root checks, not a full SVG allowlist.

## Contract deviations

None.
