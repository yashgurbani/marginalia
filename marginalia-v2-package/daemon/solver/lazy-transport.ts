import type { RpcTransport } from '../providers/stdio.ts';
import { createRpcSolverTransport, type SolverCommandTransport, type SolverExecOptions,
  type SolverCommandRequest, type SolverCommandObservation } from './transport.ts';

export type LazySolverTransportOptions = {
  readonly launch: () => Promise<RpcTransport>;
  readonly inspect: (rpc: RpcTransport) => Promise<unknown>;
  readonly rpcTimeoutMs: number;
};

/** One daemon-lifetime app-server, initialized only when saved-solver work first needs it. */
export interface LazySolverTransport extends SolverCommandTransport, Pick<RpcTransport, 'request'> {
  close(): void;
  lastLaunchFailureReason(): string | undefined;
}

export function createLazySolverTransport(options: LazySolverTransportOptions): LazySolverTransport {
  if (!Number.isSafeInteger(options.rpcTimeoutMs) || options.rpcTimeoutMs < 1) {
    throw new TypeError('rpcTimeoutMs must be a positive integer.');
  }
  let rpc: RpcTransport | undefined;
  let transport: SolverCommandTransport | undefined;
  let initializing: Promise<RpcTransport> | undefined;
  let closed = false;
  let failureReason: string | undefined;

  async function initialize(): Promise<RpcTransport> {
    let launched: RpcTransport | undefined;
    try {
      launched = await options.launch();
      await options.inspect(launched);
      if (closed) throw new Error('The saved-solver transport is shutting down.');
      rpc = launched;
      transport = createRpcSolverTransport(launched, { rpcTimeoutMs: options.rpcTimeoutMs });
      return launched;
    } catch (error) {
      launched?.close();
      failureReason = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async function ready(): Promise<RpcTransport> {
    if (closed) throw new Error('The saved-solver transport is shutting down.');
    if (rpc) return rpc;
    if (!initializing) {
      const attempt = initialize();
      initializing = attempt;
      void attempt.finally(() => {
        if (initializing === attempt) initializing = undefined;
      }).catch(() => {});
    }
    return initializing;
  }

  return {
    enforces: { timeout: true, outputBytes: true, memoryBytes: false, maxTimeoutMs: options.rpcTimeoutMs },
    async exec(request: SolverCommandRequest, execOptions: SolverExecOptions): Promise<SolverCommandObservation> {
      await ready();
      return transport!.exec(request, execOptions);
    },
    async request(method: string, params?: unknown, requestOptions?: { onRequestId(id: number): void }): Promise<any> {
      return (await ready()).request(method, params, requestOptions);
    },
    close() {
      if (closed) return;
      closed = true;
      rpc?.close();
      rpc = undefined;
      transport = undefined;
    },
    lastLaunchFailureReason: () => failureReason,
  };
}
