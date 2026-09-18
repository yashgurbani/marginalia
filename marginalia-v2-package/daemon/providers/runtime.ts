import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { executableDigest, fileIdentity, recordLaunch, sameFile } from './launch-facts.ts';
import { createStdioTransport, type RpcTransport, type StdioTransportOptions } from './stdio.ts';
import { assertSeparateHome, assertVersion, providerEnvironment } from './preflight.ts';

export interface RuntimeOptions {
  executable: string;
  workspace: string;
  codexHome: string;
  homeMode?: 'dedicated' | 'ordinary';
  configOverrides?: Readonly<Record<string, unknown>>;
  timeoutMs?: number;
}
/** Ordinary tool discovery can wait for configured MCP servers to start (observed 42s).
 * Keep other operations/dedicated mode unchanged and honor explicit caller deadlines. */
export function providerTimeoutPolicy(kind: 'app-server' | 'mcp-server', options: Pick<RuntimeOptions, 'homeMode' | 'timeoutMs'>): Pick<StdioTransportOptions, 'timeoutMs' | 'methodTimeoutMs' | 'allowMcpDiscoveryStartupAllowance'> {
  return {
    timeoutMs: options.timeoutMs ?? (kind === 'mcp-server' ? 600_000 : 30_000),
    methodTimeoutMs: kind === 'app-server' && options.homeMode === 'ordinary' && options.timeoutMs === undefined
      ? { 'mcpServerStatus/list': 90_000 } : {},
    ...(kind === 'app-server' && options.homeMode === 'ordinary' && options.timeoutMs === undefined
      ? { allowMcpDiscoveryStartupAllowance: true } : {}),
  };
}

/** Native executable required on Windows: never interpolate paths or config into a shell. */
export async function launchProvider(kind: 'app-server' | 'mcp-server', options: RuntimeOptions): Promise<RpcTransport> {
  if (process.platform === 'win32' && !/\.exe$/i.test(options.executable)) throw new Error('native-codex-executable-required');
  if (!isAbsolute(options.executable)) throw new Error('absolute-codex-executable-required');
  const executable = fileIdentity(options.executable), executableSha256 = await executableDigest(executable);
  const workspace = await realpath(options.workspace), home = await realpath(options.codexHome);
  assertSeparateHome(home, workspace);
  const normalHomes = [join(homedir(), '.codex'), process.env.CODEX_HOME].filter((x): x is string => !!x);
  for (const normal of options.homeMode === 'ordinary' ? [] : normalHomes) {
    const actual = await realpath(normal).catch(() => resolve(normal));
    const nested = (a: string, b: string) => { const r = relative(a, b); return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
    if (nested(home, actual) || nested(actual, home)) throw new Error('dedicated-codex-home-required');
  }
  const env = providerEnvironment(home, process.env, options.homeMode);
  const version = await new Promise<string>((done, reject) => execFile(executable.path, ['--version'],
    { cwd: workspace, env, windowsHide: true, timeout: 5000, maxBuffer: 16384 }, (error, stdout) => error ? reject(new Error('codex-version-unavailable')) : done(stdout)));
  assertVersion(version);
  const args: string[] = [kind];
  for (const [key, value] of Object.entries({ ...options.configOverrides,
    ...(options.homeMode === 'ordinary' ? {} : { cli_auth_credentials_store: 'file' }) })) {
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error('invalid-config-key');
    args.push('-c', `${key}=${JSON.stringify(value)}`);
  }
  if (!sameFile(executable, fileIdentity(executable.path))) throw new Error('codex-executable-changed');
  const rpc = createStdioTransport({ executable: executable.path, args, cwd: workspace, env,
    ...providerTimeoutPolicy(kind, options),
    protocol: kind === 'app-server' ? 'app-server' : 'jsonrpc' });
  const keys = Object.keys(env).filter(key => key !== 'CODEX_HOME').sort();
  recordLaunch(rpc, { provider: kind, executable, executableSha256, version: version.trim(), workspace, codexHome: home,
    inheritedEnvironmentKeys: keys, environmentValueDigests: Object.fromEntries(keys.map(key => [key, createHash('sha256').update(env[key]!).digest('hex')])),
    windowsKeyCasingReviewed: new Set(Object.keys(env).map(key => key.toUpperCase())).size === Object.keys(env).length, observedAt: new Date().toISOString() });
  return rpc;
}
