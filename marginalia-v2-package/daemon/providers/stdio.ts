import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;

type JsonObject = Record<string, unknown>;
type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export interface RpcTransport {
  request(method: string, params?: unknown, options?: { onRequestId(id: number): void }): Promise<any>;
  notify(method: string, params?: unknown): void;
  onNotification(listener: (method: string, params: any) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  close(): void;
}

export interface StdioTransportOptions {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  protocol?: 'app-server' | 'jsonrpc';
  timeoutMs?: number;
  maxMessageBytes?: number;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer.`);
}

function errorFromResponse(value: unknown): Error {
  if (!isObject(value)) return new Error('RPC request failed.');
  const error = new Error(typeof value.message === 'string' ? value.message : 'RPC request failed.');
  error.name = 'RpcError';
  if (typeof value.code === 'number') Object.defineProperty(error, 'code', { value: value.code, enumerable: true });
  return error;
}

export function createStdioTransport(options: StdioTransportOptions): RpcTransport {
  if (typeof options.executable !== 'string' || options.executable.length === 0) throw new TypeError('executable is required.');
  if (!Array.isArray(options.args) || options.args.some(argument => typeof argument !== 'string')) throw new TypeError('args must contain only strings.');
  if (typeof options.cwd !== 'string' || options.cwd.length === 0) throw new TypeError('cwd is required.');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const protocol = options.protocol ?? 'jsonrpc';
  if (protocol !== 'app-server' && protocol !== 'jsonrpc') throw new TypeError('protocol must be app-server or jsonrpc.');
  assertPositiveInteger(timeoutMs, 'timeoutMs');
  assertPositiveInteger(maxMessageBytes, 'maxMessageBytes');

  const child = spawn(options.executable, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map<number, PendingRequest>();
  const notificationListeners = new Set<(method: string, params: any) => void>();
  const disconnectListeners = new Set<() => void>();
  let nextId = 1;
  let input = Buffer.alloc(0);
  let disconnected = false;

  function disconnect(reason: Error, terminate = false): void {
    if (disconnected) return;
    disconnected = true;
    input = Buffer.alloc(0);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(reason);
    }
    pending.clear();
    if (terminate && child.exitCode === null && child.signalCode === null) child.kill();
    for (const listener of [...disconnectListeners]) {
      try { listener(); } catch { /* A consumer cannot keep the transport alive. */ }
    }
    disconnectListeners.clear();
    notificationListeners.clear();
  }

  function encodeMessage(message: JsonObject): Buffer {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    if (payload.length > maxMessageBytes) throw new RangeError('RPC message exceeds the configured size limit.');
    return Buffer.concat([payload, Buffer.from('\n')]);
  }

  function writeMessage(message: JsonObject): void {
    if (disconnected || child.stdin.destroyed || !child.stdin.writable) throw new Error('RPC transport is disconnected.');
    const line = encodeMessage(message);
    if (child.stdin.writableLength + line.length > maxMessageBytes) {
      const error = new Error('RPC output buffer exceeds the configured size limit.');
      disconnect(error, true);
      throw error;
    }
    try {
      child.stdin.write(line);
    } catch {
      const error = new Error('RPC transport is disconnected.');
      disconnect(error, true);
      throw error;
    }
  }

  function denyRequest(id: unknown): void {
    const responseId = typeof id === 'string' || typeof id === 'number' || id === null ? id : null;
    const message: JsonObject = {
      id: responseId,
      error: { code: -32601, message: 'Inbound RPC requests are not supported.' },
    };
    if (protocol === 'jsonrpc') message.jsonrpc = '2.0';
    writeMessage(message);
  }

  function handleMessage(value: unknown): void {
    if (!isObject(value) || (protocol === 'jsonrpc' ? value.jsonrpc !== '2.0' : value.jsonrpc !== undefined && value.jsonrpc !== '2.0')) throw new Error('Invalid JSON-RPC message.');
    const hasId = Object.hasOwn(value, 'id');
    if (typeof value.method === 'string') {
      if (hasId) denyRequest(value.id);
      else for (const listener of [...notificationListeners]) {
        try { listener(value.method, value.params); } catch { /* Isolate consumer callbacks. */ }
      }
      return;
    }
    if (!hasId || (Object.hasOwn(value, 'result') === Object.hasOwn(value, 'error'))) throw new Error('Invalid JSON-RPC response.');
    if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id)) return;
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id);
    clearTimeout(request.timer);
    if (Object.hasOwn(value, 'error')) request.reject(errorFromResponse(value.error));
    else request.resolve(value.result);
  }

  function handleLine(line: Buffer): void {
    if (line.length > 0 && line[line.length - 1] === 13) line = line.subarray(0, line.length - 1);
    if (line.length === 0) return;
    try {
      handleMessage(JSON.parse(line.toString('utf8')));
    } catch {
      disconnect(new Error('RPC process sent an invalid message.'), true);
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    if (disconnected) return;
    let offset = 0;
    while (offset < chunk.length && !disconnected) {
      const newline = chunk.indexOf(10, offset);
      if (newline === -1) {
        const remainder = chunk.subarray(offset);
        if (input.length + remainder.length > maxMessageBytes) {
          disconnect(new Error('RPC process exceeded the configured message size limit.'), true);
          return;
        }
        input = input.length === 0 ? Buffer.from(remainder) : Buffer.concat([input, remainder]);
        return;
      }
      const fragment = chunk.subarray(offset, newline);
      if (input.length + fragment.length > maxMessageBytes) {
        disconnect(new Error('RPC process exceeded the configured message size limit.'), true);
        return;
      }
      const line = input.length === 0 ? fragment : Buffer.concat([input, fragment]);
      input = Buffer.alloc(0);
      handleLine(line);
      offset = newline + 1;
    }
  });
  child.stdout.on('error', () => disconnect(new Error('RPC process disconnected.'), true));
  child.stdin.on('error', () => disconnect(new Error('RPC process disconnected.'), true));
  child.on('error', () => disconnect(new Error('RPC process could not be started.')));
  child.on('close', () => disconnect(new Error('RPC process disconnected.')));

  return {
    request(method: string, params?: unknown, requestOptions?: { onRequestId(id: number): void }): Promise<any> {
      if (typeof method !== 'string' || method.length === 0) return Promise.reject(new TypeError('RPC method is required.'));
      if (disconnected) return Promise.reject(new Error('RPC transport is disconnected.'));
      const id = nextId++;
      if (!Number.isSafeInteger(nextId)) nextId = 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          reject(new Error(`RPC request timed out after ${timeoutMs} ms.`));
        }, timeoutMs);
        timer.unref();
        pending.set(id, { resolve, reject, timer });
        const message: JsonObject = { id, method };
        if (protocol === 'jsonrpc') message.jsonrpc = '2.0';
        if (params !== undefined) message.params = params;
        try { requestOptions?.onRequestId(id); writeMessage(message); }
        catch (error) {
          if (pending.delete(id)) {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error('RPC request could not be sent.'));
          }
        }
      });
    },
    notify(method: string, params?: unknown): void {
      if (typeof method !== 'string' || method.length === 0) throw new TypeError('RPC method is required.');
      const message: JsonObject = { method };
      if (protocol === 'jsonrpc') message.jsonrpc = '2.0';
      if (params !== undefined) message.params = params;
      writeMessage(message);
    },
    onNotification(listener: (method: string, params: any) => void): () => void {
      if (typeof listener !== 'function') throw new TypeError('Notification listener must be a function.');
      if (disconnected) return () => {};
      notificationListeners.add(listener);
      return () => { notificationListeners.delete(listener); };
    },
    onDisconnect(listener: () => void): () => void {
      if (typeof listener !== 'function') throw new TypeError('Disconnect listener must be a function.');
      if (disconnected) {
        try { listener(); } catch { /* Match live listener isolation. */ }
        return () => {};
      }
      disconnectListeners.add(listener);
      return () => { disconnectListeners.delete(listener); };
    },
    close(): void {
      disconnect(new Error('RPC transport was closed.'), true);
      child.stdin.destroy();
    },
  };
}
