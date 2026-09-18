# Product Hunt listing draft

This draft describes the local polish build on 18 September 2026. Review it
against the integrated release before publication. The existing gallery images show a standalone reader session on a local fixture
page. They do not support the caption set below, which needs fresh captures of
the loaded extension on the live Navier-Stokes post.

## Name

Marginalia

## Tagline

Your agentic research assistant, in the margin of any page

## Description

Marginalia is an agentic companion in the margin of whatever you read. Select a passage for a definition in about two seconds, or a small model with sliders. Save it for later. Your Codex sign-in, no keys. Open source alpha.

## Long description

Marginalia is an agentic companion as you browse the web. It opens a margin beside whatever you read, and it reads along with you. On OpenAI's Navier-Stokes post you can select the word viscosity and get a definition written for that passage in about two seconds, or select the passage about smoothing and choose Simulate it, which returns a small model with sliders you can move, the equation beside it, and a plain note on what it does not claim. Step by step, Diagram, Explore and Not sure answer the same way. Save interactive journeys, annotations, highlights and bookmarks. Pick up any page where you left it.

Help runs through your ordinary Codex setup, including its settings and tools. There are no API keys or required Marginalia environment variables. In v1.1.0, a full Ask shows the exact outgoing content and recipient before it goes. Instant help is on by default for allowed pages and provides quick definitions and simple explanations, using your own Codex subscription. It shows today's usage, can be turned off during onboarding or in Settings, and lets you exclude sites. Excluded sites never send anything. No Codex credential is stored in the browser. The current build also includes Simulate it, Journeys, Activity with Daily recap, Save page, Read page later and Forget this page. The Navier-Stokes runs above were recorded live on 18 September 2026.

This is an open source alpha built by one developer. It works in Chrome and needs Codex installed and signed in.

## Topics

Productivity, Open Source, Chrome Extensions

## Shoutouts

- OpenAI
- Codex
- KaTeX
- WXT
- Vite
- TypeScript
- Node.js

## Maker first comment

I'm Yash. I built Marginalia because I kept reading pages I could not follow.

Every time I start a paper in a new field I end up making myself an annotated copy. Marginalia is that copy, made as I read, kept beside the original, and mine.

It puts a margin beside whatever you read on the web. Select a passage, write a
note, and the note stays with its source on your machine. The page is never
rewritten.

Ask for help and the reply takes the form that fits the passage. You can get a
definition from the page, the steps of a derivation, a diagram, connections to
other reading, or a small working simulation with a slider. The Navier-Stokes
post is the hardest public page I could find, so it is the page I test on. I
select the word viscosity and a definition arrives in about two seconds. I select
the passage about smoothing and choose Simulate it, and close to three minutes later
there is a small model I can move, because Codex is writing the model, the
equation and its limits in that time. Both were recorded live on 18 September
2026 and are included in v1.1.0.

Help runs through your ordinary Codex setup, including its settings and tools.
There are no API keys or required Marginalia environment variables. In v1.1.0, a
full Ask shows the exact outgoing content and recipient before it goes. Instant
help is on by default for allowed pages and provides quick definitions and simple
explanations, using your own Codex subscription. It shows today's usage, can be
turned off during onboarding or in Settings, and lets you exclude sites. Excluded
sites never send anything. No Codex
credential is stored in the browser. Setup is honest about being early: load the
unpacked extension, run one installer command, and paste a six-digit pairing
code.

This is an open source alpha for Chrome, built by one developer. It needs Codex
installed and signed in. I entered it in the Product Hunt Astra 6 Challenge.
Tell me what breaks.

Fresh-install acceptance and proof of runtime confinement remain pending.
“Check this claim” has not yet produced an accepted live reply, so it is early.

The [research whitepaper](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/Marginalia-Research-Whitepaper.pdf)
([source](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/sources/RESEARCH-WHITEPAPER-v3.md)) explains the design and research
lineage. [Credits](https://github.com/yashgurbani/marginalia/blob/main/CREDITS.md) name prior art and tools;
[third-party notices](https://github.com/yashgurbani/marginalia/blob/main/THIRD-PARTY-NOTICES.md) record dependency licenses.
The [build scope](https://github.com/yashgurbani/marginalia/blob/main/marginalia-v2-package/docs/SCOPE-COVERAGE.md) records evidence gaps.

## Next

Complete live acceptance, vocabulary gathering and reading-history coverage.
Grouping from captured source links, sharing, connectors and Firefox
remain ahead.

## Gallery captions, for the captures being made

1. **A definition in about two seconds.** The Navier-Stokes post open in Chrome, the word viscosity selected, the margin already holding the definition written for that passage (`gallery-1-instant-define.png`).
2. **Simulate it.** The same page, the margin showing the small model, its sliders and the equation dy/dt = y² - γy + f (`gallery-2-simulate-it.png`).
3. **It tells you what it is not modelling.** The illustration note and assumptions under How this was made (`gallery-3-limits.png`).
4. **Your note stays on top.** A passage-anchored note above the reply (`gallery-4-note.png`).
5. **Pick up any page where you left it.** Saved pages, highlights and bookmarks in the library (`gallery-5-library.png`).

Each image needs a fresh capture of the loaded extension in Chrome on the live
page. The current standalone-reader captures on the fixture page do not support
this order and should not ship in it.
