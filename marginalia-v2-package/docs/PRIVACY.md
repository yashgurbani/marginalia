# Privacy policy

Last updated 18 September 2026.

## What this covers

This policy covers the Marginalia Chrome extension and the local helper daemon in
this repository. It describes this build. Marginalia is an alpha and is still
changing, so this policy will change with it. The date above says which build it
describes.

## The short version

Your reading, your notes and your threads stay on your computer. Selecting text
sends nothing anywhere. Asking for help sends the passage, your note and a
bounded slice of the surrounding page to the Codex runtime you
configured, and the margin shows you the exact outgoing text before the first
send for each site. There is no analytics, no tracking and no remote code.

## What is collected, and when

**Website content.** Only when you select text on a page and the margin captures
it. The capture strips scripts, styles, `noscript`, `template`, form elements,
`contenteditable` regions, `[role="textbox"]`, `[role="combobox"]`, `[hidden]`,
`[inert]` and `aria-hidden` content before projecting anything
(`extension/lib/capture.ts:8`), and it skips nodes that compute to
`display: none`, `visibility: hidden` or zero opacity
(`extension/lib/capture.ts:13-14`). What you type into a form is not captured.
The projection is bounded: at most 1,000,000 characters of page text, 20,000
characters per quote, and 40 characters of anchor prefix and suffix
(`extension/lib/protocol.ts:2-4`, `:37`).

**Page address and title.** The page identity travels with a capture so a thread
can be found again.

**Your own notes and questions.** What you write in the margin.

You can exclude sites. Add a hostname to the exclusion list in the extension
options (`extension/entrypoints/options/main.ts:16-22`) and that host and its
subdomains are no longer read (`extension/lib/protocol.ts:33`). The list starts
empty.

## Where it is stored

In the browser, in extension-origin storage, which no website can read.

On your computer, in a SQLite database in the helper's data directory. That
directory is `MARGINALIA_DATA_DIR` when you set it, and the platform data
directory when you do not.

One place keeps a plaintext second copy, and you should know about it. Each ask
writes `packet.json` into `<data dir>/jobs/<attemptId>/`
(`daemon/jobs/workspace.ts:19`). That file holds the selection, the adjacent page
context, your question and the answered note. When a follow-up ask reuses the
same workspace, the previous `packet.json` and reply files are moved into
`<data dir>/jobs/.history/` (`daemon/jobs/workspace-integrity.ts:62-90`).

Nothing in this build removes either location. Removing a thread in the margin is
a soft delete: the row is marked with a timestamp and the text stays in the
database (`daemon/store.ts:188`). If you want that material gone, you delete the
data directory yourself.

## What leaves your computer, and when

Only when you explicitly ask for help. Only to the provider you configured.

Before text from a new site leaves for the first time, the margin shows you the
exact outgoing text, the recipient and the scope, and records your answer: this
time, always on this site, or never on this site.

The bytes you reviewed are the bytes that are sent. The daemon compares the
digest of the prepared payload against the digest you approved and refuses with
"The reviewed outgoing content changed. Review it again." when they differ
(`daemon/jobs/service.ts:208`, `:229`, `:263`).

When the payload is too large, truncation is deterministic and the omitted parts
are listed by name (`daemon/jobs/outgoing-budget.ts:28-40`). When the essential
parts alone overflow the budget, the send is refused rather than silently cut.

One honest limit: the margin can establish a recorded handoff to the provider,
but it does not observe physical transmission. `ui/margin.ts:70-71` reports
`observedSentBytes: null` and `transmissionObserved: false`, and the "What was
sent" sheet says so in those words (`ui/margin.ts:381`).

## What does not leave

Selecting text. Reopening a page. Reconnecting to the helper. Recovering after a
crash: reconnection throws rather than replaying a send
(`extension/lib/helper-reconnect.ts:54-56`), and recovery only marks an attempt
failed or of unknown outcome (`daemon/jobs/service.ts:92-104`).

Web checks do not leave either, because this build cannot make them. Every
sandbox it defines sets `networkAccess: false` (`daemon/codex-policy.ts:18-20`,
`:175-176`), and the solver transport refuses any policy that does not
(`daemon/solver/transport.ts:135`).

## Who else can see it

The helper listens on loopback only, at `http://127.0.0.1` with a configurable
port (`extension/lib/helper-origin.ts:3`, `:7-17`). The extension will not accept
any other address, so a tampered setting cannot redirect your notes off the
machine.

Pairing is the whole boundary. Any browser holding a valid pairing token can read
your entire library and activity stream, and can export any thread's full text
(`daemon/routes/reader.ts:35`, `:58`, `:59`). Pair only browsers you control.

Before pairing, the helper answers a reachability probe. A `GET /health` request
returns a readiness status without any token (`daemon/routes/helper.ts:37`), and
the server accepts requests from any `chrome-extension://` or `moz-extension://`
origin (`daemon/server.ts:43`). So another extension on your machine can learn
that Marginalia is running. It cannot read anything: pairing requires the
six-digit code the helper prints, the code expires after five minutes, and five
wrong attempts exhaust it (`daemon/pairing.ts:59`, `:63`).

Event records carry identifiers and digests, not note or page text
(`daemon/store.ts:144-145`). Two consent events are the exception: they record
the site origin you decided about (`daemon/consent/service.ts:130`, `:160`).

## Analytics and third parties

There are none. No analytics, no telemetry, no advertising, no data sale, and no
data sharing with anyone other than the provider you configured for an ask.

There is no remote code. The extension loads no external script, stylesheet or
font. Its page policy is `default-src 'none'` with `script-src 'self'`
(`extension/wxt.config.ts:20`). It does not run in incognito windows
(`extension/wxt.config.ts:18`).

## Limited Use

Marginalia's use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Your controls

- Exclude any site and its subdomains in the extension options.
- Answer "never on this site" at the consent prompt. The refusal persists.
- Export your threads to plain files.
- Delete the helper's data directory to remove the database and the job
  workspaces.
- Uninstall the helper with `-Uninstall` or `--uninstall`. That removes the login
  task or service and keeps your reader data.

## What is not finished

- No run against a real model provider has been recorded. Reply behaviour is
  proven on deterministic fixtures only.
- Real asks run in a reader-authorized mode where solver confinement is requested
  but not observed.
- Native install is proven on Windows only. macOS and Linux have command-level CI
  evidence.
- Deleting the job workspaces under `<data dir>/jobs/` is manual. Nothing expires
  or purges them.
- Removing a thread marks it deleted; it does not erase the text.

## Contact

**To be completed by the maintainer before this policy is posted.**

- Contact address: _needed_
- Public URL where this policy is posted: _needed_

The Chrome Web Store requires a public policy URL and a contact address. Neither
is invented here.

[Research whitepaper](Marginalia-Research-Whitepaper.pdf) ([source](sources/RESEARCH-WHITEPAPER-v3.md)) · [Credits](../../CREDITS.md) · [Third-party notices](../../THIRD-PARTY-NOTICES.md) · [Build scope](SCOPE-COVERAGE.md)
