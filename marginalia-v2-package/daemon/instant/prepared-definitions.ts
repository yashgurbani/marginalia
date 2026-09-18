import { createHash } from 'node:crypto';
import { instantTextToReply, type InstantUsageTotals } from '../../contracts/instant.ts';
import type { CandidateReply } from '../../contracts/reply.ts';
export type PreparedTerm = { candidateId: string; term: string; normalizedTerm: string; start: number; end: number; contextHash: string };
export type PreparedPage = { pageId: string; generation: string; pageKeyHash: string; model: string; effort: string; instructionVersion: string };
export type PreparedDefinition = { candidateId: string; text: string; reply: CandidateReply };
export type PreparationState = 'ready' | 'stale' | 'off' | 'excluded' | 'paused-at-limit';
type Lease = { settle(usage: InstantUsageTotals): void | Promise<void>; cancelBeforeSend(): void | Promise<void> };
export type PreparedDefinitionDependencies = {
  /** This callback MUST perform authoritative admission atomically and retain the usage lease until settlement. */
  admit(page: PreparedPage, count: number): Promise<{ state: 'admitted'; lease: Lease } | { state: 'off' | 'excluded' | 'paused-at-limit' }>;
  /** Recheck principal, page generation, enabled switches and exclusions immediately before transport. */
  allowed(page: PreparedPage): 'allowed' | 'off' | 'excluded';
  transport(request: { pageId: string; generation: string; items: readonly Omit<PreparedTerm, 'normalizedTerm' | 'contextHash'>[] }, signal: AbortSignal): Promise<{ items: unknown; usage: InstantUsageTotals }>;
};
const unknownUsage: InstantUsageTotals = { inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null };
function cacheKey(page: PreparedPage, term: PreparedTerm): string {
  return createHash('sha256').update(JSON.stringify([page.pageId, page.pageKeyHash, term.normalizedTerm, term.contextHash, page.instructionVersion, page.model, page.effort])).digest('hex');
}
/** Injected transport only. Construction does not dispatch; the caller owns authenticated admission. */
export function createPreparedDefinitions(deps: PreparedDefinitionDependencies) {
  const active = new Map<string, { generation: string; abort: AbortController }>();
  const cache = new Map<string, { pageId: string; normalizedTerm: string; text: string; reply: CandidateReply }>();
  function forget(pageId: string) {
    active.get(pageId)?.abort.abort(); active.delete(pageId);
    for (const [key, value] of cache) if (value.pageId === pageId) cache.delete(key);
  }
  return {
    forget,
    dismiss(pageId: string, normalizedTerm: string) {
      active.get(pageId)?.abort.abort(); active.delete(pageId);
      for (const [key, value] of cache) if (value.pageId === pageId && value.normalizedTerm === normalizedTerm) cache.delete(key);
    },
    close() { for (const pageId of active.keys()) forget(pageId); cache.clear(); },
    async prepare(page: PreparedPage, terms: readonly PreparedTerm[]): Promise<{ state: PreparationState; definitions: PreparedDefinition[] }> {
      const allowed = deps.allowed(page); if (allowed !== 'allowed') { forget(page.pageId); return { state: allowed, definitions: [] }; }
      active.get(page.pageId)?.abort.abort();
      if (!active.has(page.pageId) && active.size >= 8) forget(active.keys().next().value!);
      const run = { generation: page.generation, abort: new AbortController() }; active.set(page.pageId, run);
      const current = () => active.get(page.pageId) === run && !run.abort.signal.aborted;
      const definitions: PreparedDefinition[] = [], pending: PreparedTerm[] = [];
      const ids = new Set<string>();
      for (const term of terms.slice(0, 30)) {
        if (!term.candidateId || term.candidateId.length > 256 || ids.has(term.candidateId) || !term.term.trim() || term.term.length > 128 || term.normalizedTerm !== term.term.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase() || !Number.isInteger(term.start) || !Number.isInteger(term.end) || term.start < 0 || term.end <= term.start || term.end - term.start !== term.term.length || !/^[a-f0-9]{64}$/iu.test(term.contextHash)) continue;
        ids.add(term.candidateId); const cached = cache.get(cacheKey(page, term));
        if (cached) definitions.push({ candidateId: term.candidateId, text: cached.text, reply: cached.reply }); else pending.push(term);
      }
      for (let offset = 0; offset < pending.length; offset += 3) {
        if (!current()) return { state: 'stale', definitions: [] };
        const batch = pending.slice(offset, offset + 3);
        const admission = await deps.admit(page, batch.length);
        if (admission.state !== 'admitted') return current() ? { state: admission.state, definitions } : { state: 'stale', definitions: [] };
        const permission = deps.allowed(page);
        if (!current() || permission !== 'allowed') {
          await admission.lease.cancelBeforeSend();
          return { state: current() ? permission as 'off' | 'excluded' : 'stale', definitions: [] };
        }
        let response: { items: unknown; usage: InstantUsageTotals };
        try {
          response = await deps.transport({ pageId: page.pageId, generation: page.generation, items: batch.map(({ candidateId, term, start, end }) => ({ candidateId, term, start, end })) }, run.abort.signal);
        } catch (error) {
          // Once sent, unknown usage remains charged/reserved through the authoritative store.
          await admission.lease.settle(unknownUsage);
          if (!current()) return { state: 'stale', definitions: [] };
          throw error;
        }
        await admission.lease.settle(response.usage);
        if (!current()) return { state: 'stale', definitions: [] };
        const after = deps.allowed(page); if (after !== 'allowed') { forget(page.pageId); return { state: after, definitions: [] }; }
        if (!Array.isArray(response.items) || response.items.length > 3) continue;
        const seen = new Set<string>();
        for (const item of response.items) {
          if (!item || typeof item !== 'object' || typeof item.candidateId !== 'string' || typeof item.text !== 'string' || seen.has(item.candidateId)) continue;
          seen.add(item.candidateId);
          const term = batch.find(t => t.candidateId === item.candidateId);
          if (!term || item.text.length > 2000 || item.text.trim().split(/\s+/u).length > 35) continue;
          try {
            const reply = instantTextToReply(item.text); const text = item.text.trim();
            cache.set(cacheKey(page, term), { pageId: page.pageId, normalizedTerm: term.normalizedTerm, text, reply });
            if (cache.size > 256) cache.delete(cache.keys().next().value!);
            definitions.push({ candidateId: term.candidateId, text, reply });
          } catch { /* One invalid result must not discard a valid sibling. */ }
        }
      }
      return current() ? { state: 'ready', definitions } : { state: 'stale', definitions: [] };
    },
  };
}

