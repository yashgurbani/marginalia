import type { InstantAction, InstantHelpSettings, InstantHelpSettingsChange } from '../../contracts/instant.ts';
import type { CandidateReply } from '../../contracts/reply.ts';

export type InstantTodayUsage = {
  periodStart: string;
  timezone: string;
  usedTokens: number;
  pendingTokens: number;
  limitTokens: number;
};

export type InstantSelection = {
  requestId: string;
  pageKey: string;
  sourceUrl: string;
  sourceGeneration: string;
  text: string;
  action: InstantAction;
};

export type InstantDefinitionEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reply'; reply: CandidateReply }
  | { type: 'state'; state: 'paused-at-limit' | 'off' | 'excluded' };

export interface InstantTransport {
  getSettings(signal?: AbortSignal): Promise<InstantHelpSettings>;
  saveSettings(change: InstantHelpSettingsChange, signal?: AbortSignal): Promise<InstantHelpSettings>;
  getTodayUsage(signal?: AbortSignal): Promise<InstantTodayUsage>;
  requestDefinition(selection: InstantSelection, signal?: AbortSignal): AsyncIterable<InstantDefinitionEvent>;
  forgetPage(pageKey: string, signal?: AbortSignal): Promise<void>;
}

type FakeDefinition = InstantDefinitionEvent[] | ((selection: InstantSelection, signal?: AbortSignal) => AsyncIterable<InstantDefinitionEvent>);

/** A deterministic in-memory helper boundary for UI tests and offline demos. */
export class FakeInstantTransport implements InstantTransport {
  settings: InstantHelpSettings;
  usage: InstantTodayUsage;
  definition: FakeDefinition = [];
  readonly saved: InstantHelpSettingsChange[] = [];
  readonly selections: InstantSelection[] = [];
  readonly forgotten: string[] = [];

  constructor(settings: InstantHelpSettings, usage?: Partial<InstantTodayUsage>) {
    this.settings = structuredClone(settings);
    this.usage = { periodStart: '2026-09-18', timezone: settings.tokenBudget.timezone,
      usedTokens: 0, pendingTokens: 0, limitTokens: settings.tokenBudget.limit, ...usage };
  }

  async getSettings(): Promise<InstantHelpSettings> { return structuredClone(this.settings); }
  async saveSettings(change: InstantHelpSettingsChange): Promise<InstantHelpSettings> {
    this.saved.push(structuredClone(change));
    const { expectedRevision, ...values } = structuredClone(change);
    this.settings = { ...values, version: 1, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    this.usage.limitTokens = this.settings.tokenBudget.limit;
    return structuredClone(this.settings);
  }
  async getTodayUsage(): Promise<InstantTodayUsage> { return structuredClone(this.usage); }
  async *requestDefinition(selection: InstantSelection, signal?: AbortSignal): AsyncIterable<InstantDefinitionEvent> {
    this.selections.push(structuredClone(selection));
    const events = typeof this.definition === 'function' ? this.definition(selection, signal) : arrayEvents(this.definition);
    for await (const event of events) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Stopped.', 'AbortError');
      yield structuredClone(event);
    }
  }
  async forgetPage(pageKey: string): Promise<void> { this.forgotten.push(pageKey); }
}

async function* arrayEvents(events: InstantDefinitionEvent[]) {
  for (const event of events) yield event;
}
