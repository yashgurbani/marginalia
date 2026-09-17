import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { respondAsync } from '../lib/respond.ts';
import { captureSelection, locate, safeNode } from '../lib/capture.ts';
import { allowedPage, isMessage, pageIdentity, validAnchor, type Snapshot } from '../lib/protocol.ts';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], allFrames: false, runAt: 'document_idle',
  main(ctx) {
    if (window.top !== window || !allowedPage(location.href)) return;
    const documentId = crypto.randomUUID();
    let snapshot: Snapshot | null = null, revision = 0, busy = false, host: HTMLElement | null = null, dirty = true, lastProjection = 0;
    const observer = new MutationObserver(changes => { if (changes.some(change => !host?.contains(change.target))) dirty = true; });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    function clear() { snapshot = null; host?.remove(); host = null; highlights?.delete('marginalia-selection'); }
    async function permitted() { const result = await browser.runtime.sendMessage({ type: 'policy', version: 1 }); return result?.allowed === true; }
    async function open() {
      if (host?.isConnected) return;
      host = null;
      const response = await browser.runtime.sendMessage({ type: 'open', version: 1 });
      if (!response?.allowed || response.panel || typeof response.capability !== 'string' || host) return;
      host = document.createElement('div'); host.id = 'marginalia-host-' + crypto.randomUUID();
      host.style.setProperty('all', 'initial', 'important');
      for (const [property, value] of Object.entries({ position: 'fixed', right: '0', top: '0', width: '0', height: '0', display: 'block', 'z-index': '2147483647' })) host.style.setProperty(property, value, 'important');
      const shadow = host.attachShadow({ mode: 'closed' });
      const frame = document.createElement('iframe'); frame.title = 'Marginalia';
      let loaded = false;
      frame.addEventListener('load', () => { if (loaded) { host?.remove(); host = null; } loaded = true; });
      frame.src = browser.runtime.getURL('/panel.html') + '#capability=' + encodeURIComponent(response.capability);
      frame.style.cssText = 'position:fixed;right:12px;top:12px;width:min(420px,calc(100vw - 24px));height:calc(100vh - 24px);border:1px solid #aaa;z-index:2147483647;background:#faf8f3;color-scheme:light dark;';
      shadow.append(frame); document.documentElement.append(host);
    }
    async function select() {
      if (busy || getSelection()?.isCollapsed) return;
      busy = true;
      try {
        if (!await permitted()) { clear(); return; }
        if (snapshot && snapshot.capture.url !== pageIdentity(location.href)) clear();
        const next = captureSelection(documentId, ++revision);
        if (!next?.anchor) return;
        snapshot = next; dirty = false; lastProjection = Date.now(); await open();
      } catch (error) { console.warn('Marginalia capture unavailable:', error instanceof Error ? error.message : 'unknown'); }
      finally { busy = false; }
    }
    ctx.addEventListener(document, 'pointerup', event => { if (event.isTrusted) void select(); });
    ctx.addEventListener(document, 'keyup', event => { if (event.isTrusted && (event.key === 'Shift' || event.key.startsWith('Arrow'))) void select(); });
    ctx.addEventListener(window, 'scroll', () => {
      if (!snapshot || dirty) return;
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).filter(safeNode).slice(0, 299);
      const offset = snapshot.sections.length - headings.length;
      snapshot.position = 0;
      headings.forEach((heading, index) => {
        if (heading.getBoundingClientRect().top <= innerHeight * .4) snapshot!.position = snapshot!.sections[index + offset]?.start ?? 0;
      });
    }, { passive: true });
    for (const type of ['pageshow', 'resize']) ctx.addEventListener(window, type, () => { dirty = true; });
    ctx.addEventListener(document, 'load', () => { dirty = true; }, { capture: true });
    browser.runtime.onMessage.addListener((message, sender, respond) => respondAsync(() => {
      if (sender.id !== browser.runtime.id || sender.tab) return;
      if (isMessage(message, 'identity')) return Promise.resolve({ document: documentId });
      if (isMessage(message, 'excluded')) { clear(); return Promise.resolve(true); }
      if (isMessage(message, 'activate')) return (async () => {
        if (!await permitted()) return;
        snapshot = captureSelection(documentId, ++revision, false); dirty = false; lastProjection = Date.now();
        if (!message.panel) await open();
        return true;
      })();
      if (isMessage(message, 'snapshot')) return (async () => {
        if (!await permitted() || snapshot?.capture.url !== pageIdentity(location.href)) { clear(); return null; }
        if (dirty || Date.now() - lastProjection > 5000) {
          const fresh = captureSelection(documentId, revision, false); dirty = false; lastProjection = Date.now();
          if (fresh && snapshot && fresh.capture.text !== snapshot.capture.text) { fresh.revision = ++revision; snapshot = fresh; }
        }
        return snapshot;
      })();
      if ((isMessage(message, 'highlight') || isMessage(message, 'scroll')) && message.document === documentId && (message.anchor === null || validAnchor(message.anchor))) {
        highlights?.delete('marginalia-selection');
        if (message.anchor) {
          if (message.anchor.kind === 'whole-page') {
            if (message.type === 'scroll') scrollTo({ top: 0, behavior: 'instant' });
            return Promise.resolve(true);
          }
          const range = locate(message.anchor);
          if (range && message.type === 'scroll') range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' });
          const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
          if (range && HighlightClass) highlights?.set('marginalia-selection', new HighlightClass(range));
        }
        return Promise.resolve(true);
      }
    }, respond));
    // Styling a named Custom Highlight never wraps or rewrites source nodes.
    const style = document.createElement('style'); style.textContent = '::highlight(marginalia-selection){background-color:#e8cb75;color:inherit}'; document.documentElement.append(style);
    ctx.onInvalidated(() => { clear(); style.remove(); observer.disconnect(); });
  },
});
