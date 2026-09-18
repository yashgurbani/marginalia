import { launchProvider, type RuntimeOptions } from '../providers/runtime.ts';
import type { RpcTransport } from '../providers/stdio.ts';

/** D20: process-local overrides for instant only. Keep the reader's home/sign-in.
 * Pinned Codex 0.153.4: skills.include_instructions controls the automatic catalog;
 * features.plugins gates plugin loading, including bundled plugin MCP servers.
 * Local configured servers additionally need per-thread enabled=false below. */
export const INSTANT_RUNTIME_OVERRIDES = Object.freeze({
  'skills.include_instructions': false,
  'orchestrator.skills.enabled': false,
  'orchestrator.mcp.enabled': false,
  'features.plugins': false,
  'features.apps': false,
});

export function instantRuntimeOptions(runtime: RuntimeOptions): RuntimeOptions {
  return { ...runtime, configOverrides: { ...runtime.configOverrides, ...INSTANT_RUNTIME_OVERRIDES } };
}

export function launchInstantProvider(runtime: RuntimeOptions): Promise<RpcTransport> {
  return launchProvider('app-server', instantRuntimeOptions(runtime));
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Read metadata in memory only; never retain/log config values, commands or env.
 * Empty maps are not resets: disable each configured server by its exact key. */
export async function instantThreadConfig(wire: RpcTransport, workspace: string): Promise<{ mcp_servers: Record<string, { enabled: false }> }> {
  const result: unknown = await wire.request('config/read', { cwd: workspace, includeLayers: false });
  if (!record(result) || !record(result.config)) throw new Error('Instant configuration is unavailable.');
  const config = result.config;
  for (const key of Object.keys(INSTANT_RUNTIME_OVERRIDES)) {
    let value: unknown = config;
    for (const part of key.split('.')) value = record(value) ? value[part] : undefined;
    if (value !== false) throw new Error('Instant configuration could not be applied.');
  }
  const servers = config.mcp_servers ?? {};
  if (!record(servers) || Object.keys(servers).length > 1000) throw new Error('Instant tool configuration is unavailable.');
  const overrides: Record<string, { enabled: false }> = Object.create(null);
  for (const name of Object.keys(servers)) {
    if (!name || name.length > 512 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('Instant tool configuration is unavailable.');
    // Thread config dotted keys split on literal dots, not TOML quoted paths.
    // A nested JSON table preserves arbitrary server IDs during recursive merge.
    overrides[name] = { enabled: false };
  }
  return { mcp_servers: overrides };
}

/** Disabled configured servers remain listed. Verify their runtime state and
 * empty capabilities on the intended thread, not the global inventory. */
export async function verifyInstantThread(wire: RpcTransport, threadId: string): Promise<void> {
  let cursor: string | undefined, count = 0;
  const seen = new Set<string>();
  do {
    const result: unknown = await wire.request('mcpServerStatus/list', { threadId, limit: 100, ...(cursor ? { cursor } : {}) });
    if (!record(result) || !Array.isArray(result.data)) throw new Error('Instant tools could not be disabled.');
    count += result.data.length;
    if (count > 1000) throw new Error('Instant tool inventory is too large.');
    for (const server of result.data) {
      if (!record(server) || server.runtimeStatus !== 'disabled' || server.pluginId != null
        || !record(server.tools) || Object.keys(server.tools).length
        || !Array.isArray(server.resources) || server.resources.length
        || !Array.isArray(server.resourceTemplates) || server.resourceTemplates.length) throw new Error('Instant tools could not be disabled.');
    }
    const next = result.nextCursor;
    if (next != null && (typeof next !== 'string' || !next || seen.has(next) || seen.size >= 100)) throw new Error('Instant tool inventory is incomplete.');
    cursor = next as string | undefined;
    if (cursor) seen.add(cursor);
  } while (cursor);
}
