import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../daemon/server.ts';
import { createLazySolverTransport } from '../daemon/solver/lazy-transport.ts';
import type { RpcTransport } from '../daemon/providers/stdio.ts';

function fakeRpc(): RpcTransport {
  return {
    async request(method) { return { method }; },
    notify() {},
    onNotification() { return () => {}; },
    onDisconnect() { return () => {}; },
    close() {},
  };
}

test('starting the server with a lazy solver transport does not launch Codex', async () => {
  let launches = 0, inspections = 0;
  const lazy = createLazySolverTransport({
    launch: async () => { launches += 1; return fakeRpc(); },
    inspect: async () => { inspections += 1; },
    rpcTimeoutMs: 60_000,
  });
  const helper = await startServer({ database: ':memory:', port: 0,
    solverTransport: lazy, solverRpc: lazy, solverProbeRoot: 'test-probes' });
  try {
    assert.equal(launches, 0);
    assert.equal(inspections, 0);
    await lazy.request('windowsSandbox/readiness');
    assert.equal(launches, 1);
    assert.equal(inspections, 1);
  } finally {
    await helper.close();
    lazy.close();
  }
});

test('two concurrent first solver calls share one launch', async () => {
  let launches = 0;
  let release!: () => void;
  const launched = new Promise<void>(done => { release = done; });
  const lazy = createLazySolverTransport({
    launch: async () => { launches += 1; await launched; return fakeRpc(); },
    inspect: async () => {},
    rpcTimeoutMs: 60_000,
  });

  const first = lazy.request('first');
  const second = lazy.request('second');
  assert.equal(launches, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ method: 'first' }, { method: 'second' }]);
  assert.equal(launches, 1);
  lazy.close();
});

test('a launch failure keeps its real reason and the next call retries', async () => {
  let launches = 0;
  const lazy = createLazySolverTransport({
    launch: async () => {
      launches += 1;
      if (launches === 1) throw new Error('codex launch failed: test reason');
      return fakeRpc();
    },
    inspect: async () => {},
    rpcTimeoutMs: 60_000,
  });

  await assert.rejects(lazy.request('first'), /codex launch failed: test reason/);
  assert.equal(lazy.lastLaunchFailureReason(), 'codex launch failed: test reason');
  assert.deepEqual(await lazy.request('second'), { method: 'second' });
  assert.equal(launches, 2);
  assert.equal(lazy.lastLaunchFailureReason(), 'codex launch failed: test reason');
  lazy.close();
});
