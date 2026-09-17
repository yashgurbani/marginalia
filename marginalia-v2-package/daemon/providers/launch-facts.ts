import { createHash } from 'node:crypto';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import type { ProviderAudit, ProviderKind } from '../../contracts/job-runner.ts';
import type { RpcTransport } from './stdio.ts';

export type LaunchFileIdentity = { path: string; dev: number; ino: number; size: number; mtimeMs: number };
export type LaunchFacts = {
  provider: ProviderKind; executable: LaunchFileIdentity; executableSha256: string; version: string;
  workspace: string; codexHome: string; inheritedEnvironmentKeys: string[];
  environmentValueDigests: Record<string, string>; windowsKeyCasingReviewed: boolean;
  observedAt: string; alive: boolean;
};
const transports = new WeakMap<object, LaunchFacts>(), audits = new WeakMap<object, LaunchFacts>();
export function fileIdentity(path: string): LaunchFileIdentity {
  const resolved = realpathSync(path), stat = statSync(resolved);
  if (!stat.isFile()) throw new Error('Provider executable is not a regular file.');
  return { path: resolved, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
}
export function sameFile(a: LaunchFileIdentity, b: LaunchFileIdentity): boolean {
  return a.path === b.path && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
export async function executableDigest(file: LaunchFileIdentity): Promise<string> {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file.path)) hash.update(chunk);
  if (!sameFile(file, fileIdentity(file.path))) throw new Error('Provider executable changed while being inspected.');
  return hash.digest('hex');
}
/** Called only by the host launcher with the actual spawn arguments/environment. These facts
 * attest to launch configuration, never to filesystem/network confinement or credential origin. */
export function recordLaunch(rpc: RpcTransport, facts: Omit<LaunchFacts, 'alive'>): void {
  if (transports.has(rpc)) throw new Error('Transport launch identity was already recorded.');
  const owned = { ...structuredClone(facts), alive: true };
  transports.set(rpc, owned); rpc.onDisconnect(() => { owned.alive = false; });
}
export function bindLaunchAudit(audit: ProviderAudit, rpc: RpcTransport): void {
  const facts = transports.get(rpc);
  if (!facts || facts.workspace !== audit.workspace || facts.codexHome !== audit.codexHome) throw new Error('Provider audit has no matching launch observation.');
  audits.set(audit, facts);
}
export function observedLaunch(audit: ProviderAudit): Readonly<LaunchFacts> | undefined {
  const value = audits.get(audit); return value && structuredClone(value);
}
/** Synchronous identity fence, not a confinement certificate. */
export function assertLaunchCurrent(audit: ProviderAudit): void {
  const facts = audits.get(audit);
  if (!facts || !facts.alive || facts.workspace !== audit.workspace || facts.codexHome !== audit.codexHome ||
    !sameFile(facts.executable, fileIdentity(facts.executable.path))) throw new Error('Provider launch identity changed before send.');
}
