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
/** Dedicated mode excludes inherited integration credentials/settings; D15 ordinary mode preserves them. */
export function providerEnvironment(home: string, source: NodeJS.ProcessEnv = process.env, homeMode?: 'dedicated' | 'ordinary'): NodeJS.ProcessEnv {
  if (homeMode === 'ordinary') {
    const env = { ...source };
    // Windows treats environment keys case-insensitively. Always select the resolved reader home.
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'CODEX_HOME') delete env[key];
    env.CODEX_HOME = home;
    return env;
  }
  const env: NodeJS.ProcessEnv = { CODEX_HOME: home };
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'LANG', 'LC_ALL']) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}
const STARTUP_METHODS = new Set(['initialize', 'account/read', 'config/read', 'configRequirements/read', 'skills/list', 'mcpServerStatus/list', 'experimentalFeature/list']);
export type StartupStage = Readonly<{ method: string; pageOrdinal: number; at: string; elapsedMs: number; outcome: 'started' | 'succeeded' | 'failed' }>;
export type StartupObserver = (stage: StartupStage) => void;
async function startupRequest(rpc: RpcTransport, method: string, params: unknown, observer?: StartupObserver, pageOrdinal = 1): Promise<any> {
  const start = performance.now();
  const emit = (outcome: StartupStage['outcome']) => {
    if (!observer || !STARTUP_METHODS.has(method)) return;
    // Whitelisted host fields only: never params, server names, cursors, IDs or raw errors.
    try { observer(Object.freeze({ method, pageOrdinal, at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start), outcome })); }
    catch { /* Diagnostics must not affect provider authority or availability. */ }
  };
  emit('started');
  try { const response = await rpc.request(method, params); emit('succeeded'); return response; }
  catch (error) { emit('failed'); throw error; }
}

export async function pages(rpc: RpcTransport, method: string, params: Record<string, unknown> = {}, field = 'data', observer?: StartupObserver): Promise<any[]> {
  const result: any[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  let pageOrdinal = 0;
  do {
    const page = await startupRequest(rpc, method, { ...params, ...(cursor ? { cursor } : {}) }, observer, ++pageOrdinal);
    if (!Array.isArray(page[field])) throw new Error(`invalid-page:${method}`);
    result.push(...page[field]);
    if (result.length > 10000) throw new Error('provider-inventory-limit');
    cursor = page.nextCursor ?? page.next_cursor ?? undefined;
    if (cursor && (seen.has(cursor) || seen.size >= 100)) throw new Error('provider-pagination-loop');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}
/** Numeric fields only from this process's effective, workspace-scoped config/read. */
export function mcpStartupAllowanceSeconds(response: unknown): number | undefined {
  const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!record(response) || !record(response.config) || !record(response.config.mcp_servers)) return undefined;
  let maximum: number | undefined;
  for (const entry of Object.values(response.config.mcp_servers)) {
    if (!record(entry) || (entry.enabled !== undefined && entry.enabled !== true)) continue;
    const seconds = entry.startup_timeout_sec;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) maximum = Math.max(maximum ?? 0, seconds);
  }
  return maximum;
}

export async function inspectAppServer(rpc: RpcTransport, workspace: string, expectedHome: string, onStage: StartupObserver = stage => console.info('MARGINALIA_STARTUP ' + JSON.stringify(stage))): Promise<ProviderAudit> {
  assertSeparateHome(expectedHome, workspace);
  const initialize = await startupRequest(rpc, 'initialize', { clientInfo: { name: 'marginalia', version: '1.1.0' }, capabilities: { experimentalApi: true } }, onStage);
  if (resolve(initialize.codexHome ?? '') !== resolve(expectedHome)) throw new Error('unexpected-codex-home');
  rpc.notify('initialized');
  const account = await startupRequest(rpc, 'account/read', { refreshToken: false }, onStage);
  const config = await startupRequest(rpc, 'config/read', { cwd: workspace, includeLayers: true }, onStage);
  const requirements = await startupRequest(rpc, 'configRequirements/read', undefined, onStage);
  const skills = await startupRequest(rpc, 'skills/list', { cwds: [workspace], forceReload: true }, onStage);
  const startupAllowance = mcpStartupAllowanceSeconds(config);
  if (startupAllowance !== undefined) rpc.setMcpDiscoveryStartupAllowance?.(startupAllowance);
  const mcpServers = await pages(rpc, 'mcpServerStatus/list', { detail: 'toolsAndAuthOnly' }, 'data', onStage);
  const features = await pages(rpc, 'experimentalFeature/list', {}, 'data', onStage);
  return { workspace, codexHome: expectedHome, initialize, account, config, requirements, skills, mcpServers, features, completeModelToolCatalog: false };
}
