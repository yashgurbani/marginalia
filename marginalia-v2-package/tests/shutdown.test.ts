import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePrivateDataDirectory, runShutdown, shutdownSignals } from '../daemon/shutdown.ts';

test('shutdown signals match the host platform lifecycle', () => {
  assert.deepEqual(shutdownSignals('win32'), ['SIGINT', 'SIGBREAK', 'SIGHUP']);
  assert.deepEqual(shutdownSignals('linux'), ['SIGINT', 'SIGTERM', 'SIGHUP']);
  assert.deepEqual(shutdownSignals('darwin'), ['SIGINT', 'SIGTERM', 'SIGHUP']);
});

test('completed shutdown clears its hard deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events: string[] = [];

  await runShutdown({
    closeTerminal: () => { events.push('terminal'); },
    closeServer: async () => { events.push('server'); },
    closeSolver: () => { events.push('solver'); },
    exit: code => { events.push(`exit:${code}`); },
  });
  t.mock.timers.tick(5_000);

  assert.deepEqual(events, ['terminal', 'server', 'solver', 'exit:0']);
});

test('shutdown hard deadline exits when the server drain never resolves', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const exits: number[] = [];

  void runShutdown({
    closeTerminal: () => undefined,
    closeServer: () => new Promise<void>(() => undefined),
    closeSolver: () => undefined,
    exit: code => { exits.push(code); },
  });
  t.mock.timers.tick(4_999);
  assert.deepEqual(exits, []);
  t.mock.timers.tick(1);

  assert.deepEqual(exits, [1]);
});

test('new data directories are private on POSIX', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-private-dir-'));
  const dataDir = join(root, 'data');
  try {
    ensurePrivateDataDirectory(dataDir);
    assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
