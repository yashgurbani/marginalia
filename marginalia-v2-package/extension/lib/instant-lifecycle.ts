import { instantTextToReply } from '../../contracts/instant.ts';
import type { CandidateReply } from '../../contracts/reply.ts';

export type InstantEvent = { type: 'draft' | 'completed' | 'state'; pageId: string; selectionId: string; sequence: number; text?: string; reply?: CandidateReply; state?: string };
export type InstantPage = { document: string; url: string; sourceHash: string; pageId?: string; state: string; selectionId?: string; selectionText?: string; budgetEpoch?: string; event?: InstantEvent };
export type InstantSource = { document: string; url: string; sourceHash: string; text: string };
export type InstantDependencies = {
  read(tab: number): Promise<InstantPage | undefined>;
  write(tab: number, value: InstantPage | undefined): Promise<void>;
  allowed(tab: number, source: InstantSource): Promise<boolean>;
  budgetEpoch?(): string | undefined;
  prepare(tab: number, source: InstantSource): Promise<{ pageId: string; state: string }>;
  select(pageId: string, selectionId: string, text: string, signal: AbortSignal): AsyncIterable<unknown>;
  release(pageId: string): Promise<void>;
};
export async function sourceHash(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function acceptInstantEvent(value: unknown, pageId: string, selectionId: string): InstantEvent | undefined {
  if (!value || typeof value !== 'object') return;
  const event = value as InstantEvent;
  if (event.pageId !== pageId || event.selectionId !== selectionId || !Number.isSafeInteger(event.sequence) || event.sequence < 0) return;
  if (event.type === 'draft' && typeof event.text === 'string' && event.text.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(event.text)) return { type: 'draft', pageId, selectionId, sequence: event.sequence, text: event.text };
  if (event.type === 'completed' && event.reply && typeof event.reply.summary === 'string') {
    try { return { type: 'completed', pageId, selectionId, sequence: event.sequence, reply: instantTextToReply(event.reply.summary) }; } catch { return; }
  }
  if (event.type === 'state' && ['ready', 'off', 'excluded', 'paused-at-limit', 'cancelled', 'failed', 'outcome_unknown'].includes(event.state ?? '')) return { type: 'state', pageId, selectionId, sequence: event.sequence, state: event.state };
}
/** Persist before dispatch. A lost outcome is not automatically replayed after worker restart. */
export function createInstantLifecycle(deps: InstantDependencies) {
  const active = new Map<number, AbortController>();
  const selections = new Map<number, number>();
  const epochs = new Map<number, number>();
  const prepares = new Map<number, Promise<InstantPage | undefined>>();
  const current = (tab: number, epoch: number) => (epochs.get(tab) ?? 0) === epoch;
  async function release(tab: number) {
    epochs.set(tab, (epochs.get(tab) ?? 0) + 1); active.get(tab)?.abort(); active.delete(tab);
    const old = await deps.read(tab); await deps.write(tab, undefined);
    if (old?.pageId) await deps.release(old.pageId).catch(() => {});
  }
  async function preparePage(tab: number, source: InstantSource): Promise<InstantPage | undefined> {
    if (!source.text.trim() || source.text.length > 200_000 || !await deps.allowed(tab, source)) { await release(tab); return; }
    const old = await deps.read(tab);
    const budgetEpoch = deps.budgetEpoch?.();
    const newBudgetPeriod = old?.state === 'paused-at-limit' && !!budgetEpoch && !!old.budgetEpoch && budgetEpoch !== old.budgetEpoch;
    if (old?.document === source.document && old.url === source.url && old.sourceHash === source.sourceHash && old.state !== 'cancelled' && !newBudgetPeriod) return old;
    await release(tab);
    const epoch = epochs.get(tab) ?? 0;
    const task = (async () => {
      const record: InstantPage = { document: source.document, url: source.url, sourceHash: source.sourceHash, state: 'outcome_unknown', budgetEpoch };
      await deps.write(tab, record);
      if (!current(tab, epoch) || !await deps.allowed(tab, source)) return;
      const result = await deps.prepare(tab, source);
      if (!current(tab, epoch) || !await deps.allowed(tab, source) || !current(tab, epoch)) { if (result.pageId) await deps.release(result.pageId); return; }
      record.pageId = result.pageId; record.state = result.state; await deps.write(tab, record); return record;
    })();
    return task;
  }
  async function prepare(tab: number, source: InstantSource): Promise<InstantPage | undefined> {
    const running = prepares.get(tab); if (running) { await running; return prepare(tab, source); }
    const task = preparePage(tab, source); prepares.set(tab, task);
    try { return await task; } finally { if (prepares.get(tab) === task) prepares.delete(tab); }
  }
  async function select(tab: number, source: InstantSource, selectionId: string, text: string) {
    active.get(tab)?.abort();
    const request = (selections.get(tab) ?? 0) + 1; selections.set(tab, request);
    const page = await prepare(tab, source);
    if (selections.get(tab) !== request || !page?.pageId || page.state !== 'ready' || page.selectionId === selectionId || !text.trim() || text.length > 8000) return;
    const abort = new AbortController(); active.set(tab, abort);
    const epoch = epochs.get(tab) ?? 0;
    const isCurrent = () => !abort.signal.aborted && current(tab, epoch);
    const record: InstantPage = { ...page, selectionId, selectionText: text, budgetEpoch: deps.budgetEpoch?.() ?? page.budgetEpoch, event: undefined };
    await deps.write(tab, record);
    if (!isCurrent() || !await deps.allowed(tab, source) || !isCurrent()) return;
    let terminal = false;
    try {
      for await (const value of deps.select(page.pageId, selectionId, text, abort.signal)) {
        if (!isCurrent() || !await deps.allowed(tab, source) || !isCurrent()) break;
        const event = acceptInstantEvent(value, page.pageId, selectionId);
        if (!event || terminal || (record.event && event.sequence < record.event.sequence)) continue;
        record.event = event; if (event.type === 'state' && (event.state === 'cancelled' || event.state === 'paused-at-limit')) record.state = event.state; terminal = event.type === 'completed' || event.type === 'state'; await deps.write(tab, record);
      }
    } catch { /* Uncertain requests remain fenced, never replayed. */ }
    if (isCurrent() && !terminal) { record.event = { type: 'state', pageId: page.pageId, selectionId, sequence: record.event?.sequence ?? 0, state: 'outcome_unknown' }; await deps.write(tab, record); }
  }
  async function suppress(tab: number, pageId: string) {
    const page = await deps.read(tab); if (!page || page.pageId !== pageId) return false;
    epochs.set(tab, (epochs.get(tab) ?? 0) + 1); active.get(tab)?.abort(); active.delete(tab);
    await deps.write(tab, { ...page, state: 'off', selectionId: undefined, selectionText: undefined, event: undefined });
    return true;
  }
  return { prepare, select, release, suppress };
}

/** Bounded SSE decoder, including UTF-8 and CRLF split across network chunks. */
export async function* instantEvents(response: Response): AsyncIterable<unknown> {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Instant help is unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > 1_000_000) throw new Error('Instant reply is too large.');
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        if (match.index > 32_000) throw new Error('Instant event is too large.');
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) yield JSON.parse(data);
      }
      if (buffer.length > 32_000) throw new Error('Instant event is too large.');
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
