import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('helper launch explains an occupied configured port without a raw stack', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const address = occupied.address();
  assert.ok(address && typeof address !== 'string');
  const data = mkdtempSync(join(tmpdir(), 'marginalia-startup-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, MARGINALIA_DATA_DIR: data, MARGINALIA_PORT: String(address.port) };
    for (const key of ['MARGINALIA_AUTHORIZED_RUNTIME_MODULE', 'MARGINALIA_CODEX_EXECUTABLE', 'MARGINALIA_CODEX_HOME']) delete env[key];
    const result = await new Promise<{ code: number | string | null | undefined; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, [fileURLToPath(new URL('../daemon/main.ts', import.meta.url))],
        { env, timeout: 10000, windowsHide: true }, (error, stdout, stderr) => resolve({ code: error?.code, stdout, stderr }));
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`Another program is using port ${address.port}\\.`));
    assert.match(result.stderr, /start Marginalia on another port/);
    assert.doesNotMatch(result.stderr, /at Server\.|node:net|EADDRINUSE|listen E/);
    assert.doesNotMatch(result.stdout, /Pairing code:|Reading and notes are ready/);
    assert.equal(occupied.listening, true, 'the existing service must not be stopped');
  } finally {
    await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));
    rmSync(data, { recursive: true, force: true });
  }
});
