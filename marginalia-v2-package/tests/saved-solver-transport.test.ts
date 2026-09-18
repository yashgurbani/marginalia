import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  RPC_MAX_MESSAGE_BYTES,
  SOLVER_ALWAYS_STREAMS,
  SOLVER_EXEC_METHOD,
  SOLVER_OUTPUT_DELTA_NOTIFICATION,
  SOLVER_TERMINATE_METHOD,
  SolverPolicyError,
  commandExecParams,
  createRpcSolverTransport,
  decodeCanonicalBase64,
  execRequestFor,
  outputBytesCapFor,
  readCommandResponse,
  readOutputDelta,
} from '../daemon/solver/transport.ts';
import { SolverResultCache } from '../daemon/solver/cache.ts';
import {
  RECOMPUTE_DIRECTORY,
  discardSolverInput,
  newAttemptToken,
  prepareSolverInput,
  resolveSolverArtifacts,
  safeRelativeSolverPath,
} from '../daemon/solver/artifacts.ts';
import { PINNED_CODEX_VERSION, createCodexPolicy } from '../daemon/codex-policy.ts';
import { SOLVER_EXECUTION_SCHEMA, type SolverArtifactBinding, type SolverExecutionRecord } from '../contracts/solver.ts';
import type { RpcTransport } from '../daemon/providers/stdio.ts';

const CODEX_HOME = process.platform === 'win32' ? 'C:\\Marginalia\\codex-home' : '/var/marginalia/codex-home';
const WORKSPACE = process.platform === 'win32' ? 'C:\\Marginalia\\jobs\\one' : '/var/marginalia/jobs/one';
const SOLVER = join(WORKSPACE, 'solver', 'main.py');
const INPUT = join(WORKSPACE, RECOMPUTE_DIRECTORY, 'req-1.abc', 'input.json');
const RUNTIME = process.platform === 'win32' ? 'C:\\Python\\python.exe' : '/usr/bin/python3';

function savedSolverPolicy(overrides: { writesWorkspace?: boolean; timeoutMs?: number } = {}) {
  return createCodexPolicy({
    version: PINNED_CODEX_VERSION,
    platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
    adapter: 'app-server',
    workspace: WORKSPACE,
    codexHome: CODEX_HOME,
    auditId: 'audit-1',
    operation: 'saved-solver',
    executable: RUNTIME,
    solverPath: SOLVER,
    inputPath: INPUT,
    writesWorkspace: overrides.writesWorkspace ?? false,
    timeoutMs: overrides.timeoutMs ?? 5_000,
  });
}

test('a saved-solver policy yields a closed command/exec request with no network access', () => {
  const request = execRequestFor(savedSolverPolicy());
  assert.equal(request.cwd, resolve(WORKSPACE));
  assert.equal(request.timeoutMs, 5_000);
  assert.equal(request.sandboxPolicy.networkAccess, false);
  assert.equal(request.sandboxPolicy.type, 'readOnly');
  assert.deepEqual([...request.command], [resolve(RUNTIME), resolve(SOLVER), '--input', resolve(INPUT)]);
});

test('a model-turn policy can never reach the command adapter', () => {
  const generation = createCodexPolicy({
    version: PINNED_CODEX_VERSION,
    platform: process.platform === 'win32' ? 'win32' : 'linux',
    adapter: 'app-server',
    workspace: WORKSPACE,
    codexHome: CODEX_HOME,
    auditId: 'audit-1',
    operation: 'generation',
    model: 'gpt-5-codex',
  });
  assert.throws(() => execRequestFor(generation), SolverPolicyError);
});

test('only the generated CommandExecResponse shape is read as a result', () => {
  // Codex 0.153.4 CommandExecResponse is exactly {exitCode, stdout, stderr}, and
  // RpcTransport already unwrapped the JSON-RPC result. Anything else is unreadable.
  const read = readCommandResponse({ exitCode: 0, stdout: '{"ok":true}', stderr: '' });
  assert.equal(read.ok, true);
  if (read.ok) assert.deepEqual(read.value, { exitCode: 0, stdout: '{"ok":true}', stderr: '' });

  const shapes: unknown[] = [
    null, 'done', [], {},
    { result: { exitCode: 0, stdout: '{}', stderr: '' } },   // no nested result envelope exists
    { exit_code: 0, stdout: '{}', stderr: '' },               // no snake_case alias exists
    { timedOut: true },                                       // no timeout field exists
    { exitCode: 0, stdout: '{}', stderr: '', timedOut: true, extra: 1 },
    { exitCode: 0, stdout: '{}' },                            // stderr is not optional
    { exitCode: 0, stderr: '' },
    { exitCode: '0', stdout: '{}', stderr: '' },
    { exitCode: 1.5, stdout: '{}', stderr: '' },
  ];
  const unreadable = shapes.filter((shape) => !readCommandResponse(shape).ok);
  // The timedOut shape is readable only because it also carries the three real
  // fields; the flag itself is ignored rather than trusted.
  assert.equal(unreadable.length, shapes.length - 1);
  assert.equal(readCommandResponse(shapes[7]).ok, true);
});

test('an unknown extra field does not make a valid response unreadable', () => {
  const read = readCommandResponse({ exitCode: 3, stdout: 'out', stderr: 'err', signal: 'SIGKILL' });
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.value.exitCode, 3);
});

test('only the generated outputDelta notification shape is read as a chunk', () => {
  const read = readOutputDelta({ processId: 'p1', stream: 'stderr', deltaBase64: 'aGk=', capReached: true });
  assert.equal(read.kind, 'delta');
  if (read.kind !== 'delta') return;
  assert.equal(read.delta.processId, 'p1');
  assert.equal(read.delta.stream, 'stderr');
  assert.equal(read.delta.capReached, true);
  assert.equal(read.delta.bytes.toString('utf8'), 'hi');

  // No processId at all: the chunk cannot be attributed to any attempt, so it is
  // ignored exactly as a chunk for another process is.
  for (const shape of [null, 'chunk', [], {},
    { processId: 1, stream: 'stdout', deltaBase64: 'aGk=', capReached: false },
    { processId: '', stream: 'stdout', deltaBase64: 'aGk=', capReached: false }]) {
    assert.equal(readOutputDelta(shape).kind, 'unattributed', 'an unattributable chunk must be ignored');
  }

  // A readable processId with a broken body is a protocol error, not silence.
  for (const shape of [
    { processId: 'p1', stream: 'stdout', deltaBase64: 'aGk=' },
    { processId: 'p1', stream: 'other', deltaBase64: 'aGk=', capReached: false },
    { processId: 'p1', stream: 'stdout', delta: 'hi', capReached: false },
    { processId: 'p1', stream: 'stdout', deltaBase64: 'aGk', capReached: false },
    { processId: 'p1', stream: 'stdout', deltaBase64: 'a G k=', capReached: false },
    { processId: 'p1', stream: 'stdout', deltaBase64: 'aGk*', capReached: false }]) {
    const malformed = readOutputDelta(shape);
    assert.equal(malformed.kind, 'malformed', 'a malformed chunk must name the process it claimed');
    if (malformed.kind === 'malformed') assert.equal(malformed.processId, 'p1');
  }
});

test('deltaBase64 is decoded only in its canonical spelling', () => {
  // Independent expectations: 'aGVsbG8=' is the standard base64 of 'hello', taken
  // from RFC 4648's alphabet, not from this module's own encoder.
  assert.equal(decodeCanonicalBase64('aGVsbG8=')?.toString('utf8'), 'hello');
  assert.equal(decodeCanonicalBase64('')?.length, 0);
  assert.equal(decodeCanonicalBase64('AAAA')?.toString('hex'), '000000');
  for (const spelling of [
    'aGVsbG8',      // missing padding
    'aGVsbG8==',    // wrong padding length
    'aGVs bG8=',    // embedded whitespace Buffer.from would skip
    'aGVsbG8*',     // outside the alphabet
    'aG_sbG8=',     // url-safe alphabet
    'AB==',         // trailing bits that are not zero
    '====',
  ]) {
    assert.equal(decodeCanonicalBase64(spelling), undefined, `${spelling} must not decode`);
  }
});

test('the capture cap is per stream and sits one byte above the reader limit', () => {
  // outputBytesCap in CommandExecParams is a per-stream cap. Asking for one byte
  // more than the reader limit is what makes an overrun observable.
  assert.equal(outputBytesCapFor(65_536), 65_537);
  assert.throws(() => outputBytesCapFor(0), SolverPolicyError);
  assert.throws(() => outputBytesCapFor(-1), SolverPolicyError);
  assert.throws(() => outputBytesCapFor(1.5), SolverPolicyError);
});

test('a raw byte budget cannot bound a buffered reply, so the adapter always streams', () => {
  // The reason buffering was abandoned, stated as arithmetic rather than prose.
  // JSON escaping expands bytes: one control byte becomes a six character escape.
  // A solver that writes only control bytes therefore costs six frame bytes for
  // every raw byte it produced.
  const oneControlByte = JSON.stringify(String.fromCharCode(0));
  assert.equal(oneControlByte, '"\\u0000"');
  assert.equal(oneControlByte.length - 2, 6);
  const escapedBytes = (raw: number) => raw * 6;

  // A per-stream cap of 100_000 bytes looks far inside the 1 MiB frame limit.
  const cap = 100_000;
  assert.ok(cap * 2 + 4096 < RPC_MAX_MESSAGE_BYTES, 'the raw budget says this fits');
  // Escaped, the same two streams overflow the frame.
  assert.ok(escapedBytes(cap) * 2 > RPC_MAX_MESSAGE_BYTES, 'the escaped bytes do not fit');

  // Streaming removes the budget rather than tightening it. The generated schema
  // says streamed bytes are not duplicated into the response, so the reply frame
  // carries no output at any cap.
  assert.equal(SOLVER_ALWAYS_STREAMS, true);
  const params = commandExecParams(execRequestFor(savedSolverPolicy()), {
    processId: 'p1', outputBytesCap: outputBytesCapFor(1_000_000), streamStdoutStderr: SOLVER_ALWAYS_STREAMS,
  });
  assert.equal(params.streamStdoutStderr, true, 'no configured cap can switch buffering back on');
});

test('the exec parameters are exactly the generated CommandExecParams fields', () => {
  const request = execRequestFor(savedSolverPolicy());
  const params = commandExecParams(request, { processId: 'p1', outputBytesCap: 65_537, streamStdoutStderr: true });
  assert.deepEqual(Object.keys(params).sort(),
    ['command', 'cwd', 'outputBytesCap', 'processId', 'sandboxPolicy', 'streamStdoutStderr', 'timeoutMs'].sort());
  // CommandExecParams has no memory parameter in 0.153.4, so none is invented here.
  for (const absent of ['maxMemoryBytes', 'memoryBytes', 'memoryLimit', 'disableTimeout', 'disableOutputCap']) {
    assert.equal(Object.hasOwn(params, absent), false, 'only generated fields may be sent');
  }
  assert.equal(params.outputBytesCap, 65_537);
  assert.deepEqual(params.command, [...request.command]);
});

type Sent = { method: string; params: unknown };
type FakeRpc = {
  rpc: RpcTransport;
  sent: Sent[];
  listenerCount: () => number;
  emit: (method: string, params: unknown) => void;
};

function fakeRpc(onExec: (params: unknown, api: FakeRpc) => Promise<unknown> | unknown): FakeRpc {
  const sent: Sent[] = [];
  const listeners = new Set<(method: string, params: unknown) => void>();
  const api: FakeRpc = {
    sent,
    listenerCount: () => listeners.size,
    emit(method, params) { for (const listener of [...listeners]) listener(method, params); },
    rpc: {
      async request(method: string, params: unknown) {
        sent.push({ method, params });
        if (method === SOLVER_TERMINATE_METHOD) return {};
        return await onExec(params, api);
      },
      notify() { throw new Error('a recompute never notifies'); },
      onNotification(listener: (method: string, params: unknown) => void) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      onDisconnect() { return () => {}; },
      async close() {},
    } as unknown as RpcTransport,
  };
  return api;
}

const RPC_TIMEOUT_MS = 30_000;

test('the rpc transport sends only command/exec and never starts a thread or a turn', async () => {
  const api = fakeRpc(() => ({ exitCode: 0, stdout: '', stderr: '' }));
  const transport = createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS });
  const observation = await transport.exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-1' });
  assert.equal(observation.status, 'exited');
  assert.deepEqual(api.sent.map((entry) => entry.method), [SOLVER_EXEC_METHOD]);
  for (const forbidden of ['thread/start', 'turn/start', 'thread/resume', 'turn/interrupt', 'codex', 'codex-reply']) {
    assert.equal(api.sent.some((entry) => entry.method === forbidden), false, 'no inference method may be sent by a recompute');
  }
});

test('even a tiny limit streams, and each attempt gets its own processId', async () => {
  const chunk = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  const api = fakeRpc((params, self) => {
    const processId = (params as { processId: string }).processId;
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stdout', deltaBase64: chunk('out'), capReached: false });
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stderr', deltaBase64: chunk('err'), capReached: false });
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  const transport = createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS });
  const request = execRequestFor(savedSolverPolicy());
  const first = await transport.exec(request, { maxOutputBytes: 4096, executionAttemptId: 'attempt-1' });
  const second = await transport.exec(request, { maxOutputBytes: 4096, executionAttemptId: 'attempt-1' });
  assert.equal(first.status, 'exited');
  assert.equal(second.status, 'exited');
  if (first.status !== 'exited' || second.status !== 'exited') return;
  assert.equal(first.streamed, true);
  assert.equal(first.stdout.text, 'out');
  assert.equal(first.stderr.text, 'err');
  assert.equal(first.stdout.capReached, false);
  assert.equal(first.stdout.hostBoundReached, false);

  const ids = api.sent.map((entry) => (entry.params as { processId: string }).processId);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1], 'two attempts must never share a processId');
  for (const id of ids) assert.match(id, /^marginalia-recompute-attempt-1-/);
  assert.equal((api.sent[0]?.params as { streamStdoutStderr: boolean }).streamStdoutStderr, true);
  assert.equal(api.listenerCount(), 0, 'no notification listener is left behind');
});

test('streamed chunks are decoded per stream and capReached is carried through', async () => {
  const chunk = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  const api = fakeRpc((params, self) => {
    const processId = (params as { processId: string }).processId;
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stdout', deltaBase64: chunk('{"a"'), capReached: false });
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stdout', deltaBase64: chunk(':1}'), capReached: false });
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stderr', deltaBase64: chunk('warn'), capReached: true });
    // Another process on the same connection, and an unrelated notification.
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId: 'someone-else', stream: 'stdout', deltaBase64: chunk('NO'), capReached: false });
    self.emit('command/exec/other', { processId, stream: 'stdout', deltaBase64: chunk('NO'), capReached: false });
    // Streamed output is not repeated in the reply.
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  const transport = createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS });
  const observation = await transport.exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 1024, executionAttemptId: 'attempt-2' });
  assert.equal(observation.status, 'exited');
  if (observation.status !== 'exited') return;
  assert.equal(observation.streamed, true);
  assert.equal(observation.stdout.text, '{"a":1}');
  assert.equal(observation.stdout.bytes, 7);
  assert.equal(observation.stdout.capReached, false);
  assert.equal(observation.stderr.text, 'warn');
  assert.equal(observation.stderr.capReached, true, 'the server cap signal is reported, not inferred');
  assert.equal((api.sent[0]?.params as { streamStdoutStderr: boolean }).streamStdoutStderr, true);
  assert.equal(api.listenerCount(), 0, 'the notification listener is removed after the call');
});

test('a valid prefix followed by an unreadable chunk is unknown, not an accepted result', async () => {
  // The dropped chunk is what makes this a defect: stdout would read as the complete
  // JSON document {"value":1} even though the middle of the stream never arrived.
  const chunk = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  for (const broken of [
    { deltaBase64: 'aGk', capReached: false },            // unpadded, not canonical
    { deltaBase64: chunk(':99'), capReached: 'no' },      // capReached is not a boolean
    { deltaBase64: 42, capReached: false },               // deltaBase64 is not a string
    { stream: 'stdlog', deltaBase64: chunk('x'), capReached: false },
  ]) {
    const api = fakeRpc((params, self) => {
      const processId = (params as { processId: string }).processId;
      self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stdout', deltaBase64: chunk('{"value"'), capReached: false });
      self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stdout', ...broken });
      self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stdout', deltaBase64: chunk(':1}'), capReached: false });
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const observation = await createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS })
      .exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-delta' });
    assert.equal(observation.status, 'unknown', 'a broken chunk for this process must not settle as exited');
    if (observation.status !== 'unknown') return;
    assert.match(observation.reason, /unreadable output/);
    assert.equal(observation.terminationRequested, false);
    assert.equal(observation.terminationHandoff, 'none');
    assert.equal(api.listenerCount(), 0);
  }
});

test('an unreadable chunk that names another process is still ignored', async () => {
  const chunk = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  const api = fakeRpc((params, self) => {
    const processId = (params as { processId: string }).processId;
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stdout', deltaBase64: chunk('{"ok":1}'), capReached: false });
    // Broken, and none of this attempt's business. Both facts have to hold together.
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId: 'someone-else', stream: 'stdlog', deltaBase64: 'zz', capReached: 7 });
    // No processId at all: unattributable, so ignored on the same grounds.
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { stream: 'stdout', deltaBase64: 'zz', capReached: false });
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  const observation = await createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS })
    .exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-delta-other' });
  assert.equal(observation.status, 'exited');
  if (observation.status !== 'exited') return;
  assert.equal(observation.stdout.text, '{"ok":1}');
});

test('server truncation and host truncation are reported as different things', async () => {
  const api = fakeRpc((params, self) => {
    const processId = (params as { processId: string }).processId;
    // Twelve bytes against an eight byte reader limit: the host stops holding more.
    const deltaBase64 = Buffer.from('123456789012', 'utf8').toString('base64');
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stdout', deltaBase64, capReached: false });
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  const transport = createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS });
  const observation = await transport.exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 8, executionAttemptId: 'attempt-3' });
  assert.equal(observation.status, 'exited');
  if (observation.status !== 'exited') return;
  assert.equal(observation.stdout.capReached, false, 'the server never said it truncated');
  assert.equal(observation.stdout.hostBoundReached, true);
  assert.equal(observation.stdout.bytes, 9, 'the host holds one byte past the limit so the overrun is visible');
});

test('a server that buffers output anyway is a protocol disagreement, not a result', async () => {
  // Streaming was requested, so the schema says the reply carries no output. A
  // reply that carries some was shaped by rules this adapter did not set, and may
  // already have been cut by the 1 MiB frame. Reading it would report a truncated
  // capture as a complete one.
  for (const reply of [
    { exitCode: 0, stdout: 'x'.repeat(4096), stderr: '' },
    { exitCode: 0, stdout: '', stderr: 'noise' },
  ]) {
    const api = fakeRpc(() => reply);
    const transport = createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS });
    const observation = await transport.exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 1024, executionAttemptId: 'attempt-4' });
    assert.equal(observation.status, 'unknown');
    if (observation.status !== 'unknown') return;
    assert.match(observation.reason, /buffered output/);
    assert.equal(observation.processStopConfirmed, false);
    assert.equal(api.listenerCount(), 0);
  }
});

test('the rpc transport reports enforcement truthfully and never claims a memory cap', () => {
  const transport = createRpcSolverTransport({} as RpcTransport, { rpcTimeoutMs: RPC_TIMEOUT_MS });
  assert.deepEqual(transport.enforces, { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: RPC_TIMEOUT_MS });
  assert.throws(() => createRpcSolverTransport({} as RpcTransport, { rpcTimeoutMs: 0 }), TypeError);
});

test('an adapter failure becomes an unknown outcome, not a failure with a made up exit code', async () => {
  const api = fakeRpc(() => { throw new Error('pipe closed'); });
  const observation = await createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS })
    .exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-5' });
  assert.equal(observation.status, 'unknown');
  if (observation.status !== 'unknown') return;
  assert.equal(observation.processStopConfirmed, false);
});

test('an unreadable reply is unknown, never a guessed exit code', async () => {
  const api = fakeRpc(() => ({ ok: true }));
  const observation = await createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS })
    .exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-6' });
  assert.equal(observation.status, 'unknown');
});

test('an already aborted attempt is not dispatched at all', async () => {
  const api = fakeRpc(() => ({ exitCode: 0, stdout: '{}', stderr: '' }));
  const controller = new AbortController();
  controller.abort();
  const observation = await createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS })
    .exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-7', signal: controller.signal });
  assert.equal(observation.status, 'unknown');
  assert.equal(api.sent.length, 0);
});

test('cancelling terminates that exact process and never claims the process stopped', async () => {
  let release: ((value: unknown) => void) | undefined;
  const api = fakeRpc(() => new Promise((resolve) => { release = resolve; }));
  const controller = new AbortController();
  const pending = createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS })
    .exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-8', signal: controller.signal });

  const execCall = api.sent[0];
  assert.equal(execCall?.method, SOLVER_EXEC_METHOD);
  const processId = (execCall?.params as { processId: string }).processId;

  controller.abort();
  const observation = await pending;
  assert.equal(observation.status, 'unknown');
  if (observation.status !== 'unknown') return;
  assert.equal(observation.terminationRequested, true);
  // The request reached the adapter, so the observation may say so and no more.
  assert.equal(observation.terminationHandoff, 'sent');
  assert.match(observation.reason, /handed to the isolated command adapter/);
  // An acknowledged terminate is not proof of exit, so this stays false.
  assert.equal(observation.processStopConfirmed, false);

  const terminate = api.sent.find((entry) => entry.method === SOLVER_TERMINATE_METHOD);
  assert.deepEqual(terminate?.params, { processId });

  // The late reply arrives after the fence and changes nothing.
  release?.({ exitCode: 0, stdout: '{"late":true}', stderr: '' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observation.status, 'unknown');
  assert.equal(api.listenerCount(), 0);
});

test('a terminate that never reaches the adapter is reported as attempted, not as sent', async () => {
  // The defect this guards: the observation used to state that a terminate "was sent"
  // while the call was still queued, so a failed handoff read as a delivered one.
  const listeners = new Set<(method: string, params: unknown) => void>();
  const rpc = {
    request(method: string) {
      if (method === SOLVER_TERMINATE_METHOD) throw new Error('the adapter socket is closed');
      return new Promise(() => {});
    },
    notify() { throw new Error('a recompute never notifies'); },
    onNotification(listener: (method: string, params: unknown) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onDisconnect() { return () => {}; },
    async close() {},
  } as unknown as RpcTransport;

  const controller = new AbortController();
  const pending = createRpcSolverTransport(rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS })
    .exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-terminate', signal: controller.signal });
  controller.abort();
  const observation = await pending;

  assert.equal(observation.status, 'unknown');
  if (observation.status !== 'unknown') return;
  assert.equal(observation.terminationRequested, true);
  assert.equal(observation.terminationHandoff, 'failed');
  assert.match(observation.reason, /attempted but no handoff/);
  assert.equal(observation.processStopConfirmed, false);
  assert.equal(listeners.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('a finished attempt detaches from its signal and sends no later terminate', async () => {
  const chunk = Buffer.from('{}', 'utf8').toString('base64');
  const api = fakeRpc((params, self) => {
    const processId = (params as { processId: string }).processId;
    self.emit(SOLVER_OUTPUT_DELTA_NOTIFICATION, { processId, stream: 'stdout', deltaBase64: chunk, capReached: false });
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  // One controller reused across a reader's session. An attempt that left its
  // listener attached would keep the finished processId alive on this signal.
  const controller = new AbortController();
  const transport = createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS });

  const first = await transport.exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-9', signal: controller.signal });
  assert.equal(first.status, 'exited');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'the exact abort listener is removed');
  assert.equal(api.listenerCount(), 0, 'the notification listener is removed');

  const second = await transport.exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-10', signal: controller.signal });
  assert.equal(second.status, 'exited');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);

  // Cancelling the session afterwards must not terminate either finished process.
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.sent.some((entry) => entry.method === SOLVER_TERMINATE_METHOD), false);
  assert.equal(api.sent.filter((entry) => entry.method === SOLVER_EXEC_METHOD).length, 2, 'no attempt ran twice');
});

test('a synchronous throw from the adapter is an unknown outcome, with the listener removed', async () => {
  const listeners = new Set<(method: string, params: unknown) => void>();
  const rpc = {
    // Not async: this throws during the call, before any promise exists.
    request() { throw new Error('the adapter socket is closed'); },
    notify() { throw new Error('a recompute never notifies'); },
    onNotification(listener: (method: string, params: unknown) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onDisconnect() { return () => {}; },
    async close() {},
  } as unknown as RpcTransport;

  const controller = new AbortController();
  const observation = await createRpcSolverTransport(rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS })
    .exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-11', signal: controller.signal });

  assert.equal(observation.status, 'unknown');
  if (observation.status !== 'unknown') return;
  assert.match(observation.reason, /the adapter socket is closed/);
  assert.equal(observation.processStopConfirmed, false);
  assert.equal(listeners.size, 0, 'a synchronous throw still reaches the cleanup');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('an abort that races the reply produces one settled outcome and one dispatch', async () => {
  let release: ((value: unknown) => void) | undefined;
  const api = fakeRpc(() => new Promise((resolve) => { release = resolve; }));
  const controller = new AbortController();
  const pending = createRpcSolverTransport(api.rpc, { rpcTimeoutMs: RPC_TIMEOUT_MS })
    .exec(execRequestFor(savedSolverPolicy()), { maxOutputBytes: 4096, executionAttemptId: 'attempt-12', signal: controller.signal });

  // The reply and the abort land in the same tick. Whichever the race settles on,
  // the attempt settles once, dispatches once and never claims a confirmed stop.
  release?.({ exitCode: 0, stdout: '', stderr: '' });
  controller.abort();

  const observation = await pending;
  assert.equal(api.sent.filter((entry) => entry.method === SOLVER_EXEC_METHOD).length, 1, 'the solver was dispatched once');
  if (observation.status === 'unknown') assert.equal(observation.processStopConfirmed, false);

  // A second abort of the same signal after settling adds nothing.
  const terminatesBefore = api.sent.filter((entry) => entry.method === SOLVER_TERMINATE_METHOD).length;
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.sent.filter((entry) => entry.method === SOLVER_TERMINATE_METHOD).length, terminatesBefore);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(api.listenerCount(), 0);
});

function record(overrides: Partial<SolverExecutionRecord> = {}): SolverExecutionRecord {
  return {
    schema: SOLVER_EXECUTION_SCHEMA,
    origin: 'host-execution',
    executionId: 'exec-1',
    executionAttemptId: 'attempt-1',
    requestId: 'req-1',
    requestIdentity: '1'.repeat(64),
    generationLeaseId: 'lease-1',
    atMostOnce: 'process-local',
    replyVersionId: 'reply-1',
    replyHash: 'a'.repeat(64),
    solverId: 'solver-1',
    solverSha256: 'b'.repeat(64),
    runtimeExecutable: RUNTIME,
    workspace: WORKSPACE,
    workspaceGeneration: 'gen-1',
    inputDigest: 'c'.repeat(64),
    outputDigest: 'd'.repeat(64),
    grantId: 'grant-1',
    grantRevision: 3,
    policyKey: 'e'.repeat(64),
    policyFingerprint: 'e'.repeat(64),
    handoffToken: 'handoff-1',
    evidenceScope: 'f'.repeat(64),
    permissionFingerprint: 'fingerprint-1',
    startedAt: '2026-09-17T10:00:00.000Z',
    endedAt: '2026-09-17T10:00:01.000Z',
    durationMs: 1000,
    exitCode: 0,
    outputBytes: 42,
    enforced: { timeout: true, outputBytes: true, memoryBytes: false },
    streamed: false,
    modelTurns: 0,
    ...overrides,
  };
}

const outputs = { 'derived-1': { kind: 'values' as const, values: { halfLife: 3.4657 } } };

test('the cache stores only observed host executions with zero model turns', () => {
  const cache = new SolverResultCache();
  cache.store('key-1', outputs, record());
  assert.equal(cache.size, 1);
  assert.throws(() => cache.store('key-2', outputs, record({ origin: 'imported' as unknown as 'host-execution' })));
  assert.throws(() => cache.store('key-3', outputs, record({ modelTurns: 1 as unknown as 0 })));
  assert.equal(cache.size, 1);
});

test('a cache entry expires and is not resurrected', () => {
  let clock = 1_000;
  const cache = new SolverResultCache({ ttlMs: 500, now: () => clock });
  cache.store('key-1', outputs, record());
  clock = 1_400;
  assert.ok(cache.get('key-1'));
  clock = 2_000;
  assert.equal(cache.get('key-1'), undefined);
  assert.equal(cache.size, 0);
});

test('revoking a grant or superseding a reply removes the cached work it authorized', () => {
  const cache = new SolverResultCache();
  cache.store('key-1', outputs, record());
  cache.store('key-2', outputs, record({ grantId: 'grant-2', replyVersionId: 'reply-2' }));
  assert.equal(cache.invalidateGrant('grant-1'), 1);
  assert.equal(cache.get('key-1'), undefined);
  assert.equal(cache.invalidateReply('reply-2'), 1);
  assert.equal(cache.size, 0);
});

test('the cache evicts the least recently used entry beyond its size', () => {
  const cache = new SolverResultCache({ maxEntries: 2 });
  cache.store('key-1', outputs, record());
  cache.store('key-2', outputs, record());
  cache.get('key-1');
  cache.store('key-3', outputs, record());
  assert.ok(cache.get('key-1'));
  assert.equal(cache.get('key-2'), undefined);
  assert.ok(cache.get('key-3'));
});

test('unsafe relative solver paths are refused before any filesystem call', () => {
  assert.equal(safeRelativeSolverPath('solver/main.py'), true);
  for (const value of ['', '/etc/passwd', '../escape.py', 'solver/../../escape.py', 'C:/solver.py',
    'solver\\main.py', 'solver/main.py\0', 'solver//main.py', './main.py', 'sol ver/main.py']) {
    assert.equal(safeRelativeSolverPath(value), false, `${JSON.stringify(value)} must be refused`);
  }
});

async function temporaryWorkspace(): Promise<{ workspace: string; binding: SolverArtifactBinding; source: string }> {
  const workspace = await mkdtemp(join(tmpdir(), 'marginalia-solver-'));
  await mkdir(join(workspace, 'solver'), { recursive: true });
  const source = 'print("saved solver")\n';
  await writeFile(join(workspace, 'solver', 'main.py'), source, 'utf8');
  return {
    workspace,
    source,
    binding: {
      jobId: 'job-1', attemptId: 'attempt-1',
      workspace, workspaceGeneration: 'gen-1',
      solverRelativePath: 'solver/main.py',
      solverSha256: createHash('sha256').update(source, 'utf8').digest('hex'),
      runtimeExecutable: process.execPath,
    },
  };
}

test('a pinned solver artifact resolves and re-hashes to the committed digest', async (t) => {
  const { workspace, binding } = await temporaryWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const resolved = await resolveSolverArtifacts(binding);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.solverSha256, binding.solverSha256);
  assert.equal(resolved.value.solverPath, resolve(await realpath(workspace), 'solver', 'main.py'));
});

test('solver artifacts canonicalize an aliased ancestor but reject a linked workspace', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'marginalia-solver-alias-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, 'real-parent'), workspace = join(parent, 'job'), alias = join(root, 'parent-alias');
  const linkedWorkspace = join(root, 'workspace-link'), source = 'print("saved solver")\n';
  await mkdir(join(workspace, 'solver'), { recursive: true });
  await writeFile(join(workspace, 'solver', 'main.py'), source, 'utf8');
  try {
    await symlink(parent, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(workspace, linkedWorkspace, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('This host does not permit creating directory links.'); return;
  }
  const binding: SolverArtifactBinding = {
    jobId: 'job-1', attemptId: 'attempt-1', workspace: join(alias, 'job'), workspaceGeneration: 'gen-1',
    solverRelativePath: 'solver/main.py', solverSha256: createHash('sha256').update(source, 'utf8').digest('hex'),
    runtimeExecutable: process.execPath,
  };
  const resolved = await resolveSolverArtifacts(binding);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.value.workspace, await realpath(workspace));
  const linked = await resolveSolverArtifacts({ ...binding, workspace: linkedWorkspace });
  assert.equal(linked.ok, false);
  if (!linked.ok) assert.equal(linked.code, 'path-unsafe');
});

test('a modified solver file is rejected as artifact-modified', async (t) => {
  const { workspace, binding } = await temporaryWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, 'solver', 'main.py'), 'print("something else")\n', 'utf8');
  const resolved = await resolveSolverArtifacts(binding);
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.code, 'artifact-modified');
});

test('a missing solver file is rejected as artifact-unknown', async (t) => {
  const { workspace, binding } = await temporaryWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await rm(join(workspace, 'solver', 'main.py'));
  const resolved = await resolveSolverArtifacts(binding);
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.code, 'artifact-unknown');
});

test('a solver path that escapes its workspace is rejected as path-unsafe', async (t) => {
  const { workspace, binding } = await temporaryWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  for (const solverRelativePath of ['../main.py', 'solver/../../main.py']) {
    const resolved = await resolveSolverArtifacts({ ...binding, solverRelativePath });
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.equal(resolved.code, 'path-unsafe');
  }
});

test('an interpreter inside the workspace it executes is rejected', async (t) => {
  const { workspace, binding } = await temporaryWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const planted = join(workspace, 'planted.exe');
  await writeFile(planted, 'not really an interpreter', 'utf8');
  const resolved = await resolveSolverArtifacts({ ...binding, runtimeExecutable: planted });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.code, 'path-unsafe');
});

test('an interpreter whose pinned hash no longer matches is rejected', async (t) => {
  const { workspace, binding } = await temporaryWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const resolved = await resolveSolverArtifacts({ ...binding, runtimeSha256: '0'.repeat(64) });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.code, 'artifact-modified');
});

test('a symlinked solver file is rejected instead of followed', async (t) => {
  const { workspace, binding, source } = await temporaryWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const outside = await mkdtemp(join(tmpdir(), 'marginalia-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const target = join(outside, 'main.py');
  await writeFile(target, source, 'utf8');
  await rm(join(workspace, 'solver', 'main.py'));
  try {
    await symlink(target, join(workspace, 'solver', 'main.py'), 'file');
  } catch {
    t.skip('This host does not permit creating symlinks without elevation.');
    return;
  }
  const resolved = await resolveSolverArtifacts(binding);
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.code, 'path-unsafe');
});

test('the input tuple is written inside a fresh attempt directory and then discarded', async (t) => {
  const { workspace } = await temporaryWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const token = newAttemptToken();
  const prepared = await prepareSolverInput(workspace, 'req-1', token, '{"k":0.2}');
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.value.inputPath, resolve(await realpath(workspace), RECOMPUTE_DIRECTORY, `req-1.${token}`, 'input.json'));

  // A second attempt with the same token cannot reuse the directory.
  const again = await prepareSolverInput(workspace, 'req-1', token, '{"k":0.2}');
  assert.equal(again.ok, false);

  await discardSolverInput(prepared.value.directory);
  const afterDiscard = await prepareSolverInput(workspace, 'req-1', token, '{"k":0.2}');
  assert.equal(afterDiscard.ok, true);
});

test('an unsafe attempt identity never becomes a directory name', async (t) => {
  const { workspace } = await temporaryWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  for (const [requestId, token] of [['../escape', 'abc'], ['req-1', '../escape'], ['', 'abc']]) {
    const prepared = await prepareSolverInput(workspace, requestId, token, '{}');
    assert.equal(prepared.ok, false, `${requestId}/${token} must be refused`);
  }
});
