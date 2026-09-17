import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createDiagnostics, EXPECTED_CODEX_VERSION, type DiagnosticsConfiguration, type DiagnosticsDependencies } from '../daemon/diagnostics.ts';
import { providerEnvironment } from '../daemon/providers/preflight.ts';

type Execute = NonNullable<DiagnosticsDependencies['execute']>;
const config = { executable: '/fixture/bin with spaces/codex', codexHome: '/fixture/dedicated home' };
const available: Execute = (_file, argv, _options, done) => done(null,
  argv[0] === '--version' ? `codex-cli ${EXPECTED_CODEX_VERSION}` : 'Logged in using API key - ACCOUNT_SENTINEL', '');
const check = (execute: Execute = available, extra: DiagnosticsDependencies = {}) =>
  createDiagnostics(config, { platform: 'linux', execute, ...extra });

for (const [platform, identity] of [
  ['linux', config],
  ['darwin', { executable: '/fixture/Application Support/codex', codexHome: '/fixture/mac dedicated home' }],
  ['win32', { executable: 'C:\\Fixture & tools\\codex.EXE', codexHome: 'D:\\Fixture dedicated home' }],
] as const) test(`configured identity and provider environment reach both direct probes on ${platform}`, async () => {
  const before = { ...process.env };
  const old = { CODEX_HOME: process.env.CODEX_HOME, OPENAI_API_KEY: process.env.OPENAI_API_KEY, HTTPS_PROXY: process.env.HTTPS_PROXY };
  Object.assign(process.env, { CODEX_HOME: 'AMBIENT_HOME_SENTINEL', OPENAI_API_KEY: 'KEY_SENTINEL', HTTPS_PROXY: 'PROXY_SENTINEL' });
  try {
    const parent = { ...process.env }, calls: Parameters<Execute>[] = [];
    const result = await createDiagnostics(identity, { platform, execute: (...args) => {
      calls.push(args); available(...args);
    } })();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(args => args[1]), [
      ['--version'], ['-c', 'cli_auth_credentials_store="file"', 'login', 'status'],
    ]);
    for (const [file, _argv, options] of calls) {
      assert.equal(file, identity.executable);
      assert.ok(isDeepStrictEqual(options.env, providerEnvironment(identity.codexHome)), 'provider environment must match without exposing its values');
      assert.equal(options.env.CODEX_HOME, identity.codexHome);
      assert.equal(options.env.OPENAI_API_KEY, undefined);
      assert.equal(options.env.HTTPS_PROXY, undefined);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 5000); assert.equal(options.maxBuffer, 16384);
      assert.equal(options.windowsHide, true); assert.equal(options.encoding, 'utf8');
    }
    assert.notStrictEqual(calls[0][2].env, calls[1][2].env);
    assert.ok(isDeepStrictEqual({ ...process.env }, parent), 'diagnostics must not mutate the parent environment');
    assert.deepEqual(result, { status: 'installed', expectedVersion: EXPECTED_CODEX_VERSION,
      version: EXPECTED_CODEX_VERSION, login: 'signed-in', sandbox: 'unverified', isolation: 'unverified', execution: 'unverified' });
    const publicText = JSON.stringify(result);
    for (const secret of [identity.executable, identity.codexHome, 'ACCOUNT_SENTINEL', 'KEY_SENTINEL', 'AMBIENT_HOME_SENTINEL']) {
      assert.equal(publicText.includes(secret), false);
    }
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.ok(isDeepStrictEqual({ ...process.env }, before), 'the test must restore the parent environment');
  }
});

test('absent or invalid host configuration never invokes a child, including on refresh', async () => {
  let calls = 0;
  const execute: Execute = (...args) => { calls++; available(...args); };
  const invalid: unknown[] = [undefined, null, {}, [], 'codex', { executable: 'codex', codexHome: config.codexHome },
    { executable: config.executable, codexHome: '' }, { executable: config.executable, codexHome: '.codex' },
    { executable: 1, codexHome: config.codexHome }, { executable: config.executable, codexHome: null },
    { executable: '/bin/codex\0', codexHome: config.codexHome }, { executable: config.executable, codexHome: '/home\ninvalid' }];
  for (const value of invalid) {
    const diagnostics = createDiagnostics(value as DiagnosticsConfiguration, { platform: 'linux', execute });
    for (const refresh of [false, true]) {
      const result = await diagnostics(refresh);
      assert.equal(result.status, 'unavailable'); assert.equal(result.login, 'unknown'); assert.equal(result.version, null);
    }
  }
  for (const executable of ['codex.exe', 'C:codex.exe', '\\codex.exe', 'C:\\codex.cmd', 'C:\\codex.bat', 'C:\\codex.ps1']) {
    assert.equal((await createDiagnostics({ executable, codexHome: 'C:\\dedicated' }, { platform: 'win32', execute })()).status, 'unavailable');
  }
  assert.equal((await createDiagnostics({ executable: 'C:\\codex.exe', codexHome: '\\dedicated' }, { platform: 'win32', execute })()).status, 'unavailable');
  assert.equal((await createDiagnostics(config, { platform: 'freebsd', execute })()).status, 'unavailable');
  assert.equal(calls, 0);
  const oldExecutable = process.env.MARGINALIA_CODEX_EXECUTABLE, oldHome = process.env.CODEX_HOME;
  try {
    process.env.MARGINALIA_CODEX_EXECUTABLE = config.executable; process.env.CODEX_HOME = config.codexHome;
    assert.equal((await createDiagnostics(undefined, { execute })()).status, 'unavailable');
    assert.equal(calls, 0);
  } finally {
    if (oldExecutable === undefined) delete process.env.MARGINALIA_CODEX_EXECUTABLE; else process.env.MARGINALIA_CODEX_EXECUTABLE = oldExecutable;
    if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
  }
});

test('version mismatch and signed-out remain independent of execution evidence', async () => {
  for (const version of [EXPECTED_CODEX_VERSION, '0.153.3', `${EXPECTED_CODEX_VERSION}-beta`, `${EXPECTED_CODEX_VERSION}+BUILD-SENTINEL`]) {
    const result = await check((_file, argv, _options, done) => argv[0] === '--version'
      ? done(null, `codex-cli ${version}`, '') : done(new Error('ACCOUNT_SENTINEL'), '', 'Not logged in'))();
    assert.equal(result.status, version === EXPECTED_CODEX_VERSION ? 'installed' : 'version-mismatch'); assert.equal(result.login, 'signed-out');
    assert.equal(result.version, version.includes('-') || version.includes('+') ? null : version);
    assert.equal(result.sandbox, 'unverified'); assert.equal(result.isolation, 'unverified'); assert.equal(result.execution, 'unverified');
    assert.equal(JSON.stringify(result).includes('SENTINEL'), false);
  }
});

test('arbitrary version tokens and raw failure details never become public diagnostics', async () => {
  for (const token of [config.executable, config.codexHome, 'ACCOUNT_SENTINEL', 'sk-KEY_SENTINEL']) {
    let calls = 0;
    const result = await check((_file, _argv, _options, done) => { calls++; done(null, `codex-cli ${token}`, 'ACCOUNT_SENTINEL'); })();
    assert.equal(result.status, 'unavailable'); assert.equal(result.login, 'unknown'); assert.equal(result.version, null);
    assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes(token), false);
  }
  const thrown = await check(() => { throw new Error(`${config.executable}: KEY_SENTINEL`); })();
  assert.equal(thrown.status, 'unavailable'); assert.equal(thrown.login, 'unknown');
  assert.equal(JSON.stringify(thrown).includes('SENTINEL'), false);
  const failed = await check((_file, _argv, _options, done) => done(new Error(config.codexHome), `codex-cli ${EXPECTED_CODEX_VERSION}`, 'KEY_SENTINEL'))();
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.version, null);
});

test('login probe failure preserves observed version but never implies sign-in or readiness', async () => {
  for (const failure of ['throw', 'callback'] as const) {
    const result = await check((_file, argv, _options, done) => {
      if (argv[0] === '--version') return done(null, `codex-cli ${EXPECTED_CODEX_VERSION}`, '');
      if (failure === 'throw') throw new Error('ACCOUNT_SENTINEL');
      done(new Error(config.codexHome), 'Logged in using KEY_SENTINEL', '');
    })();
    assert.equal(result.status, 'installed'); assert.equal(result.login, 'unknown');
    assert.equal(result.execution, 'unverified'); assert.equal(JSON.stringify(result).includes('SENTINEL'), false);
  }
});

test('cache shares pending work, expires after 30 seconds, and refresh bypasses success and failure caches', async () => {
  let now = 100, calls = 0;
  const diagnostics = check((...args) => { calls++; available(...args); }, { now: () => now });
  const first = diagnostics(); assert.strictEqual(diagnostics(), first);
  await first; assert.equal(calls, 2);
  now += 30000; await diagnostics(); assert.equal(calls, 2);
  now++; await diagnostics(); assert.equal(calls, 4);
  await diagnostics(true); assert.equal(calls, 6);
  let failures = 0;
  const absent = check(() => { failures++; throw new Error('KEY_SENTINEL'); }, { now: () => now });
  await absent(); await absent(); assert.equal(failures, 1);
  await absent(true); assert.equal(failures, 2);
  now += 30001; await absent(); assert.equal(failures, 3);
});

test('a checker snapshots its host identity; reconfiguration requires a new checker', async () => {
  const identity = { ...config }, files: string[] = [];
  const diagnostics = createDiagnostics(identity, { platform: 'linux', execute: (file, argv, options, done) => {
    files.push(file); assert.equal(options.env.CODEX_HOME, config.codexHome); available(file, argv, options, done);
  } });
  identity.executable = '/fixture/replaced-codex'; identity.codexHome = '/fixture/replaced-home';
  await diagnostics(); await diagnostics(true);
  assert.deepEqual(files, Array(4).fill(config.executable));
});
