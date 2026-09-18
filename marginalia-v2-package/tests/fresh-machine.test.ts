import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const main = fileURLToPath(new URL('../daemon/main.ts', import.meta.url));
const origin = 'chrome-extension://' + 'f'.repeat(32);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

type Helper = { child: ChildProcessWithoutNullStreams; challenge: string; stdout: string; stderr: string };
async function launch(dataDir: string, port: number, extra: NodeJS.ProcessEnv = {}): Promise<Helper> {
  const env: NodeJS.ProcessEnv = { ...process.env, MARGINALIA_DATA_DIR: dataDir, MARGINALIA_PORT: String(port), ...extra };
  delete env.MARGINALIA_AUTHORIZED_RUNTIME_MODULE;
  if (!Object.hasOwn(extra, 'MARGINALIA_CODEX_EXECUTABLE')) delete env.MARGINALIA_CODEX_EXECUTABLE;
  const child = spawn(process.execPath, [main], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const helper: Helper = { child, challenge: '', stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { helper.stdout += chunk; });
  child.stderr.on('data', chunk => { helper.stderr += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`helper startup timed out\n${helper.stdout}\n${helper.stderr}`)), 10_000);
    const ready = () => {
      const match = /Pairing code: (\d{6})/.exec(helper.stdout);
      if (match && /Codex: .*; sign-in: .*\. Execution remains unverified\./.test(helper.stdout)) {
        helper.challenge = match[1]!; clearTimeout(timeout); resolve();
      }
    };
    child.stdout.on('data', ready);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { if (!helper.challenge) { clearTimeout(timeout); reject(new Error(`helper exited ${code}\n${helper.stderr}`)); } });
  });
  return helper;
}

async function stop(helper: Helper): Promise<void> {
  const exited = new Promise<void>(resolve => helper.child.once('exit', () => resolve()));
  helper.child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  await exited;
}

test('a fresh machine can pair, restart, and read saved work while Codex is signed out', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'marginalia-fresh-'));
  const emptyCodexHome = mkdtempSync(join(tmpdir(), 'marginalia-signed-out-'));
  const port = await freePort();
  let helper: Helper | undefined;
  let token = '';
  let saved: unknown;
  const headers = () => ({ Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  try {
    await t.test('fresh data starts the helper and issues a pairing challenge', async () => {
      helper = await launch(dataDir, port);
      assert.match(helper.stdout, new RegExp(`Marginalia local helper: http://127\\.0\\.0\\.1:${port}`));
      assert.match(helper.challenge, /^\d{6}$/);
    });
    await t.test('paired reader data survives a helper stop and restart', async () => {
      assert.ok(helper);
      const paired = await fetch(`http://127.0.0.1:${port}/pair`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: helper.challenge }) });
      assert.equal(paired.status, 200);
      token = (await paired.json() as { token: string }).token;
      const change = { id: 'fresh-keep', kind: 'keep', threadId: 'fresh-thread', note: 'Still here after restart.',
        capture: { url: 'https://example.org/fresh', title: 'Fresh machine', pageType: 'article', text: 'A durable passage.', capturedAt: '2026-09-18T08:00:00Z', extractionVersion: 'text-v1' },
        anchor: { exact: 'A durable passage.', prefix: '', suffix: '', start: 0, end: 18 } };
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/change`, { method: 'POST', headers: headers(), body: JSON.stringify(change) })).status, 200);
      saved = await (await fetch(`http://127.0.0.1:${port}/api/threads`, { headers: headers() })).json();
      assert.match(JSON.stringify(saved), /Still here after restart\./);
      await stop(helper); helper = await launch(dataDir, port);
      const reopened = await (await fetch(`http://127.0.0.1:${port}/api/threads`, { headers: headers() })).json();
      assert.deepEqual(reopened, saved);
    });
    await t.test('an empty Codex home leaves saved reading available with a plain status', async () => {
      assert.ok(helper); await stop(helper);
      helper = await launch(dataDir, port, { MARGINALIA_CODEX_HOME: emptyCodexHome });
      assert.match(helper.stdout, /Codex: unavailable; sign-in: unknown\. Execution remains unverified\./);
      assert.doesNotMatch(helper.stdout + helper.stderr, /(?:^|\n)\s*at |Error:|node:/);
      const reopened = await (await fetch(`http://127.0.0.1:${port}/api/threads`, { headers: headers() })).json();
      assert.deepEqual(reopened, saved);
    });
  } finally {
    if (helper && helper.child.exitCode === null) await stop(helper);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(emptyCodexHome, { recursive: true, force: true });
  }
});

function run(file: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => execFile(file, args, { cwd: root, windowsHide: true },
    (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
}

test('shell installer dry-run prints its service plan without changing the machine', {
  skip: process.platform === 'win32' ? 'POSIX service lifecycle is not available on Windows' : false,
}, async () => {
  const { stdout, stderr } = await run('bash', ['scripts/install-helper.sh', '--dry-run']);
  assert.equal(stderr, '');
  assert.match(stdout, /DRY RUN/); assert.match(stdout, /npm ci.*node_modules/i);
  assert.match(stdout, /LaunchAgent.*launchctl|systemd user unit.*systemctl/i);
  assert.match(stdout, /http:\/\/127\.0\.0\.1:43120\//);
  assert.match(stdout, /To pair, open the helper address in a browser, choose "Show pairing code", then enter the code in the extension options\./);
  assert.doesNotMatch(stdout, /Pairing code: \d{6}/);
  const removed = await run('bash', ['scripts/install-helper.sh', '--uninstall', '--dry-run']);
  assert.match(removed.stdout, /remove.*retain/i);
  assert.match(removed.stdout, /helper is stopped/i);
  assert.doesNotMatch(removed.stdout, /Show pairing code/);
});

test('PowerShell installer dry-run prints its Scheduled Task plan', async t => {
  let result: { stdout: string; stderr: string };
  try { result = await run('pwsh', ['-NoProfile', '-File', 'scripts/install-helper.ps1', '-DryRun']); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { t.skip('pwsh is not on PATH'); return; }
    throw error;
  }
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /DRY RUN/); assert.match(result.stdout, /npm ci.*node_modules/i);
  assert.match(result.stdout, /Scheduled Task.*logon/i);
  assert.match(result.stdout, /http:\/\/127\.0\.0\.1:43120\//);
  assert.match(result.stdout, /To pair, open the helper address in a browser, choose "Show pairing code", then enter the code in the extension options\./);
  assert.doesNotMatch(result.stdout, /Pairing code: \d{6}/);
  const removed = await run('pwsh', ['-NoProfile', '-File', 'scripts/install-helper.ps1', '-Uninstall', '-DryRun']);
  assert.match(removed.stdout, /remove.*retain/i);
  assert.match(removed.stdout, /helper is stopped/i);
  assert.doesNotMatch(removed.stdout, /Show pairing code/);
});
