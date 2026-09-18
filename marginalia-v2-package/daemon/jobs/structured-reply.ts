import type { ProviderKind } from '../../contracts/job-runner.ts';
import { REPLY_LIMITS } from '../../contracts/reply.ts';

/** Transport only. The full authoring contract and host admission remain unchanged.
 * Dynamic maps and optional fields cannot be losslessly compiled into the provider's
 * closed, all-required Structured Outputs object subset. */
export function structuredReplySchema(provider: ProviderKind, contract: Record<string, unknown>): Record<string, unknown> {
  if (provider !== 'app-server') return contract;
  return {
    type: 'object', additionalProperties: false, required: ['replyJson'],
    properties: {
      replyJson: {
        type: 'string',
        description: 'The complete Marginalia reply serialized once as JSON text, matching the authoring contract in the prompt. The host validates its contents independently.',
      },
    },
  };
}

/** Decode transport, never fill, remove or repair candidate fields. Native v1
 * objects remain readable for already completed pre-envelope attempts. */
export function structuredReplyText(text: string, provider: ProviderKind): string | undefined {
  if (provider !== 'app-server') return text;
  // JSON escaping can expand each original byte to six bytes. Bound before parse.
  if (Buffer.byteLength(text, 'utf8') > REPLY_LIMITS.bytes * 6 + 64) return;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, 'replyJson')) {
    if (Object.keys(record).length !== 1 || typeof record.replyJson !== 'string' ||
        Buffer.byteLength(record.replyJson, 'utf8') > REPLY_LIMITS.bytes) return;
    return record.replyJson;
  }
  return record.schema === 'marginalia.reply.v1' ? text : undefined;
}
