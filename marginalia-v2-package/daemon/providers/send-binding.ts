import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AuditedPolicy, ProviderHandle, ProviderRequest, ProviderSendBinding } from '../../contracts/job-runner.ts';
import { formatMcpPrompt } from './prompt.ts';

/** Verify the bytes about to leave against the immutable request AND audited policy.
 * Never promote requested configuration to an observation of effective confinement. */
export function validateProviderSend(request: ProviderRequest, handle: ProviderHandle, policy: AuditedPolicy, wire: ProviderSendBinding): void {
  const app = handle.provider === 'app-server';
  const expected = app ? { ...policy.turn, threadId: handle.threadId, model: request.model,
    input: [{ type: 'text', text: request.prompt, text_elements: [] }],
    ...(request.mode === 'structured-final' ? { outputSchema: request.outputSchema } : {}) }
    : { name: handle.threadId ? 'codex-reply' : 'codex',
      arguments: { ...(handle.threadId ? { threadId: handle.threadId } : { ...policy.mcp, model: request.model }), prompt: formatMcpPrompt(request) } };
  if (!wire || wire.method !== (app ? 'turn/start' : 'tools/call') || !Number.isSafeInteger(wire.requestId) || wire.requestId < 1 ||
      typeof wire.transportGeneration !== 'string' || !/^[\w-]{1,100}$/.test(wire.transportGeneration) ||
      !isDeepStrictEqual(wire.params, expected)) throw new Error('provider-send-payload-mismatch');
  const message = { id: wire.requestId, method: wire.method, ...(!app ? { jsonrpc: '2.0' } : {}), params: wire.params };
  const digest = createHash('sha256').update(JSON.stringify(message) + '\n').digest('hex');
  if (wire.wireSha256 !== digest) throw new Error('provider-send-wire-digest-mismatch');
}
