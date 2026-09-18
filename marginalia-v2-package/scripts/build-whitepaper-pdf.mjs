/**
 * Build the unchanged research source as standalone HTML, then print with Edge.
 * Install the renderer outside this repository:
 * npm install --prefix <tools-directory> --no-audit --no-fund markdown-it
 * Usage: node marginalia-v2-package/scripts/build-whitepaper-pdf.mjs <tools-directory>
 * Or set WHITEPAPER_PDF_TOOLS to that directory. EDGE_PATH may override Edge.
 * Requires Python with pypdf for author metadata, which Edge omits from its PDF.
 * PYTHON may override the Python executable. No Python packages are installed here.
 * HTML and the isolated browser profile go under .local/positioning-credits/pdf-check.
 * No repository dependencies or source prose are changed.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tools = process.argv[2] || process.env.WHITEPAPER_PDF_TOOLS;
if (!tools) throw new Error('Provide a tools directory argument or WHITEPAPER_PDF_TOOLS.');
const require = createRequire(resolve(tools, 'package.json'));
const MarkdownIt = require('markdown-it');
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
const source = await readFile(resolve(root, 'marginalia-v2-package/docs/sources/RESEARCH-WHITEPAPER-v3.md'), 'utf8');
const tokens = md.parse(source, {});
const headings = [];
const ids = new Set();
for (let i = 0; i < tokens.length; i++) {
  if (tokens[i].type !== 'heading_open') continue;
  const label = tokens[i + 1].content;
  const base = label.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
  ids.add(id);
  tokens[i].attrSet('id', id);
  if (tokens[i].tag === 'h2') headings.push({ label, id });
}
const esc = md.utils.escapeHtml;
const toc = headings.map(h => `<li><a href="#${h.id}">${esc(h.label)}</a></li>`).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Marginalia | Research whitepaper</title>
<meta name="author" content="Yash Gurbani">
<meta name="description" content="A personalized, agentic margin for the web">
<style>
@page { size: A4; margin: 22mm 22mm 23mm; @bottom-center { content: counter(page); font: 9pt 'Segoe UI', sans-serif; color: #647080; } }
@page:first { @bottom-center { content: none; } }
:root { --ink: oklch(0.245 0.016 255); --accent: oklch(0.500 0.120 255); --rule: oklch(0.895 0.008 255); --soft: oklch(0.968 0.007 255); }
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); font: 10.75pt/1.48 Georgia, 'Times New Roman', serif; }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
p { margin: 0 0 9pt; orphans: 3; widows: 3; }
h1,h2,h3,h4 { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.22; break-after: avoid; }
h1 { font-size: 24pt; margin: 0 0 16pt; }
h2 { font-size: 16pt; margin: 22pt 0 10pt; padding-top: 8pt; border-top: 1px solid var(--rule); }
h3 { font-size: 12pt; margin: 16pt 0 8pt; }
li { margin-bottom: 5pt; orphans: 3; widows: 3; }
ul,ol { padding-left: 19pt; }
table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 13pt 0; font: 8.5pt/1.4 'Segoe UI', Arial, sans-serif; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th,td { text-align: left; vertical-align: top; padding: 7pt 6pt; border-bottom: 1px solid var(--rule); overflow-wrap: anywhere; }
th { background: var(--soft); font-weight: 600; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 8.5pt; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 11pt; background: var(--soft); border-left: 2pt solid var(--rule); line-height: 1.42; }
pre code { white-space: pre-wrap; }
blockquote { margin: 12pt 0; padding-left: 14pt; border-left: 2pt solid var(--rule); }
.cover { break-after: page; padding-top: 42mm; }
.cover .brand { font: 48pt/1.1 Georgia, serif; letter-spacing: -1.5pt; margin-bottom: 18pt; }
.cover .subtitle { font: 19pt/1.4 'Segoe UI', sans-serif; max-width: 135mm; }
.cover .kind { color: var(--accent); font: 11pt 'Segoe UI', sans-serif; margin: 24pt 0 64pt; padding-top: 18pt; border-top: 2pt solid var(--accent); }
.cover .byline { font: 11pt/1.7 'Segoe UI', sans-serif; }
.cover .repo { margin-top: 24pt; font: 9pt 'Segoe UI', sans-serif; }
.toc { break-after: page; font: 11pt/1.45 'Segoe UI', sans-serif; }
.toc h1 { margin-bottom: 24pt; }
.toc ol { list-style: none; padding: 0; }
.toc li { margin: 0; padding: 7pt 0; border-bottom: 1px solid var(--rule); break-inside: avoid; }
html { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
</style></head><body>
<section class="cover"><div class="brand">Marginalia</div>
<p class="subtitle">A personalized, agentic margin for the web</p>
<p class="kind">Research whitepaper</p>
<p class="byline">Yash Gurbani<br>September 2026</p>
<p class="repo"><a href="https://github.com/yashgurbani/marginalia">https://github.com/yashgurbani/marginalia</a></p></section>
<nav class="toc" aria-label="Table of contents"><h1>Contents</h1><ol>${toc}</ol></nav>
<main>${md.renderer.render(tokens, md.options, {})}</main></body></html>`;
const check = resolve(root, '.local/positioning-credits/pdf-check');
await mkdir(check, { recursive: true });
const htmlPath = resolve(check, 'Marginalia-Research-Whitepaper.html');
await writeFile(htmlPath, html);
const pdf = resolve(root, 'marginalia-v2-package/docs/Marginalia-Research-Whitepaper.pdf');
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const result = spawnSync(edge, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
  `--user-data-dir=${resolve(check, 'edge-profile')}`, `--print-to-pdf=${pdf}`, pathToFileURL(htmlPath).href],
  { encoding: 'utf8', timeout: 120000, windowsHide: true });
if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
// Edge reads <title> but currently ignores <meta name="author"> when printing.
const metadata = spawnSync(process.env.PYTHON || 'python', ['-c', `
import sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
p = Path(sys.argv[1])
w = PdfWriter(clone_from=PdfReader(p))
w.add_metadata({'/Title': 'Marginalia | Research whitepaper', '/Author': 'Yash Gurbani'})
temp = p.with_suffix('.metadata.pdf')
with temp.open('wb') as f: w.write(f)
temp.replace(p)
`, pdf], { encoding: 'utf8', windowsHide: true });
if (metadata.error || metadata.status !== 0) throw metadata.error || new Error(metadata.stderr);
if ((await stat(pdf)).size > 5_000_000) throw new Error('PDF exceeds 5 MB.');
await copyFile(pdf, resolve(root, 'site/Marginalia-Research-Whitepaper.pdf'));
console.log(`Built ${pdf}\nStandalone HTML: ${htmlPath}`);
