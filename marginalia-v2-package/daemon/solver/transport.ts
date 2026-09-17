import { randomUUID } from 'node:crypto';
import type { ClosedSandbox, CodexPolicy } from '../codex-policy.ts';
import type { RpcTransport } from '../providers/stdio.ts';

/**
 * The only execution path this ticket uses: the pinned Codex 0.153.4 isolated
 * `command/exec` method. There is deliberately no local-shell fallback and no
 * in-browser evaluation. Model-authored code and its output are untrusted.
 *
 * Every shape here is taken from the installed generated schema, not inferred:
 * `CommandExecParams`, `CommandExecResponse`, `CommandExecTerminateParams` and
 * `CommandExecOutputDeltaNotification`.
 */
export const SOLVER_EXEC_METHOD = 'command/exec' as const;
export const SOLVER_TERMINATE_METHOD = 'command/exec/terminate' as const;
export const SOLVER_OUTPUT_DELTA_NOTIFICATION = 'command/exec/outputDelta' as const;

/** The transport's own framing limit, mirrored from daemon/providers/stdio.ts. */
export const RPC_MAX_MESSAGE_BYTES = 1024 * 1024;
/**
 * A stream cut into more chunks than this is treated as output the host will not
 * hold. The per-stream byte cap is the real limit; this only stops a pathological
 * one-byte-per-chunk stream from costing unbounded bookkeeping.
 */
const MAX_OUTPUT_CHUNKS = 100_000;

/**
 * This adapter always streams.
 *
 * Budgeting a buffered reply against the 1 MiB frame limit cannot be done from raw
 * UTF-8 byte counts: JSON escaping multiplies bytes, and a single control byte
 * becomes a six-character escape. A cap that looks small in raw bytes can still
 * overflow the frame. `CommandExecParams.streamStdoutStderr` removes the problem
 * instead of bounding it: the generated schema states that streamed bytes are not
 * duplicated into the final response, so the reply frame stays small at every cap,
 * and `capReached` on the final chunk is the server's own truncation evidence.
 */
export const SOLVER_ALWAYS_STREAMS = true as const;

/** Exactly the policy-owned half of `CommandExecParams`. */
export type SolverCommandRequest = {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly sandboxPolicy: ClosedSandbox;
};

/**
 * `capReached` is the server's own signal that `outputBytesCap` truncated later
 * output on that stream. `hostBoundReached` is this adapter refusing to hold more.
 * They are reported separately so post-reply host truncation is never presented as
 * an enforced capture limit.
 */
export type SolverStreamObservation = {
  text: string;
  bytes: number;
  capReached: boolean;
  hostBoundReached: boolean;
};

/**
 * What this adapter actually observed about a terminate request, never what it hopes
 * happened. `none`: no terminate was attempted. `attempted`: the call was begun and no
 * handoff has been observed yet. `sent`: `rpc.request` accepted the call without
 * throwing, so the request reached the transport. `failed`: the call threw before any
 * handoff. No value here means the isolated process stopped; that is a separate,
 * always-false claim.
 */
export type SolverTerminationHandoff = 'none' | 'attempted' | 'sent' | 'failed';

export type SolverCommandObservation =
  | {
      status: 'exited';
      exitCode: number;
      stdout: SolverStreamObservation;
      stderr: SolverStreamObservation;
      /** True when output arrived as outputDelta notifications rather than in the reply. */
      streamed: boolean;
    }
  | {
      status: 'unknown';
      reason: string;
      /** A terminate request was attempted for this exact processId. */
      terminationRequested: boolean;
      /** How far that attempt was observed to get. `sent` is still not proof of exit. */
      terminationHandoff: SolverTerminationHandoff;
      /** Never true. An acknowledgement is not proof the isolated process exited. */
      processStopConfirmed: false;
    };

export type SolverExecOptions = {
  /** Per-stream limit the reader asked for. The server cap is set one byte above it. */
  maxOutputBytes: number;
  /** Host-owned identity for this dispatch attempt. Becomes the connection-scoped processId. */
  executionAttemptId: string;
  /** Fences the current attempt. It does not prove the isolated process stopped. */
  signal?: AbortSignal;
};

export type SolverTransportLimits = {
  timeout: boolean;
  outputBytes: boolean;
  /**
   * Always false. Codex 0.153.4 `CommandExecParams` has no memory parameter, so no
   * adapter built on it can enforce one.
   */
  memoryBytes: false;
  /** The RPC deadline this adapter answers within. A longer solver limit is refused. */
  maxTimeoutMs: number;
};

export interface SolverCommandTransport {
  /** Truthful capability report. The service refuses limits this adapter cannot apply. */
  readonly enforces: SolverTransportLimits;
  exec(request: SolverCommandRequest, options: SolverExecOptions): Promise<SolverCommandObservation>;
}

export class SolverPolicyError extends Error {
  override name = 'SolverPolicyError';
}

/**
 * Extracts the exec request from an audited policy. It refuses anything that is
 * not the reviewed saved-solver shape, so a model-turn policy can never reach here.
 */
export function execRequestFor(policy: CodexPolicy): SolverCommandRequest {
  if (policy.operation !== 'saved-solver') throw new SolverPolicyError('Only a saved-solver policy can be executed by this adapter.');
  if (policy.modelTurn !== false) throw new SolverPolicyError('A recompute policy must declare no model turn.');
  if (policy.commandExec.method !== SOLVER_EXEC_METHOD) throw new SolverPolicyError('The reviewed saved-solver method is required.');
  const params = policy.commandExec.params;
  if (!Array.isArray(params.command) || params.command.length < 2) throw new SolverPolicyError('The saved-solver command is incomplete.');
  if (params.command.some((argument) => typeof argument !== 'string' || argument.length === 0 || argument.includes('\0'))) {
    throw new SolverPolicyError('The saved-solver command contains an unsafe argument.');
  }
  if (params.sandboxPolicy.networkAccess !== false) throw new SolverPolicyError('The tool-execution sandbox must have no network access.');
  return params;
}

/** The per-stream capture cap, one byte above the reader's limit so an overrun is visible. */
export function outputBytesCapFor(maxOutputBytes: number): number {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new SolverPolicyError('The output limit must be a positive whole number of bytes.');
  return maxOutputBytes + 1;
}

/** Exactly `CommandExecParams`. No memory field exists in this version, so none is sent. */
export function commandExecParams(
  request: SolverCommandRequest,
  options: { processId: string; outputBytesCap: number; streamStdoutStderr: boolean },
): Record<string, unknown> {
  return {
    command: [...request.command],
    processId: options.processId,
    streamStdoutStderr: options.streamStdoutStderr,
    outputBytesCap: options.outputBytesCap,
    timeoutMs: request.timeoutMs,
    cwd: request.cwd,
    sandboxPolicy: request.sandboxPolicy,
  };
}

export type CommandExecResult = { exitCode: number; stdout: string; stderr: string };

/**
 * Reads exactly `CommandExecResponse`. `RpcTransport.request` has already unwrapped
 * the JSON-RPC result, so there is no nested result envelope to look inside and no
 * alias to guess. Anything else is unreadable, never a guessed success.
 */
export function readCommandResponse(response: unknown): { ok: true; value: CommandExecResult } | { ok: false; reason: string } {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    return { ok: false, reason: 'The command adapter did not return a CommandExecResponse object.' };
  }
  const value = response as Record<string, unknown>;
  const { exitCode, stdout, stderr } = value;
  if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode)) {
    return { ok: false, reason: 'The command adapter did not report an integer exitCode.' };
  }
  if (typeof stdout !== 'string' || typeof stderr !== 'string') {
    return { ok: false, reason: 'The command adapter did not report stdout and stderr as strings.' };
  }
  return { ok: true, value: { exitCode, stdout, stderr } };
}

/** Accumulates one stream under a hard byte bound and a hard chunk count. */
class StreamBuffer {
  private chunks: Buffer[] = [];
  private held = 0;
  private count = 0;
  capReached = false;
  hostBoundReached = false;

  private bound: number;

  constructor(bound: number) {
    this.bound = bound;
  }

  /** Returns false when this chunk could not be held in full. */
  add(bytes: Buffer): boolean {
    this.count += 1;
    if (this.count > MAX_OUTPUT_CHUNKS) { this.hostBoundReached = true; return false; }
    const room = this.bound - this.held;
    if (room <= 0) { this.hostBoundReached = true; return false; }
    if (bytes.byteLength > room) {
      this.chunks.push(bytes.subarray(0, room));
      this.held += room;
      this.hostBoundReached = true;
      return false;
    }
    this.chunks.push(bytes);
    this.held += bytes.byteLength;
    return true;
  }

  observation(): SolverStreamObservation {
    const joined = Buffer.concat(this.chunks, this.held);
    return { text: joined.toString('utf8'), bytes: this.held, capReached: this.capReached, hostBoundReached: this.hostBoundReached };
  }
}

type OutputDelta = { processId: string; stream: 'stdout' | 'stderr'; bytes: Buffer; capReached: boolean };

/**
 * How a notification was read. `unattributed` means no processId could be read at all,
 * so the chunk cannot be tied to any attempt and is ignored exactly as a chunk for
 * another process is. `malformed` carries the processId it named, so the caller can
 * decide: a malformed chunk naming this attempt is a protocol error, and a malformed
 * chunk naming another process is still none of this attempt's business.
 */
export type OutputDeltaRead =
  | { kind: 'delta'; delta: OutputDelta }
  | { kind: 'malformed'; processId: string; reason: string }
  | { kind: 'unattributed' };

/**
 * Decodes base64 in its canonical form only. `Buffer.from(value, 'base64')` silently
 * skips characters outside the alphabet and tolerates wrong padding, so two different
 * wire strings can decode to the same bytes and a corrupt chunk can decode to
 * plausible output. Re-encoding the result and requiring an exact match rejects every
 * non-canonical spelling, including unused trailing bits.
 */
export function decodeCanonicalBase64(value: string): Buffer | undefined {
  if (value.length % 4 !== 0) return undefined;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) return undefined;
  return decoded;
}

/**
 * Reads `CommandExecOutputDeltaNotification`. The processId is read first and on its
 * own, so "not readable at all" and "readable, names this attempt, and is broken" stay
 * separate outcomes. Collapsing them would let a corrupt chunk disappear from a stream
 * this adapter is otherwise reporting as complete.
 */
export function readOutputDelta(params: unknown): OutputDeltaRead {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return { kind: 'unattributed' };
  const value = params as Record<string, unknown>;
  if (typeof value.processId !== 'string' || value.processId.length === 0) return { kind: 'unattributed' };
  const processId = value.processId;
  if (value.stream !== 'stdout' && value.stream !== 'stderr') {
    return { kind: 'malformed', processId, reason: 'an output chunk named neither stdout nor stderr' };
  }
  if (typeof value.capReached !== 'boolean') {
    return { kind: 'malformed', processId, reason: 'an output chunk did not report capReached as a boolean' };
  }
  if (typeof value.deltaBase64 !== 'string') {
    return { kind: 'malformed', processId, reason: 'an output chunk did not carry deltaBase64 as a string' };
  }
  const bytes = decodeCanonicalBase64(value.deltaBase64);
  if (!bytes) {
    return { kind: 'malformed', processId, reason: 'an output chunk carried deltaBase64 that is not canonical base64' };
  }
  return { kind: 'delta', delta: { processId, stream: value.stream, bytes, capReached: value.capReached } };
}

/** Resolves the abort race without carrying an observation built before the facts are in. */
const ABORTED = Symbol('marginalia.solver.aborted');

export type RpcSolverTransportOptions = {
  /**
   * The RPC deadline the host configured on this transport. A solver time limit
   * above it is refused by the service rather than failing mid-run.
   */
  rpcTimeoutMs: number;
};

/**
 * Wraps the existing provider transport. It sends `command/exec`, and on abort
 * `command/exec/terminate` for that exact processId. It never starts a thread or a turn.
 */
export function createRpcSolverTransport(rpc: RpcTransport, options: RpcSolverTransportOptions): SolverCommandTransport {
  if (!Number.isSafeInteger(options.rpcTimeoutMs) || options.rpcTimeoutMs < 1) throw new TypeError('rpcTimeoutMs must be a positive integer.');
  return {
    enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: options.rpcTimeoutMs },
    async exec(request, execOptions) {
      if (execOptions.signal?.aborted) {
        return {
          status: 'unknown',
          reason: 'The recompute was cancelled before dispatch.',
          terminationRequested: false,
          terminationHandoff: 'none',
          processStopConfirmed: false,
        };
      }
      const cap = outputBytesCapFor(execOptions.maxOutputBytes);
      // Connection-scoped and unique per attempt, so terminate and every chunk name
      // this run and no other.
      const processId = `marginalia-recompute-${execOptions.executionAttemptId}-${randomUUID()}`;
      const stdout = new StreamBuffer(cap);
      const stderr = new StreamBuffer(cap);

      // Sticky: once output for this attempt arrives broken, nothing later can make the
      // capture whole again. A valid JSON prefix followed by a dropped chunk must not
      // be read as a complete result, so this forces `unknown` even on a clean exit.
      let protocolError: string | undefined;

      const stop = rpc.onNotification((method: string, params: unknown) => {
        if (method !== SOLVER_OUTPUT_DELTA_NOTIFICATION) return;
        const read = readOutputDelta(params);
        if (read.kind === 'unattributed') return;
        if (read.kind === 'malformed') {
          // Other processes are still none of this attempt's business.
          if (read.processId !== processId) return;
          protocolError ??= `The isolated command adapter sent unreadable output for this recompute, so the capture is incomplete: ${read.reason}.`;
          return;
        }
        const delta = read.delta;
        if (delta.processId !== processId) return;
        const target = delta.stream === 'stdout' ? stdout : stderr;
        if (delta.capReached) target.capReached = true;
        target.add(delta.bytes);
      });

      const signal = execOptions.signal;
      let terminationRequested = false;
      let handoff: SolverTerminationHandoff = 'none';
      // Read through a call, so every observation reports the state at the moment it is
      // built rather than the state the compiler last saw assigned.
      const terminationHandoff = (): SolverTerminationHandoff => handoff;
      let settled = false;
      let releaseAbort: () => void = () => {};
      const abort = new Promise<typeof ABORTED>((done) => { releaseAbort = () => done(ABORTED); });
      // Named, so the exact listener can be removed again. An anonymous listener
      // stays attached to a long-lived signal for the life of the process.
      const onAbortEvent = () => {
        if (settled) return;
        terminationRequested = true;
        handoff = 'attempted';
        // Called here rather than from a deferred microtask: the observation must be
        // able to state what actually happened to the request, and a queued call has
        // not happened yet. The returned promise is not awaited, because no
        // acknowledgement would prove the isolated process exited.
        try {
          const pending = rpc.request(SOLVER_TERMINATE_METHOD, { processId });
          handoff = 'sent';
          void Promise.resolve(pending).catch(() => {});
        } catch {
          handoff = 'failed';
        }
        releaseAbort();
      };
      if (signal) signal.addEventListener('abort', onAbortEvent);

      try {
        // The call is wrapped so that a synchronous throw from rpc.request becomes
        // a rejection inside this try, rather than escaping exec and skipping cleanup.
        const call = (async () => rpc.request(SOLVER_EXEC_METHOD, commandExecParams(request, {
          processId, outputBytesCap: cap, streamStdoutStderr: SOLVER_ALWAYS_STREAMS,
        })))().then(
          (response): SolverCommandObservation => {
            settled = true;
            // Checked before the reply, because a clean exit code says nothing about
            // the chunks that never made it into the capture.
            if (protocolError) {
              return { status: 'unknown', reason: protocolError, terminationRequested, terminationHandoff: terminationHandoff(), processStopConfirmed: false };
            }
            const read = readCommandResponse(response);
            if (!read.ok) return { status: 'unknown', reason: read.reason, terminationRequested, terminationHandoff: terminationHandoff(), processStopConfirmed: false };
            // Streamed bytes are not duplicated into the reply. A server that fills
            // these fields anyway did not honour streamStdoutStderr, so the reply may
            // already have been shaped by the frame limit. That is a protocol
            // disagreement, not a result to read.
            if (read.value.stdout.length > 0 || read.value.stderr.length > 0) {
              return {
                status: 'unknown',
                reason: 'The command adapter returned buffered output although streaming was requested; the capture cannot be trusted.',
                terminationRequested,
                terminationHandoff: terminationHandoff(),
                processStopConfirmed: false,
              };
            }
            return {
              status: 'exited',
              exitCode: read.value.exitCode,
              stdout: stdout.observation(),
              stderr: stderr.observation(),
              streamed: true,
            };
          },
          (error: unknown): SolverCommandObservation => {
            settled = true;
            const reason = error instanceof Error ? error.message : 'The command adapter failed.';
            return { status: 'unknown', reason: `The saved-solver outcome is unknown: ${reason}`, terminationRequested, terminationHandoff: terminationHandoff(), processStopConfirmed: false };
          },
        );
        if (!signal) return await call;
        const raced = await Promise.race([call, abort]);
        if (raced !== ABORTED) return raced;
        // Built here, from the state the terminate attempt actually reached, rather
        // than from wording chosen before the call was made.
        const handedOff = terminationHandoff() === 'sent';
        return {
          status: 'unknown',
          reason: handedOff
            ? 'The recompute was cancelled and a terminate request was handed to the isolated command adapter; the isolated process was not confirmed stopped.'
            : 'The recompute was cancelled and a terminate request was attempted but no handoff to the isolated command adapter was observed; the isolated process was not confirmed stopped.',
          terminationRequested,
          terminationHandoff: terminationHandoff(),
          processStopConfirmed: false,
        };
      } finally {
        // Past this point the attempt is over: no later abort of the same signal may
        // send a terminate for a processId this adapter is no longer watching.
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbortEvent);
        stop();
      }
    },
  };
}
