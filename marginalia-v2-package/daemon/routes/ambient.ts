import type { ApiRouteContext } from './types.ts';
import {
  AMBIENT_PAGE_TYPES, CONSERVATIVE_AMBIENT_PAGE_TYPES, evaluateAmbientPolicy, normalizeAmbientWhitelist,
  parseAmbientPageType, type AmbientPageType, type AmbientPolicyDecision, type AmbientSettingsReader, type AmbientTrigger,
} from '../ambient-policy.ts';

export const AMBIENT_POLICY_PATH = '/api/ambient/policy';

export type AmbientPolicyRouteOptions = {
  readSettings: AmbientSettingsReader;
  /** Reads the durable host policy for a normalized page origin. */
  readHostPolicy: (siteOrigin: string) => { excluded: boolean };
  /** Optional runtime input. It is not persisted by this route. */
  readWhitelist?: () => readonly AmbientPageType[] | undefined;
};

export type AmbientPolicyRead = {
  sourceOrigin: string;
  pageType: AmbientPageType;
  excluded: boolean;
  trigger: AmbientTrigger;
  autoAssistEnabled: boolean;
  whitelist: readonly AmbientPageType[] | null;
  conservativePageTypes: typeof CONSERVATIVE_AMBIENT_PAGE_TYPES;
  supportedPageTypes: typeof AMBIENT_PAGE_TYPES;
  policy: AmbientPolicyDecision;
};

export function createAmbientRoutes(options: AmbientPolicyRouteOptions) {
  return async (context: ApiRouteContext): Promise<boolean> => {
    const { request, response, url, requestOrigin, requireCurrentPairing, emptyBody, send } = context;
    const readAlias = url.pathname === '/api/read/ambient/policy';
    if (!readAlias && url.pathname !== AMBIENT_POLICY_PATH) return false;
    if (readAlias) {
      if (request.method !== 'POST') { send(response, 405, { error: 'Use POST for this read operation.' }); return true; }
      if (!requestOrigin) { send(response, 401, { error: 'Origin required.' }); return true; }
      await emptyBody(request, true);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pairing changed. Pair again.' }); return true; }
    } else if (request.method !== 'GET') { send(response, 405, { error: 'Use GET for the ambient policy.' }); return true; }

    const trigger = parseTrigger(url.searchParams.get('trigger'));
    if (!trigger) { send(response, 400, { error: 'Unknown ambient policy trigger.' }); return true; }
    const sourceOrigin = parseSourceOrigin(url.searchParams.get('sourceUrl'));
    if (!sourceOrigin) { send(response, 400, { error: 'A valid source URL is required for the ambient policy.' }); return true; }
    const pageType = parseAmbientPageType(url.searchParams.get('type'));
    const settings = options.readSettings();
    const excluded = options.readHostPolicy(sourceOrigin).excluded;
    const whitelist = normalizeAmbientWhitelist(options.readWhitelist?.());
    const policy = evaluateAmbientPolicy({ trigger, enabled: settings.enabled, excluded, pageType, whitelist });
    const result: AmbientPolicyRead = {
      sourceOrigin, pageType, excluded, trigger, autoAssistEnabled: settings.enabled,
      whitelist: whitelist ? [...whitelist] : null,
      conservativePageTypes: CONSERVATIVE_AMBIENT_PAGE_TYPES,
      supportedPageTypes: AMBIENT_PAGE_TYPES,
      policy,
    };
    send(response, 200, result);
    return true;
  };
}

function parseTrigger(value: string | null): AmbientTrigger | undefined {
  return value === null || value === 'ambient' || value === 'explicit-ask' || value === 'instant' ? (value ?? 'ambient') : undefined;
}

function parseSourceOrigin(value: string | null): string | undefined {
  if (!value || value.length > 8192) return undefined;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}
