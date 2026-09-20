import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStdioTransport, type RpcTransport } from '../daemon/providers/stdio.ts';

function transportFor(source: string, options: { protocol?: 'app-server' | 'jsonrpc'; timeoutMs?: number; maxMessageBytes?: number } = {}): RpcTransport {
  return createStdioTransport({
    executable: process.execPath,
    args: ['--input-type=module', '--eval', source + `\nprocess.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'test/fixture-ready'})+'\\n');`],
    cwd: process.cwd(),
    env: { ...process.env },
    ...options,
  });
}

// Fixture startup has its own bounded budget; operation deadlines stay unchanged.
// Subscribe immediately after spawn, before yielding to child stdout/exit events.
function peerReady(rpc: RpcTransport, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false, offReady = () => {}, offExit = () => {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); offReady(); offExit();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Synthetic peer startup readiness timed out.')), timeoutMs);
    offReady = rpc.onNotification(method => { if (method === 'test/fixture-ready') finish(); });
    offExit = rpc.onDisconnect(() => finish(new Error('Synthetic peer exited before readiness.')));
    // onDisconnect may invoke synchronously for an already disconnected transport.
    if (settled) { offReady(); offExit(); }
  });
}

function nextNotification(transport: RpcTransport, method: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Notification ${method} was not received.`));
    }, 2_000);
    const unsubscribe = transport.onNotification((receivedMethod, params) => {
      if (receivedMethod !== method) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(params);
    });
  });
}

test('stdio transport exchanges requests and notifications with a JSON-lines child', { timeout: 15_000 }, async () => {
  const transport = transportFor(`
    import readline from 'node:readline';
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', line => {
      const message = JSON.parse(line);
      if (Object.hasOwn(message, 'id')) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'server/progress', params: { stage: 1 } }) + '\\n');
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { echoed: message.params } }) + '\\n');
      } else {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'server/observed', params: { method: message.method, params: message.params } }) + '\\n');
      }
    });
  `);
  try {
    await peerReady(transport);
    const observed = nextNotification(transport, 'server/observed');
    const progress = nextNotification(transport, 'server/progress');
    transport.notify('client/ready', { version: 1 });
    const result = await transport.request('echo', { value: 'ok' });
    assert.deepEqual(result, { echoed: { value: 'ok' } });
    assert.deepEqual(await observed, { method: 'client/ready', params: { version: 1 } });
    assert.deepEqual(await progress, { stage: 1 });
  } finally {
    transport.close();
  }
});

test('stdio transport rejects every inbound request instead of authorizing approval or tool work', { timeout: 15_000 }, async () => {
  const transport = transportFor(`
    import readline from 'node:readline';
    const lines = readline.createInterface({ input: process.stdin });
    lines.once('line', () => {
      lines.once('line', line => {
        const response = JSON.parse(line);
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'server/denial-observed', params: response }) + '\\n');
      });
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { command: 'secret' } }) + '\\n');
    });
  `);
  try {
    await peerReady(transport);
    const denied = nextNotification(transport, 'server/denial-observed');
    transport.notify('test/request-approval');
    const response = await denied;
    assert.deepEqual(response, {
      jsonrpc: '2.0',
      id: 'approval-1',
      error: { code: -32601, message: 'Inbound RPC requests are not supported.' },
    });
  } finally {
    transport.close();
  }
});

test('app-server mode exchanges versionless messages and returns a versionless denial', { timeout: 15_000 }, async () => {
  const transport = transportFor(`
    import readline from 'node:readline';
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', line => {
      const message = JSON.parse(line);
      if (Object.hasOwn(message, 'jsonrpc')) process.exit(2);
      if (message.method === 'client/ready') {
        process.stdout.write(JSON.stringify({ method: 'server/observed', params: message.params }) + '\\n');
        return;
      }
      if (message.method === 'echo') {
        process.stdout.write(JSON.stringify({ id: message.id, result: message.params }) + '\\n');
        process.stdout.write(JSON.stringify({ id: 'tool-1', method: 'item/tool/request', params: { name: 'unsafe' } }) + '\\n');
        return;
      }
      if (message.id === 'tool-1') {
        process.stdout.write(JSON.stringify({ method: 'server/denial-observed', params: message }) + '\\n');
      }
    });
  `, { protocol: 'app-server' });
  try {
    await peerReady(transport);
    const observed = nextNotification(transport, 'server/observed');
    const denied = nextNotification(transport, 'server/denial-observed');
    transport.notify('client/ready', { version: 1 });
    assert.deepEqual(await transport.request('echo', { value: 'ok' }), { value: 'ok' });
    assert.deepEqual(await observed, { version: 1 });
    assert.deepEqual(await denied, {
      id: 'tool-1',
      error: { code: -32601, message: 'Inbound RPC requests are not supported.' },
    });
  } finally {
    transport.close();
  }
});

test('stdio transport rejects pending work and signals when the child disconnects', async () => {
  const transport = transportFor(`
    import readline from 'node:readline';
    const lines = readline.createInterface({ input: process.stdin });
    lines.once('line', () => process.exit(0));
  `);
  const disconnected = new Promise<void>(resolve => transport.onDisconnect(resolve));
  try {
    await Promise.all([
      assert.rejects(transport.request('wait'), /disconnected/i),
      disconnected,
    ]);
  } finally {
    transport.close();
  }
});

test('stdio transport times out requests without retrying them', async () => {
  const transport = transportFor(`
    import readline from 'node:readline';
    const lines = readline.createInterface({ input: process.stdin });
    let received = 0;
    lines.on('line', () => { received += 1; });
    setInterval(() => {}, 1_000);
  `, { timeoutMs: 50 });
  try {
    await assert.rejects(transport.request('never-answers'), /timed out after 50 ms/i);
  } finally {
    transport.close();
  }
});

test('stdio transport disconnects when a child exceeds the input line limit', async () => {
  const transport = transportFor(`
    import readline from 'node:readline';
    const lines = readline.createInterface({ input: process.stdin });
    lines.once('line', () => process.stdout.write('x'.repeat(129)));
    setInterval(() => {}, 1_000);
  `, { maxMessageBytes: 128 });
  const disconnected = new Promise<void>(resolve => transport.onDisconnect(resolve));
  try {
    await Promise.all([
      assert.rejects(transport.request('oversized-response'), /size limit/i),
      disconnected,
    ]);
  } finally {
    transport.close();
  }
});

test('delayed fixture startup consumes the old notification deadline but not a ready peer deadline', { timeout: 15_000 }, async () => {
  const transport = transportFor(`
    import readline from 'node:readline';
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
    const lines = readline.createInterface({ input: process.stdin });
    let count = 0;
    lines.on('line', line => {
      const message = JSON.parse(line);
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'server/' + message.params, params: { count: ++count, value: message.params } }) + '\\n');
    });
  `);
  const ready = peerReady(transport); void ready.catch(() => {});
  try {
    const beforeReady = nextNotification(transport, 'server/before');
    transport.notify('probe', 'before');
    await assert.rejects(beforeReady, /Notification server\/before was not received/);
    await ready;
    const afterReady = nextNotification(transport, 'server/after');
    transport.notify('probe', 'after');
    assert.deepEqual(await afterReady, { count: 2, value: 'after' });
  } finally { transport.close(); }
});

for (const [name, source, expected] of [
  ['early exit', 'process.exit(7)', /exited before readiness/],
  ['missing ready', 'await new Promise(() => { setInterval(() => {}, 1000); })', /startup readiness timed out/],
] as const) {
  test(`stdio fixture readiness rejects ${name} and closes its owned transport`, { timeout: 15_000 }, async () => {
    const transport = transportFor(source);
    try { await assert.rejects(peerReady(transport, name === 'early exit' ? 10_000 : 100), expected); }
    finally { transport.close(); }
  });
}
