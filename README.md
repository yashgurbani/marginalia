# Marginalia

A personalized, agentic and dynamic margin, right in your browser. Your research assistant for the web.

An agentic companion as you browse the web. It lives in the margin, so every answer stays attached to the sentence that raised it, and the page stays exactly as the author wrote it.

Read OpenAI's Navier-Stokes post with Marginalia open. Select the word viscosity and a definition written for that passage arrives in about two seconds. Select the passage about viscosity smoothing out motion and choose Simulate it: a small model arrives with sliders you can move, the equation beside it, and a plain note on what it does not claim. Show the steps, See it, Connect it and Say it plainly offer other ways to work through a passage.

Those runs were recorded live on 18 September 2026. The current v1.1 build includes Instant help and Simulate it, along with Journeys, Activity, Daily recap, Save page, Read page later and Forget this page.

Help runs through your ordinary Codex setup, including its settings and tools. No API keys or Marginalia environment variables.

[Install the v1.1.0 alpha, four steps](https://github.com/yashgurbani/marginalia/releases/tag/v1.1.0) · [Product Hunt](https://www.producthunt.com/products/marginalia-2) · [Open the website](https://yashgurbani.github.io/marginalia/) · [Research whitepaper](https://yashgurbani.github.io/marginalia/site/Marginalia-Research-Whitepaper.pdf)

Marginalia keeps notes, highlights and replies beside the passage that prompted them. Your notes stay above model replies, and the source page is never rewritten. A Chrome extension provides the margin; a local helper stores your reading; a library brings saved work together.

Select a passage to keep it or write a note. Ask when you want deeper help. Replies include definitions, worked examples, derivations, diagrams and interactive models. Saved threads retain their source context for later reading.

## Install it

Start with the [website](https://yashgurbani.github.io/marginalia/) or the [interactive walkthrough](https://app.supademo.com/demo/cmu6m02dn00viz60jcsm56acw). The walkthrough shows the reader view captured outside Chrome, so the browser frame is missing.

Installing v1.1.0 takes four manual steps: obtain the source package and extension, install and start the local helper from the source package, load the unpacked extension in Chrome, then pair it in the browser margin Settings. The [package guide](marginalia-v2-package/README.md#install-the-helper) has the commands. You need Node 24, Chrome 116 or newer, and Codex already installed and signed in on your machine. Check the [v1.1.0 release](https://github.com/yashgurbani/marginalia/releases/tag/v1.1.0) for a prebuilt extension ZIP. The source package is also required for the local helper. The package guide includes the extension build commands. Development instructions and commands also live in that guide.

## Current stage

This is an alpha for Chrome, built by one developer. It needs Codex installed and signed in. Local reading, persistence and reply handling have automated coverage. On 18 September 2026, live runs on public pages returned accepted replies for Define it here, Simulate it, Show the steps, See it, Connect it and Say it plainly on OpenAI's Navier-Stokes post, and Define it here and Give an example on a NASA page. Instant definitions returned their first text in about two seconds. A full simulation took close to three minutes, because Codex is writing a model, an equation and its limits. Deeper asks can take several minutes, and some asks need a second try before a reply is accepted. Check this claim is limited and remains a suggestion to investigate. Review its sources yourself; an accepted live reply remains pending. Observed solver confinement and complete native-browser acceptance remain open. Several library features are still being developed. The [build status](marginalia-v2-package/BUILD-STATUS.md) and [scope coverage](marginalia-v2-package/docs/SCOPE-COVERAGE.md) record the evidence and remaining work.

In v1.1.0, a full Ask still shows the exact outgoing content and recipient before it goes. Instant help is on by default and sends each allowed open page to Codex so quick definitions and simple explanations are ready when you select text, using your own Codex subscription. Onboarding offers to turn it off. Settings lets you turn it off later, exclude sites and see today's usage. Excluded sites never send anything, and no Codex credential is stored in the browser. The current build also includes Journeys, Activity with Daily recap, Save page, Read page later and Forget this page. Read the [privacy details](https://yashgurbani.github.io/marginalia/site/privacy.html) for storage, request records and deletion behaviour.

## Project

The current application is in [`marginalia-v2-package/`](marginalia-v2-package/), and the website is in [`site/`](site/). The earlier competition prototype is preserved on the [`webmcp-v1` branch](https://github.com/yashgurbani/marginalia/tree/webmcp-v1).

[Whitepaper source](marginalia-v2-package/docs/sources/RESEARCH-WHITEPAPER-v3.md) · [Credits](CREDITS.md) · [Third-party notices](THIRD-PARTY-NOTICES.md) · [MIT license](LICENSE)
