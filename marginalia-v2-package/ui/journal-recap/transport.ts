import type { JournalRecap } from '../../contracts/journal-recap.ts';

export interface JournalRecapTransport {
  getRecap(date: string, timeZone: string, signal?: AbortSignal): Promise<JournalRecap>;
}

/** A deterministic local recap boundary for UI tests and offline demos. */
export class FakeJournalRecapTransport implements JournalRecapTransport {
  summary: JournalRecap;
  readonly requests: { date: string; timeZone: string }[] = [];
  constructor(summary: JournalRecap) { this.summary = structuredClone(summary); }
  async getRecap(date: string, timeZone: string): Promise<JournalRecap> {
    this.requests.push({ date, timeZone }); return structuredClone(this.summary);
  }
}
