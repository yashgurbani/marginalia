Marginalia is a reader where a human and their agent work on the same page: the page holds the document, your marks and your notes; the agent brings what it knows about you; WebMCP tools are where they meet.

Reading is personal. A paper can be basic in one section and difficult in the next. Marginalia keeps the document as an untouched source, then uses your live marks, reading position, and confirmed knowledge to build a useful margin. The agent can propose knowledge, fold a section with a reason, add an explanation, highlight, or draw a figure. You can see, remove, or reverse each result.

WebMCP fits because the page and the agent hold different live state. The page knows the document and what the reader just marked. The agent brings conversation context and memory. `get_reading_state` joins those facts at the moment of reading. Tool absence also enforces the central rule: no registered tool can write the source layer.

This is better than a browser agent that merely clicks around. The page reshapes as you say what you know. Its changes are visible, reasoned, and reversible. A reader and agent can now turn a live document into a personal companion without silently replacing the author’s words.

The implementation uses WebMCP’s imperative API and nine tools. Validators return an honest `next_step` when an action lacks evidence, such as trying to hide a section without confirmed knowledge. Client-side state stays in three layers: immutable source, reader marks, and removable agent artifacts. A client-side fixture index loads a 1911 Rutherford paper, a CC BY-ND Curious Kids article, and Chrome’s WebMCP docs.

All repository work is new from the August 25–September 4, 2026 submission period. Earlier private brainstorming with Claude informed the design, but no code was reused. Code is MIT licensed; fixture licenses and attribution are in `fixtures/ATTRIBUTION.md`. Judges can test the live page in ChatGPT’s in-app browser or in Chrome with `chrome://flags/#enable-webmcp-testing` enabled.
