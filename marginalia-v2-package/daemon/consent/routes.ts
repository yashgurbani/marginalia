import type { ConsentDecisionRequest, ConsentPrincipal, ConsentSettingsChange, PrepareConsentInput } from '../../contracts/consent.ts';
import { ConsentSessionService } from './service.ts';

export type ConsentApiResponse = { status: number; body: unknown };

/** T06 calls this only after it freezes the final adapter-specific outgoing envelope. */
export function prepareConsentForTrustedHost(service: ConsentSessionService, input: PrepareConsentInput): ConsentApiResponse {
  try { return { status: 200, body: { preview: service.prepare(input) } }; }
  catch (error) { return failure(error); }
}

/**
 * T06 owns HTTP authentication and must construct `principal` from the paired token and validated
 * Origin. The body cannot nominate its own principal. Floating page-embedded callers get no
 * principal and therefore cannot reach these mutation handlers.
 */
export function handleConsentDecision(service: ConsentSessionService, principal: ConsentPrincipal | undefined, body: unknown): ConsentApiResponse {
  if (!principal) return { status: 403, body: { error: 'trusted-consent-surface-required' } };
  try {
    const request = parseDecision(body);
    return { status: 200, body: { grant: service.decide(request, principal) } };
  } catch (error) {
    return failure(error);
  }
}

export function handleConsentSettingsRead(service: ConsentSessionService, principal: ConsentPrincipal | undefined): ConsentApiResponse {
  if (!principal || principal.surface !== 'localhost-settings') return { status: 403, body: { error: 'localhost-settings-required' } };
  return { status: 200, body: { grants: service.grants(true), exclusions: service.exclusions() } };
}

export function handleConsentSettingsChange(service: ConsentSessionService, principal: ConsentPrincipal | undefined, body: unknown): ConsentApiResponse {
  if (!principal || principal.surface !== 'localhost-settings') return { status: 403, body: { error: 'localhost-settings-required' } };
  try {
    const change = parseSettingsChange(body);
    if (change.action === 'revoke-grant') return { status: 200, body: { grant: service.revokeGrant(change.grantId, change.expectedRevision) } };
    return { status: 200, body: { exclusion: service.setExclusion(change.site, change.excluded, change.expectedRevision) } };
  } catch (error) {
    return failure(error);
  }
}

function parseDecision(value: unknown): ConsentDecisionRequest {
  if (!record(value)) throw new Error('invalid-consent-decision');
  return { previewId: string(value.previewId), expectedRevision: integer(value.expectedRevision), choice: choice(value.choice) };
}
function parseSettingsChange(value: unknown): ConsentSettingsChange {
  if (!record(value)) throw new Error('invalid-consent-setting');
  if (value.action === 'revoke-grant') return { action: 'revoke-grant', grantId: string(value.grantId), expectedRevision: integer(value.expectedRevision) };
  if (value.action === 'set-exclusion') return { action: 'set-exclusion', site: string(value.site), excluded: boolean(value.excluded), ...(value.expectedRevision === undefined ? {} : { expectedRevision: integer(value.expectedRevision) }) };
  throw new Error('invalid-consent-setting');
}
function failure(error: unknown): ConsentApiResponse {
  const name = error instanceof Error ? error.name : '';
  const status = name === 'ConsentConflict' ? 409 : name === 'ConsentDenied' ? 403 : 400;
  const detail = error instanceof Error ? error.message.slice(0, 300) : 'Invalid consent request.';
  return { status, body: { error: status === 409 ? 'consent-conflict' : status === 403 ? 'consent-denied' : 'invalid-consent-request', detail } };
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('invalid-string'); return value; }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('invalid-revision'); return Number(value); }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('invalid-boolean'); return value; }
function choice(value: unknown): ConsentDecisionRequest['choice'] {
  if (!['this-time', 'always-site', 'never-site'].includes(String(value))) throw new Error('invalid-consent-choice');
  return value as ConsentDecisionRequest['choice'];
}
