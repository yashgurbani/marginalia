import { instantTextToReply } from '../../contracts/instant.ts';
import type { AutoAssistPosture } from '../../contracts/auto-assist.ts';
import type { QuoteAnchor } from '../../contracts/reader.ts';
import { sourceHash } from './instant-lifecycle.ts';
export type ReadyTerm = { candidateId: string; term: string; normalizedTerm: string; anchor: QuoteAnchor; state: 'suggested' | 'preparing' | 'ready' | 'paused-at-limit'; definition?: string; request?: 'pending' | 'unknown' | 'done' | 'paused'; budgetEpoch?: string; dismissOperation?: string; dismissObservedAt?: string };
export type ReadyPage = { document: string; url: string; sourceHash: string; pageId: string; posture: AutoAssistPosture; items: ReadyTerm[]; focused?: string };
export type ReadySource = Omit<ReadyPage, 'items' | 'focused'> & { text: string; pageType?: string };
export type ReadyDependencies = {
  read(tab: number): Promise<ReadyPage | undefined>;
  write(tab: number, page: ReadyPage | undefined): Promise<void>;
  allowed(tab: number, source: ReadySource): Promise<boolean>;
  prepare(pageId: string, terms: { candidateId: string; term: string; normalizedTerm: string; start: number; end: number; contextHash: string }[]): Promise<unknown>;
  dismiss(pageId: string, term: ReadyTerm): Promise<void>;
  budgetEpoch(): string | undefined;
};
export function readyTerms(value: unknown, text: string): ReadyTerm[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('Invalid ready help candidates.');
  const ids = new Set<string>();
  return value.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid ready help candidate.');
    const item = value as { candidateId?: unknown; term?: unknown; start?: unknown; end?: unknown };
    if (typeof item.candidateId !== 'string' || !item.candidateId || item.candidateId.length > 256 || ids.has(item.candidateId) || typeof item.term !== 'string' || !item.term.trim() || item.term.length > 128 || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end)) throw new Error('Invalid ready help candidate.');
    const start = item.start as number, end = item.end as number;
    if (start < 0 || end <= start || end > text.length || text.slice(start, end) !== item.term) throw new Error('The ready help source changed.');
    ids.add(item.candidateId);
    return { candidateId: item.candidateId, term: item.term, normalizedTerm: item.term.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase(), state: 'suggested', anchor: { kind: 'quote', exact: item.term, start, end, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) } };
  });
}
const same = (page: ReadyPage | undefined, source: ReadySource) => page?.pageId === source.pageId && page.document === source.document && page.url === source.url && page.sourceHash === source.sourceHash;
/** Caller serializes updates per tab. Request intent survives disposable worker restarts. */
export function createReadyHelp(deps: ReadyDependencies) {
  return {
    async update(tab: number, source: ReadySource, candidates: unknown, visibleIds: string[]) {
      if (!await deps.allowed(tab, source)) { await deps.write(tab, undefined); return; }
      const previous = await deps.read(tab), terms = readyTerms(candidates, source.text), epoch = deps.budgetEpoch();
      const items = terms.map(term => same(previous, source) ? previous!.items.find(old => old.candidateId === term.candidateId && old.term === term.term && old.anchor.start === term.anchor.start) ?? term : term);
      for (const item of items) if (item.request === 'pending') { item.request = 'unknown'; item.state = 'suggested'; }
      const page: ReadyPage = { document: source.document, url: source.url, sourceHash: source.sourceHash, pageId: source.pageId, posture: source.posture, items, ...(same(previous, source) ? { focused: previous?.focused } : {}) };
      const pending = items.filter(item => visibleIds.includes(item.candidateId) && (!item.request || item.request === 'paused' && !!epoch && item.budgetEpoch !== epoch)).slice(0, 3);
      for (const item of pending) { item.state = 'preparing'; item.request = 'pending'; item.budgetEpoch = epoch; }
      await deps.write(tab, page);
      if (!pending.length) return;
      const termsToSend = await Promise.all(pending.map(async item => ({ candidateId: item.candidateId, term: item.term, normalizedTerm: item.normalizedTerm, start: item.anchor.start, end: item.anchor.end, contextHash: await sourceHash(source.text.slice(Math.max(0, item.anchor.start - 200), item.anchor.end + 200)) })));
      if (!await deps.allowed(tab, source) || !same(await deps.read(tab), source)) return;
      try {
        const value = await deps.prepare(source.pageId, termsToSend) as { state?: string; definitions?: unknown[] };
        const latest = await deps.read(tab);
        if (!same(latest, source) || !await deps.allowed(tab, source)) return;
        if (!value || !['ready', 'stale', 'off', 'excluded', 'paused-at-limit'].includes(value.state ?? '') || !Array.isArray(value.definitions) || value.definitions.length > 30) throw new Error('Invalid prepared definitions.');
        if (['stale', 'off', 'excluded'].includes(value.state!)) { await deps.write(tab, undefined); return; }
        for (const requested of pending) {
          const item = latest!.items.find(term => term.candidateId === requested.candidateId); if (!item) continue;
          const raw = value.definitions.find(raw => !!raw && typeof raw === 'object' && (raw as { candidateId?: unknown }).candidateId === item.candidateId) as { text?: unknown } | undefined;
          if (typeof raw?.text === 'string') { try { item.definition = instantTextToReply(raw.text).summary; item.state = 'ready'; item.request = 'done'; continue; } catch { /* Untrusted text is never mounted. */ } }
          item.state = value.state === 'paused-at-limit' ? 'paused-at-limit' : 'suggested'; item.request = value.state === 'paused-at-limit' ? 'paused' : 'unknown';
        }
        await deps.write(tab, latest);
      } catch {
        const latest = await deps.read(tab); if (!same(latest, source)) return;
        for (const item of latest!.items) if (pending.some(term => term.candidateId === item.candidateId)) { item.state = 'suggested'; item.request = 'unknown'; }
        await deps.write(tab, latest);
      }
    },
    async focus(tab: number, candidateId: string) {
      const page = await deps.read(tab); if (!page?.items.some(item => item.candidateId === candidateId)) return false;
      page.focused = candidateId; await deps.write(tab, page); return true;
    },
    async dismiss(tab: number, candidateId: string) {
      const page = await deps.read(tab), term = page?.items.find(item => item.candidateId === candidateId);
      if (!page || !term) throw new Error('This ready help item changed.');
      term.dismissOperation ??= crypto.randomUUID(); term.dismissObservedAt ??= new Date().toISOString(); await deps.write(tab, page);
      await deps.dismiss(page.pageId, term);
      const latest = await deps.read(tab);
      if (latest?.pageId === page.pageId && latest.sourceHash === page.sourceHash) { latest.items = latest.items.filter(item => item.normalizedTerm !== term.normalizedTerm); await deps.write(tab, latest); }
      return term.term;
    },
  };
}
