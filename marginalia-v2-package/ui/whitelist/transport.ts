import type { WhitelistSettings, WhitelistSite, WhitelistSiteChange } from '../../contracts/whitelist.ts';

export interface WhitelistTransport {
  getSettings(signal?: AbortSignal): Promise<WhitelistSettings>;
  saveSite(change: WhitelistSiteChange, signal?: AbortSignal): Promise<WhitelistSite>;
}

export class FakeWhitelistTransport implements WhitelistTransport {
  settings: WhitelistSettings;
  readonly changes: WhitelistSiteChange[] = [];
  constructor(settings: WhitelistSettings) { this.settings = structuredClone(settings); }
  async getSettings(): Promise<WhitelistSettings> { return structuredClone(this.settings); }
  async saveSite(change: WhitelistSiteChange): Promise<WhitelistSite> {
    this.changes.push(structuredClone(change));
    const previous = this.settings.exclusions.find(value => value.site === change.site);
    const saved: WhitelistSite = { site: change.site, excluded: change.excluded, revision: (previous?.revision ?? 0) + 1, updatedAt: '2026-09-18T12:00:00.000Z' };
    this.settings.exclusions = [...this.settings.exclusions.filter(value => value.site !== saved.site), saved]; return structuredClone(saved);
  }
}
