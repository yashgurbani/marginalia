import type { AutoAssistSettings, AutoAssistSettingsChange } from '../../contracts/auto-assist.ts';
import type { AutoAssistTransport } from './transport.ts';

export interface AutoAssistHttpGateway {
  request(method: 'GET' | 'POST', path: string, body?: object, signal?: AbortSignal): Promise<unknown>;
}

/** Authentication and origin checks belong to the injected helper gateway. */
export class AutoAssistClient implements AutoAssistTransport {
  private readonly gateway: AutoAssistHttpGateway;
  constructor(gateway: AutoAssistHttpGateway) { this.gateway = gateway; }

  async getSettings(signal?: AbortSignal): Promise<AutoAssistSettings> {
    return settingsFrom(await this.gateway.request('GET', '/api/settings/auto-assist', undefined, signal));
  }
  async saveSettings(change: AutoAssistSettingsChange, signal?: AbortSignal): Promise<AutoAssistSettings> {
    return settingsFrom(await this.gateway.request('POST', '/api/settings/auto-assist', change, signal));
  }
}

function settingsFrom(value: unknown): AutoAssistSettings {
  if (!record(value) || !record(value.autoAssist)) throw new Error('The helper returned invalid auto assist settings.');
  const settings = value.autoAssist;
  if (settings.version !== 1 || !count(settings.revision) || typeof settings.enabled !== 'boolean'
    || (settings.updatedAt !== null && !dateTime(settings.updatedAt)) || settings.method !== 'frequency-page-v0'
    || !['flow', 'balanced', 'learning'].includes(String(settings.posture)) || !record(settings.autoDefinitions)
    || settings.autoDefinitions.budgetPercent !== 20 || settings.autoDefinitions.batchSize !== 3) {
    throw new Error('The helper returned invalid auto assist settings.');
  }
  return settings as unknown as AutoAssistSettings;
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function dateTime(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
