# Install and recovery experience (T19)

Status: design and copy specification, written 2026-09-17 from a source reading of `codex/marginalia-v2` (head `2c35157` plus uncommitted work). Nothing in this document was run. It does not complete the T19 installer, the diagnostics page or the fresh-machine test. Those remain T19 implementation work.

Evidence and line references: the historical receipt (omitted from this public tree).

## 1. The promise this flow must keep

Marginalia is a margin beside whatever you are reading. Reading, keeping passages and writing notes work in the browser with no helper and no account. The local helper adds durable saving and a library on this computer. Asking is a third, separate fact: it sends the passage and your note to OpenAI through Codex. Codex runs on this computer, but the model does not.

Every screen in this flow keeps three facts apart and states each one plainly:

| Fact | Question it answers | Source of truth |
| --- | --- | --- |
| Reading | Can I read, keep and write here? | Extension storage. Always yes unless the site is excluded. |
| Saving | Are my notes also saved by the local helper? | Pairing token plus a reachable helper. |
| Asking | Can I send a question now? | `/api/jobs` `available`, the site grant and the page's exclusion state. |

Pairing never implies asking. A paired helper with a signed-out Codex is a normal, calm state.

## 2. Labels used below

- **Exists**: the behaviour or copy is in source today. Source presence is not runtime acceptance.
- **Change**: source must change before this works. Section 7 lists each change and its owner.
- **Unverified**: nobody has observed it at runtime in the consolidated snapshot.

## 3. Prerequisites and honest unsupported states

| Requirement | Current fact | What the reader sees when it fails |
| --- | --- | --- |
| Operating system | Only Windows 11 has been observed (the maker's machine). macOS and Linux are unverified. | Nothing today. **Change:** the listing and README say "Tested on Windows 11. macOS and Linux are untested." |
| Browser | Chrome 116 or later. Other browsers are unestablished (`extension/README.md`). | Nothing in product. **Change:** the listing states "Chrome 116 or later." |
| Node | Node 24 (`package.json` engines `>=24 <25`). | npm warns in a terminal. No product copy. |
| Local helper install | No installer exists. The helper starts only from a source checkout with `npm start`. | Not applicable until an installer exists. |
| Codex | Exactly `codex-cli 0.153.4`, with its own dedicated home, separate from the desktop Codex account. | See states S7 and S8. |
| Isolation for asking | Codex confinement on this host is unverified. Dispatch is hard-off (`dispatchReady:false`). | See state S8. |

Honest unsupported copy (**Change**, shown in Settings under "Asking"):

- Platform not tested: "Asking has not been tested on this system yet. Reading and notes work normally."
- Wrong Codex version: "Asking needs Codex 0.153.4. This computer has {version}. Reading and notes work normally."
- Codex missing: "Asking needs Codex on this computer. Reading and notes work normally."
- Confinement unconfirmed: "Asking is off on this computer. Marginalia could not confirm that Codex stays inside its own folder. Reading and notes work normally."

The alpha listing must describe only what the recorded fresh-machine run shows (T12 gate).

## 4. Entry points

The journey uses surfaces that already exist. It adds no dashboard and no onboarding framework.

| Entry point | Today | Role in this flow |
| --- | --- | --- |
| Helper console (`npm start`) | Prints the origin, the pairing code, a readiness line and a Codex line. Typing `pair` renews the code. | First start and code renewal until an installer ships. |
| Margin Settings (side panel) | Pairing field, Pair, "Save to local helper", Disconnect. | The one place for pairing, saving state and asking state. |
| Margin footer | "Export JSON" (this page), "Hear it · not available yet". | Export stays one click away. Hear it stays visibly unavailable. |
| Helper page at `http://127.0.0.1:43120` | Mounts the margin only. The T11 library is built but not mounted. | **Change:** mount the library there; add a small "This computer" section with the pairing code and diagnostics. |
| Extension options | Site exclusions and "Allow reading". | Unchanged. |

## 5. States, actions and copy

Each row names the reader action, the state the reader observes, and the copy. Copy in quotes marked Exists is verbatim from source. Everything else is proposed.

### S1. First install, helper never started

- Reader action: loads the unpacked extension and opens the side panel on an article.
- Observed state: the margin works. Settings shows the pairing field.
- Copy (Exists, `ui/margin.ts:595`): "Reading and notes work on this device without an account. Pairing also saves them in the local helper."
- Label: Exists, Unverified.

### S2. First helper start

- Reader action: starts the helper. Today that means `npm start` in a checkout. Later it means the installer's start item.
- Observed state: the helper prints its address and a six-digit code valid five minutes, single use.
- Copy (Exists, `daemon/main.ts:36-41`): "Pairing code: {code} (valid for five minutes, one use)" and "Enter pair here to renew the pairing code."
- **Change:** an installed helper has no visible console. The code must also appear in the helper page's "This computer" section, behind a "Show pairing code" button. That endpoint accepts only the helper's own origin, never an extension origin (section 7, C4).
- **Implemented, verified on Windows:** an occupied configured port exits with code 1 and says "Another program is using port {port}. Close it, or start Marginalia on another port." It also explains MARGINALIA_PORT and matching the browser helper address. The existing service is left running; no pairing code or readiness claim is printed. The extension supports a configured loopback helper address. Platform installers and Mac/Linux launch checks remain open (C5).

### S3. Pairing

- Reader action: types or pastes the code into Settings and chooses Pair.
- Observed state on success: the Settings saving line changes. Asking state is read from the helper, not assumed.
- Copy on success (**Change**, replaces the hard-coded `ui/margin.ts:578,660` text): "Saved on this device and in the local helper." Then one asking line from section 5, S7 to S9.
- Copy on wrong code (Exists, `daemon/pairing.ts:22`): "Pairing code did not match."
- Copy on expiry or five attempts (Exists, `daemon/pairing.ts:20`): "Pairing expired. Request a new code from the local helper."
- Input (**Change**): one field, `inputmode="numeric"`, `maxlength="7"`, accepts "123 456" and "123456", shows the 3+3 grouping visually only.
- Pairing is not a grant. No send permission changes here.

### S4. Disconnect, revoke and re-pair

- Reader action: chooses Disconnect in Settings.
- Observed state: the saved token is removed on this browser. Notes remain on the device.
- Copy (Exists): "Disconnected from the local helper."
- Defect: when the helper is unreachable, `/api/revoke` throws before the token is cleared (`ui/margin.ts:599`). **Change:** always clear locally. If the helper call failed, say: "Disconnected on this browser. The local helper will forget this browser next time it is running." Keep the pending revoke and send it on the next contact.
- Re-pair: same as S3 with a fresh code.
- Revoked elsewhere (socket close 1008) today reads "Pair again or reconnect to resume local updates." **Change:** "This browser is no longer paired. Pair again in Settings. Your notes remain on this device."
- **Change** (small): the helper page lists paired browsers by first-paired date with "Forget" on each. No names or tokens are shown.

### S5. Grant boundaries

- Reader action: prepares the first question on a site.
- Observed state: the consent sheet opens inside the margin only when asking is available (T13).
- Copy (Exists, `ui/margin.ts:250`): "Asking is blocked for this site. You can change this in Settings." and "Codex is not connected. You can prepare a question and review exactly what it would send."
- Recipient line, only when S9 holds (design pass 2): "Sends this context to OpenAI through Codex on this computer."
- Excluded sites show no send action (Exists, panel copy).
- Pairing, revoking and re-pairing never create, widen or clear a site grant. Grants are T13 data and survive re-pairing.

### S6. Helper absent, stopped or restarted

- Reader action: keeps reading while the helper is off, then starts it again.
- Observed state: reading, keeping and notes continue. Unsaved changes stay queued.
- Copy (Exists, `extension/lib/helper-reconnect.ts`):
  - "Local helper unavailable. Your notes remain on this device."
  - "Connecting to the local helper…"
  - "Saved work connected to the local helper."
  - "Some local changes still need to be saved. Review Settings."
- Restart: tokens persist in the helper database, so no re-pair is needed. The reconnect backoff runs from 1 to 30 seconds.
- Conflicts after reconnect (Exists): "Updated elsewhere · review your change". Neither version is discarded.
- Label: Exists, Unverified. The T19 acceptance line depends on this state.

### S7. Codex signed out in the dedicated home

- Reader action: pairs and opens Settings.
- Observed state: saving works; asking is off.
- Copy (**Change**): "Asking is off. Codex on this computer is not signed in for Marginalia. Your notes are unaffected." Then a "How to sign in" disclosure whose steps come from the helper, derived from the configured Codex executable and dedicated home.
- Rules: never tell the reader to copy the desktop Codex sign-in. Never reuse the desktop account's home. Signing in is the reader's own action in their own terminal or browser.
- Defect: `/health` probes the Codex on PATH with the inherited home (`daemon/diagnostics.ts:9-10`). It can report "signed-in" for the desktop account while the dedicated home is signed out. **Change** C3 must land before this copy can be trusted.

### S8. Unsupported version or unconfirmed isolation

- Observed state: `/api/jobs` reports `available:false` with a reason.
- Copy: the matching unsupported line from section 3. The raw `unavailableReason` string is not shown to readers (**Change**: map reasons to fixed codes).

### S9. Ready to ask

- Observed state: helper paired, Codex version matches, dedicated home signed in, confinement confirmed, `dispatchReady` true.
- Copy: "Asking is on. Questions go to OpenAI through Codex on this computer, only after you approve them."
- Label: Unverified. No such state has been observed.

### S10. Disconnection during a request, and unknown outcomes

- Reader action: asks, then the helper or network drops.
- Observed state: the reply shows "Unknown, try again" (T06 display state).
- Copy (**Change**, sentence under the state): "Marginalia lost contact before this finished. It may have run. Try again sends it as a new request."
- Rules: never retry automatically. Try again is a new request and passes the consent check again. Cancel remains available while Working.

### S11. Upgrade and data-migration failure

- Reader action: installs a newer helper and starts it.
- Today: migrations run in place with no copy made first (`daemon/store.ts:17-65`). A failure throws from the constructor and the helper does not start. A database from a newer helper is opened without a check.
- **Change** (C8): before any pending migration, the helper writes a dated copy of the database beside the original. Then:
  - Migration fails: "Marginalia could not update its saved library. Nothing was removed. A copy from before the update is kept on this computer." The helper stays up read-only for export and the extension keeps working.
  - Database newer than the helper: "This library was saved by a newer version of Marginalia. Reinstall that version to open it. Nothing was changed." The helper does not write to it.
- Rollback: reinstall the previous helper version. The pre-update copy stays in place. Recovery never involves deleting a database, a browser profile or extension storage.
- Label: Change. Unverified.

### S12. Export and recovery access

- Exists: margin footer "Export JSON" writes this page's notes (`marginalia-notes.json`). The helper exports one thread per request (`/api/export?thread=`). The unmounted library has per-thread export.
- **Change** (C10): "Export everything" in the helper page and in Settings. It writes one file with every thread, note, highlight and version the helper holds. Extension-only notes export from Settings even with no helper.
- Copy: "Exports are plain files. They stay on this computer until you move them."

### S13. Diagnostics

- Reader action: chooses "Copy diagnostics" in Settings or on the helper page (**Change**, C9).
- The copied text contains only: Marginalia version, OS family, browser major version, Node major version, helper port, reachable yes or no, paired browser count, Codex version, dedicated sign-in (signed in, signed out or unknown), asking available yes or no with its reason code, applied migration numbers, and the last start error code.
- It never contains page text, URLs, titles, notes, pairing codes, tokens, account names, email addresses or raw Codex output. Local paths replace the home folder with `~`.
- Copy: "Copied. This includes versions and states only. It has no page text, notes or sign-in details."

## 6. Smallest complete journey

1. Load the extension. Read and keep notes at once (S1).
2. Start the helper. Pair with the six-digit code from the console or the helper page (S2, S3).
3. Settings shows two plain lines: saving state and asking state (S3, S7 to S9).
4. If asking is off, the asking line says why and how to fix it, and reading continues (S7, S8).
5. If the helper stops, reading continues, changes queue, and reconnection saves them (S6).
6. If an update fails, nothing is removed and export still works (S11, S12).
7. When something is unclear, Copy diagnostics gives a safe summary to share (S13).

## 7. Implementation handoff

Owners follow `wayfinder/BUILD-PLAN-24H.md`. The chief assigns them. This slice changed no product source.

| ID | File | Change | Owner |
| --- | --- | --- | --- |
| C1 | `daemon/main.ts:12,34` | Resolve the data directory and web root from a per-user application folder and the install location, not the working directory. | T19 / T01 |
| C2 | `daemon/main.ts:28` | Read the dedicated Codex home from configuration. Remove the hard-coded `D:/MarginaliaRuntime/T02`. | T01 / T02 |
| C3 | `daemon/diagnostics.ts:9-10` | Probe the configured Codex executable with `providerEnvironment(dedicatedHome)`. Never report the PATH or desktop account's sign-in. | T01 |
| C4 | `daemon/server.ts`, `daemon/pairing.ts` | Add a code-renewal route that accepts only the helper's exact origin and returns a fresh code. Add list and forget for paired browsers. | T01 |
| C5 | `daemon/server.ts` listen, `extension/lib/helper-reconnect.ts:6,48`, `extension/entrypoints/panel/main.ts:27` | Catch port-in-use with the S2 copy. Replace the hard-coded 43120 with one stored helper origin. | T01 / T04 |
| C6 | `ui/margin.ts:599` | Disconnect clears the local token first and queues the helper revoke when unreachable. | T05 |
| C7 | `ui/margin.ts:578,594,660`, `extension/lib/helper-reconnect.ts:70` | Replace hard-coded "Codex is not connected" with the asking line from `/api/jobs`. Add numeric input hints. Use the S4 revoked copy. | T05 / T04 |
| C8 | `daemon/store.ts:17-65` | Copy the database before pending migrations. Refuse to write to a newer schema. Start read-only on migration failure. | T07 |
| C9 | `daemon/server.ts`, `ui/margin.ts`, `ui/library` | Add the Copy diagnostics summary with the S13 allowlist. Map `unavailableReason` to fixed codes. | T01 / T05 / T11 |
| C10 | `daemon/store.ts`, `daemon/server.ts`, `ui/library/index.ts` | Add whole-library export. | T07 / T11 |
| C11 | `webapp/main.ts:2-4` | Mount the T11 library and the "This computer" section on the helper page. | T05 / T11 |
| C12 | `daemon/server.ts:38` | Narrow `allowedOrigin` from any extension ID to the Marginalia extension ID(s). Today any installed extension may attempt pairing. | T01 |
| C13 | `daemon/server.ts:87` | Decide whether `/health` stays unauthenticated. If it does, drop the sign-in state from the public response. | T01 |
| C14 | New installer per OS | Installer, start-at-login choice, uninstall that keeps data unless the reader chooses otherwise, upgrade path. | T19 |
| C15 | `extension/README.md`, listing | Rebuild note: the checked-in build predates the final security fixes. State tested platforms only. | T12 |

## 8. Unresolved product decisions

1. Where an installed helper shows the pairing code: helper page button (recommended), tray item, or both.
2. Whether uninstall offers "Also remove my saved library". Recommended: off by default, with an export offered first.
3. Whether macOS and Linux ship in the alpha at all, or the listing says Windows only.
4. How many pre-update database copies to keep. Recommended: the latest two.
5. Whether `/health` requires pairing (C13).
