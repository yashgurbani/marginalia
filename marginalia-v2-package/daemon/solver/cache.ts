import type { SolverBlockOutput, SolverExecutionRecord } from '../../contracts/solver.ts';

/**
 * Equivalent successful executions only. Errors, timeouts, cancellations and
 * unknown outcomes are never stored, so a cache read can never invent a result
 * that no process produced.
 */
export type SolverCacheEntry = {
  key: string;
  outputs: Readonly<Record<string, SolverBlockOutput>>;
  /** The record of the execution that actually produced this data. */
  record: SolverExecutionRecord;
  storedAt: number;
};

export type SolverCacheOptions = {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
};

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class SolverResultCache {
  private entries = new Map<string, SolverCacheEntry>();
  private maxEntries: number;
  private ttlMs: number;
  private now: () => number;

  constructor(options: SolverCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) throw new Error('Invalid solver cache size.');
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1) throw new Error('Invalid solver cache lifetime.');
  }

  get size(): number {
    return this.entries.size;
  }

  /** A hit is only data. The caller still re-checks current authorization before using it. */
  get(key: string): SolverCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.storedAt > this.ttlMs) { this.entries.delete(key); return undefined; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  store(key: string, outputs: Readonly<Record<string, SolverBlockOutput>>, record: SolverExecutionRecord): void {
    if (record.origin !== 'host-execution') throw new Error('Only an observed host execution can be cached.');
    if (record.modelTurns !== 0) throw new Error('A cached recompute must record zero model turns.');
    this.entries.delete(key);
    this.entries.set(key, { key, outputs, record, storedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Called when a grant is revoked or a site is excluded: cached work loses its authority. */
  invalidateGrant(grantId: string): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.record.grantId === grantId) { this.entries.delete(key); removed++; }
    }
    return removed;
  }

  invalidateReply(replyVersionId: string): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.record.replyVersionId === replyVersionId) { this.entries.delete(key); removed++; }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }
}
