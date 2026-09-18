import { whitelistSettingsFrom, whitelistSiteResponseFrom, type WhitelistSettings, type WhitelistSite, type WhitelistSiteChange } from '../../contracts/whitelist.ts';
import type { WhitelistTransport } from './transport.ts';

export interface WhitelistHttpGateway {
  request(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
}

/** Authentication and origin policy belong to the injected gateway. */
export class WhitelistClient implements WhitelistTransport {
  private readonly gateway: WhitelistHttpGateway;
  constructor(gateway: WhitelistHttpGateway) { this.gateway = gateway; }
  async getSettings(signal?: AbortSignal): Promise<WhitelistSettings> {
    return whitelistSettingsFrom(await this.gateway.request('GET', '/api/consent/settings', undefined, signal));
  }
  async saveSite(change: WhitelistSiteChange, signal?: AbortSignal): Promise<WhitelistSite> {
    return whitelistSiteResponseFrom(await this.gateway.request('POST', '/api/consent/settings', change, signal));
  }
}
