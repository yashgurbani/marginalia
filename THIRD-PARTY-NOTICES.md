# Third-party notices

[Research whitepaper](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/Marginalia-Research-Whitepaper.pdf) ([source](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/sources/RESEARCH-WHITEPAPER-v3.md)) · [Credits](CREDITS.md) · [Build scope](marginalia-v2-package/docs/SCOPE-COVERAGE.md)

## Production dependencies

This inventory was generated on 18 September 2026 from the installed package metadata. A temporary Node script started at the production dependencies in marginalia-v2-package/package.json, resolved each package from its parent, and recursively read dependencies, optional dependencies and installed peers. It followed the existing node_modules junction without changing it. Distinct installed versions appear separately. No required package was missing; absent optional peers are not shipped and are excluded.

| Package | Version | License | Repository | Flag |
| --- | --- | --- | --- | --- |
| @dagrejs/dagre | 3.1.1 | MIT | [Repository](https://github.com/dagrejs/dagre) | None |
| @dagrejs/graphlib | 4.0.5 | MIT | [Repository](https://github.com/dagrejs/graphlib) | None |
| ancestors | 0.0.3 | MIT | [Repository](https://github.com/chrisdickinson/ancestors) | None |
| better-sqlite3 | 13.0.3 | MIT | [Repository](https://github.com/WiseLibs/better-sqlite3) | None |
| commander | 15.0.0 | MIT | [Repository](https://github.com/tj/commander.js) | None |
| diff-match-patch | 1.0.5 | Apache-2.0 | [Repository](https://github.com/JackuB/diff-match-patch) | None |
| dom-anchor-text-position | 5.0.0 | MIT | [Repository](https://github.com/tilgovi/dom-anchor-text-position) | None |
| dom-anchor-text-position | 4.0.0 | MIT | [Repository](https://github.com/tilgovi/dom-anchor-text-position) | None |
| dom-anchor-text-quote | 4.0.2 | MIT | [Repository](https://github.com/tilgovi/dom-anchor-text-quote) | None |
| dom-node-iterator | 3.5.3 | MIT | [Repository](https://github.com/tilgovi/dom-node-iterator) | None |
| dom-seek | 5.1.1 | MIT | [Repository](https://github.com/tilgovi/dom-seek) | None |
| dom-seek | 4.0.3 | MIT | [Repository](https://github.com/tilgovi/dom-seek) | None |
| index-of | 0.2.0 | MIT | [Repository](https://github.com/jonschlinkert/index-of) | None |
| katex | 0.18.7 | MIT | [Repository](https://github.com/KaTeX/KaTeX) | None |
| node-addon-api | 8.9.2 | MIT | [Repository](https://github.com/nodejs/node-addon-api) | None |
| ws | 8.21.3 | MIT | [Repository](https://github.com/websockets/ws) | None |

No production package has a license outside MIT, ISC, BSD, Apache-2.0, 0BSD or OFL in its package metadata. No GPL, LGPL, AGPL, unknown or missing package license was found.

## Development and build tools

These direct tools are separate from the production closure above; their transitive development dependencies are not inventoried here.

| Package | Version | License | Repository | Flag |
| --- | --- | --- | --- | --- |
| wxt | 0.21.4 | MIT | [Repository](https://github.com/wxt-dev/wxt) | None |
| vite | 8.3.0 | MIT | [Repository](https://github.com/vitejs/vite) | None |
| typescript | 5.9.3 | Apache-2.0 | [Repository](https://github.com/microsoft/TypeScript) | None |

Node.js runs the helper and build tools. It uses the [MIT license with bundled third-party notices](https://github.com/nodejs/node/blob/main/LICENSE). SQLite, included through better-sqlite3, is [public domain](https://www.sqlite.org/copyright.html).

## KaTeX fonts

KaTeX code uses the MIT license. Its fonts use the SIL Open Font License, Version 1.1, as confirmed in the [KaTeX repository font-license discussion](https://github.com/KaTeX/KaTeX/issues/339), which quotes the license metadata embedded in the fonts.

## Compatibility

The recorded MIT and Apache-2.0 package licenses are compatible with this repository’s MIT license when their notice and license conditions are preserved. Third-party components keep their own licenses, including SIL OFL 1.1 for the KaTeX fonts.
