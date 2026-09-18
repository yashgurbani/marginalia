import type { InstantAdmissionResult, InstantReservation, InstantUsageRecord, InstantUsageTotals } from '../contracts/instant.ts';
import { isDigest } from '../contracts/digest.ts';
import { LibrarySettingsService } from './library.ts';
import { ConflictError, type ReaderStore } from './store.ts';

/** This store admits instant work only. Deep Ask has separate authority. */
export class InstantStore {
  readonly reader: ReaderStore;
  constructor(reader: ReaderStore) { this.reader = reader; }

  get(requestId: string): InstantUsageRecord | undefined {
    return this.reader.db.prepare('SELECT * FROM instant_usage WHERE requestId=?').get(requestId) as InstantUsageRecord | undefined;
  }

  /** excluded is a host policy decision, never a browser assertion. Recheck before dispatch. */
  reserve(request: InstantReservation, excluded: boolean, now = new Date()): InstantAdmissionResult {
    if (typeof excluded !== 'boolean' || !request.requestId || request.requestId.length > 200 || !isDigest(request.pageKeyHash)
      || !['prepare', 'selection', 'auto-definition'].includes(request.kind) || !Number.isSafeInteger(request.reservedTokens) || request.reservedTokens < 1) throw new Error('Invalid instant help reservation.');
    return this.reader.db.transaction((): InstantAdmissionResult => {
      const settings = new LibrarySettingsService(this.reader).instantHelp();
      if (!settings.enabled) return { state: 'off' };
      if (excluded) return { state: 'excluded' };
      if (this.get(request.requestId)) throw new ConflictError('This instant help request already has a reservation.');
      const timezone = settings.tokenBudget.timezone, periodStart = instantDay(now, timezone);
      // Usage remains authoritative and is exposed by the status route, but it no longer gates admission.
      // Keep reservations and settlement intact so used and pending counts stay truthful.
      const usage: InstantUsageRecord = { ...request, periodStart, timezone, model: settings.model,
        inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null,
        state: 'reserved', createdAt: now.toISOString(), settledAt: null };
      this.reader.db.prepare(`INSERT INTO instant_usage(requestId,pageKeyHash,kind,periodStart,timezone,model,inputTokens,cachedInputTokens,outputTokens,totalTokens,reservedTokens,state,createdAt,settledAt)
        VALUES(@requestId,@pageKeyHash,@kind,@periodStart,@timezone,@model,@inputTokens,@cachedInputTokens,@outputTokens,@totalTokens,@reservedTokens,@state,@createdAt,@settledAt)`).run(usage);
      return { state: 'admitted', usage };
    }).immediate();
  }

  /** Missing provider totals leave the reservation pending, including across restarts. */
  settle(requestId: string, totals: Partial<InstantUsageTotals>, now = new Date()): InstantUsageRecord {
    return this.reader.db.transaction(() => {
      const previous = this.get(requestId);
      if (!previous) throw new Error('This instant help reservation is unavailable.');
      const next = { ...previous };
      for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens'] as const) {
        const value = totals[key];
        if (value === undefined || value === null) continue;
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid instant help token usage.');
        if (previous[key] !== null && previous[key] !== value) throw new ConflictError('Instant help usage was already recorded with a different value.');
        next[key] = value;
      }
      if (next.cachedInputTokens !== null && (next.inputTokens === null || next.cachedInputTokens > next.inputTokens)) throw new Error('Cached input must be part of input tokens.');
      if (next.totalTokens !== null && next.totalTokens < (next.inputTokens ?? 0) + (next.outputTokens ?? 0)) throw new Error('Total tokens cannot be less than input and output tokens.');
      if (next.totalTokens !== null) { next.state = 'settled'; next.reservedTokens = 0; next.settledAt ??= now.toISOString(); }
      this.reader.db.prepare(`UPDATE instant_usage SET inputTokens=@inputTokens,cachedInputTokens=@cachedInputTokens,outputTokens=@outputTokens,
        totalTokens=@totalTokens,reservedTokens=@reservedTokens,state=@state,settledAt=@settledAt WHERE requestId=@requestId`).run(next);
      return next;
    }).immediate();
  }
}

export function instantDay(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(part => part.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
