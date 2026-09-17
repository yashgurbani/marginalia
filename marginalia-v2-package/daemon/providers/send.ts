import { ProviderNotSentError, type ProviderAudit, type ProviderHandle, type ProviderHooks, type ProviderRequest, type ProviderSendBinding } from '../../contracts/job-runner.ts';
import { RpcNotSentError, RpcRequestUsedError, type RpcTransport } from './stdio.ts';

/** Exactly one serialization precedes every asynchronous prerequisite. The transport owns
 * the immediate synchronous finalization/write pair. Reuse is never a not-sent assertion. */
export async function sendProviderRequest(rpc: RpcTransport, hooks: ProviderHooks, audit: ProviderAudit,
  request: ProviderRequest, handle: ProviderHandle, method: 'turn/start' | 'tools/call', params: unknown,
  current: () => ProviderHandle, onRequestId?: (id: number) => void): Promise<{ handle: ProviderHandle; response: Promise<any> }> {
  let entered = false, finalized = false;
  let canonical!: ProviderHandle;
  try {
    if (!rpc.prepareRequest) throw new Error('prepared-provider-send-unavailable');
    const exactParams = structuredClone(params);
    const prepared = rpc.prepareRequest(method, exactParams, onRequestId ? { onRequestId } : undefined);
    const binding: ProviderSendBinding = { method, params: exactParams, requestId: prepared.id,
      transportGeneration: prepared.generation, wireSha256: prepared.sha256 };
    await hooks.authorizeSend(structuredClone(request), structuredClone(handle), audit, structuredClone(binding));
    const response = prepared.send(() => {
      const latest = current();
      if (latest.tombstone) throw new Error('provider-send-cancelled');
      entered = true;
      const committed = hooks.finalizeSend(structuredClone(request), latest, audit, structuredClone(binding));
      if (committed && typeof (committed as unknown as { then?: unknown }).then === 'function') {
        void Promise.resolve(committed).catch(() => {});
        throw new Error('provider-finalization-must-return-synchronous-canonical-handle');
      }
      if (!committed ||
        committed.jobId !== latest.jobId || committed.provider !== latest.provider ||
        committed.workspace !== latest.workspace || committed.policyKey !== latest.policyKey ||
        committed.model !== latest.model || committed.mode !== latest.mode ||
        committed.providerInstanceId !== latest.providerInstanceId || committed.threadId !== latest.threadId ||
        committed.turnId || committed.tombstone || committed.state !== 'starting' ||
        !Number.isSafeInteger(committed.revision) || committed.revision! < 1) {
        throw new Error('provider-finalization-must-return-synchronous-canonical-handle');
      }
      canonical = committed; finalized = true;
    });
    return { handle: canonical, response };
  } catch (error) {
    // A committed host transaction followed by an injected transport throw is ambiguous.
    if (finalized) { const response = Promise.reject(error); void response.catch(() => {}); return { handle: canonical, response }; }
    // Preserve CAS/duplicate/transaction failures rather than claiming no other invocation sent.
    if (error instanceof RpcRequestUsedError) throw error;
    if (entered) throw error instanceof RpcNotSentError ? error.cause : error;
    throw new ProviderNotSentError(handle.provider, request.jobId, error);
  }
}
