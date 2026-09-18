export type WhitelistSite = {
  site: string;
  revision: number;
  excluded: boolean;
  updatedAt: string;
};

export type WhitelistSettings = { exclusions: WhitelistSite[] };
export type WhitelistSiteChange = {
  action: 'set-exclusion';
  site: string;
  excluded: boolean;
  expectedRevision?: number;
};

export function whitelistSettingsFrom(value: unknown): WhitelistSettings {
  if (!record(value) || !Array.isArray(value.exclusions) || value.exclusions.length > 10_000
    || !value.exclusions.every(siteEntry)) invalid();
  return { exclusions: value.exclusions as WhitelistSite[] };
}

export function whitelistSiteResponseFrom(value: unknown): WhitelistSite {
  if (!record(value) || !siteEntry(value.exclusion)) invalid();
  return value.exclusion;
}

export function siteOriginFromInput(value: string): string | undefined {
  const raw = value.trim();
  if (!raw || raw.length > 2_000) return undefined;
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    return parsed.origin;
  } catch { return undefined; }
}

function siteEntry(value: unknown): value is WhitelistSite {
  return record(value) && typeof value.site === 'string' && siteOriginFromInput(value.site) === value.site
    && Number.isSafeInteger(value.revision) && Number(value.revision) > 0
    && typeof value.excluded === 'boolean' && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt));
}
function invalid(): never { throw new Error('The helper returned an invalid site list.'); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
