# Chrome Web Store listing — working document

This file is not published. It holds the text to paste into the developer
dashboard if and when a submission happens.

## Status

Whether to submit to the Chrome Web Store at all is the maintainer's decision and
is still open. Nothing can be submitted until [PRIVACY.md](PRIVACY.md) is posted
at a public URL, because the dashboard requires that URL and a contact address.

## Listing description

Tagline, as the manifest already states it (`extension/wxt.config.ts:8`):

> A margin beside whatever you are reading.

Description to paste:

> Marginalia puts a margin beside the page you are reading. Select a passage or
> write a note, and the answer appears next to it, anchored to the words that
> prompted it. The page itself is never changed.
>
> The margin reads a page only when you select text on it. Selecting sends
> nothing anywhere.
>
> Your reading, notes and threads stay on your computer, in a local database, and
> export as plain files.
>
> This extension needs a separate local helper program to do anything. The helper
> is a small Node 24 daemon you install yourself from the Marginalia repository;
> it listens on 127.0.0.1 and holds your reading. Without it, the extension has
> nowhere to save and nothing to ask.
>
> Asking for help sends the passage, your note and a bounded slice of the
> surrounding page to the Codex runtime you configured. The first time text from
> a site is about to leave, the margin shows you the exact outgoing text, the
> recipient and the scope, and asks: this time, always on this site, or never on
> this site.
>
> Web checks are not available in this version. "What supports this" and "go
> further" cannot fetch anything, because this build has no network-capable
> policy.
>
> This is an alpha. No run against a real model provider has been recorded yet.

Chrome's single-purpose rule and the prominent-disclosure rule both rest on this
text, so the helper requirement and the consent step must stay in it.

## Permission justifications

One paragraph per permission in the built manifest
(`extension/.output/chrome-mv3/manifest.json`, from `extension/wxt.config.ts:10-11`).

**storage.** The extension stores your per-site exclusion list, the helper
address and the pairing token in extension-origin storage, and reads them on
every page decision. `extension/entrypoints/background.ts:14-24` sets both local
and session storage to trusted contexts and caches the exclusion policy; line 32
re-reads it before allowing a page.

**tabs.** The margin has to know which page a request belongs to and open its own
surface. `background.ts:37` reads the tab behind a request,
`background.ts:105` re-checks that the tab's URL still matches what was captured,
and `background.ts:133` opens the workspace tab.

**webNavigation.** Capture must be pinned to one document, so the extension
compares the top frame's document ID before and after a snapshot and refuses when
it changed. `background.ts:39-43` takes that before-and-after reading;
`background.ts:56-64` and `background.ts:111-113` use the same frame identity for
later messages, including `getAllFrames` to detect a changed embedding.

**sidePanel.** The margin is Chrome's side panel.
`background.ts:26-27` opens it for the active tab.

**alarms.** When the local helper is unreachable, the extension backs off and
retries on a one-minute alarm rather than polling.
`extension/lib/helper-reconnect.ts:44` creates that alarm.

**host_permissions `http://127.0.0.1/*`.** The extension talks to the local
helper and to nothing else. The default address is the single port
`http://127.0.0.1:43120` (`extension/lib/helper-origin.ts:3`), and the reader may
choose a different port. Match patterns cannot carry a port, so the narrowest
pattern Chrome accepts is wider than the one port actually in use. The extension
narrows it in code instead: `extension/lib/helper-origin.ts:7-17` accepts only
`http://127.0.0.1` with an optional port, so no setting can point it elsewhere.
The three network destinations in browser code are all this loopback helper
(`ui/helper.ts:110`, `ui/helper-management.ts:41`,
`extension/lib/helper-reconnect.ts:80`).

**activeTab — declared but unused.** `activeTab` is in the manifest and nothing
in the source calls it. A search across the package returns only the declaration
in `extension/wxt.config.ts:10`. Chrome rejects permissions an extension does not
use, and no honest justification can be written for this one. Remove it from the
manifest before submitting. That change belongs to the extension code, not to
this document.

## Broad host access justification

The content script matches `http://*/*` and `https://*/*` on top frames only
(`extension/entrypoints/content.ts:28`), and the exclusion list starts empty
(`extension/entrypoints/options/main.ts:6`).

The justification to paste:

> Marginalia is a margin for whatever the reader is reading. A margin that worked
> only on a pre-approved list of sites would not be the product. The breadth is
> bounded in four ways. The script runs in the top frame only. It captures
> nothing until the reader makes a deliberate text selection. The reader can
> exclude any site and its subdomains, which also blocks every subdomain. And no
> page content leaves the machine without a per-site consent decision that shows
> the exact outgoing text first.

Future narrowing, worth stating as intent: `optional_host_permissions`, or a
per-site enable flow, would cut the default scope to the sites a reader actually
uses Marginalia on.

## Privacy practices tab

Declare these categories, and no others. A mismatch between the dashboard, the
posted policy and the code is itself a violation, which is what this table exists
to prevent.

| Dashboard category | Code path | Covered in PRIVACY.md by |
|---|---|---|
| Website content | `extension/lib/capture.ts:8`, `extension/lib/protocol.ts:2` | "What is collected, and when" — website content |
| Web history | `extension/lib/protocol.ts:35`, `extension/entrypoints/background.ts:37` | "What is collected, and when" — page address and title |
| User-generated content | notes and questions written in the margin, stored by `daemon/store.ts:176` | "What is collected, and when" — your own notes and questions |
| Authentication information | pairing token, `extension/lib/helper-reconnect.ts:74` | "Who else can see it" |

Answer no to personally identifiable information, health information, financial
information, personal communications and location. Answer no to selling or
transferring data, to using it for unrelated purposes, and to creditworthiness
determination.

## Known review risks

- **Broad host access with an empty default exclusion list.** The most likely
  point of friction. The justification above is the whole defence.
- **A localhost dependency.** On a clean profile with no helper installed, the
  extension cannot save or ask, which looks like a broken extension to a
  reviewer. The first screenshot and the first line of the description must both
  state the helper requirement.
- **`activeTab` declared and unused.** See above. Remove it before submitting.
- **`panel.html` is a web-accessible resource** matched to `http://*/*` and
  `https://*/*` (`extension/wxt.config.ts:19`), which lets any page detect the
  extension.
- **The in-page overlay margin can be overlaid or hidden by a hostile page**, and
  a site with a restrictive `frame-src` can block it. The embedded surface cannot
  pair or send. The native side panel is the surface to prefer, and the listing
  should point readers at it.

## Required before submission

Only the maintainer can supply these:

- [ ] A public URL where PRIVACY.md is posted.
- [ ] A contact address for the developer account.
- [ ] Screenshots, with the helper requirement visible in the first one.
- [ ] The decision to submit at all.
- [ ] Removal of `activeTab` from the manifest.
