# W7b Rutherford fixture report

Status: PASS.

The Rutherford fixture now contains the full ChemTeam transcription of the 1911 paper. The fixture has 7,180 words and seven sections. It contains plain Unicode equations and no HTML.

## Files changed

- `fixtures/rutherford-1911.md`
- `fixtures/index.json` (Rutherford entry only)
- `fixtures/ATTRIBUTION.md` (Rutherford lines only)
- `.scratch/artifacts/W7/REPORT.md`

No source, test, page, documentation, or README file changed as part of W7b. No commit or push command ran.

## Source and conversion

The source was `.scratch/artifacts/W7/chemteam.html`. The extraction retained the paper text, its seven numbered sections, period spelling, tables, and footnote text. It removed page numbers, footnote markers, and figure images. It retained the two image captions as `Fig. 1.` and `Fig. 2.`.

The source stored fourteen equations as GIF images. I downloaded those fourteen GIF files from the same ChemTeam page directory. I visually transcribed each equation into Unicode plain text. Every equation appears on its own line.

## Word count and content checks

Command:

```powershell
$env:PYTHONIOENCODING='utf-8'; @'
from pathlib import Path
import re
s=Path('fixtures/rutherford-1911.md').read_text(encoding='utf-8')
print('word_count='+str(len(re.findall(r"\b[\w’'-]+\b", s, flags=re.UNICODE))))
print('forbidden_matches='+str(len(re.findall(r'(?im)^.*(?:abridg|condens|lorem|<[^>]+>).*$', s))))
'@ | python -
```

Output:

```text
word_count=7180
forbidden_matches=0
```

## Sections

1. `§1 It is well known that the α and the β particles suffer deflexions from their rectilinear paths by encounters with atoms of matter`
2. `§2 We shall first examine theoretically the single encounters with an atom of simple structure, which is able to produce large deflections of an α particle, and then compare the deductions from the theory with the experimental data available`
3. `§3 Probability of single deflexion through any angle`
4. `§4 Alteration of velocity in an atomic encounter`
5. `§5 Comparison of single and compound scattering`
6. `§6 Comparison of Theory with Experiments`
7. `§7 General Considerations`

## Parser check

Commands:

```powershell
Copy-Item -LiteralPath 'src\ingest.js' -Destination '.scratch\artifacts\W7\ingest-check.mjs'
node --input-type=module -e "import fs from 'node:fs'; import { parseMarkdown } from './.scratch/artifacts/W7/ingest-check.mjs'; const md=fs.readFileSync('./fixtures/rutherford-1911.md','utf8'); const parsed=parseMarkdown(md); const headings=(md.match(/^## /gm)||[]).length; console.log('heading_count='+headings); console.log('section_count='+parsed.sections.length); console.log('empty_sections='+parsed.sections.filter(s=>!s.text.trim()).length); if(parsed.sections.length!==headings||parsed.sections.some(s=>!s.text.trim())) process.exit(1);"
Remove-Item -LiteralPath '.scratch\artifacts\W7\ingest-check.mjs'
```

Output:

```text
heading_count=7
section_count=7
empty_sections=0
parse_exit=0
```

## Browser integration check

Commands:

```powershell
python -m http.server 8765 --bind 127.0.0.1
$edge='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'; $dom = & $edge --headless=new --disable-gpu --virtual-time-budget=7000 --enable-logging=stderr --v=0 --dump-dom http://127.0.0.1:8765/tests/e2e.test.html 2>&1 | Out-String
```

Output:

```text
<pre id="result">ALL PASS
FAILURES: 0</pre>
e2e_exit=0
```

## Diff check

Command:

```powershell
git diff --check -- fixtures/rutherford-1911.md fixtures/index.json fixtures/ATTRIBUTION.md
```

Output:

```text
warning: in the working copy of 'fixtures/ATTRIBUTION.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'fixtures/index.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'fixtures/rutherford-1911.md', LF will be replaced by CRLF the next time Git touches it
diff_check_exit=0
```

## Unverified items

- `.scratch/artifacts/W7/wikisource.html` is a short stub. It did not provide a full second transcription.
- `.scratch/artifacts/W7/ihep.pdf` is a 236-byte error response. It did not provide a usable scan.
- The paper text was not checked page by page against a journal scan.
- The fourteen equations were visually checked against the ChemTeam GIF files. They were not checked against a second source.
- Apparent wording and typographical artifacts in the ChemTeam transcription remain unchanged. Symbol-font math, superscripts, subscripts, and image equations were converted to readable Unicode.
