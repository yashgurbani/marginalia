# Marginalia v2 package

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
reader data. The helper listens only at `http://127.0.0.1:43120`; after it starts,
open the extension options and pair with the code in the helper output. Installing,
starting, and pairing do not send a passage to a provider or change Codex sign-in.
Without an authorized Codex runtime, saved reading and notes remain available.

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
