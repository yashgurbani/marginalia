# Marginalia v2 package

A personalized, agentic margin for the web.

Your notes are senior to model replies. An ask uses your note and the passage you
chose, and saved reading belongs to your local library. Remember vocabulary is
reader-owned in the design; this build does not yet populate its vocabulary table.

Ask sends a passage you approve to a Codex agent (GPT-6 Astra). It can request a
definition, work an example, explain step by step or run a saved solver. You review
the exact outgoing text and recipient before the first send for each site.
Nothing sends on its own.

Marks, notes and replies live beside the source. The page is never rewritten.
A Chrome MV3 extension draws the margin, and a local helper on `127.0.0.1` stores
your reading in SQLite. The local library page opens saved work.

## Read now

Select a passage, Keep or Highlight it, write a note, and Ask when you want help.
Your note remains above the reply.

## Read it later

Park a passage or thread and return to a "You were here" resume line. Saved marks
repaint on the page. Retained local copies keep the captured source with your work.

## Your knowledge base

Kept passages, notes and replies collect in a local library with source attribution
and plain-file export. Library search and "Related saved passages" are available
in the local library page. Code and automated tests support this claim; native
browser acceptance has not been recorded.

## Next

PDF reading and listening ("Hear it") are next. Topics and reading paths across
papers, sharing, connectors and Firefox are also planned.

## What works today, and what does not

This is an alpha. These limits are current:

- No run against a real model provider has been recorded. Reply behaviour is
  proven on deterministic fixtures only.
- Real asks run in a reader-authorized mode where solver confinement is requested
  but not observed.
- Web checks are unavailable. Every sandbox this build defines sets
  `networkAccess: false`, so "what supports this" and "go further" cannot fetch anything.
- Native install is proven on Windows only. macOS and Linux have command-level
  CI evidence.
- PDF reading and audio are not supported yet. Nothing writes to the vocabulary
  table, so vocabulary is always empty.
- The sending indicator never lights. `ui/margin.ts` reports
  `transmissionObserved: false`, so the record reads "Not observed".

[BUILD-STATUS.md](BUILD-STATUS.md) and [docs/README.md](docs/README.md) carry the
detail and the evidence. The [repository README](../README.md) covers the project
as a whole.

[Research whitepaper](docs/Marginalia-Research-Whitepaper.pdf) ([source](docs/sources/RESEARCH-WHITEPAPER-v3.md)) · [Credits](../CREDITS.md) · [Third-party notices](../THIRD-PARTY-NOTICES.md) · [Build scope](docs/SCOPE-COVERAGE.md)

## Install the helper

Install Node 24, then run the installer from this checkout. It installs locked
dependencies when needed, builds the local reader, and starts the helper at
login. Paths with spaces are supported.

On Windows, open PowerShell in this folder and run:

```powershell
.\scripts\install-helper.ps1
```

On macOS or Linux, run:

```sh
bash scripts/install-helper.sh
```

Both installers have a dry-run option (`-DryRun` or `--dry-run`). To remove the
login task or service, use `-Uninstall` or `--uninstall`. Uninstalling keeps your
reader data. The helper listens only at `http://127.0.0.1:43120`. Installing,
starting, and pairing do not send a passage to a provider or change Codex sign-in.
Without an authorized Codex runtime, saved reading and notes remain available.

## Install the extension

The extension is not on the Chrome Web Store. Load it unpacked. Chrome 116 or
newer is required (`extension/wxt.config.ts:9`).

1. From this folder, install dependencies and build:

   ```sh
   npm ci
   npm run extension:build
   ```

   The build writes to `extension/.output/chrome-mv3`.

2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Choose "Load unpacked" and select `extension/.output/chrome-mv3`.

## Pair

Start the helper, then open the extension options and enter the six-digit code
the helper prints. The code expires five minutes after it is issued and allows
five attempts (`daemon/pairing.ts:59`, `:63`).

## Where your reading is kept

Your threads, notes and highlights live in SQLite under `MARGINALIA_DATA_DIR`, or
in the platform data directory when that variable is unset. Export produces plain
files.

One place keeps a second copy. Each ask writes `packet.json`, containing the selection, the
adjacent page context, your question and the answered note, to
`<data dir>/jobs/<attemptId>/` (`daemon/jobs/workspace.ts:19`). A follow-up ask
moves the previous copy under `<data dir>/jobs/.history/`
(`daemon/jobs/workspace-integrity.ts:62-90`). Nothing removes either today, and
removing a thread is a soft delete (`daemon/store.ts:188`). Deleting that
directory is manual for now.

[docs/PRIVACY.md](docs/PRIVACY.md) states the whole boundary.

## Develop

Use Node 24 (`>=24 <25`) and npm. Install the locked dependencies with `npm ci`.
The install lifecycle runs `prepare`, which generates WXT's ignored configuration
under `extension/.wxt`.

```text
npm test
npm run typecheck
npm run extension:typecheck
npm run extension:build
npm run build
npm start
```

`test` runs the Node test suite. `typecheck` checks the package. The extension
commands prepare and build the Chrome MV3 extension. `build` builds the web app.
`start` runs the local helper daemon.

## Runtime environment

- `MARGINALIA_DATA_DIR`: absolute directory for the SQLite database and job data.
  If unset, the daemon uses the platform data directory.
- `MARGINALIA_PORT`: loopback helper port. The default is `43120`.
- `MARGINALIA_CODEX_EXECUTABLE`: absolute path to the Codex executable. Required
  with `MARGINALIA_CODEX_HOME` for the dedicated runtime.
- `MARGINALIA_CODEX_HOME`: absolute path to the dedicated Codex home. It is
  required with `MARGINALIA_CODEX_EXECUTABLE` and must be disjoint from `~/.codex`
  (and from any `CODEX_HOME` directory).
- `MARGINALIA_AUTHORIZED_RUNTIME_MODULE`: optional test seam. Set it to a module
  exporting `createAuthorizedRuntime()` when a test supplies the authorized
  runtime factory.
- `T18_CHROMIUM`: path to a Chromium executable. Setting it enables the T18
  browser test gate; leaving it unset skips that test.

## License

MIT. See [LICENSE](../LICENSE) at the repository root.
