/// <reference types="vite/client" />
import { mountMargin, threadContentKey } from '../ui/margin.ts';
import { localPersistence } from '../ui/persistence.ts';
import { libraryAdapters } from '../ui/helper.ts';
import { mountLibrary, type LibraryMount } from './library/index.ts';
import type { Thread } from '../contracts/reader.ts';
import type { LibrarySearchResult } from '../contracts/library.ts';
import { focusSavedPassage, validateSavedPassage } from '../ui/library/passage.ts';
import { sourceCaptureFromVersion } from '../ui/library-entry.ts';
import '../ui/margin.css';
import '../ui/helper-management.css';

const app = document.querySelector<HTMLElement>('#app')!;
const nav = document.createElement('nav'); nav.className = 'm-app-nav'; nav.setAttribute('aria-label', 'Reading and saved work');
const reading = document.createElement('div'), libraryHost = document.createElement('div'); libraryHost.hidden = true;
const status = document.createElement('p'); status.className = 'm-library-message'; status.setAttribute('role', 'status');
const libraryButton = control('Library and settings', openLibrary), back = control('Back to reading', showReading); back.hidden = true;
nav.append(libraryButton, back); app.append(nav, status, reading, libraryHost);
const persistence = localPersistence();
const primary = mountMargin(reading, { helperManagement: true, onLibrary: openLibrary });
let primaryMount: Awaited<ReturnType<typeof mountMargin>> | undefined;
void primary.then(value => { primaryMount = value; }).catch(error => { status.textContent = error instanceof Error ? error.message : 'The reading margin could not be opened.'; });
let library: LibraryMount | undefined, generation = 0, activeSaved: HTMLElement | undefined;
let readingFocus: HTMLElement | null = null;
const savedFocus = new WeakMap<HTMLElement, HTMLElement>();
const opening = new Set<string>();
const savedViews = new Map<string, { root: HTMLElement; margin: Awaited<ReturnType<typeof mountMargin>>; threadKey: string; sourceId: string }>();
app.addEventListener('focusin', () => { const node = document.activeElement; if (!(node instanceof HTMLElement)) return; if (!reading.hidden && reading.contains(node)) readingFocus = node; else if (activeSaved && !activeSaved.hidden && activeSaved.contains(node)) savedFocus.set(activeSaved, node); });
function control(text: string, action: () => void) { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', action); return node; }
function hideSaved() { for (const view of savedViews.values()) { view.margin.suspend(); view.root.hidden = true; } }
function closeLibrary() {
  generation++; library?.destroy(); library = undefined; libraryHost.hidden = true;
  if (activeSaved?.isConnected) { activeSaved.hidden = false; reading.hidden = true; [...savedViews.values()].find(view => view.root === activeSaved)?.margin.resume(); }
  else { reading.hidden = false; primaryMount?.resume(); }
  back.hidden = !activeSaved; status.textContent = '';
  const target = activeSaved ? savedFocus.get(activeSaved) : readingFocus;
  if (target?.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true }); else libraryButton.focus();
}
function showReading() {
  closeLibrary(); hideSaved(); activeSaved = undefined; reading.hidden = false; primaryMount?.resume(); back.hidden = true;
  if (readingFocus?.isConnected && reading.contains(readingFocus)) readingFocus.focus({ preventScroll: true }); else libraryButton.focus();
}
function openLibrary() {
  void (async () => {
    const request = ++generation, margin = await primary; if (request !== generation) return;
    const connection = () => { if (request !== generation) throw new Error('This library view has closed.'); const client = margin.connection(); if (client.origin !== location.origin) throw new Error('Open the library at the paired local helper address.'); return client; };
    connection(); // A failed pairing check must not hide a working reader.
    margin.suspend(); reading.hidden = true; hideSaved(); libraryHost.hidden = false; back.hidden = false;
    library?.destroy();
    const adapters = libraryAdapters(connection, (client, thread) => {
      const epoch = client.connectionVersion;
      const current = () => { if (request !== generation || client !== connection() || epoch !== client.connectionVersion) throw new Error('The library or helper connection changed. The restore outcome may need checking.'); };
      return persistence.library.restore(client.origin, thread, async mutation => { current(); await client.change(mutation); }, async () => { current(); return client.list(); });
    }, {
      onClose: closeLibrary,
      onOpenPassage: async (thread, result, isCurrentSearch) => {
        if (opening.has(thread.id)) return;
        opening.add(thread.id);
        try { await openSavedThread(thread, request, connection, result, isCurrentSearch); } finally { opening.delete(thread.id); }
      },
      onOpenThread: async thread => {
        if (opening.has(thread.id)) return;
        opening.add(thread.id);
        try { await openSavedThread(thread, request, connection); } finally { opening.delete(thread.id); }
      },
    });
    if (adapters.permissions) {
      const permissions = adapters.permissions;
      const changed = () => { const channel = new BroadcastChannel('marginalia-reader'); channel.postMessage({ type: 'permissions-changed' }); channel.close(); };
      adapters.permissions = { load: permissions.load,
        revoke: async (grant, signal) => { const result = await permissions.revoke(grant, signal); changed(); return result; },
        setExcluded: async (site, excluded, revision, signal) => { const result = await permissions.setExcluded(site, excluded, revision, signal); changed(); return result; },
      };
    }
    library = mountLibrary(libraryHost, adapters);
    status.textContent = 'Saved helper threads, local passage search and settings. Other reading drafts remain open.';
    libraryHost.querySelector<HTMLElement>('button')?.focus();
  })().catch(error => { status.textContent = error instanceof Error ? error.message : 'The library is unavailable. Your reading draft is retained.'; });
}
async function openSavedThread(thread: Thread, request: number, connection: () => ReturnType<Awaited<ReturnType<typeof mountMargin>>['connection']>, result?: LibrarySearchResult, isCurrentSearch: () => boolean = () => true) {
  if (request !== generation || thread.deletedAt) throw new Error('Restore a removed thread deliberately before opening it.');
  const client = connection(), epoch = client.connectionVersion;
  const bundle = await client.exportThread(thread.id);
  const current = () => request === generation && isCurrentSearch() && client === connection() && epoch === client.connectionVersion;
  if (!current()) return;
  if (bundle.thread.id !== thread.id || bundle.thread.deletedAt || bundle.thread.sourceUrl !== thread.sourceUrl || bundle.thread.sourceVersionId !== thread.sourceVersionId || !bundle.source || bundle.source.id !== bundle.thread.sourceVersionId) throw new Error('The helper did not return the current nonremoved thread and original source. Reload the library.');
  const version = bundle.source;
  if (result) validateSavedPassage(result, version, thread.id);
  if (!version.capturedAt || !version.extractionVersion || version.title === null || version.pageType === null || version.metadataStatus !== 'provided') throw new Error('This saved source has incomplete capture metadata. JSON export remains available; opening it needs the legacy-source contract.');
  const retained = savedViews.get(thread.id);
  if (retained) {
    if (retained.sourceId !== version.id || threadContentKey(retained.margin.getThread(thread.id) ?? bundle.thread) !== threadContentKey(bundle.thread)) throw new Error('This thread changed while its editor was open. The connected editor and inputs are retained; synchronize them explicitly before reopening.');
    library?.destroy(); library = undefined; libraryHost.hidden = true; hideSaved(); retained.root.hidden = false; retained.margin.resume(); activeSaved = retained.root; retained.margin.focusThread(thread.id);
    if (result) focusSavedPassage(retained.root.querySelector<HTMLElement>('.m-captured-text')!, result);
    return;
  }
  await persistence.replies.refresh(client.origin, thread.id, () => persistence.replies.cache(client.origin, thread.id, version, bundle.replies, bundle.replyViews));
  if (!current()) return;
  const capture = sourceCaptureFromVersion(bundle.thread.sourceUrl, version);
  const root = document.createElement('section'); root.className = 'm-saved-workspace'; root.hidden = true;
  const article = document.createElement('article'); article.className = 'm-captured-source';
  const label = document.createElement('p'); label.textContent = 'Saved source capture, not a newly fetched page.';
  const source = document.createElement('div'); source.className = 'm-captured-text'; source.tabIndex = -1;
  let offset = 0;
  for (const [index, section] of (capture.sections ?? []).entries()) { source.append(document.createTextNode(capture.text.slice(offset, section.start))); const block = document.createElement('span'); block.dataset.readingSection = String(index); block.textContent = capture.text.slice(section.start, section.end); source.append(block); offset = section.end; }
  source.append(document.createTextNode(capture.text.slice(offset))); article.append(label, source);
  const marginRoot = document.createElement('div'); root.append(article, marginRoot); app.append(root);
  let mounted: Awaited<ReturnType<typeof mountMargin>>;
  try { mounted = await mountMargin(marginRoot, { capture, sections: capture.sections, sourceRoot: source, savedThread: bundle.thread, helperOrigin: client.origin, initialOpen: true, draftScope: 'library-' + thread.id, onLibrary: openLibrary }); }
  catch (error) { root.remove(); throw error; }
  savedViews.set(thread.id, { root, margin: mounted, threadKey: threadContentKey(bundle.thread), sourceId: version.id });
  if (!current()) { mounted.suspend(); return; }
  library?.destroy(); library = undefined; libraryHost.hidden = true; hideSaved(); root.hidden = false; mounted.resume(); activeSaved = root; reading.hidden = true;
  mounted.focusThread(thread.id); status.textContent = 'Opened original saved work. Other drafts remain connected. Nothing was synchronized or asked automatically.';
  if (result) { focusSavedPassage(source, result); status.textContent = 'Opened and selected the cited passage in the saved source capture.'; }
}
if (import.meta.env?.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
