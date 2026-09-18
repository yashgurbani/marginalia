import type { AutoAssistSettings, AutoAssistSettingsChange } from '../../contracts/auto-assist.ts';

export interface AutoAssistTransport {
  getSettings(signal?: AbortSignal): Promise<AutoAssistSettings>;
  saveSettings(change: AutoAssistSettingsChange, signal?: AbortSignal): Promise<AutoAssistSettings>;
}

/** Deterministic settings boundary for UI tests and offline hosts. */
export class FakeAutoAssistTransport implements AutoAssistTransport {
  settings: AutoAssistSettings;
  readonly saved: AutoAssistSettingsChange[] = [];

  constructor(settings: AutoAssistSettings) { this.settings = structuredClone(settings); }
  async getSettings(): Promise<AutoAssistSettings> { return structuredClone(this.settings); }
  async saveSettings(change: AutoAssistSettingsChange): Promise<AutoAssistSettings> {
    this.saved.push(structuredClone(change));
    const { expectedRevision, ...values } = structuredClone(change);
    this.settings = { ...values, version: 1, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    return structuredClone(this.settings);
  }
}
