import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ProviderAudit } from '../../contracts/job-runner.ts';
import type { RpcTransport } from './stdio.ts';

export const PINNED_CODEX_VERSION = '0.153.4';
export function assertVersion(version: string): void {
  if (version.trim() !== `codex-cli ${PINNED_CODEX_VERSION}`) throw new Error('codex-version-mismatch');
}
export function assertSeparateHome(home: string, workspace: string): void {
  if (!isAbsolute(home) || !isAbsolute(workspace)) throw new Error('absolute-provider-paths-required');
  const inside = (a: string, b: string) => { const r = relative(resolve(a), resolve(b)); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };
  if (inside(workspace, home) || inside(home, workspace)) throw new Error('codex-home-must-be-separate-from-workspace');
}
/** Allowlist intentionally excludes API keys, proxy overrides and inherited CODEX settings. */
export function providerEnvironment(home: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CODEX_HOME: home };
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'LANG', 'LC_ALL']) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}
export async function pages(rpc: RpcTransport, method: string, params: Record<string, unknown> = {}, field = 'data'): Promise<any[]> {
  const result: any[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await rpc.request(method, { ...params, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page[field])) throw new Error(`invalid-page:${method}`);
    result.push(...page[field]);
    if (result.length > 10000) throw new Error('provider-inventory-limit');
    cursor = page.nextCursor ?? page.next_cursor ?? undefined;
    if (cursor && (seen.has(cursor) || seen.size >= 100)) throw new Error('provider-pagination-loop');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}
export async function inspectAppServer(rpc: RpcTransport, workspace: string, expectedHome: string): Promise<ProviderAudit> {
  assertSeparateHome(expectedHome, workspace);
  const initialize = await rpc.request('initialize', { clientInfo: { name: 'marginalia', version: '0.2.0' }, capabilities: { experimentalApi: true } });
  if (resolve(initialize.codexHome ?? '') !== resolve(expectedHome)) throw new Error('unexpected-codex-home');
  rpc.notify('initialized');
  const account = await rpc.request('account/read', { refreshToken: false });
  const config = await rpc.request('config/read', { cwd: workspace, includeLayers: true });
  const requirements = await rpc.request('configRequirements/read');
  const skills = await rpc.request('skills/list', { cwds: [workspace], forceReload: true });
  const mcpServers = await pages(rpc, 'mcpServerStatus/list');
  const features = await pages(rpc, 'experimentalFeature/list');
  return { workspace, codexHome: expectedHome, initialize, account, config, requirements, skills, mcpServers, features, completeModelToolCatalog: false };
}
