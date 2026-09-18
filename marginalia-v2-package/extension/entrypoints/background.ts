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
  let excludedCache: string[] | null = null;
  const cachePolicy = (value: unknown) => { excludedCache = Array.isArray(value) && value.every(h => typeof h === 'string') ? value : null; };
  void storageReady.then(async () => { const value = (await browser.storage.local.get('excludedHosts')).excludedHosts ?? []; cachePolicy(value); }).catch(() => { excludedCache = null; });
  browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.excludedHosts) { cachePolicy(changes.excludedHosts.newValue ?? []); void browser.tabs.query({}).then(tabs => Promise.all(tabs.filter(tab => tab.id !== undefined && tab.url && (excludedCache === null || !allowedPage(tab.url, excludedCache))).map(async tab => { await instant.release(tab.id!); await browser.tabs.sendMessage(tab.id!, { type: 'excluded', version: 1 }, { frameId: 0 }).catch(() => {}); }))).catch(() => {}); } });
  function openNative(tabId: number, url: string, incognito?: boolean): Promise<boolean> {
    if (excludedCache === null || incognito || !allowedPage(url, excludedCache) || typeof browser.sidePanel?.open !== 'function') return Promise.resolve(false);
    try { return browser.sidePanel.open({ tabId }).then(() => true).catch(() => false); }
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
    void instant.release(tabId);
    void navigator.locks.request('marginalia-frame:' + tabId, () => browser.storage.session.remove('frame:' + tabId));
    void removeWorkspaces(tabId);
  });
  browser.webNavigation.onHistoryStateUpdated?.addListener(details => {
    if (details.frameId !== 0) return;
    void instant.release(details.tabId).then(() => browser.tabs.sendMessage(details.tabId, { type: 'instant-navigation', version: 1 }, { frameId: 0 })).catch(() => {});
  });
  browser.webNavigation.onCommitted.addListener(details => {
    if (details.frameId === 0) {
      void instant.release(details.tabId);
      void navigator.locks.request('marginalia-frame:' + details.tabId, () => browser.storage.session.remove('frame:' + details.tabId));
      void removeWorkspaces(details.tabId, details.url);
    }
  });
});
