import { execFile } from 'node:child_process';

export const EXPECTED_CODEX_VERSION = '0.153.4';
type Probe = (command: 'version' | 'login') => Promise<{ ok: boolean; output: string }>;

// These fixed commands only inspect installation/account status. Never return raw CLI
// output: login output can contain an account identifier or a fragment of an API key.
const probe: Probe = command => new Promise(resolve => {
  const args = command === 'version' ? ['--version'] : ['login', 'status'];
  const executable = process.platform === 'win32' ? 'powershell.exe' : 'codex';
  const argv = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', `& codex ${args.join(' ')}; exit $LASTEXITCODE`]
    : args;
  execFile(executable, argv, { timeout: 5000, maxBuffer: 16384, windowsHide: true }, (error, stdout, stderr) => {
    resolve({ ok: !error, output: `${stdout}\n${stderr}` });
  });
});

export function createDiagnostics(run: Probe = probe) {
  let pending: Promise<Awaited<ReturnType<typeof inspect>>> | undefined;
  let checkedAt = 0;
  async function inspect() {
    const versionResult = await run('version');
    const version = versionResult.ok ? /(?:^|\n)codex(?:-cli)?[ \t]+(\S+)[ \t]*(?:\r?\n|$)/.exec(versionResult.output)?.[1] ?? null : null;
    const loginResult = version ? await run('login') : undefined;
    const login = loginResult && /(?:^|\n)(?:not logged in|logged out)\b/i.test(loginResult.output) ? 'signed-out'
      : loginResult?.ok && /(?:^|\n)logged in\b/i.test(loginResult.output) ? 'signed-in' : 'unknown';
    return {
      status: version ? version === EXPECTED_CODEX_VERSION ? 'installed' : 'version-mismatch' : 'unavailable',
      expectedVersion: EXPECTED_CODEX_VERSION, version, login,
      sandbox: 'unverified', isolation: 'unverified', execution: 'unverified',
      checkedAt: new Date().toISOString(),
    };
  }
  return (refresh = false) => {
    if (!pending || refresh || Date.now() - checkedAt > 30000) {
      checkedAt = Date.now();
      pending = inspect().catch(() => ({ status: 'unavailable', expectedVersion: EXPECTED_CODEX_VERSION,
        version: null, login: 'unknown', sandbox: 'unverified', isolation: 'unverified', execution: 'unverified', checkedAt: new Date().toISOString() }));
    }
    return pending;
  };
}
