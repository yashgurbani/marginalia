# Marginalia

A personalized, agentic margin for the web.

[Open the website](https://yashgurbani.github.io/marginalia/) · [Download the alpha](https://github.com/yashgurbani/marginalia/releases/tag/v0.2.0) · [Research whitepaper](https://yashgurbani.github.io/marginalia/site/Marginalia-Research-Whitepaper.pdf)

Marginalia keeps notes, highlights and replies beside the passage that prompted them. Your notes stay above model replies, and the source page stays intact. A Chrome extension provides the margin; a local helper stores your reading; a library brings saved work together.

Select a passage to keep it or write a note. Ask when you want help, then review the exact outgoing content and recipient. The reply formats include definitions, worked examples, derivations, diagrams and interactive models. Saved threads retain their source context for later reading.

## Try it

Start with the [website](https://yashgurbani.github.io/marginalia/) or the [interactive walkthrough](https://app.supademo.com/demo/cmu6m02dn00viz60jcsm56acw). The walkthrough uses standalone-reader captures.

The [v0.2.0 prerelease](https://github.com/yashgurbani/marginalia/releases/tag/v0.2.0) includes the extension ZIP. Follow the [package guide](marginalia-v2-package/README.md#install-the-helper) to set up the local helper and extension. Development instructions and commands also live in that guide.

## Current stage

This is an alpha under active development. Local reading, persistence and reply handling have automated coverage. Real-provider runs, observed solver confinement and complete native-browser acceptance remain open. PDF reading, listening and several library features are still being developed. The [build status](marginalia-v2-package/BUILD-STATUS.md) and [scope coverage](marginalia-v2-package/docs/SCOPE-COVERAGE.md) record the evidence and remaining work.

Your reading data is stored locally. Asking sends the reviewed content to the selected recipient. Read the [privacy details](https://yashgurbani.github.io/marginalia/site/privacy.html) for storage, request records and deletion behaviour.

## Project

The current application is in [`marginalia-v2-package/`](marginalia-v2-package/), and the website is in [`site/`](site/). The earlier WebMCP competition prototype is preserved on the [`webmcp-v1` branch](https://github.com/yashgurbani/marginalia/tree/webmcp-v1).

[Whitepaper source](marginalia-v2-package/docs/sources/RESEARCH-WHITEPAPER-v3.md) · [Credits](CREDITS.md) · [Third-party notices](THIRD-PARTY-NOTICES.md) · [MIT license](LICENSE)
