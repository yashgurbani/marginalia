import { CONTROL_MODELS, type ControlModel, type ModelChoice } from './model-controls.ts';
import { validateReply, type CandidateReply } from './reply.ts';

export const INSTANT_HELP_KEY = 'library.instant-help.v1';
export const INSTANT_MODELS = CONTROL_MODELS;
export type InstantModel = ControlModel;
/** V2 choice, resolved separately from legacy operating/consent settings. */
export type InstantModelChoice = ModelChoice;
export type InstantAction = 'define' | 'explain-simply';
export type InstantHelpSettings = {
  version: 1; revision: number; enabled: boolean; updatedAt: string | null;
  model: InstantModel; effort: 'medium' | 'high'; defaultAction: InstantAction;
  tokenBudget: { period: 'day'; timezone: string; limit: number };
  warmPages: number; idleMinutes: number;
  disclosure: { version: number; acknowledgedAt: string | null };
};
export type InstantHelpSettingsChange = Omit<InstantHelpSettings, 'version' | 'revision' | 'updatedAt'> & { expectedRevision: number };
export type InstantUsageTotals = {
  inputTokens: number | null; cachedInputTokens: number | null;
  outputTokens: number | null; totalTokens: number | null;
};
export type InstantReservation = {
  requestId: string; pageKeyHash: string; kind: 'prepare' | 'selection' | 'auto-definition';
  reservedTokens: number;
};
export type InstantUsageRecord = InstantReservation & InstantUsageTotals & {
  /** Calendar date in the stored timezone, not the helper's current timezone. */
  periodStart: string; timezone: string; model: InstantModel;
  state: 'reserved' | 'settled'; createdAt: string; settledAt: string | null;
};
export type InstantAdmissionResult =
  | { state: 'admitted'; usage: InstantUsageRecord }
  | { state: 'paused-at-limit' | 'off' | 'excluded' };

export function defaultInstantHelpSettings(timezone = 'UTC'): InstantHelpSettings {
  return { version: 1, revision: 0, enabled: true, updatedAt: null,
    model: 'gpt-5.6-luna', effort: 'medium', defaultAction: 'define',
    tokenBudget: { period: 'day', timezone, limit: 100_000 }, warmPages: 8, idleMinutes: 15,
    disclosure: { version: 1, acknowledgedAt: null } };
}

/** Only final, bounded explanatory prose belongs in this text-only reply. */
export function instantTextToReply(text: string, action: InstantAction = 'define'): CandidateReply {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || text.trim().split(/\s+/u).length > 60
    || /<[^>\r\n]+>|`|[\u0000-\u001f\u007f]/u.test(text)
    || /!?\[[^\]\r\n]*\]\([^\)\r\n]+\)/u.test(text)
    || /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\b(?:mailto|javascript|data|file):|\b[\w-]+\.[a-z]{2,}\b)/iu.test(text)
    || /^\s*(?:system|developer|assistant)\s*:/iu.test(text)
    || /\b(?:ignore|disregard|override|forget)\b.*\b(?:instructions?|prompts?|rules?|previous|above)\b/iu.test(text)
    || (action !== 'define' && action !== 'explain-simply')) throw new Error('Instant help needs a short plain explanation without markup, links or instructions.');
  const authored = { kind: 'authored' as const, description: 'Contextual explanation' };
  const candidate: CandidateReply = {
    schema: 'marginalia.reply.v1', intent: 'define', status: 'complete',
    title: action === 'define' ? 'In this passage' : 'Simply put', summary: text, staticFallback: text,
    sourceBindings: [], parameters: [], assumptions: [], limitations: [], requiredCapabilities: [],
    blocks: [{ id: 'meaning', type: 'text', md: text }], checks: [],
    origins: { version: 1, parts: { '/title': { ...authored }, '/summary': { ...authored }, '/staticFallback': { ...authored }, '/blocks/0': { ...authored } } },
  };
  const result = validateReply(candidate, { sourceText: '', capabilities: [], requireOrigins: true });
  if (!result.ok) throw new Error(result.errors.join(' '));
  return result.value;
}
