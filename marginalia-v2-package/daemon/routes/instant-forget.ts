import type { ConsentPrincipal } from '../../contracts/consent.ts';
import type { InstantForgetService } from '../instant/forget.ts';
import type { ApiRouteContext } from './types.ts';

export const INSTANT_FORGET_PATH = '/api/instant/forget';

/** The helper constructs this identity from pairing and origin. Request JSON never supplies it. */
export function instantPrincipalKey(principal: ConsentPrincipal): string {
  return JSON.stringify([principal.pairingId, principal.origin]);
}

function pageIdFrom(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A page is required.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.pageId !== 'string' || record.pageId.trim().length === 0 ||
      record.pageId.length > 2_000 || record.pageId.includes('\0')) throw new Error('A page is required.');
  return record.pageId;
}

/**
 * Mount before the broad `/api/instant/` handler. The route rechecks pairing after reading the
 * body, then passes only the host-built principal identity to the forget service.
 */
export function createInstantForgetRoute(service: InstantForgetService) {
  return async (context: ApiRouteContext): Promise<boolean> => {
    const { request, response, url, principal, requireCurrentPairing, send, body } = context;
    if (url.pathname !== INSTANT_FORGET_PATH) return false;
    if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to forget this page.' }); return true; }
    if (request.method !== 'POST') { send(response, 405, { error: 'Use POST to forget this page.' }); return true; }
    const value = await body(request);
    if (!requireCurrentPairing()) { send(response, 401, { error: 'Pairing changed. Pair again.' }); return true; }
    const result = await service.forget(instantPrincipalKey(principal), pageIdFrom(value));
    send(response, 200, result);
    return true;
  };
}
