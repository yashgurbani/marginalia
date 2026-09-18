import { instantReadRequest } from './instant-read-request.ts';
import { ambientAssistanceAllowed } from './ambient-policy.ts';
import { createReadyHelp, type ReadyPage, type ReadySource } from './auto-assist-bridge.ts';
import type { AutoAssistPosture } from '../../contracts/auto-assist.ts';
import { stopExcluding, validExclusionHost } from './instant-exclusions.ts';
import { browser } from 'wxt/browser';
import { localPersistence } from '../../ui/persistence.ts';
import { HelperClient } from '../../ui/helper.ts';
import { helperOrigin } from './helper-origin.ts';
import { allowedPage, pageIdentity, type Snapshot } from './protocol.ts';
import { createInstantLifecycle, instantEvents, sourceHash, type InstantPage, type InstantSource } from './instant-lifecycle.ts';

export function instantWorker(permitted: (url: string, incognito?: boolean) => Promise<boolean>) {
  let persistence: ReturnType<typeof localPersistence> | undefined;
  let budgetEpoch: string | undefined;
  const key = (tab: number) => 'instant-page:' + tab;
  async function connection() {
    const origin = await helperOrigin();
    persistence ??= localPersistence('marginalia-extension-reader');
    const pairing = await persistence.read<{ origin: string; token: string }>('pairing');
    if (pairing?.origin !== origin || !/^[A-Za-z0-9_-]{43}$/.test(pairing.token)) throw new Error('Pair with the local helper.');
    const client = new HelperClient(origin); client.token = pairing.token; return client;
  }
  async function request(path: string, body?: unknown, signal?: AbortSignal) {
    const client = await connection();
    ({ path, body } = instantReadRequest(path, body));
    return fetch(client.origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${client.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', signal: signal ?? AbortSignal.timeout(120_000) });
  }
  async function json(path: string, body?: unknown) { const response = await request(path, body); if (!response.ok) throw new Error('Instant help is unavailable.'); return response.json(); }
  async function policy(url: string, incognito?: boolean, requireInstant = true): Promise<boolean> {
    if (!await permitted(url, incognito)) return false;
    return navigator.locks.request('instant-policy', async () => {
      const local = (await browser.storage.local.get('excludedHosts')).excludedHosts;
      if (local !== undefined && (!Array.isArray(local) || !local.every(host => typeof host === 'string'))) return false;
      const remote = await json('/api/instant/policy', { excludedHosts: local ?? [] });
      if (!Array.isArray(remote?.excludedHosts) || !remote.excludedHosts.every((host: unknown) => typeof host === 'string')) return false;
      budgetEpoch = typeof remote.budgetEpoch === 'string' && remote.budgetEpoch.length <= 200 ? remote.budgetEpoch : undefined;
      const hosts = [...new Set([...(local ?? []) as string[], ...remote.excludedHosts as string[]])];
      if (hosts.length !== (local ?? []).length) await browser.storage.local.set({ excludedHosts: hosts });
      return allowedPage(url, hosts) && await permitted(url, incognito) && (!requireInstant || remote.settings?.enabled === true);
    }).catch(() => false);
  }
  async function allowed(tabId: number, source: InstantSource) {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    const frame = await browser.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
    return !!tab && frame?.documentId === source.document && frame.documentLifecycle === 'active' && pageIdentity(frame.url) === source.url && await policy(frame.url, tab.incognito);
  }
  const lifecycle = createInstantLifecycle({
    read: async tab => (await browser.storage.session.get(key(tab)))[key(tab)] as InstantPage | undefined,
    write: async (tab, value) => { if (value) await browser.storage.session.set({ [key(tab)]: value }); else await browser.storage.session.remove(key(tab)); },
    allowed,
    budgetEpoch: () => budgetEpoch,
    prepare: async (tab, source) => {
      const browserInstanceId = await navigator.locks.request('instant-browser-id', async () => {
        const old = (await browser.storage.session.get('instant-browser-id'))['instant-browser-id'];
        if (typeof old === 'string') return old;
        const id = crypto.randomUUID(); await browser.storage.session.set({ 'instant-browser-id': id }); return id;
      });
      if (!await allowed(tab, source)) throw new Error('Source changed.');
      return json('/api/instant/prepare', { browserInstanceId, tabId: String(tab), documentId: source.document, url: source.url, sourceHash: source.sourceHash, text: source.text });
    },
    select: async function* (pageId, selectionId, text, signal) { yield* instantEvents(await request('/api/instant/select', { pageId, selectionId, text }, signal)); },
    release: async pageId => { await json('/api/instant/release', { pageId }); },
  });
  async function source(snapshot: Snapshot & { browserDocument: string }): Promise<InstantSource> { return { document: snapshot.browserDocument, url: snapshot.capture.url, sourceHash: await sourceHash(snapshot.capture.text), text: snapshot.capture.text }; }
  async function autoAssistPolicy(url: string, incognito?: boolean, pageType?: string) {
    if (!await policy(url, incognito, false)) return { enabled: false };
    try {
      if (pageType !== undefined && !await ambientAssistanceAllowed(url, pageType, json)) return { enabled: false };
      const settings = await json('/api/settings/auto-assist');
      if (settings?.autoAssist?.enabled !== true || !['flow', 'balanced', 'learning'].includes(settings.autoAssist.posture)) return { enabled: false };
      const result = await json('/api/vocabulary');
      if (!Array.isArray(result?.vocabulary)) return { enabled: false };
      return { enabled: true, posture: settings.autoAssist.posture as AutoAssistPosture, vocabulary: result.vocabulary.slice(0, 10_000).map((entry: { term?: unknown }) => entry.term).filter((term: unknown) => typeof term === 'string') };
    } catch { return { enabled: false }; }
  }
  const readyKey = (tab: number) => 'auto-assist-ready:' + tab;
  const readReady = async (tab: number) => (await browser.storage.session.get(readyKey(tab)))[readyKey(tab)] as ReadyPage | undefined;
  const ready = createReadyHelp({ read: readReady,
    write: async (tab, value) => { if (value) await browser.storage.session.set({ [readyKey(tab)]: value }); else await browser.storage.session.remove(readyKey(tab)); },
    allowed: async (tab, source: ReadySource) => {
      const frame = await browser.webNavigation.getFrame({ tabId: tab, frameId: 0 }).catch(() => null);
      return frame?.documentId === source.document && frame.documentLifecycle === 'active' && pageIdentity(frame.url) === source.url && (await autoAssistPolicy(frame.url, undefined, source.pageType ?? 'Unknown')).enabled;
    },
    budgetEpoch: () => budgetEpoch,
    prepare: (pageId, terms) => json('/api/instant/definitions/prepare', { pageId, terms }),
    dismiss: async (pageId, term) => {
      const client = await connection();
      await client.observeVocabulary({ operationId: term.dismissOperation!, term: term.term, origin: 'stated', observedAt: term.dismissObservedAt!, source: { kind: 'reader' } });
      if (pageId) await json('/api/instant/definitions/dismiss', { pageId, normalizedTerm: term.normalizedTerm });
    },
  });
  return {
    policy,
    settings: () => json('/api/instant/settings'),
    saveSettings: (change: unknown) => json('/api/instant/settings', change),
    usage: () => json('/api/instant/usage', {}),
    async forget(tab: number, pageId: string) {
      if (!await lifecycle.suppress(tab, pageId)) throw new Error('Stale source request.');
      await browser.storage.session.remove(readyKey(tab));
      const result = await json('/api/instant/forget', { pageId });
      if (result?.forgotten !== true) throw new Error('Forgetting this page remains unconfirmed.');
      const page = (await browser.storage.session.get(key(tab)))[key(tab)] as InstantPage | undefined;
      if (page?.pageId === pageId && page.state === 'off') await browser.storage.session.set({ [key(tab)]: { ...page, pageId: undefined } });
      return result;
    },
    async changeExclusion(host: string, excluded: boolean) {
      if (!validExclusionHost(host)) throw new Error('Invalid exclusion host.');
      return navigator.locks.request('instant-policy', async () => {
        const read = async () => {
          const value = (await browser.storage.local.get('excludedHosts')).excludedHosts ?? [];
          if (!Array.isArray(value) || !value.every(validExclusionHost)) throw new Error('Invalid exclusion policy.');
          return value as string[];
        };
        const write = async (hosts: string[]) => { await browser.storage.local.set({ excludedHosts: hosts }); };
        if (excluded) { await write([...new Set([...(await read()), host])]); return { excluded: true }; }
        return stopExcluding({ read, write,
          sync: hosts => json('/api/instant/policy', { excludedHosts: hosts }),
          unexclude: (host, expectedRevision) => json('/api/instant/policy/unexclude', { host, expectedRevision }),
        }, host);
      });
    },
    autoAssistPolicy,
    async prepare(tab: number, snapshot: Snapshot & { browserDocument: string }) { return lifecycle.prepare(tab, await source(snapshot)); },
    async select(tab: number, snapshot: Snapshot & { browserDocument: string }, selectionId: string) { if (snapshot.anchor?.exact) await lifecycle.select(tab, await source(snapshot), selectionId, snapshot.anchor.exact); },
    async release(tab: number) { await browser.storage.session.remove(readyKey(tab)); await lifecycle.release(tab); },
    async autoCandidates(tab: number, snapshot: Snapshot & { browserDocument: string }, candidates: unknown, visibleIds: string[]) {
      const enabled = await autoAssistPolicy(snapshot.capture.url, undefined, snapshot.capture.pageType); if (!enabled.enabled || !enabled.posture) { await browser.storage.session.remove(readyKey(tab)); return; }
      const captured = await source(snapshot), page = (await browser.storage.session.get(key(tab)))[key(tab)] as InstantPage | undefined;
      const pageId = page?.sourceHash === captured.sourceHash && page.document === captured.document && page.state === 'ready' ? page.pageId ?? '' : '';
      await navigator.locks.request('auto-assist-update:' + tab, () => ready.update(tab, { ...captured, pageType: snapshot.capture.pageType, pageId, posture: enabled.posture! }, candidates, pageId ? visibleIds : []));
    },
    async autoStatus(tab: number, snapshot: Snapshot & { browserDocument: string }) {
      if (!(await autoAssistPolicy(snapshot.capture.url, undefined, snapshot.capture.pageType)).enabled) { await browser.storage.session.remove(readyKey(tab)); return null; }
      const page = await readReady(tab);
      if (!page || page.document !== snapshot.browserDocument || page.url !== snapshot.capture.url || page.sourceHash !== await sourceHash(snapshot.capture.text)) return null;
      return { ...page, document: snapshot.document };
    },
    autoFocus: ready.focus,
    async autoDismiss(tab: number, candidateId: string) {
      const term = await ready.dismiss(tab, candidateId);
      await browser.tabs.sendMessage(tab, { type: 'auto-assist-familiar', version: 1, term }, { frameId: 0 }).catch(() => {});
      return { dismissed: true };
    },
    async status(tab: number) { return (await browser.storage.session.get(key(tab)))[key(tab)] as InstantPage | undefined; },
  };
}
