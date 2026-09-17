import test from 'node:test';
import assert from 'node:assert/strict';
import { localPersistence } from '../ui/persistence.ts';

test('reply lock awaits operations, serializes mounts, preserves results and recovers after rejection', async t => {
  const oldDatabase = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let held = 0;
  const entered: string[] = [];
  // refresh exercises the production queue/lock without reading or writing IDB.
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open: () => ({}) } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    async request(name: string, operation: () => Promise<unknown>) {
      entered.push(name); held++;
      assert.equal(held, 1, 'overlapping operations entered the same reply lock');
      try { return await operation(); } finally { held--; }
    },
  } } });
  t.after(() => {
    if (oldDatabase) Object.defineProperty(globalThis, 'indexedDB', oldDatabase); else Reflect.deleteProperty(globalThis, 'indexedDB');
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
  });
  const name = 'lock-test-' + crypto.randomUUID();
  const firstMount = localPersistence(name), secondMount = localPersistence(name);
  let release!: () => void, signalEntered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { signalEntered = resolve; });
  const failure = new Error('write failed');
  const first = firstMount.replies.refresh('http://localhost:3210', 'thread', async () => {
    signalEntered(); await gate; throw failure;
  });
  const rejected = assert.rejects(first, error => error === failure);
  await started;
  let secondRan = false;
  const second = secondMount.replies.refresh('http://localhost:3210', 'thread', async () => { secondRan = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(held, 1); assert.equal(secondRan, false); assert.equal(entered.length, 1);
  release(); await rejected; assert.equal(await second, undefined);
  assert.equal(secondRan, true); assert.equal(held, 0);
  assert.equal(entered.length, 2); assert.equal(entered[0], entered[1]);
  await firstMount.replies.refresh('http://localhost:3210', 'thread', async () => {});
  assert.equal(held, 0); assert.equal(entered.length, 3);
});
