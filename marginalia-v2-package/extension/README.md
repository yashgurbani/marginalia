# Marginalia extension

This WXT MV3 package uses the shared margin in a Chrome side panel, an extension-origin floating iframe, and a browser-owned extension tab. The page keeps its source nodes and layout. The floating host contains no private note or library markup.

The toolbar action opens the margin. Selecting text also opens Keep and Ask. Keep and notes use extension-origin IndexedDB without the helper. Ask currently previews its packet; sending remains disabled until the consent and provider integration is available.

Pairing and explicit saving to the local helper happen in the native side panel or **Open browser margin**, never in the page-controlled floating presentation. After pairing, the browser margin can opt into authenticated local helper updates. Background replay reads committed helper work, uses a durable cursor, and never sends pending note/source mutations. Save pending work explicitly in the browser margin first.

Site exclusions are editable in the extension options. Private windows and non-HTTP(S) pages are excluded. Extraction omits forms, editable fields, hidden/inert content, scripts and styles. A page larger than the capture bound is declined; it is not silently truncated. The capture carries the same ordered, non-overlapping heading boundaries used by the live margin, while the outer snapshot keeps that section map for compatibility. Empty headings and zero-length sections are omitted. Source identity includes the URL without its fragment, captured safe text, capture time, extraction version and captured section metadata. The shared journal/helper owns hashing and durable source versions.

Anchor validation follows the shared reader contract: prefix and suffix context are bounded to 40 characters; explicit quote selections are bounded to 20,000 characters; legacy and section anchors may span the already-bounded 1 MB source capture. Fresh captures must match their recorded offsets exactly. Later source actions preserve the immutable selector and use shared exact/context reattachment, accepting only exact or uniquely moved passages. Lost and ambiguous passages are refused. Canonical whole-page anchors contain no quote. Their source action scrolls to the document start and never paints a highlight.

## Build and later acceptance

From the v2 package root, the existing scripts are `npm run extension:build` and `npm run extension:typecheck`. WXT writes the unpacked Chrome build to `extension/.output/chrome-mv3`. The generated output is ignored.

**Testing is deferred by user instruction.** The generated build currently predates the final security/reconnect changes. Rebuild and complete the deferred browser checks before loading it for acceptance or making release claims. See `wayfinder/build-receipts/T04.md` and `docs/evidence/T04-review.md`.

Chrome 116 or later is required for the document/context APIs used by the native surface and authenticated frame binding. Other browser compatibility has not been established. Page-owned DOM can obstruct or remove a floating frame; it is not an authorization surface for helper transfer or future provider consent.
