import type { AutoAssistSettings } from '../contracts/auto-assist.ts';

export const AMBIENT_PAGE_TYPES = ['paper', 'docs', 'article', 'social', 'reference', 'unknown'] as const;
export type AmbientPageType = typeof AMBIENT_PAGE_TYPES[number];

/**
 * Automatic help is deliberately narrower than the set of page types the
 * extension can identify. A reader may widen it through an explicit caller
 * supplied whitelist when that setting has a durable owner.
 */
export const CONSERVATIVE_AMBIENT_PAGE_TYPES = ['paper', 'docs', 'article', 'reference'] as const;

export type AmbientTrigger = 'ambient' | 'explicit-ask' | 'instant';
export type AmbientPolicyReason =
  | 'allowed'
  | 'auto-assist-disabled'
  | 'site-excluded'
  | 'unknown-page-type'
  | 'page-type-not-whitelisted'
  | 'explicit-ask'
  | 'instant-owner-default';

export type AmbientPolicyInput = {
  trigger?: AmbientTrigger;
  enabled: boolean;
  excluded: boolean;
  pageType: AmbientPageType;
  /** Runtime input only until a persisted whitelist is explicitly designed. */
  whitelist?: readonly AmbientPageType[];
};

export type AmbientPolicyDecision = {
  trigger: AmbientTrigger;
  pageType: AmbientPageType;
  /** False means this evaluator intentionally left the trigger to its owner. */
  applies: boolean;
  /** Null means ambient policy neither authorizes nor denies this owner-controlled trigger. */
  allowed: boolean | null;
  reason: AmbientPolicyReason;
};

export type AmbientSettingsReader = () => Pick<AutoAssistSettings, 'enabled'>;

export function isAmbientPageType(value: unknown): value is AmbientPageType {
  return typeof value === 'string' && (AMBIENT_PAGE_TYPES as readonly string[]).includes(value);
}

export function parseAmbientPageType(value: string | null | undefined): AmbientPageType {
  return isAmbientPageType(value) ? value : 'unknown';
}

export function normalizeAmbientWhitelist(value: readonly AmbientPageType[] | undefined): readonly AmbientPageType[] | undefined {
  if (value === undefined) return undefined;
  return [...new Set(value.filter(isAmbientPageType))];
}

/**
 * Decide only whether automatic ambient help may run for this page. Explicit
 * Ask and instant help remain owned by their existing flows and are returned
 * as pass-through decisions. This function performs no I/O and makes no
 * provider or persistence decisions.
 */
export function evaluateAmbientPolicy(input: AmbientPolicyInput): AmbientPolicyDecision {
  const trigger = input.trigger ?? 'ambient';
  if (trigger === 'explicit-ask') return { trigger, pageType: input.pageType, applies: false, allowed: null, reason: 'explicit-ask' };
  if (trigger === 'instant') return { trigger, pageType: input.pageType, applies: false, allowed: null, reason: 'instant-owner-default' };
  if (input.excluded) return { trigger, pageType: input.pageType, applies: true, allowed: false, reason: 'site-excluded' };
  if (!input.enabled) return { trigger, pageType: input.pageType, applies: true, allowed: false, reason: 'auto-assist-disabled' };

  const whitelist = normalizeAmbientWhitelist(input.whitelist);
  if (whitelist !== undefined) {
    return whitelist.includes(input.pageType)
      ? { trigger, pageType: input.pageType, applies: true, allowed: true, reason: 'allowed' }
      : { trigger, pageType: input.pageType, applies: true, allowed: false, reason: 'page-type-not-whitelisted' };
  }
  if (input.pageType === 'unknown' || !CONSERVATIVE_AMBIENT_PAGE_TYPES.includes(input.pageType as typeof CONSERVATIVE_AMBIENT_PAGE_TYPES[number])) {
    return { trigger, pageType: input.pageType, applies: true, allowed: false,
      reason: input.pageType === 'unknown' ? 'unknown-page-type' : 'page-type-not-whitelisted' };
  }
  return { trigger, pageType: input.pageType, applies: true, allowed: true, reason: 'allowed' };
}
