import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { dedicatedRuntimeIdentity } from '../daemon/runtime-identity.ts';
import { providerEnvironment } from '../daemon/providers/preflight.ts';

test('ordinary environment preserves integration variables, dedicated mode stays bounded, and selected home wins', () => {
  const source = { PATH: '/fixture/bin', CODEX_HOME: '/managed', codex_home: '/other-managed',
    READER_TOOL_KEY: 'synthetic-tool-value', OPENAI_API_KEY: 'synthetic-api-value', HTTPS_PROXY: 'http://proxy.example.test' };
  const ordinary = providerEnvironment('/reader/.codex', source, 'ordinary');
  assert.deepEqual(ordinary, { PATH: source.PATH, CODEX_HOME: '/reader/.codex',
    READER_TOOL_KEY: source.READER_TOOL_KEY, OPENAI_API_KEY: source.OPENAI_API_KEY, HTTPS_PROXY: source.HTTPS_PROXY });
  assert.equal(source.CODEX_HOME, '/managed'); assert.equal(source.codex_home, '/other-managed');
  assert.deepEqual(providerEnvironment('/dedicated', source), { CODEX_HOME: '/dedicated', PATH: source.PATH });
});

test('zero-env discovery uses PATH native executable and ordinary home, never ambient managed home', async t => {
  const root = await mkdtemp(join(tmpdir(), 'a7-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), user = join(root, 'reader');
  await mkdir(bin); await mkdir(join(user, '.codex'), { recursive: true });
  const executable = join(bin, process.platform === 'win32' ? 'codex.exe' : 'codex');
  await writeFile(executable, 'never executed');
  const env = { PATH: `relative${delimiter}${bin}`, CODEX_HOME: join(root, 'managed-account') };
  assert.deepEqual(dedicatedRuntimeIdentity({ env, userHome: user }), {
    executable: await realpath(executable), codexHome: await realpath(join(user, '.codex')), homeMode: 'ordinary',
  });
  assert.equal(dedicatedRuntimeIdentity({ env: { ...env, MARGINALIA_CODEX_HOME: join(root, 'missing') }, userHome: user }), undefined);
  assert.equal(dedicatedRuntimeIdentity({ env: { PATH: '' }, userHome: user }), undefined);
});

test('explicit dedicated pair stays disjoint and invalid override never falls through to discovery', async t => {
  const root = await mkdtemp(join(tmpdir(), 'a7-dedicated-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const user = join(root, 'reader'), home = join(root, 'dedicated'), executable = join(root, 'codex.exe');
  await mkdir(join(user, '.codex'), { recursive: true }); await mkdir(home); await writeFile(executable, 'never executed');
  const env = { PATH: root, MARGINALIA_CODEX_EXECUTABLE: executable, MARGINALIA_CODEX_HOME: home };
  assert.deepEqual(dedicatedRuntimeIdentity({ env, userHome: user }), { executable: await realpath(executable), codexHome: await realpath(home) });
  assert.equal(dedicatedRuntimeIdentity({ env: { ...env, MARGINALIA_CODEX_HOME: join(user, '.codex') }, userHome: user }), undefined);
  assert.equal(dedicatedRuntimeIdentity({ env: { ...env, MARGINALIA_CODEX_EXECUTABLE: 'relative.exe' }, userHome: user }), undefined);
});

test('Windows npm discovery resolves the native optional package without running cmd or ps1 shims', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'a7-npm-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`;
  const executable = join(root, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', target, 'bin', 'codex.exe');
  await mkdir(join(executable, '..'), { recursive: true }); await writeFile(executable, 'never executed');
  await mkdir(join(root, '.codex')); await writeFile(join(root, 'codex.cmd'), 'must not execute');
  assert.equal(dedicatedRuntimeIdentity({ env: { PATH: root }, userHome: root })?.executable, await realpath(executable));
});
