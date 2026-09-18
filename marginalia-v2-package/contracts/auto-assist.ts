export type DifficultyMethod = 'frequency-page-v0' | 'causal-lm-v1';

export type DifficultyInput = {
  pageKeyHash: string;
  text: string;
  sections: readonly { title: string; start: number; end: number }[];
  language: string;
};

export type DifficultyCandidate = {
  candidateId: string;
  term: string;
  normalizedTerm: string;
  start: number;
  end: number;
  /** Comparable only within one method and version. */
  score: number;
  /** Present only when a causal model computed it. */
  surprisalBits?: number;
  /** Fixed engineering codes, never reader copy. */
  reasons: readonly string[];
};

export interface DifficultyScorer {
  readonly method: DifficultyMethod;
  readonly version: string;
  scorePage(input: DifficultyInput, signal: AbortSignal): Promise<readonly DifficultyCandidate[]>;
}

export type AutoAssistPosture = 'flow' | 'balanced' | 'learning';
export type AutoAssistPostureLimits = {
  underlinesPerBand: 1 | 2 | 3;
  pageCap: 12 | 20 | 30;
  readyBands: 1 | 2 | 3;
  assumesTerms: 3 | 4 | 5;
};

export const AUTO_ASSIST_POSTURE_LIMITS = Object.freeze({
  flow: Object.freeze({ underlinesPerBand: 1, pageCap: 12, readyBands: 1, assumesTerms: 3 }),
  balanced: Object.freeze({ underlinesPerBand: 2, pageCap: 20, readyBands: 2, assumesTerms: 4 }),
  learning: Object.freeze({ underlinesPerBand: 3, pageCap: 30, readyBands: 3, assumesTerms: 5 }),
}) satisfies Readonly<Record<AutoAssistPosture, AutoAssistPostureLimits>>;

export const AUTO_ASSIST_KEY = 'library.auto-assist.v1';
export const AUTO_DEFINITION_BUDGET_PERCENT = 20;
export const AUTO_DEFINITION_BATCH_SIZE = 3;

export type AutoAssistSettings = {
  version: 1;
  revision: number;
  enabled: boolean;
  updatedAt: string | null;
  method: 'frequency-page-v0';
  posture: AutoAssistPosture;
  autoDefinitions: { budgetPercent: 20; batchSize: 3 };
};

export type AutoAssistSettingsChange = Omit<AutoAssistSettings, 'version' | 'revision' | 'updatedAt'> & {
  expectedRevision: number;
};

export function defaultAutoAssistSettings(): AutoAssistSettings {
  return {
    version: 1, revision: 0, enabled: false, updatedAt: null,
    method: 'frequency-page-v0', posture: 'balanced',
    autoDefinitions: { budgetPercent: AUTO_DEFINITION_BUDGET_PERCENT, batchSize: AUTO_DEFINITION_BATCH_SIZE },
  };
}

export type AutoAssistEventKind = 'nominated' | 'shown' | 'definition-ready' | 'definition-opened'
  | 'dismissed-familiar' | 'kept' | 'asked';
export type AutoAssistElapsedBucket = '<2s' | '2-10s' | '10-60s' | '>60s' | null;

export type AutoAssistEvent = {
  eventId: string;
  candidateId: string;
  pageKeyHash: string;
  scorerMethod: DifficultyMethod;
  scorerVersion: string;
  scoreBand: 0 | 1 | 2 | 3;
  rankInBand: number;
  reasonBits: number;
  posture: AutoAssistPosture;
  bandIndex: number;
  event: AutoAssistEventKind;
  elapsedBucket: AutoAssistElapsedBucket;
  createdAt: string;
};
