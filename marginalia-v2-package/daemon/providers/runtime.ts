import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { createStdioTransport, type RpcTransport } from './stdio.ts';
import { assertSeparateHome, assertVersion, providerEnvironment } from './preflight.ts';

export interface RuntimeOptions {
  executable: string;
  workspace: string;
  codexHome: string;
  configOverrides?: Readonly<Record<string, unknown>>;
  timeoutMs?: number;
}
/** Native executable required on Windows: never interpolate paths or config into a shell. */
export async function launchProvider(kind: 'app-server' | 'mcp-server', options: RuntimeOptions): Promise<RpcTransport> {
  if (!isAbsolute(options.executable)) throw new Error('absolute-codex-executable-required');
  const workspace = await realpath(options.workspace), home = await realpath(options.codexHome);
  assertSeparateHome(home, workspace);
  const normalHomes = [join(homedir(), '.codex'), process.env.CODEX_HOME].filter((x): x is string => !!x);
  for (const normal of normalHomes) {
    const actual = await realpath(normal).catch(() => resolve(normal));
    if (home.toLowerCase() === actual.toLowerCase()) throw new Error('dedicated-codex-home-required');
  }
  const env = providerEnvironment(home);
  const version = await new Promise<string>((done, reject) => execFile(options.executable, ['--version'],
    { cwd: workspace, env, windowsHide: true, timeout: 5000, maxBuffer: 16384 }, (error, stdout) => error ? reject(new Error('codex-version-unavailable')) : done(stdout)));
  assertVersion(version);
  const args: string[] = [kind];
  for (const [key, value] of Object.entries({ ...options.configOverrides, cli_auth_credentials_store: 'file' })) {
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error('invalid-config-key');
    args.push('-c', `${key}=${JSON.stringify(value)}`);
  }
  return createStdioTransport({ executable: options.executable, args, cwd: workspace, env,
    timeoutMs: options.timeoutMs ?? (kind === 'mcp-server' ? 600_000 : 30_000),
    protocol: kind === 'app-server' ? 'app-server' : 'jsonrpc' });
}
