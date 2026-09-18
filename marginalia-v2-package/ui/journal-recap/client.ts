import { journalRecapFrom, type JournalRecap } from '../../contracts/journal-recap.ts';
import type { JournalRecapTransport } from './transport.ts';

export interface JournalRecapHttpGateway {
  request(path: string, signal?: AbortSignal): Promise<unknown>;
}

/** Authentication and origin policy belong to the injected gateway. */
export class JournalRecapClient implements JournalRecapTransport {
  private readonly gateway: JournalRecapHttpGateway;
  constructor(gateway: JournalRecapHttpGateway) { this.gateway = gateway; }
  async getRecap(date: string, timeZone: string, signal?: AbortSignal): Promise<JournalRecap> {
    const query = new URLSearchParams({ date, timeZone });
    return journalRecapFrom(await this.gateway.request(`/api/library-journal-summary?${query}`, signal));
  }
}
