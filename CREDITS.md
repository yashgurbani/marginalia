# Credits

[Research whitepaper](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/Marginalia-Research-Whitepaper.pdf) ([source](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/sources/RESEARCH-WHITEPAPER-v3.md)) · [Third-party notices](THIRD-PARTY-NOTICES.md) · [Build scope](marginalia-v2-package/docs/SCOPE-COVERAGE.md)

## Research lineage

[ScholarPhi](https://scholarphi.org/), Head et al., CHI 2021, demonstrated just-in-time, position-sensitive definitions of terms and symbols. Read the [paper](https://scholarphi.org/assets/pdf/scholarphi-chi-2021.pdf) or inspect its [code](https://github.com/allenai/scholarphi). Marginalia uses no ScholarPhi code. The debt is the idea of definitions beside the text.

Lo et al.’s [Semantic Reader Project](https://arxiv.org/abs/2303.14334) appeared as a 2023 preprint and was published in CACM 67(10) in 2024. It provides research context for assistance within a reading surface.

The whitepaper’s prior-art section also cites August et al., Paper Plain, TOCHI 2023. That entry provides no direct paper link; its citation is retained in the [whitepaper reference section](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/Marginalia-Research-Whitepaper.pdf) ([source](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/sources/RESEARCH-WHITEPAPER-v3.md#appendix-d-references)). Other prior art and platform references from that section follow. These are intellectual and design references, not a list of code bundled with Marginalia.

- [Semantic Reader Open Research Platform](https://openreader.semanticscholar.org/)
- [Semantic Reader product](https://www.semanticscholar.org/product/semantic-reader)
- [@allenai/pdf-components](https://www.npmjs.com/package/@allenai/pdf-components)
- [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- [Readwise Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/global)
- [Anara](https://support.anara.com/en/articles/14473005-what-is-anara)
- [SciSpace Copilot extension](https://scispace.com/resources/scispace-copilot-chrome-extension/)
- [ChatGPT Atlas data controls](https://help.openai.com/en/articles/12574142-chatgpt-atlas-data-controls-and-privacy)
- [Perplexity memory](https://www.perplexity.ai/hub/blog/introducing-ai-assistants-with-memory)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

## Open source used by Marginalia

| Project | License | Use |
| --- | --- | --- |
| [KaTeX](https://github.com/KaTeX/KaTeX) | MIT (code); [SIL OFL 1.1 (fonts)](https://github.com/KaTeX/KaTeX/issues/339) | Render mathematical notation |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | Access the local SQLite store |
| [SQLite](https://www.sqlite.org/) | Public domain | Persist reading data and local indexes |
| [ws](https://github.com/websockets/ws) | MIT | WebSocket communication with the helper |
| [dom-anchor-text-quote](https://github.com/tilgovi/dom-anchor-text-quote) | MIT | Locate saved text by quotation |
| [dom-anchor-text-position](https://github.com/tilgovi/dom-anchor-text-position) | MIT | Locate saved text by position |
| [@dagrejs/dagre](https://github.com/dagrejs/dagre) | MIT | Lay out graph reply blocks |
| [WXT](https://github.com/wxt-dev/wxt) | MIT | Build the Chrome extension |
| [Vite](https://github.com/vitejs/vite) | MIT | Build the local web app |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 | Type checking and typed source |
| [Node.js](https://github.com/nodejs/node) | MIT with bundled third-party notices | Run the helper and build tools |

The notices file records installed versions and transitive production dependencies.

## Build tools

Yash Gurbani built Marginalia with GPT-6 Astra via Codex and ChatGPT Pro. Claude Code supported integration and review. These tools are credited for the build; they do not supply evidence that every planned capability is shipped.
