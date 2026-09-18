/** Explicit reply envelope for runtime and tab messages. Error text stays bounded. */
export type MessageReply = { ok: true; value: unknown } | { ok: false; error: string };

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const allowed = new Set([
    'Source changed.', 'This page is excluded.', 'This page is not active.',
    'The page changed. Select the passage again.', 'Open this margin from the source.',
    'Reopen this margin from the source.', 'The source changed. Reopen the margin from that page.',
    'Open the margin from the page.', 'This page is excluded or changed.',
    'Reopen the margin after navigation.', 'Reopen the margin.',
    'Open the native margin.', 'Choose a supported page.',
    'This source is unavailable.', 'Stale source request.',
    'This passage could not be located safely on the current page.',
    'The source action failed.', 'Unsupported margin request.',
  ]);
  return allowed.has(message) ? message : 'The margin request failed. Reopen it from the source page.';
}

export function respondAsync(operation: () => unknown, respond: (value: MessageReply) => void): true {
  Promise.resolve().then(operation).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: publicError(error) }));
  return true;
}

export function readReply(value: unknown): unknown {
  if (!value || typeof value !== 'object') throw new Error('The margin did not answer. Reopen it from the source page.');
  const reply = value as Partial<MessageReply>;
  if (reply.ok === true && 'value' in reply) return reply.value;
  if (reply.ok === false && typeof reply.error === 'string' && reply.error.length > 0 && reply.error.length <= 180 && /^[\x20-\x7e]+$/.test(reply.error)) throw new Error(reply.error);
  throw new Error('The margin returned an invalid response. Reopen it from the source page.');
}
