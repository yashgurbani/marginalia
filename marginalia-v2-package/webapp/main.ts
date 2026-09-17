/// <reference types="vite/client" />
import { mountMargin, threadContentKey } from '../ui/margin.ts';
import { localPersistence } from '../ui/persistence.ts';
import { libraryAdapters, type HelperClient } from '../ui/helper.ts';
import { savedThreadCapture } from '../ui/library-entry.ts';
import { mountLibrary, type LibraryMount } from './library/index.ts';
import type { Thread } from '../contracts/reader.ts';
import '../ui/margin.css';
import '../ui/helper-management.css';
import '../ui/consent.css';

const app = document.querySelector<HTMLElement>('#app')!;
const navigation = document.createElement('nav'); navigation.className = 'm-app-nav'; navigation.setAttribute('aria-label', 'Local reading and saved work');
const reading = document.createElement('div'), libraryHost = document.createElement('div'); libraryHost.hidden = true;
const message = document.createElement('p'); message.className = 'm-library-message'; message.setAttribute('role', 'status');
const libraryButton = control('Library and settings', () => { void openLibrary().catch(fail); });
const homeButton = control('Original reading page', showReading);
const backButton = control('Return to open margin', closeLibrary); backButton.hidden = true;
navigation.append(libraryButton, homeButton, backButton); app.append(navigation, message, reading, libraryHost);
const primary = mountMargin(reading, { helperManagement: true });
let primaryMount: Awaited<ReturnType<typeof mountMargin>> | undefined;
void primary.then(margin => { primaryMount = margin; }).catch(fail);
const persistence = localPersistence();
let library: LibraryMount | undefined, generation = 0, openingThread: string | undefined;
let activeSaved: HTMLElement | undefined;
const viewFocus = new WeakMap<HTMLElement, HTMLElement>();
const savedViews = new Map<string, { root: HTMLElement; margin: Awaited<ReturnType<typeof mountMargin>>; threadKey: string; sourceId: string }>();
// Navigation changes visibility, never destroys an editor with unpreserved work.
app.addEventListener('focusin', () => {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement)) return;
  if (!reading.hidden && reading.contains(target)) viewFocus.set(reading, target);
  else if (activeSaved && !activeSaved.hidden && activeSaved.contains(target)) viewFocus.set(activeSaved, target);
});
function control(text: string, action: () => void) { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.addEventListener('click', action); return button; }
function fail(error: unknown) { message.textContent = error instanceof Error ? error.message : 'This action could not finish. Open margin work is retained.'; }
function hideSaved() { for (const view of savedViews.values()) { view.margin.suspend(); view.root.hidden = true; } }
function showReading() {
  generation++; library?.destroy(); library = undefined; libraryHost.hidden = true;
  hideSaved(); activeSaved = undefined; reading.hidden = false; primaryMount?.resume(); backButton.hidden = true;
  message.textContent = '';
  const target = viewFocus.get(reading);
  if (target?.isConnected && reading.contains(target)) target.focus({ preventScroll: true }); else libraryButton.focus({ preventScroll: true });
}
function closeLibrary() {
  generation++; library?.destroy(); library = undefined; libraryHost.hidden = true; backButton.hidden = true;
  if (activeSaved?.isConnected) { activeSaved.hidden = false; reading.hidden = true; [...savedViews.values()].find(view => view.root === activeSaved)?.margin.resume(); }
  else { reading.hidden = false; primaryMount?.resume(); }
  const target = viewFocus.get(activeSaved ?? reading);
  if (target?.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true }); else libraryButton.focus({ preventScroll: true });
}
async function openLibrary() {
  if (library) return;
  const request = ++generation, margin = await primary;
  if (request !== generation) return;
  const connection = () => {
    if (request !== generation) throw new Error('This library view has closed.');
    const client = margin.connection();
    if (client.origin !== location.origin) throw new Error('Open the library at the paired local helper address.');
    return client;
  };
  connection(); // Fail before hiding a usable editor.
  margin.suspend(); reading.hidden = true; hideSaved(); libraryHost.hidden = false; backButton.hidden = false;
  try { library = mountLibrary(libraryHost, libraryAdapters(connection, (client, thread) => {
    const epoch = client.connectionVersion;
    const current = () => { if (request !== generation || connection() !== client || client.connectionVersion !== epoch) throw new Error('The library or connection changed. The restore outcome may need refreshing.'); };
    return persistence.library.restore(client.origin, thread, async change => { current(); await client.change(change); }, async () => { current(); return client.list(); });
  }, {
    onClose: closeLibrary,
    onOpenThread: async thread => {
      if (openingThread) throw new Error('A saved thread is opening. Its current operation has not finished.');
      openingThread = thread.id;
      try { await openSaved(thread, request, connection); } finally { openingThread = undefined; }
    },
  }));
  } catch (error) { closeLibrary(); throw error; }
  message.textContent = 'Saved helper threads and settings. Your reading drafts remain open. Full-library search is not part of this entry.';
  libraryHost.querySelector<HTMLElement>('button')?.focus();
}
async function openSaved(thread: Thread, request: number, connection: () => HelperClient) {
  const client = connection(), epoch = client.connectionVersion;
  const current = () => request === generation && connection() === client && client.connectionVersion === epoch;
  const exported = await client.exportThread(thread.id);
  if (!current()) return;
  const { bundle, capture } = savedThreadCapture(exported, thread);
  const retained = savedViews.get(thread.id);
  if (retained) {
    if (retained.sourceId !== bundle.source.id || retained.threadKey !== threadContentKey(bundle.thread)) throw new Error('This thread changed while its margin was open. The connected editor is retained; return to that margin and explicitly synchronize before reopening.');
    library?.destroy(); library = undefined; libraryHost.hidden = true; backButton.hidden = true;
    retained.root.hidden = false; retained.margin.resume(); activeSaved = retained.root; reading.hidden = true;
    message.textContent = 'Returned to the same connected saved-source margin. Drafts and controls are unchanged.'; return;
  }
  await persistence.replies.refresh(client.origin, thread.id, () => persistence.replies.cache(client.origin, thread.id, bundle.source, bundle.replies, bundle.replyViews));
  if (!current()) return;
  const root = document.createElement('section'); root.className = 'm-saved-workspace'; root.hidden = true;
  const article = document.createElement('article'); article.className = 'm-captured-source';
  const title = document.createElement('h1'); title.textContent = capture.title;
  const label = document.createElement('p'); label.textContent = 'Saved source capture: ' + capture.capturedAt + '. This is not a newly fetched page.';
  const original = document.createElement('a'); original.textContent = 'Open original source'; original.href = capture.url; original.target = '_blank'; original.rel = 'noopener noreferrer';
  const text = document.createElement('div'); text.className = 'm-captured-text'; text.tabIndex = -1;
  const sections = capture.sections?.length ? capture.sections : [{ title: 'Whole page', start: 0, end: capture.text.length }];
  let offset = 0;
  sections.forEach((section, index) => {
    text.append(document.createTextNode(capture.text.slice(offset, section.start)));
    const span = document.createElement('span'); span.dataset.readingSection = String(index); span.textContent = capture.text.slice(section.start, section.end); text.append(span); offset = section.end;
  });
  text.append(document.createTextNode(capture.text.slice(offset))); article.append(title, label, original, text);
  const marginRoot = document.createElement('div'); root.append(article, marginRoot); app.append(root);
  let mounted: Awaited<ReturnType<typeof mountMargin>>;
  try { mounted = await mountMargin(marginRoot, { capture, sections, sourceRoot: text, savedThread: bundle.thread, helperOrigin: client.origin, initialOpen: true, draftScope: 'library-' + thread.id }); }
  catch (error) { root.remove(); throw error; }
  savedViews.set(thread.id, { root, margin: mounted, threadKey: threadContentKey(bundle.thread), sourceId: bundle.source.id });
  if (!current()) { mounted.suspend(); return; } // Retain it; no late completion steals navigation.
  mounted.setReadingPosition(bundle.thread.anchor.start);
  library?.destroy(); library = undefined; libraryHost.hidden = true; backButton.hidden = true;
  hideSaved(); root.hidden = false; mounted.resume(); activeSaved = root; reading.hidden = true;
  message.textContent = 'Opened the original saved capture. Existing note and question drafts remain connected. Opening did not send queued changes.';
  text.focus({ preventScroll: true });
}

// Packaged assets only; private helper requests never enter the service-worker cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => { /* Open-page local saving is independent of offline shell installation. */ });
}
