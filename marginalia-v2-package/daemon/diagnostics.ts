import { execFile } from 'node:child_process';
import { posix, win32 } from 'node:path';
import { PINNED_CODEX_VERSION, providerEnvironment } from './providers/preflight.ts';

export const EXPECTED_CODEX_VERSION = PINNED_CODEX_VERSION;

/** Host-owned, absolute paths from the same validated configuration as runtime launch.
 * Never obtain either value from a browser request, PATH lookup or a default home. */
export interface DiagnosticsConfiguration {
  readonly executable: string;
  readonly codexHome: string;
}
export interface DiagnosticsResult {
  readonly status: 'installed' | 'version-mismatch' | 'unavailable';
  readonly expectedVersion: string;
  /** Only a plain numeric release is public; decorated versions are withheld. */
  readonly version: string | null;
  readonly login: 'signed-in' | 'signed-out' | 'unknown';
  readonly sandbox: 'unverified';
  readonly isolation: 'unverified';
  readonly execution: 'unverified';
}
interface ProbeOptions {
  env: NodeJS.ProcessEnv;
  encoding: 'utf8';
  shell: false;
  timeout: number;
  maxBuffer: number;
  windowsHide: boolean;
}
type Execute = (executable: string, argv: readonly string[], options: ProbeOptions,
  done: (error: Error | null, stdout: string, stderr: string) => void) => void;
export interface DiagnosticsDependencies {
  /** Child-process boundary for tests; no real installation is needed. */
  execute?: Execute;
  now?: () => number;
  platform?: NodeJS.Platform;
}
const execute: Execute = (executable, argv, options, done) => {
  execFile(executable, [...argv], options, done);
};
const unavailable = (): DiagnosticsResult => ({ status: 'unavailable', expectedVersion: EXPECTED_CODEX_VERSION,
  version: null, login: 'unknown', sandbox: 'unverified', isolation: 'unverified', execution: 'unverified' });

function configuration(value: DiagnosticsConfiguration | undefined, platform: NodeJS.Platform): DiagnosticsConfiguration | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !['win32', 'linux', 'darwin'].includes(platform)) return undefined;
    const { executable, codexHome } = value;
    const path = platform === 'win32' ? win32 : posix;
    const absolute = (input: unknown): input is string => typeof input === 'string'
      && !/[\x00-\x1f\x7f]/.test(input) && path.isAbsolute(input)
      // A Windows root-relative path still depends on the process's current drive.
      && (platform !== 'win32' || path.parse(input).root.length > 1);
    if (!absolute(executable) || !absolute(codexHome)) return undefined;
    // Match runtime's native Windows executable requirement, never a shell shim.
    if (platform === 'win32' && !/\.exe$/i.test(executable)) return undefined;
    return { executable, codexHome };
  } catch { return undefined; }
}

export function createDiagnostics(config?: DiagnosticsConfiguration, dependencies: DiagnosticsDependencies = {}) {
  // Copy the identity once: a cached checker must not silently switch installations.
  const target = configuration(config, dependencies.platform ?? process.platform);
  const run = dependencies.execute ?? execute, now = dependencies.now ?? Date.now;
  let pending: Promise<DiagnosticsResult> | undefined;
  let checkedAt = 0;
  async function inspect(): Promise<DiagnosticsResult> {
    if (!target) return unavailable();
    const env = providerEnvironment(target.codexHome);
    const probe = (argv: readonly string[]) => new Promise<{ ok: boolean; output: string }>(resolve => {
      try {
        run(target.executable, argv, { env: { ...env }, encoding: 'utf8', shell: false,
          timeout: 5000, maxBuffer: 16384, windowsHide: true }, (error, stdout, stderr) => {
          resolve({ ok: !error, output: `${stdout}\n${stderr}` });
        });
      } catch { resolve({ ok: false, output: '' }); }
    });
    const release = await probe(['--version']);
    // Recognize bounded version syntax, not an arbitrary CLI token that may be a path
    // or credential. Never expose free-form prerelease/build identifiers either.
    const match = release.ok ? /(?:^|\n)codex(?:-cli)?[ \t]+((?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5}))([+-][0-9A-Za-z.+-]{1,128})?[ \t]*(?:\r?\n|$)/.exec(release.output) : null;
    if (!match) return unavailable();
    const version = match[2] ? null : match[1];
    // Runtime launch forces file-backed credentials; status must inspect that store,
    // not an ambient desktop/keyring identity. These arguments contain no user text.
    const account = await probe(['-c', 'cli_auth_credentials_store="file"', 'login', 'status']);
    const login = /(?:^|\n)(?:not logged in|logged out)\b/i.test(account.output) ? 'signed-out'
      : account.ok && /(?:^|\n)logged in\b/i.test(account.output) ? 'signed-in' : 'unknown';
    return { status: !match[2] && version === EXPECTED_CODEX_VERSION ? 'installed' : 'version-mismatch',
      expectedVersion: EXPECTED_CODEX_VERSION, version, login,
      sandbox: 'unverified', isolation: 'unverified', execution: 'unverified' };
  }
  return (refresh = false): Promise<DiagnosticsResult> => {
    if (!pending || refresh || now() - checkedAt > 30000) {
      checkedAt = now();
      pending = inspect().catch(() => unavailable());
    }
    return pending;
  };
}
