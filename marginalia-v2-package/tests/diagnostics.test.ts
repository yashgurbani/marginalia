import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics } from '../daemon/diagnostics.ts';

test('diagnostics distinguish installation, login, version mismatch and execution evidence without exposing CLI output', async () => {
  let calls = 0;
  const check = createDiagnostics(async command => {
    calls++;
    return { ok: true, output: command === 'version' ? 'codex-cli 0.153.4' : 'Logged in using API key - secret-account-detail' };
  });
  const result = await check();
  assert.equal(result.status, 'installed');
  assert.equal(result.login, 'signed-in');
  assert.equal(result.sandbox, 'unverified');
  assert.equal(result.isolation, 'unverified');
  assert.equal(result.execution, 'unverified');
  assert.equal(JSON.stringify(result).includes('secret-account-detail'), false);
  await check(); assert.equal(calls, 2);
  await check(true); assert.equal(calls, 4);
  const mismatch = await createDiagnostics(async command => ({ ok: command === 'version', output: command === 'version' ? 'codex-cli 0.153.3' : 'Not logged in' }))();
  assert.equal(mismatch.status, 'version-mismatch'); assert.equal(mismatch.login, 'signed-out');
  const prerelease = await createDiagnostics(async command => ({ ok: true, output: command === 'version' ? 'codex-cli 0.153.4-beta' : 'Not logged in' }))();
  assert.equal(prerelease.status, 'version-mismatch'); assert.equal(prerelease.login, 'signed-out');
  const absent = await createDiagnostics(async () => { throw new Error('secret path'); })();
  assert.equal(absent.status, 'unavailable'); assert.equal(absent.login, 'unknown');
  assert.equal(JSON.stringify(absent).includes('secret path'), false);
});
