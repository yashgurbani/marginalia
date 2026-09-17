import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStdioTransport, type RpcTransport } from '../daemon/providers/stdio.ts';

function transportFor(source: string, options: { protocol?: 'app-server' | 'jsonrpc'; timeoutMs?: number; maxMessageBytes?: number } = {}): RpcTransport {
  return createStdioTransport({
    executable: process.execPath,
    args: ['--input-type=module', '--eval', source],
    cwd: process.cwd(),
    env: { ...process.env },
    ...options,
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

test('stdio transport exchanges requests and notifications with a JSON-lines child', async () => {
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

test('stdio transport rejects every inbound request instead of authorizing approval or tool work', async () => {
  const transport = transportFor(`
    import readline from 'node:readline';
    const lines = readline.createInterface({ input: process.stdin });
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { command: 'secret' } }) + '\\n');
    lines.once('line', line => {
      const response = JSON.parse(line);
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'server/denial-observed', params: response }) + '\\n');
    });
  `);
  try {
    const response = await nextNotification(transport, 'server/denial-observed');
    assert.deepEqual(response, {
      jsonrpc: '2.0',
      id: 'approval-1',
      error: { code: -32601, message: 'Inbound RPC requests are not supported.' },
    });
  } finally {
    transport.close();
  }
});

test('app-server mode exchanges versionless messages and returns a versionless denial', async () => {
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
