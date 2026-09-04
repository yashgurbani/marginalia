# Marginalia

Marginalia is a reader where a human and their agent work on the same page: the page holds the document, your marks and your notes; the agent brings what it knows about you; WebMCP tools are where they meet.

## What it does

Marginalia reads a document as an immutable source and builds a personalized margin beside it. The agent first reads the live page state: your position, known and lost marks, and confirmed knowledge. It can then propose knowledge entries, add explainers or figures, highlight a range, and fold a section with a visible reason. You can confirm, reject, expand, remove, or hide each layer.

The included fixtures move across a century: Rutherford’s 1911 paper, a Curious Kids article on how atoms form, and Chrome’s WebMCP documentation.

## The layer rule

> “The page registers no WebMCP tool that mutates the source layer.”

Source, reader, and agent state remain separate. The full source is always available. Agent output is visible, reasoned, and removable. This is enforced by the tools the page does not register, not by an instruction that an agent can ignore.

## WebMCP tools

| Name | What it does | What it refuses |
| --- | --- | --- |
| `get_reading_state` | Reads document structure, marks, position, layers, and knowledge. | It does not return collapsed source text unless asked. |
| `get_section_text` | Reads one source section. | It cannot change the section. |
| `get_knowledge` | Reads proposed and confirmed knowledge entries. | It cannot confirm an entry. |
| `upsert_knowledge` | Proposes one reader knowledge entry. | It rejects weak evidence and does not assume mastery. |
| `search_notes` | Searches a reader-loaded local note index. | It returns an honest empty result when no vault is loaded. |
| `set_section_depth` | Folds or expands a section with a reason. | It rejects hidden depth without confirmed knowledge and defers the current section. |
| `annotate` | Adds an agent-layer gloss, explainer, question, caveat, perspective, or link. | It never writes inline source text; evidence modes require sources. |
| `highlight` | Adds a reasoned agent-layer highlight. | It rejects a range outside the source section. |
| `insert_figure` | Adds a sanitized SVG in the margin. | It rejects scripts and external SVG references. |

## How to run locally

Use any static server from the repository root. For example:

```sh
npx serve .
```

Open the displayed local URL. No build step or credentials are required.

## How to test in ChatGPT desktop in-app browser and in Chrome 149+ with chrome://flags/#enable-webmcp-testing

In the ChatGPT desktop app, open the live URL in the in-app browser. Ask ChatGPT to read the page state and fold a section after you confirm a knowledge entry. The tool action and its result appear on the page.

For local Chrome testing, use Chrome 149 or later. Open `chrome://flags/#enable-webmcp-testing`, enable the flag, and relaunch Chrome. Serve this repository, open its local URL, then use the Model Context Tool Inspector or a WebMCP-capable client to call the registered tools.

## Demo prompts

1. “Read the current reading state first. Interview me about Rutherford’s scattering experiment, then record my answer as a proposed knowledge entry.”
2. “Read the current state and confirmed knowledge first. Fold a Rutherford section that I already understand, with a reason I can see.”
3. “Read the current state first. Add a short agent-layer explanation beside the Curious Kids section about the strong force; do not change the article.”

## Prior work vs. new work

Everything in this repository was written during the submission period, August 25–September 4, 2026. The project is new work using WebMCP. Its design lineage includes earlier private brainstorming with Claude, but no code was reused. FeynmanILE and Noether IRE are separate private projects, not source material for this submission.

## Licenses

Repository code is MIT licensed. Fixture licenses and source attribution appear in [fixtures/ATTRIBUTION.md](fixtures/ATTRIBUTION.md). Rutherford is public domain. The Conversation fixture is text-only under CC BY-ND 4.0. Chrome documentation prose is CC BY 4.0 and its code sample is Apache 2.0.

## Next

The submission defers the following work in this order:

1. [Connections graph tab](.scratch/bridge/issues/12-connections-graph-and-connection-kind.md)
2. [Prerequisite insets](.scratch/bridge/issues/14-prerequisite-and-reference-kinds.md)
3. [Per-section density chips](.scratch/bridge/issues/13-pending-reshape-density-chips-batch-confirm-remove-all.md)
4. [Export to vault](.scratch/bridge/issues/15-export-to-vault-and-copy-as-question.md)
5. [Worker snapshot](.scratch/bridge/issues/09-stretch-worker-snapshot.md)
6. [Sandboxed widgets](.scratch/bridge/issues/10-stretch-insert-widget-sandbox.md)
