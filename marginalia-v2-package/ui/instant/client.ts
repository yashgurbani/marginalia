import type { InstantHelpSettings, InstantHelpSettingsChange } from '../../contracts/instant.ts';
import type { CandidateReply } from '../../contracts/reply.ts';
import type { InstantDefinitionEvent, InstantSelection, InstantTodayUsage, InstantTransport } from './transport.ts';

export interface InstantHttpGateway {
  request(path: string, body: object, signal?: AbortSignal): Promise<unknown>;
  stream(path: string, body: object, signal?: AbortSignal): AsyncIterable<unknown>;
}

/** Auth and origin policy belong to the injected helper gateway. */
export class InstantClient implements InstantTransport {
  private readonly gateway: InstantHttpGateway;
  constructor(gateway: InstantHttpGateway) { this.gateway = gateway; }

  async getSettings(signal?: AbortSignal): Promise<InstantHelpSettings> {
    return settingsFrom(await this.gateway.request('/api/instant/settings', {}, signal));
  }
  async saveSettings(change: InstantHelpSettingsChange, signal?: AbortSignal): Promise<InstantHelpSettings> {
    return settingsFrom(await this.gateway.request('/api/instant/settings', { change }, signal));
  }
  async getTodayUsage(signal?: AbortSignal): Promise<InstantTodayUsage> {
    const value = await this.gateway.request('/api/instant/usage', {}, signal);
    if (!record(value) || !record(value.usage) || !date(value.usage.periodStart) || typeof value.usage.timezone !== 'string'
      || !count(value.usage.usedTokens) || !count(value.usage.pendingTokens) || !count(value.usage.limitTokens)) {
      throw new Error('The helper returned invalid instant help usage.');
    }
    return value.usage as InstantTodayUsage;
  }
  async *requestDefinition(selection: InstantSelection, signal?: AbortSignal): AsyncIterable<InstantDefinitionEvent> {
    for await (const value of this.gateway.stream('/api/instant/definition', { selection }, signal)) yield eventFrom(value);
  }
  async forgetPage(pageKey: string, signal?: AbortSignal): Promise<void> {
    const value = await this.gateway.request('/api/instant/forget', { pageKey }, signal);
    if (!record(value) || value.forgotten !== true) throw new Error('Forgetting this page remains unconfirmed.');
  }
}

function settingsFrom(value: unknown): InstantHelpSettings {
  if (!record(value) || !record(value.settings)) throw new Error('The helper returned invalid instant help settings.');
  const settings = value.settings;
  if (settings.version !== 1 || !count(settings.revision) || typeof settings.enabled !== 'boolean'
    || (settings.model !== 'gpt-5.6-luna' && settings.model !== 'gpt-6-astra')
    || (settings.effort !== 'medium' && settings.effort !== 'high')
    || (settings.defaultAction !== 'define' && settings.defaultAction !== 'explain-simply')
    || !record(settings.tokenBudget) || settings.tokenBudget.period !== 'day' || typeof settings.tokenBudget.timezone !== 'string'
    || !positive(settings.tokenBudget.limit) || !positive(settings.warmPages) || !positive(settings.idleMinutes)
    || !record(settings.disclosure) || !positive(settings.disclosure.version)) {
    throw new Error('The helper returned invalid instant help settings.');
  }
  return settings as InstantHelpSettings;
}

function eventFrom(value: unknown): InstantDefinitionEvent {
  if (!record(value)) throw new Error('The helper returned an invalid instant help event.');
  if (value.type === 'text-delta' && typeof value.text === 'string' && value.text.length <= 2_000) return { type: value.type, text: value.text };
  if (value.type === 'state' && ['paused-at-limit', 'off', 'excluded'].includes(String(value.state))) {
    return { type: value.type, state: value.state as 'paused-at-limit' | 'off' | 'excluded' };
  }
  if (value.type === 'reply' && record(value.reply) && value.reply.schema === 'marginalia.reply.v1'
    && value.reply.status === 'complete' && typeof value.reply.summary === 'string') {
    return { type: value.type, reply: value.reply as unknown as CandidateReply };
  }
  throw new Error('The helper returned an invalid instant help event.');
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function date(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }
