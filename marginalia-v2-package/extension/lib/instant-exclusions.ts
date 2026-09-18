import { allowedPage } from './protocol.ts';
export type ExclusionPolicy = { excludedHosts: string[]; revision: string };
export type ExclusionDependencies = {
  read(): Promise<string[]>;
  write(hosts: string[]): Promise<void>;
  sync(hosts: string[]): Promise<ExclusionPolicy>;
  unexclude(host: string, expectedRevision: string): Promise<ExclusionPolicy>;
};
export function validExclusionHost(host: unknown): host is string {
  return typeof host === 'string' && host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host);
}
export function exclusionPolicy(value: unknown): ExclusionPolicy {
  if (!value || typeof value !== 'object') throw new Error('The helper returned an invalid exclusion policy.');
  const policy = value as Partial<ExclusionPolicy>;
  if (!Array.isArray(policy.excludedHosts) || !policy.excludedHosts.every(validExclusionHost) || typeof policy.revision !== 'string' || !policy.revision.length || policy.revision.length > 200) throw new Error('The helper returned an invalid exclusion policy.');
  return { excludedHosts: [...new Set(policy.excludedHosts)], revision: policy.revision };
}
/** Caller holds the same lock used by automatic policy sync and local additions. */
export async function stopExcluding(deps: ExclusionDependencies, host: string): Promise<{ excluded: boolean }> {
  if (!validExclusionHost(host)) throw new Error('Invalid exclusion host.');
  const before = exclusionPolicy(await deps.sync(await deps.read()));
  const after = exclusionPolicy(await deps.unexclude(host, before.revision));
  // An acknowledged removal replaces the old union. Other helper denials survive.
  await deps.write(after.excludedHosts);
  return { excluded: !allowedPage('https://' + host, after.excludedHosts) };
}
