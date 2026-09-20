import { FrequencyPageScorer, createAutoAssistController, paintAutoAssistMarks, AUTO_ASSIST_CSS } from '../lib/auto-assist/index.ts';
import { autoAssistAnchor } from '../lib/auto-assist/anchors.ts';
import { sourceHash } from '../lib/instant-lifecycle.ts';
import type { AutoAssistPosture, DifficultyCandidate } from '../../contracts/auto-assist.ts';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { readReply, respondAsync, type MessageReply } from '../lib/respond.ts';
import { captureSelection, locate, projectPage, type SectionMarker } from '../lib/capture.ts';
import { allowedPage, isMessage, pageIdentity, validAnchor, validSavedMarks, type Snapshot } from '../lib/protocol.ts';
import { resumeCleanupUrl, resumeThreadId } from '../../contracts/resume.ts';
import { HIGHLIGHT_COLOURS, highlightColour, type HighlightColour } from '../../contracts/reader.ts';
import { createSelectionBar } from '../lib/selection-bar.ts';
import { sameSelection, sameCommandSelection, validCommandCapture, KEEP_RECEIPT_TTL, type SelectionAction } from '../lib/selection-actions.ts';

const READING_LINE_OFFSET = 24;
type ProjectedNode = ReturnType<typeof projectPage>['nodes'][number];

export function readingPositionAt(nodes: ProjectedNode[], sectionMarkers: SectionMarker[], viewportHeight: number): number {
  let fallback = 0;
  sectionMarkers.forEach(({ heading, start }) => {
    if (heading.isConnected && heading.getBoundingClientRect().top <= viewportHeight * .4) fallback = start;
  });
  const range = document.createRange();
  for (const { node, start } of nodes) {
    const value = node.textContent ?? '';
    const textStart = value.search(/\S/);
    if (textStart < 0) continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.top >= READING_LINE_OFFSET && rect.bottom <= viewportHeight) return start + textStart;
  }
  return fallback;
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], allFrames: false, runAt: 'document_idle',
  main(ctx) {
    if (window.top !== window || !allowedPage(location.href)) return;
    const documentId = crypto.randomUUID();
    let selectionTimer: ReturnType<typeof setTimeout> | undefined, pageTimer: ReturnType<typeof setTimeout> | undefined;
    let autoCandidates: readonly DifficultyCandidate[] = [];
    let previousVocabulary = new Set<string>();
    const knownCandidates = new Map<string, DifficultyCandidate>();
    let lastInstantSelection = '', instantBusy = false, alive = true, reprepare = false, pageEpoch = 0;
    const instantMessage = (type: string, extra = {}) => browser.runtime.sendMessage({ type, version: 1, ...extra }).then(readReply);
    async function resumeFromMarker() {
      const markerUrl = location.href, threadId = resumeThreadId(markerUrl);
      if (!threadId) return;
      try {
        const result = readReply(await browser.runtime.sendMessage({ type: 'resume', version: 1, threadId })) as { consumed?: boolean } | undefined;
        const cleanupUrl = result?.consumed === true ? resumeCleanupUrl(location.href, markerUrl) : undefined;
        if (cleanupUrl !== undefined) history.replaceState(history.state, '', cleanupUrl);
      } catch { /* A failed resume never blocks ordinary reading or navigation. */ }
    }
    async function instantAllowed() { return ((await instantMessage('instant-policy')) as { allowed?: boolean })?.allowed === true; }
    function scheduleInstantPage() { clearTimeout(pageTimer); pageTimer = setTimeout(() => { void prepareInstantPage(); }, 600); }
    async function prepareInstantPage() {
      if (instantBusy) { reprepare = true; return; }
      if (!alive || actionInFlight || document.visibilityState === 'hidden') return;
      instantBusy = true; const epoch = pageEpoch;
      const currentPage = () => alive && !actionInFlight && epoch === pageEpoch;
      try {
        autoAssist.clear();
        const instantEnabled = await instantAllowed();
        let autoPolicy = await instantMessage('auto-assist-policy') as { enabled?: boolean; posture?: AutoAssistPosture; vocabulary?: string[] };
        if ((!instantEnabled && !autoPolicy?.enabled) || !currentPage()) return;
        const next = captureSelection(documentId, revision, false, rememberSections);
        if (!next?.capture.text.trim()) return;
        // Moving focus to an action or the panel is not a new source selection.
        if (!next.anchor && snapshot?.capture.url === next.capture.url && snapshot.capture.text === next.capture.text) next.anchor = snapshot.anchor;
        if (!snapshot || snapshot.capture.url !== next.capture.url || snapshot.capture.text !== next.capture.text || JSON.stringify(snapshot.anchor) !== JSON.stringify(next.anchor) || !sameSections(snapshot.sections, next.sections)) next.revision = ++revision;
        snapshot = next; dirty = false; lastProjection = Date.now(); rememberPositionNodes(); readingPosition();
        if (autoPolicy.enabled) autoPolicy = await instantMessage('auto-assist-page-policy') as typeof autoPolicy;
        if (!currentPage()) return;
        if (autoPolicy.enabled && autoPolicy.posture && Array.isArray(autoPolicy.vocabulary)) {
          const vocabulary = new Set(autoPolicy.vocabulary.map(term => term.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase()));
          for (const term of previousVocabulary) if (!vocabulary.has(term)) autoAssist.forgetDismissal(term);
          previousVocabulary = vocabulary;
          const pageKeyHash = await sourceHash(next.capture.text);
          if (!currentPage()) return;
          await autoAssist.update({ pageKeyHash, text: next.capture.text, sections: next.sections, language: document.documentElement.lang || '' }, {
            enabled: true, excluded: false, posture: autoPolicy.posture, vocabulary: autoPolicy.vocabulary,
            placement: candidate => {
              const anchor = autoAssistAnchor(next.capture.text, candidate), range = anchor && locate(anchor); if (!range || range.startContainer.parentElement?.closest('code,pre') || range.endContainer.parentElement?.closest('code,pre')) return null;
              const rect = range.getBoundingClientRect();
              if (!rect.height) return null;
              const top = rect.top + scrollY;
              return { band: Math.max(0, Math.floor(top / Math.max(1, innerHeight))), top, block: String(next.sections.findIndex(section => candidate.start >= section.start && candidate.end <= section.end)) };
            },
          });
        }
        if (instantEnabled && currentPage()) await instantMessage('instant-page');
        if (currentPage() && autoPolicy.enabled) {
          const visibleIds = autoCandidates.filter(candidate => { const anchor = autoAssistAnchor(next.capture.text, candidate), range = anchor && locate(anchor); if (!range) return false; const rect = range.getBoundingClientRect(); return rect.bottom >= 0 && rect.top <= innerHeight * 2; }).map(candidate => candidate.candidateId);
          await instantMessage('auto-assist-candidates', { candidates: autoCandidates.map(({ candidateId, term, start, end }) => ({ candidateId, term, start, end })), visibleIds });
        }
      } catch { /* Pairing and helper availability are shown in the margin. */ }
      finally { instantBusy = false; if (reprepare) { reprepare = false; scheduleInstantPage(); } }
    }
    function queueInstantSelection() {
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => { void (async () => {
        if (!alive || !await instantAllowed() || !alive) return;
        const next = captureSelection(documentId, revision, true, rememberSections);
        if (!next?.anchor) { lastInstantSelection = ''; return; }
        const identity = JSON.stringify([next.capture.url, next.capture.text, next.anchor.start, next.anchor.end]);
        if (identity === lastInstantSelection) return;
        if (!snapshot || snapshot.capture.url !== next.capture.url || snapshot.capture.text !== next.capture.text || JSON.stringify(snapshot.anchor) !== JSON.stringify(next.anchor)) next.revision = ++revision;
        lastInstantSelection = identity; snapshot = next; dirty = false;
        await instantMessage('instant-selection', { selectionId: crypto.randomUUID() });
      })().catch(() => {}); }, 250);
    }
    let snapshot: Snapshot | null = null, sectionMarkers: SectionMarker[] = [], positionNodes: ProjectedNode[] = [], revision = 0, host: HTMLElement | null = null, dirty = true, lastProjection = 0;
    let selectedSnapshot: Snapshot | null = null, selectionGeneration = 0, actionInFlight = false, selectionTabEntered = false;
    let pendingGesture: { id: string; operation: string; action: SelectionAction; snapshot: Snapshot; expires: number } | undefined;
    let keepAttempt: { operation: string; snapshot: Snapshot; expires: number } | undefined;
    let commandCapture: { request: string; snapshot: Snapshot; range: Range | null; epoch: number } | undefined;
    function commandFocusAllowed() {
      if (typeof browser.dom?.openOrClosedShadowRoot !== 'function') return false;
      try {
        let focused = document.activeElement;
        const visited = new Set<Element>();
        while (focused) {
          if (!(focused instanceof HTMLElement) || visited.has(focused) || focused.closest('iframe,frame,object,embed,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]')) return false;
          visited.add(focused);
          // Read only focus, including closed roots. Never capture their content
          // or infer the focused frame from a host containing the old range.
          const root = browser.dom.openOrClosedShadowRoot(focused);
          if (root === null) return true;
          if (!(root instanceof ShadowRoot)) return false;
          const nested = root.activeElement;
          if (nested === null) return true;
          if (!(nested instanceof HTMLElement)) return false;
          focused = nested;
        }
        return true;
      } catch { return false; }
    }
    function freshCommandSelection(selection: boolean) {
      if (!alive || !commandFocusAllowed()) return null;
      const next = captureSelection(documentId, revision, selection, rememberSections);
      if (!next || (selection && !next.anchor)) return null;
      if (!snapshot || !sameCommandSelection(snapshot, next)) next.revision = ++revision;
      snapshot = next; dirty = false; lastProjection = Date.now();
      return next;
    }
    const selectionBar = createSelectionBar(action => {
      const selected = selectedSnapshot, liveSelection = getSelection();
      if (!alive || actionInFlight || !selected?.anchor || !snapshot || !sameSelection(selected, snapshot) ||
        (!selectionBar.matches(liveSelection) && !(liveSelection?.isCollapsed && selectionBar.focused())) || projectPage().text !== selected.capture.text) return Promise.resolve(false);
      if (action === 'keep' && keepAttempt && keepAttempt.expires <= Date.now()) { keepAttempt = undefined; selectionBar.hide(); return Promise.resolve(false); }
      clearTimeout(selectionTimer);
      actionInFlight = true;
      if (action === 'keep' && (!keepAttempt || !sameSelection(keepAttempt.snapshot, selected))) keepAttempt = { operation: crypto.randomUUID(), snapshot: structuredClone(selected), expires: Date.now() + KEEP_RECEIPT_TTL };
      const operation = action === 'keep' ? keepAttempt!.operation : crypto.randomUUID();
      const gesture = crypto.randomUUID(); pendingGesture = { id: gesture, operation, action, snapshot: structuredClone(selected), expires: Date.now() + 10_000 };
      // This call must remain before any await: Chrome carries the native gesture
      // into the worker message task. The worker opens only its neutral shell first.
      return browser.runtime.sendMessage({ type: 'selection-action', version: 1, action, gesture, operation, document: selected.document, revision: selected.revision }).then(readReply).then(async (value: unknown) => {
        const result = value as { kept?: boolean; queued?: boolean; panel?: boolean } | undefined;
        if (result?.kept && keepAttempt?.operation === operation) keepAttempt = undefined;
        if (result?.queued && !result.panel && alive) await open();
        return result?.kept === true || result?.queued === true;
      }).finally(() => { if (pendingGesture?.id === gesture) pendingGesture = undefined; actionInFlight = false; });
    });
    const observer = new MutationObserver(changes => { if (changes.some(change => !host?.contains(change.target))) { pageEpoch++; selectionBar.hide(); selectedSnapshot = null; pendingGesture = undefined; autoAssist.clear(); dirty = true; scheduleInstantPage(); } });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const autoAssist = createAutoAssistController({ scorer: new FrequencyPageScorer(), onDismiss: async observation => {
      const candidate = knownCandidates.get(observation.term.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase());
      if (!candidate) throw new Error('This ready help item changed.');
      const result = await instantMessage('auto-assist-dismiss', { candidateId: candidate.candidateId }) as { dismissed?: boolean };
      if (result?.dismissed !== true) throw new Error('This term could not be marked familiar.');
    }, onMarks: candidates => {
      autoCandidates = candidates; for (const candidate of candidates) knownCandidates.set(candidate.normalizedTerm, candidate);
      const registry = highlights as Map<string, { priority: number }> | undefined;
      const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => { priority: number } }).Highlight;
      const ranges = snapshot ? candidates.map(candidate => { const anchor = autoAssistAnchor(snapshot!.capture.text, candidate); return anchor ? locate(anchor) : null; }).filter((range): range is Range => !!range) : [];
      paintAutoAssistMarks(registry, HighlightClass ? (...ranges) => new HighlightClass(...ranges) : undefined, ranges);
    } });
    let markExpiry: ReturnType<typeof setTimeout> | undefined, markEpoch = 0;
    function clearMarks() { clearTimeout(markExpiry); highlights?.delete('marginalia-kept'); highlights?.delete('marginalia-highlighted'); for (const colour of HIGHLIGHT_COLOURS) highlights?.delete('marginalia-highlighted-' + colour); }
    function clear() { selectionGeneration++; pendingGesture = undefined; keepAttempt = undefined; selectedSnapshot = null; selectionBar.hide(); knownCandidates.clear(); pageEpoch++; autoAssist.clear(); markEpoch++; clearMarks(); snapshot = null; sectionMarkers = []; positionNodes = []; host?.remove(); host = null; highlights?.delete('marginalia-selection'); }
    for (const type of ['pagehide', 'popstate']) ctx.addEventListener(window, type, () => { clear(); lastInstantSelection = ''; clearTimeout(selectionTimer); void instantMessage('instant-release').catch(() => {}); if (type === 'popstate') scheduleInstantPage(); else alive = false; });
    ctx.addEventListener(window, 'pageshow', () => { alive = true; scheduleInstantPage(); });
    ctx.addEventListener(document, 'visibilitychange', scheduleInstantPage);
    ctx.addEventListener(document, 'selectionchange', () => {
      if (selectionBar.visible() && !selectionBar.matches(getSelection()) && !selectionBar.focused()) selectionBar.hide();
      queueInstantSelection();
    });
    ctx.addEventListener(window, 'blur', () => { selectionBar.hide(); });
    ctx.addEventListener(document, 'keydown', event => {
      if (!event.isTrusted || !selectionBar.visible()) return;
      if (event.key === 'Escape') { event.preventDefault(); selectionBar.hide(); }
      else if (event.key === 'Tab' && !event.shiftKey && !selectionTabEntered && !selectionBar.owns(event)) { event.preventDefault(); selectionTabEntered = true; selectionBar.focus(); }
    });
    const rememberSections = (markers: SectionMarker[]) => { sectionMarkers = markers; };
    const sameSections = (left: Snapshot['sections'], right: Snapshot['sections']) => left.length === right.length && left.every((section, index) => {
      const other = right[index];
      return section.title === other.title && section.start === other.start && section.end === other.end;
    });
    async function permitted() { const result = readReply(await browser.runtime.sendMessage({ type: 'policy', version: 1 })) as { allowed?: boolean }; return result?.allowed === true; }
    async function open() {
      if (host?.isConnected) return;
      host = null;
      const response = readReply(await browser.runtime.sendMessage({ type: 'open', version: 1 })) as { allowed?: boolean; panel?: boolean; capability?: string };
      if (!response?.allowed || response.panel || typeof response.capability !== 'string' || host) return;
      host = document.createElement('div'); host.id = 'marginalia-host-' + crypto.randomUUID();
      host.style.setProperty('all', 'initial', 'important');
      for (const [property, value] of Object.entries({ position: 'fixed', right: '0', top: '0', width: '0', height: '0', display: 'block', 'z-index': '2147483647' })) host.style.setProperty(property, value, 'important');
      const shadow = host.attachShadow({ mode: 'closed' });
      const frame = document.createElement('iframe'); frame.title = 'Marginalia';
      let loaded = false;
      frame.addEventListener('load', () => { if (loaded) { host?.remove(); host = null; } loaded = true; });
      frame.src = browser.runtime.getURL('/panel.html') + '#capability=' + encodeURIComponent(response.capability);
      frame.style.cssText = 'position:fixed;right:12px;top:12px;width:min(440px,calc(100vw - 24px));height:calc(100vh - 24px);border:1px solid #aaa;border-radius:var(--m-radius,6px);box-shadow:0 12px 32px color-mix(in oklch,var(--m-scrim,currentColor) 18%,transparent);z-index:2147483647;background:var(--m-surface,transparent);color-scheme:light dark;';
      shadow.append(frame); document.documentElement.append(host);
    }
    async function select() {
      if (getSelection()?.isCollapsed) { selectionBar.hide(); return; }
      const generation = ++selectionGeneration, epoch = pageEpoch;
      try {
        if (!await permitted()) { clear(); return; }
        if (!alive || generation !== selectionGeneration || epoch !== pageEpoch) return;
        if (snapshot && snapshot.capture.url !== pageIdentity(location.href)) clear();
        const next = captureSelection(documentId, revision, true, rememberSections);
        if (!next?.anchor) { selectionBar.hide(); return; }
        // Releasing a shortcut's Shift key is not a new passage or retry identity.
        if (!snapshot || !sameCommandSelection(snapshot, next)) next.revision = ++revision;
        const range = getSelection()?.getRangeAt(0);
        if (!range) return;
        pendingGesture = undefined; keepAttempt = undefined; selectionTabEntered = false; selectedSnapshot = next; snapshot = next; dirty = false; lastProjection = Date.now(); rememberPositionNodes(); readingPosition(); selectionBar.show(range);
      } catch (error) { console.warn('Marginalia capture unavailable:', error instanceof Error ? error.message : 'unknown'); }
    }
    ctx.addEventListener(document, 'pointerup', event => {
      if (!event.isTrusted || selectionBar.owns(event)) return;
      if (getSelection()?.isCollapsed !== false && snapshot) {
        const candidate = autoCandidates.find(candidate => { const anchor = autoAssistAnchor(snapshot!.capture.text, candidate), range = anchor && locate(anchor); return range && Array.from(range.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom); });
        if (candidate) { void open(); void instantMessage('auto-assist-open', { candidateId: candidate.candidateId }).catch(() => {}); return; }
      }
      void select();
    });
    ctx.addEventListener(document, 'keyup', event => { if (event.isTrusted && !selectionBar.owns(event) && (event.key === 'Shift' || event.key.startsWith('Arrow'))) void select(); });
    function rememberPositionNodes() { const projection = projectPage(); positionNodes = snapshot && projection.text === snapshot.capture.text ? projection.nodes : []; }
    function readingPosition() { if (snapshot) snapshot.position = readingPositionAt(positionNodes, sectionMarkers, innerHeight); }
    ctx.addEventListener(window, 'scroll', () => { selectionBar.position(); readingPosition(); scheduleInstantPage(); }, { passive: true });
    for (const type of ['pageshow', 'resize']) ctx.addEventListener(window, type, () => { selectionBar.position(); dirty = true; });
    ctx.addEventListener(document, 'load', () => { dirty = true; }, { capture: true });
    browser.runtime.onMessage.addListener((message: unknown, sender: { id?: string; tab?: unknown }, respond: (value: MessageReply) => void) => respondAsync(() => {
      if (sender.id !== browser.runtime.id || sender.tab) return;
      if (validCommandCapture(message)) return (async () => {
        const epoch = pageEpoch;
        if (!await permitted() || epoch !== pageEpoch) return null;
        const next = freshCommandSelection(message.command !== 'open-margin');
        if (!next) { selectionBar.commandStatus('Select a passage first'); return null; }
        const range = getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).cloneRange() : null;
        commandCapture = { request: message.request, snapshot: structuredClone(next), range, epoch };
        return { request: message.request, snapshot: next };
      })();
      if (isMessage(message, 'command-result') && Object.keys(message).length === 6 &&
        typeof message.request === 'string' && message.document === documentId && Number.isSafeInteger(message.revision) &&
        (message.status === 'Kept' || message.status === 'Try again' || message.status === 'The passage changed. Select it again.')) {
        const status = message.status;
        return (async () => {
          const captured = commandCapture;
          if (!captured || captured.request !== message.request || captured.snapshot.revision !== message.revision || captured.epoch !== pageEpoch || !await permitted()) return false;
          const live = freshCommandSelection(true);
          if (captured.epoch !== pageEpoch || !live || !sameCommandSelection(captured.snapshot, live)) return false;
          commandCapture = undefined;
          if (captured.range) { selectionBar.show(captured.range); selectionBar.commandStatus(status); }
          return true;
        })();
      }
      if (isMessage(message, 'auto-assist-dismiss') && typeof message.candidateId === 'string') return (async () => {
        const candidate = autoCandidates.find(item => item.candidateId === message.candidateId); if (!candidate) throw new Error('Stale source request.');
        try { await autoAssist.dismiss(candidate.term); } catch (error) { scheduleInstantPage(); throw error; }
        return { dismissed: true };
      })();
      if (isMessage(message, 'auto-assist-familiar') && typeof message.term === 'string') { scheduleInstantPage(); return Promise.resolve(true); }
      if (isMessage(message, 'instant-navigation')) { clear(); lastInstantSelection = ''; scheduleInstantPage(); return Promise.resolve(true); }
      if (isMessage(message, 'identity')) return Promise.resolve({ document: documentId });
      if (isMessage(message, 'excluded')) { clearTimeout(selectionTimer); clearTimeout(pageTimer); clear(); return Promise.resolve(true); }
      if (isMessage(message, 'selection-bar-dismiss') && message.document === documentId) { selectionBar.hide(); return Promise.resolve(true); }
      if (isMessage(message, 'claim-selection-action')) {
        const claim = pendingGesture;
        if (!alive || !claim || claim.expires <= Date.now() || claim.id !== message.gesture || claim.operation !== message.operation || claim.action !== message.action || message.document !== documentId ||
          claim.snapshot.revision !== message.revision || !snapshot || !sameSelection(claim.snapshot, snapshot)) return Promise.resolve(false);
        pendingGesture = undefined; // One use, before any asynchronous worker work.
        return Promise.resolve(true);
      }
      if (isMessage(message, 'action-capture') && typeof message.selection === 'boolean') return (async () => {
        const epoch = pageEpoch;
        if (!await permitted() || epoch !== pageEpoch) return false;
        const next = captureSelection(documentId, ++revision, message.selection === true, rememberSections);
        if (!next || (message.selection && !next.anchor)) return false;
        snapshot = next; dirty = false; lastProjection = Date.now(); rememberPositionNodes(); readingPosition();
        return true;
      })();
      if (isMessage(message, 'action-open')) return (async () => { if (!await permitted()) return false; if (!message.panel) await open(); return true; })();
      if (isMessage(message, 'action-kept')) return Promise.resolve(true);
      if (isMessage(message, 'saved-marks') && validSavedMarks(message)) return (async () => {
        const epoch = markEpoch;
        if (!await permitted()) { clear(); return false; }
        if (epoch !== markEpoch) return false;
        if (!snapshot || message.document !== documentId || message.url !== pageIdentity(location.href) || message.url !== snapshot.capture.url || message.revision !== snapshot.revision) return false;
        const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
        if (!HighlightClass || !highlights) return false;
        const kept: Range[] = [], tinted: Record<HighlightColour, Range[]> = { yellow: [], green: [], blue: [], rose: [] };
        for (const mark of message.marks) {
          const range = locate(mark.anchor);
          if (range) { kept.push(range); if (mark.highlighted) tinted[highlightColour(mark.highlightColour)].push(range); }
        }
        clearMarks();
        const keptPaint = new HighlightClass(...kept) as { priority: number }; keptPaint.priority = 10; highlights.set('marginalia-kept', keptPaint);
        for (const colour of HIGHLIGHT_COLOURS) { const paint = new HighlightClass(...tinted[colour]) as { priority: number }; paint.priority = 20; highlights.set('marginalia-highlighted-' + colour, paint); }
        // Renewed by the live panel; covers abrupt panel destruction where a
        // final cleanup message cannot be delivered by the browser.
        markExpiry = setTimeout(clearMarks, 6000);
        return true;
      })();
      if (isMessage(message, 'activate')) return (async () => {
        if (!await permitted()) return;
        snapshot = captureSelection(documentId, ++revision, false, rememberSections); dirty = false; lastProjection = Date.now(); rememberPositionNodes(); readingPosition();
        if (!message.panel) await open();
        return true;
      })();
      if (isMessage(message, 'snapshot')) return (async () => {
        if (!await permitted() || (snapshot && snapshot.capture.url !== pageIdentity(location.href))) { clear(); return null; }
        if (!snapshot) snapshot = captureSelection(documentId, ++revision, false, rememberSections);
        if (dirty || Date.now() - lastProjection > 5000) {
          const fresh = captureSelection(documentId, revision, false, rememberSections); dirty = false; lastProjection = Date.now();
          if (fresh && snapshot && (fresh.capture.text !== snapshot.capture.text || !sameSections(fresh.sections, snapshot.sections))) { fresh.revision = ++revision; snapshot = fresh; }
          rememberPositionNodes();
          readingPosition();
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
          if (range && HighlightClass) { const paint = new HighlightClass(range) as { priority: number }; paint.priority = 30; highlights?.set('marginalia-selection', paint); }
        }
        return Promise.resolve(true);
      }
    }, respond));
    // Styling a named Custom Highlight never wraps or rewrites source nodes.
    const style = document.createElement('style'); style.textContent = AUTO_ASSIST_CSS + '::highlight(marginalia-selection){background-color:rgba(76,105,180,.18);color:inherit}::highlight(marginalia-kept){text-decoration:underline #d1ad45 2px;text-underline-offset:3px}::highlight(marginalia-highlighted-yellow){background:#f1dfa2;color:#202124}::highlight(marginalia-highlighted-green){background:#cce8cf;color:#202124}::highlight(marginalia-highlighted-blue){background:#d2e4f5;color:#202124}::highlight(marginalia-highlighted-rose){background:#f2d8df;color:#202124}@media(prefers-color-scheme:dark){::highlight(marginalia-highlighted-yellow){background:#5c512b;color:#f4f4f4}::highlight(marginalia-highlighted-green){background:#2e5940;color:#f4f4f4}::highlight(marginalia-highlighted-blue){background:#304f69;color:#f4f4f4}::highlight(marginalia-highlighted-rose){background:#69404c;color:#f4f4f4}}'; document.documentElement.append(style);
    scheduleInstantPage();
    void resumeFromMarker();
    const policyTimer = setInterval(scheduleInstantPage, 15_000);
    ctx.onInvalidated(() => { alive = false; clearInterval(policyTimer); clearTimeout(selectionTimer); clearTimeout(pageTimer); void instantMessage('instant-release').catch(() => {}); clear(); style.remove(); observer.disconnect(); });
  },
});
