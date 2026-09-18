# Marginalia v2 package

## Requirements

Use Node 24 (`>=24 <25`) and npm. Install the locked dependencies with `npm ci`.
The install lifecycle runs `prepare`, which generates WXT's ignored configuration
under `extension/.wxt`.

## Commands

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
