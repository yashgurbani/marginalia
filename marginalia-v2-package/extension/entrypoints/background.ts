import { sourceHash } from '../lib/instant-lifecycle.ts';
import { instantWorker } from '../lib/instant-worker.ts';
import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { readReply, respondAsync } from '../lib/respond.ts';
import { HELPER_RECONNECT_ALARM, helperReconnect } from '../lib/helper-reconnect.ts';
import { allowedPage, isMessage, pageIdentity, validAnchor, validSnapshot, validSavedMarks } from '../lib/protocol.ts';
import { liveSourceMatches, requestCaptureIdentity, requireWorkspaceSurface } from '../lib/surface-identity.ts';
import { attachQuote, type QuoteAnchor } from '../../contracts/reader.ts';
import { ReaderJournal } from '../../ui/journal.ts';
import { localPersistence } from '../../ui/persistence.ts';
import { resumeAnchor, validResumeThreadId, type ResumeCheckpoint } from '../../contracts/resume.ts';
import { actionMatches, retainedKeep, sameSelection, selectionAction, validContentAction, validKeepReceipt, KEEP_RECEIPT_LIMIT, KEEP_RECEIPT_BYTES, KEEP_RECEIPT_TTL, type ActionRequest, type SelectionAction, type KeepReceipt } from '../lib/selection-actions.ts';

export default defineBackground(() => {
  const helper = helperReconnect();
  browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === HELPER_RECONNECT_ALARM) void helper.reconnect(); });
  // Pairing credentials and journal are durable in extension-origin IndexedDB.
  // Only the trusted worker transport reads a token; content scripts never do.
  const storageReady = Promise.all([
    browser.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }),
    browser.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
  const panelUrl = browser.runtime.getURL('/panel.html');
  const workspaceUrl = browser.runtime.getURL('/workspace.html');
  const extensionOrigin = browser.runtime.getURL('').replace(/\/$/, '');
  const readerStorage = 'marginalia-extension-reader';
  let readerPersistence: ReturnType<typeof localPersistence> | undefined;
  const getReaderPersistence = () => readerPersistence ??= localPersistence(readerStorage);
  async function pruneKeepReceipts() {
    const values = await browser.storage.session.get(null);
    const receipts: Record<string, KeepReceipt> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith('selection-keep:')) continue;
      if (!validKeepReceipt(value) || value.expires <= Date.now() || new TextEncoder().encode(JSON.stringify(value)).byteLength > KEEP_RECEIPT_BYTES) await browser.storage.session.remove(key);
      else receipts[key] = value;
    }
    return receipts;
  }
  void storageReady.then(() => navigator.locks.request(readerStorage, pruneKeepReceipts)).catch(() => {});
  let excludedCache: string[] | null = null;
  let exclusionEpoch = 0;
  function clearPendingActions() {
    return navigator.locks.request('marginalia-selection-policy', async () => {
      const values = await browser.storage.session.get(null);
      await Promise.all(Object.keys(values).filter(key => key.startsWith('selection-action:') || key.startsWith('selection-keep:')).map(key => browser.storage.session.remove(key)));
    });
  }
  const cachePolicy = (value: unknown) => { excludedCache = Array.isArray(value) && value.every(h => typeof h === 'string') ? value : null; };
  void storageReady.then(async () => { const value = (await browser.storage.local.get('excludedHosts')).excludedHosts ?? []; cachePolicy(value); }).catch(() => { excludedCache = null; });
  browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.excludedHosts) { exclusionEpoch++; void clearPendingActions().catch(() => {}); invalidatePanel(); cachePolicy(changes.excludedHosts.newValue ?? []); void browser.tabs.query({}).then(tabs => Promise.all(tabs.filter(tab => tab.id !== undefined && tab.url && (excludedCache === null || !allowedPage(tab.url, excludedCache))).map(async tab => { await instant.release(tab.id!); await browser.tabs.sendMessage(tab.id!, { type: 'excluded', version: 1 }, { frameId: 0 }).catch(() => {}); }))).catch(() => {}); } });
  function invalidatePanel() {
    void browser.runtime.sendMessage({ type: 'panel-source-pending', version: 1 }).catch(() => {});
  }
  function openNative(tabId: number, url: string, incognito?: boolean): Promise<boolean> {
    if (incognito || !allowedPage(url, excludedCache ?? []) || typeof browser.sidePanel?.open !== 'function') return Promise.resolve(false);
    // Only the neutral shell opens before policy loads; source actions still use permitted().
    try {
      const opening = browser.sidePanel.open({ tabId });
      invalidatePanel();
      return opening.then(() => true).catch(() => false);
    }
    catch { return Promise.resolve(false); }
  }
  async function permitted(url: string, incognito?: boolean) {
    await storageReady;
    const { excludedHosts = [] } = await browser.storage.local.get('excludedHosts');
    cachePolicy(excludedHosts);
    return !incognito && Array.isArray(excludedHosts) && excludedHosts.every(h => typeof h === 'string') && allowedPage(url, excludedHosts);
  }
  const instant = instantWorker(permitted);
  async function source(tabId: number, expectedDocument?: string) {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || !await permitted(tab.url, tab.incognito)) throw new Error('This page is excluded.');
    const before = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!before?.documentId || before.documentLifecycle !== 'active' || (expectedDocument && before.documentId !== expectedDocument)) throw new Error('This page is not active.');
    const data = readReply(await browser.tabs.sendMessage(tabId, { type: 'snapshot', version: 1 }, { documentId: before.documentId, frameId: 0 }));
    const after = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!validSnapshot(data) || before.documentId !== after?.documentId || after.documentLifecycle !== 'active' || pageIdentity(after.url) !== data.capture.url || !await permitted(after.url, tab.incognito)) throw new Error('The page changed. Select the passage again.');
    return { ...data, browserDocument: before.documentId };
  }
  async function runSelectionAction(tabId: number, action: SelectionAction | 'read-later', snapshot: Awaited<ReturnType<typeof source>>, operation: string = crypto.randomUUID()) {
    const epoch = exclusionEpoch;
    const check = async () => {
      const live = await source(tabId, snapshot.browserDocument);
      if (epoch !== exclusionEpoch || !sameSelection(snapshot, live)) throw new Error('The passage changed. Select it again.');
    };
    if (action !== 'read-later' && !snapshot.anchor) throw new Error('Select a passage first.');
    if (action === 'keep') {
      await navigator.locks.request(readerStorage, async () => {
        const key = 'selection-keep:' + tabId;
        const raw = (await browser.storage.session.get(key))[key];
        const receipts = await pruneKeepReceipts(), retained = receipts[key];
        if (validKeepReceipt(raw) && raw.operation === operation && raw.expires <= Date.now()) throw new Error('Stale source request.');
        if (retained?.operation === operation && (retained.snapshot.browserDocument !== snapshot.browserDocument || !sameSelection(retained.snapshot, snapshot))) throw new Error('Stale source request.');
        const attempt: KeepReceipt = retained?.operation === operation ? retained : { operation, threadId: crypto.randomUUID(), snapshot: structuredClone(snapshot), expires: Date.now() + KEEP_RECEIPT_TTL };
        if ((!retained && Object.keys(receipts).length >= KEEP_RECEIPT_LIMIT) || new TextEncoder().encode(JSON.stringify(attempt)).byteLength > KEEP_RECEIPT_BYTES) throw new Error('The source action failed.');
        // Retain the exact mutation payload before trying durable journal storage.
        // A retry needs a fresh trusted gesture but reuses this operation identity.
        await browser.storage.session.set({ [key]: attempt });
        const journal = new ReaderJournal(getReaderPersistence().journal);
        await journal.load();
        await check();
        if (!retainedKeep(journal.state, attempt.snapshot)) await journal.change({ id: operation, kind: 'keep', threadId: attempt.threadId, capture: attempt.snapshot.capture, anchor: attempt.snapshot.anchor! });
        // Keep the bounded, original-deadline receipt across a lost runtime reply.
        // Journal sync can remove the pending capture before a fresh-gesture retry;
        // its acknowledgement still requires this exact thread/capture fingerprint.
      });
      // Same journal and lock as the panel. Saving here never starts helper sync.
      const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(readerStorage) : null;
      channel?.postMessage('changed'); channel?.close();
      return { kept: true };
    }
    await navigator.locks.request('marginalia-selection-policy', async () => {
      await check();
      const request: ActionRequest = { id: crypto.randomUUID(), action, browserDocument: snapshot.browserDocument, snapshot, expires: Date.now() + 30_000 };
      await browser.storage.session.set({ ['selection-action:' + tabId]: request });
      if (epoch !== exclusionEpoch) await browser.storage.session.remove('selection-action:' + tabId);
    });
    return { queued: true };
  }

  const menuPrefix = 'marginalia:';
  async function installMenus() {
    if (!browser.contextMenus) return;
    await navigator.locks.request('marginalia-menus', async () => {
      await browser.contextMenus.removeAll();
      for (const [action, title] of [['keep', 'Keep'], ['note', 'Note'], ['ask', 'Ask'], ['simulate', 'Simulate it'], ['read-later', 'Read later'], ['open', 'Open Marginalia']]) {
        await new Promise<void>((resolve, reject) => {
          browser.contextMenus.create({ id: menuPrefix + action, title, contexts: action === 'read-later' || action === 'open' ? ['page'] : ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] }, () => {
            const error = browser.runtime.lastError;
            if (error) reject(new Error(error.message)); else resolve();
          });
        });
      }
    });
  }
  browser.runtime.onInstalled?.addListener(() => { void installMenus().catch(() => {}); });
  browser.runtime.onStartup?.addListener(() => { void installMenus().catch(() => {}); });
  browser.contextMenus?.onClicked.addListener((info, tab) => {
    const action = String(info.menuItemId).slice(menuPrefix.length);
    if (!String(info.menuItemId).startsWith(menuPrefix) || (!selectionAction(action) && action !== 'read-later' && action !== 'open') ||
      tab?.id === undefined || tab.incognito || !allowedPage(tab.url) || (info.frameId !== undefined && info.frameId !== 0)) return;
    const tabId = tab.id;
    // Keep Chrome's native user gesture: start opening before any awaited work.
    const opening = action === 'keep' ? Promise.resolve(false) : openNative(tabId, tab.url!, tab.incognito);
    void (async () => {
      if (!await permitted(tab.url!, tab.incognito)) return;
      const frame = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
      if (!frame?.documentId || frame.documentLifecycle !== 'active' || pageIdentity(frame.url) !== pageIdentity(tab.url!)) return;
      const captured = readReply(await browser.tabs.sendMessage(tabId, { type: 'action-capture', version: 1, selection: selectionAction(action) }, { documentId: frame.documentId, frameId: 0 }));
      if (captured !== true) return;
      if (action !== 'open') {
        const snapshot = await source(tabId, frame.documentId);
        if (selectionAction(action) && (!info.selectionText || snapshot.anchor?.exact.replace(/\s+/gu, ' ').trim() !== info.selectionText.replace(/\s+/gu, ' ').trim())) return;
        await runSelectionAction(tabId, action, snapshot);
      }
      const panel = await opening;
      readReply(await browser.tabs.sendMessage(tabId, { type: action === 'keep' ? 'action-kept' : 'action-open', version: 1, panel }, { documentId: frame.documentId, frameId: 0 }));
    })().catch(() => {});
  });
  async function resume(tabId: number, expectedDocument: string, threadId: string) {
    const snapshot = await source(tabId, expectedDocument);
    const anchor = await navigator.locks.request(readerStorage, async () => {
      const journal = new ReaderJournal(getReaderPersistence().journal); await journal.load();
      const thread = journal.state.threads.find(value => value.id === threadId);
      const checkpoint = thread?.anchor.kind === 'whole-page'
        ? await getReaderPersistence().read<ResumeCheckpoint>('parked-page-position:' + thread.sourceUrl)
        : undefined;
      return thread ? resumeAnchor(thread, snapshot.capture.url, snapshot.capture.text, checkpoint) : undefined;
    });
    if (!anchor) return { consumed: true, resumed: false };
    const delivered = readReply(await browser.tabs.sendMessage(tabId, { type: 'scroll', version: 1, document: snapshot.document, anchor }, { documentId: snapshot.browserDocument, frameId: 0 })) === true;
    return { consumed: true, resumed: delivered };
  }
  browser.runtime.onMessage.addListener((message, sender, respond) => respondAsync(() => {
    if (sender.id !== browser.runtime.id) return;
    if (sender.url === browser.runtime.getURL('/options.html') && !sender.tab?.incognito && isMessage(message, 'instant-exclusion') && typeof message.host === 'string' && typeof message.excluded === 'boolean') return instant.changeExclusion(message.host, message.excluded);
    const fromContent = sender.tab?.id !== undefined && sender.frameId === 0 && typeof sender.documentId === 'string' && !!sender.url && allowedPage(sender.url) && !sender.tab.incognito;
    if (fromContent && validContentAction(message)) {
      const tabId = sender.tab!.id!, epoch = exclusionEpoch;
      const opening = message.action === 'keep' ? Promise.resolve(false) : openNative(tabId, sender.url!, sender.tab?.incognito);
      return (async () => {
        if (!await permitted(sender.url!, sender.tab?.incognito) || epoch !== exclusionEpoch) return { accepted: false };
        const frame = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
        if (!frame || frame.documentId !== sender.documentId || frame.documentLifecycle !== 'active' || pageIdentity(frame.url) !== pageIdentity(sender.url!)) return { accepted: false };
        // The isolated content script consumes a token minted only by a trusted
        // bar activation. Page messages never mint or claim this authority.
        const claimed = readReply(await browser.tabs.sendMessage(tabId, { ...message, type: 'claim-selection-action' }, { documentId: sender.documentId, frameId: 0 }));
        if (claimed !== true) return { accepted: false };
        const snapshot = await source(tabId, sender.documentId);
        if (epoch !== exclusionEpoch || snapshot.document !== message.document || snapshot.revision !== message.revision || !snapshot.anchor) return { accepted: false };
        const result = await runSelectionAction(tabId, message.action, snapshot, message.operation);
        return { ...result, panel: await opening };
      })();
    }
    if (fromContent && isMessage(message, 'policy')) return permitted(sender.url!, sender.tab?.incognito).then(allowed => ({ allowed }));
    if (fromContent && isMessage(message, 'resume') && typeof message.threadId === 'string') return (async () => {
      if (!validResumeThreadId(message.threadId)) return { consumed: true, resumed: false };
      try { return await resume(sender.tab!.id!, sender.documentId!, message.threadId); }
      catch { return { consumed: true, resumed: false }; }
    })();
    if (fromContent && (isMessage(message, 'auto-assist-candidates') || isMessage(message, 'auto-assist-open') || isMessage(message, 'auto-assist-dismiss'))) return (async () => {
      const tabId = sender.tab!.id!, snapshot = await source(tabId, sender.documentId);
      if (!(await instant.autoAssistPolicy(snapshot.capture.url, sender.tab?.incognito, snapshot.capture.pageType)).enabled) return;
      if (message.type === 'auto-assist-candidates' && Array.isArray(message.visibleIds) && message.visibleIds.length <= 30 && message.visibleIds.every(id => typeof id === 'string')) {
        void instant.autoCandidates(tabId, snapshot, message.candidates, message.visibleIds as string[]).catch(() => {}); return { accepted: true };
      }
      if (message.type === 'auto-assist-dismiss' && typeof message.candidateId === 'string' && await instant.autoStatus(tabId, snapshot)) return instant.autoDismiss(tabId, message.candidateId);
      if (message.type === 'auto-assist-open' && typeof message.candidateId === 'string' && await instant.autoStatus(tabId, snapshot)) return { opened: await instant.autoFocus(tabId, message.candidateId) };
    })();
    if (fromContent && isMessage(message, 'auto-assist-page-policy')) return source(sender.tab!.id!, sender.documentId).then(snapshot => instant.autoAssistPolicy(snapshot.capture.url, sender.tab?.incognito, snapshot.capture.pageType));
    if (fromContent && isMessage(message, 'auto-assist-policy')) return instant.autoAssistPolicy(sender.url!, sender.tab?.incognito);
    if (fromContent && isMessage(message, 'instant-policy')) return instant.policy(sender.url!, sender.tab?.incognito).then(allowed => ({ allowed }));
    if (fromContent && (isMessage(message, 'instant-page') || isMessage(message, 'instant-selection') || isMessage(message, 'instant-release'))) return (async () => {
      const tabId = sender.tab!.id!;
      const frame = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
      if (frame?.documentId !== sender.documentId) return;
      if (message.type === 'instant-release') { await instant.release(tabId); return; }
      if (!await instant.policy(sender.url!, sender.tab?.incognito)) { await instant.release(tabId); return; }
      const snapshot = await source(tabId, sender.documentId);
      if (message.type === 'instant-selection' && typeof message.selectionId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(message.selectionId)) {
        void instant.select(tabId, snapshot, message.selectionId).catch(() => {});
      } else await instant.prepare(tabId, snapshot);
      return { accepted: true };
    })();
    if (fromContent && isMessage(message, 'open')) {
      const tabId = sender.tab!.id!;
      // Chrome requires the API call within the gesture's message task.
      const opening = openNative(tabId, sender.url!, sender.tab?.incognito);
      return (async () => {
        if (!await permitted(sender.url!, sender.tab?.incognito)) return { allowed: false };
        const active = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
        if (active?.documentId !== sender.documentId || active?.documentLifecycle !== 'active') return { allowed: false };
        if (await opening) return { allowed: true, panel: true };
        return navigator.locks.request('marginalia-frame:' + tabId, async () => {
          const current = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
          if (current?.documentId !== sender.documentId || current?.documentLifecycle !== 'active') return { allowed: false };
          const key = 'frame:' + tabId;
          const old = (await browser.storage.session.get(key))[key] as { capability: string; document: string; url: string; frameDocument: string | null } | undefined;
          const frames = await browser.webNavigation.getAllFrames({ tabId });
          if (old && old.document === sender.documentId && old.url === pageIdentity(sender.url!) && (!old.frameDocument || frames?.some(frame => frame.documentId === old.frameDocument && frame.documentLifecycle === 'active'))) return { allowed: true, panel: false, capability: old.capability };
          const capability = crypto.randomUUID();
          await browser.storage.session.set({ [key]: { capability, document: sender.documentId, url: pageIdentity(sender.url!), frameDocument: null } });
          return { allowed: true, panel: false, capability };
        });
      })();
    }
    const senderPath = sender.url?.split(/[?#]/)[0];
    const trustedPanel = senderPath === panelUrl || senderPath === workspaceUrl;
    if (!trustedPanel || !isMessage(message, 'surface')) return;
    return (async () => {
      let tabId!: number;
      let sourceDocument: string | undefined;
      let embedded = false;
      if (senderPath === workspaceUrl) {
        if (typeof message.workspace !== 'string' || !/^[0-9a-f-]{36}$/.test(message.workspace) || sender.url !== workspaceUrl + '#workspace=' + message.workspace || !sender.documentId || sender.frameId !== 0 || sender.tab?.id === undefined || sender.tab.incognito) throw new Error('Open this margin from the source.');
        const key = 'workspace:' + message.workspace;
        await navigator.locks.request(key, async () => {
          const binding = (await browser.storage.session.get(key))[key] as { tabId: number; sourceDocument: string; url: string; surfaceTab: number; surfaceDocument?: string } | undefined;
          if (!binding || binding.surfaceTab !== sender.tab!.id) throw new Error('Reopen this margin from the source.');
          await requireWorkspaceSurface(
            { tabId: sender.tab?.id, documentId: sender.documentId, documentLifecycle: sender.documentLifecycle, url: sender.url, origin: sender.origin, frameId: sender.frameId, incognito: sender.tab?.incognito },
            binding.surfaceTab,
            workspaceUrl + '#workspace=' + message.workspace,
            extensionOrigin,
            filter => browser.runtime.getContexts({ contextTypes: ['TAB'], documentIds: filter.documentIds, tabIds: filter.tabIds }),
            surfaceTab => browser.tabs.get(surfaceTab),
          );
          const frame = await browser.webNavigation.getFrame({ tabId: binding.tabId, frameId: 0 });
          if (!liveSourceMatches(frame, binding.sourceDocument, binding.url) || !await permitted(frame!.url)) throw new Error('The source changed. Reopen the margin from that page.');
          tabId = binding.tabId;
          sourceDocument = binding.sourceDocument;
          if (binding.surfaceDocument !== sender.documentId) await browser.storage.session.set({ [key]: { ...binding, surfaceDocument: sender.documentId } });
        });
      } else if (sender.tab?.id !== undefined) {
        embedded = true;
        tabId = sender.tab.id;
        const key = 'frame:' + tabId, stored = (await browser.storage.session.get(key))[key] as { capability: string; document: string; url: string; frameDocument: string | null } | undefined;
        if (!stored || stored.capability !== message.capability || sender.frameId === 0 || !sender.documentId || (stored.frameDocument && stored.frameDocument !== sender.documentId)) throw new Error('Open the margin from the page.');
        sourceDocument = stored.document;
        const tab = await browser.tabs.get(tabId);
        if (!tab.url || pageIdentity(tab.url) !== stored.url || !await permitted(tab.url, tab.incognito)) throw new Error('This page is excluded or changed.');
        // Target the stored browser document and recheck it after the content
        // capture identity reply. The two IDs intentionally do not match.
        await requestCaptureIdentity(
          stored.document,
          () => browser.webNavigation.getFrame({ tabId, frameId: 0 }),
          async browserDocument => readReply(await browser.tabs.sendMessage(tabId, { type: 'identity', version: 1 }, { documentId: browserDocument, frameId: 0 })),
        );
        await navigator.locks.request('marginalia-frame:' + tabId, async () => {
          const latest = (await browser.storage.session.get(key))[key] as typeof stored;
          if (!latest || latest.capability !== message.capability || latest.document !== stored.document || (latest.frameDocument && latest.frameDocument !== sender.documentId)) throw new Error('Reopen the margin.');
          if (!latest.frameDocument) await browser.storage.session.set({ [key]: { ...latest, frameDocument: sender.documentId } });
        });
      } else {
        if (!sender.documentId) throw new Error('Open the native margin.');
        const contexts = await browser.runtime.getContexts({ contextTypes: ['SIDE_PANEL'], documentIds: [sender.documentId] });
        const context = contexts.find(c => c.documentId === sender.documentId && c.documentUrl === panelUrl && c.windowId >= 0);
        if (!context || context.incognito) throw new Error('Open the native margin.');
        const [tab] = await browser.tabs.query({ active: true, windowId: context.windowId });
        if (tab?.id === undefined || !tab.url || !await permitted(tab.url, tab.incognito)) throw new Error('Choose a supported page.');
        tabId = tab.id;
      }
      if (['auto-assist-status', 'auto-assist-open', 'auto-assist-dismiss'].includes(String(message.action))) {
        const snapshot = await source(tabId, sourceDocument);
        const state = await instant.autoStatus(tabId, snapshot);
        if (message.action === 'auto-assist-status') return state;
        if (!state || typeof message.candidateId !== 'string') throw new Error('Stale source request.');
        if (message.action === 'auto-assist-open') return { opened: await instant.autoFocus(tabId, message.candidateId) };
        return readReply(await browser.tabs.sendMessage(tabId, { type: 'auto-assist-dismiss', version: 1, candidateId: message.candidateId }, { documentId: snapshot.browserDocument, frameId: 0 }));
      }
      if (message.action === 'instant-status') { const snapshot = await source(tabId, sourceDocument); const state = await instant.status(tabId); return state?.document === snapshot.browserDocument && state.url === snapshot.capture.url && state.sourceHash === await sourceHash(snapshot.capture.text) && (!state.selectionText || state.selectionText === snapshot.anchor?.exact) ? { ...state, document: snapshot.document } : null; }
      if (message.action === 'instant-settings') return instant.settings();
      if (message.action === 'instant-save-settings') return instant.saveSettings(message.change);
      if (message.action === 'instant-usage') return instant.usage();
      if (message.action === 'instant-forget') {
        const snapshot = await source(tabId, sourceDocument), state = await instant.status(tabId);
        if (!state?.pageId || message.pageId !== state.pageId || state.document !== snapshot.browserDocument || state.url !== snapshot.capture.url || state.sourceHash !== await sourceHash(snapshot.capture.text)) throw new Error('Stale source request.');
        return instant.forget(tabId, state.pageId);
      }
      if (message.action === 'read') return source(tabId, sourceDocument);
      if (message.action === 'dismiss-selection-bar') {
        const snapshot = await source(tabId, sourceDocument);
        return readReply(await browser.tabs.sendMessage(tabId, { type: 'selection-bar-dismiss', version: 1, document: snapshot.document }, { documentId: snapshot.browserDocument, frameId: 0 }));
      }
      if (message.action === 'take-selection-action') return navigator.locks.request('marginalia-selection-policy', async () => {
        const epoch = exclusionEpoch;
        const key = 'selection-action:' + tabId;
        const request = (await browser.storage.session.get(key))[key] as ActionRequest | undefined;
        if (!request) return null;
        // Consume before dispatch. A gate refusal or interrupted mount is never replayed.
        await browser.storage.session.remove(key);
        const snapshot = await source(tabId, sourceDocument);
        return epoch === exclusionEpoch && actionMatches(request, snapshot.browserDocument, snapshot) ? request : null;
      });
      if (message.action === 'trusted-open') {
        const frame = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
        if (!frame?.documentId || !await permitted(frame.url)) throw new Error('This source is unavailable.');
        const workspace = crypto.randomUUID();
        const tab = await browser.tabs.create({ url: workspaceUrl + '#workspace=' + workspace });
        await browser.storage.session.set({ ['workspace:' + workspace]: { tabId, sourceDocument: frame.documentId, url: pageIdentity(frame.url), surfaceTab: tab.id } });
        return { opened: true };
      }
      if (message.action === 'helper-status') return { status: embedded ? 'Connect the local helper in the browser margin.' : await helper.status(), enabled: !embedded && await helper.isEnabled() };
      if (message.action === 'helper-connect' && !embedded) return { status: await helper.setEnabled(true), enabled: true };
      if (message.action === 'helper-disconnect' && !embedded) return { status: await helper.setEnabled(false), enabled: false };
      if (message.action === 'authorize-helper-send' && !embedded && typeof message.sourceUrl === 'string') return { allowed: await permitted(message.sourceUrl) };
      if (message.action === 'exclude') {
        const snapshot = await source(tabId, sourceDocument);
        await instant.changeExclusion(new URL(snapshot.capture.url).hostname, true);
        readReply(await browser.tabs.sendMessage(tabId, { type: 'excluded', version: 1 }, { frameId: 0 }));
        return { excluded: true };
      }
      if ((message.action === 'highlight' || message.action === 'scroll') && typeof message.document === 'string' && (message.anchor === null || validAnchor(message.anchor))) {
        const snapshot = await source(tabId, sourceDocument);
        if (snapshot.document !== message.document) throw new Error('Stale source request.');
        if (message.anchor !== null && message.anchor.kind !== 'whole-page') {
          const attachment = attachQuote(message.anchor as QuoteAnchor, snapshot.capture.text);
          if (!['exact', 'moved'].includes(attachment.state) || attachment.candidates.length !== 1) throw new Error('This passage could not be located safely on the current page.');
        }
        if (readReply(await browser.tabs.sendMessage(tabId, { type: message.action, version: 1, document: snapshot.document, anchor: message.anchor }, { documentId: snapshot.browserDocument, frameId: 0 })) !== true) throw new Error('The source action failed.');
        return { ok: true };
      }
      if (message.action === 'saved-marks' && validSavedMarks(message)) {
        const snapshot = await source(tabId, sourceDocument);
        if (snapshot.document !== message.document || snapshot.capture.url !== message.url || snapshot.revision !== message.revision) throw new Error('Stale source request.');
        const marks = message.marks.map(({ anchor, highlighted, highlightColour }) => ({ anchor: { kind: anchor.kind, exact: anchor.exact, prefix: anchor.prefix, suffix: anchor.suffix, start: anchor.start, end: anchor.end }, highlighted, ...(highlightColour !== undefined ? { highlightColour } : {}) }));
        if (readReply(await browser.tabs.sendMessage(tabId, { type: 'saved-marks', version: 1, document: snapshot.document, url: message.url, revision: message.revision, marks }, { documentId: snapshot.browserDocument, frameId: 0 })) !== true) throw new Error('The source action failed.');
        return { ok: true };
      }
      throw new Error('Unsupported margin request.');
    })();
  }, respond));
  browser.action.onClicked.addListener(tab => {
    if (tab.id === undefined || tab.incognito || !allowedPage(tab.url)) return;
    const tabId = tab.id;
    const opening = openNative(tabId, tab.url!, tab.incognito);
    void permitted(tab.url!, tab.incognito).then(async allowed => {
      if (!allowed) return;
      const panel = await opening;
      readReply(await browser.tabs.sendMessage(tabId, { type: 'activate', version: 1, panel }, { frameId: 0 }));
    }).catch(() => {});
  });
  browser.tabs.onActivated?.addListener(() => { invalidatePanel(); });
  type WorkspaceBinding = { tabId: number; url: string; surfaceTab: number };
  async function removeWorkspaces(tabId: number, url?: string) {
    const session = await browser.storage.session.get(null);
    await Promise.all(Object.keys(session).filter(key => key.startsWith('workspace:')).map(key => navigator.locks.request(key, async () => {
      const binding = (await browser.storage.session.get(key))[key] as WorkspaceBinding | undefined;
      const sourceChanged = binding?.tabId === tabId && url !== undefined && binding.url !== pageIdentity(url);
      const surfaceChanged = binding?.surfaceTab === tabId && url !== undefined && pageIdentity(url) !== pageIdentity(workspaceUrl);
      if (binding && ((url === undefined && (binding.tabId === tabId || binding.surfaceTab === tabId)) || sourceChanged || surfaceChanged)) await browser.storage.session.remove(key);
    })));
  }
  browser.tabs.onRemoved.addListener(tabId => {
    void browser.storage.session.remove('selection-keep:' + tabId);
    void browser.storage.session.remove('selection-action:' + tabId);
    void instant.release(tabId);
    void navigator.locks.request('marginalia-frame:' + tabId, () => browser.storage.session.remove('frame:' + tabId));
    void removeWorkspaces(tabId);
  });
  browser.webNavigation.onHistoryStateUpdated?.addListener(details => {
    if (details.frameId !== 0) return;
    invalidatePanel();
    void browser.storage.session.remove('selection-keep:' + details.tabId);
    void browser.storage.session.remove('selection-action:' + details.tabId);
    void instant.release(details.tabId).then(() => browser.tabs.sendMessage(details.tabId, { type: 'instant-navigation', version: 1 }, { frameId: 0 })).catch(() => {});
  });
  browser.webNavigation.onCommitted.addListener(details => {
    if (details.frameId === 0) {
      invalidatePanel();
      void browser.storage.session.remove('selection-keep:' + details.tabId);
      void browser.storage.session.remove('selection-action:' + details.tabId);
      void instant.release(details.tabId);
      void navigator.locks.request('marginalia-frame:' + details.tabId, () => browser.storage.session.remove('frame:' + details.tabId));
      void removeWorkspaces(details.tabId, details.url);
    }
  });
});
