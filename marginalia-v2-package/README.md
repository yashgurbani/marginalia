# Marginalia v2 package

A personalized, agentic and dynamic margin, right in your browser. Your research assistant for the web.

Keep your notes beside the passages that prompted them. Your notes stay above
model replies, and the source page is never rewritten. A Chrome MV3 extension
provides the margin; a local helper on your machine stores saved reading in
SQLite and serves the library. This is an alpha for Chrome, built by one
developer. It needs Codex installed and signed in.

This README describes the v1.1.0 build. Publication and live acceptance
are separate steps. The [research whitepaper](docs/sources/RESEARCH-WHITEPAPER-v3.md)
sets out the full vision; [build scope](docs/SCOPE-COVERAGE.md) records remaining gaps.

## Read now

In v1.1.0, select a passage to Keep, Highlight, write a note or draft an Ask.
Save page and Read page later work from the reader margin. Keeping a highlight,
writing a note and selecting text stay local.
With a paired local helper, save a page or choose Read page later, then return
through Activity, Journeys or Library search. Settings lets you inspect and
delete saved entries, and Forget this page is available for instant reading.

Instant help is on by default and sends each allowed open page to Codex so quick
definitions and simple explanations are ready when you select text, using the
reader's own Codex subscription. Onboarding offers to turn it off, and Settings
lets you turn it off later, exclude sites and see today's usage. Excluded sites
never send anything.

## Ask

The request contract covers eight kinds: definition, simulation, worked example,
derivation, diagram, “Check this claim,” exploration and an open question. Seven
have returned accepted live replies. “Check this claim” is early and has not yet
returned one. Codex authors structured replies; packaged code renders their
text, equations, diagrams and models. Help runs through the reader's ordinary Codex setup on their machine,
including its settings and tool servers. There are no API keys or
required Marginalia environment variables. Settings holds the reader's help
choices.

In v1.1.0, deeper asks show the send sheet first. For a full Ask, you review the
exact outgoing content and recipient before it goes. Instant help has separate
controls: you can turn it off, exclude sites and see today's usage. Excluded
sites never send anything. No Codex credential is stored in the browser. Provider
availability, permissions and runtime checks still govern dispatch. Local tests
cover these flows. On 18 September 2026, live runs on public pages
returned accepted replies for Define, Simulate it, Step by step, Diagram, Explore and
Not sure on OpenAI's Navier-Stokes post, and Define and Give an example on a NASA
page.

Four execution paths stay distinct: browser calculation, exploration within
precomputed samples, rerunning a saved solver locally, and an explicit new ask.
Saved-solver execution still needs accepted runtime and confinement evidence.
Evidence replies distinguish exact local quotations from unverified claim
support. Exploration replies can offer a saved reading shelf; opening an item is
an explicit action. Live web fetching and its evidence record remain gated.

## Return to saved work

Save a passage or thread and return through the “You were here” line. Retained
local copies preserve captured source versions with your work. Library search
opens saved passages. Related saved passages starts closed in the margin and
searches the local library when you open it.

The v1.1.0 build exports JSON, Markdown and Web Annotation JSON-LD. BibTeX
export, Activity and Daily recap are built and tested in the working tree.
Journeys is the name for groups of related reading. Save page and Read page later
keep reading available in the local library, and Forget this page clears the
current instant reading state.

Ranked three-offer suggestions are built and tested in the working tree. Automatic
vocabulary gathering, sharing, connectors
and Firefox remain unfinished.

## Acceptance still pending

- A recorded live four-path run. Definition and simulation runs were accepted on 18 September 2026; “Check this claim” has not yet produced an accepted live reply.
- Positive observed solver confinement and native fresh-install evidence.
- Complete web-fetch evidence and native loaded-extension acceptance.
- A recorded twenty-minute reading session with Yash.
- Bibliography-import verification.

The margin currently reports transmission as unobserved. A completed build or a
green fixture suite establishes local checks; the live gates require their own
recordings and receipts.

[BUILD-STATUS.md](BUILD-STATUS.md) and [docs/README.md](docs/README.md) carry the
broader build record. The [repository README](../README.md) covers the project.

[Research whitepaper PDF](docs/Marginalia-Research-Whitepaper.pdf) · [Whitepaper source](docs/sources/RESEARCH-WHITEPAPER-v3.md) · [Credits](../CREDITS.md) · [Third-party notices](../THIRD-PARTY-NOTICES.md)

## Install the helper

Use Node 24, then run the installer from this checkout. The installer prepares
locked dependencies when needed, builds the local reader, and configures the
helper to start at login. These are the scripted installation paths; native
fresh-machine acceptance remains pending.

On Windows, open PowerShell in this folder and run:

```powershell
.\scripts\install-helper.ps1
```

On macOS or Linux, run:

```sh
bash scripts/install-helper.sh
```

Both installers have a dry-run option (`-DryRun` or `--dry-run`). To remove the
login task or service, use `-Uninstall` or `--uninstall`. Uninstalling retains
reader data. The default helper address is `http://127.0.0.1:43120`.
Installation, startup and pairing are local operations. Signing into Codex and
approving a provider request are separate reader actions.

The helper finds the installed native `codex` executable on PATH and uses your
ordinary `~/.codex` home by default. Marginalia therefore uses your Codex sign-in,
settings and tool servers. You need no Marginalia environment variables
and no second sign-in for this setup.

## Install the extension

The alpha uses an unpacked extension. Its manifest requires Chrome 116 or newer.

1. From this folder, prepare dependencies and build:

   ```sh
   npm ci
   npm run extension:build
   ```

2. Open `chrome://extensions` and turn on Developer mode.
3. Choose “Load unpacked” and select `extension/.output/chrome-mv3`.

## Pair

Start the helper, then open the extension options and enter the pairing code
shown by the helper. The code expires after five minutes and permits five
attempts. Pairing gives the extension a revocable connection to its local helper.

## Where your reading is kept

The browser keeps queued local work on the device. After you pair the extension
with the helper, helper threads, notes and highlights live in SQLite
under `MARGINALIA_DATA_DIR`, or the platform data directory when that variable
is unset. Export creates plain files.

Each ask also writes `packet.json`, containing the selected passage, adjacent
context, question and answered note, under `<data dir>/jobs/<attemptId>/`.
Follow-up asks retain earlier workspace content under `<data dir>/jobs/.history/`.
These workspace copies persist separately from thread removal. Removing a thread
sets a tombstone; workspace cleanup currently requires a manual action.

[Privacy details](docs/PRIVACY.md) describe storage and provider boundaries.

## Develop

Use Node 24 (`>=24 <25`) and npm. Prepare the locked dependencies with `npm ci`.
The install lifecycle runs `prepare`, which generates WXT's ignored configuration
under `extension/.wxt`.

```text
npm test
npx --no-install tsc --noEmit
npm run extension:typecheck
npm run extension:build
npm run build
npm start
```

`test` runs the Node suite. The typechecks cover the package and extension.
`extension:build` produces the Chrome MV3 extension; `build` produces the web app.
`start` runs the local helper.

## Runtime environment

The ordinary setup above needs no environment variables. To use a separate
Marginalia-only Codex home instead, set both override variables below to existing
absolute paths. Partial or invalid override settings make Codex execution
unavailable instead of switching back to your ordinary setup.

- `MARGINALIA_DATA_DIR`: absolute directory for SQLite and job data; the default
  is the platform data directory.
- `MARGINALIA_PORT`: loopback helper port, default `43120`.
- `MARGINALIA_CODEX_EXECUTABLE`: optional absolute path to a native Codex
  executable. Set it together with `MARGINALIA_CODEX_HOME`.
- `MARGINALIA_CODEX_HOME`: optional separate Codex home. It must be outside the
  workspace and separate from `~/.codex` and any `CODEX_HOME` directory.
- `T18_CHROMIUM`: Chromium executable used by the opt-in browser suites.

## License

MIT. See [LICENSE](../LICENSE) at the repository root.
