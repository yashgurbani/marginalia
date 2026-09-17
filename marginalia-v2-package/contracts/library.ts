import type { Thread, ThreadState } from './reader.ts';

export type LibraryThreadFilter = ThreadState | 'removed';
export type ModelTier = 'fast' | 'deep';

export type ModelSettings = {
  fast: string;
  deep: string;
  revision: number;
  updatedAt: string | null;
  /** Host-owned identity used to prevent continuation across changed model choices. */
  compatibilityKey: string;
};

export type ModelSettingsChange = {
  fast: string;
  deep: string;
  expectedRevision: number;
};

export type ModelSelection = {
  model: string;
  settingsRevision: number;
  compatibilityKey: string;
};

export type VocabularyEntry = {
  term: string;
  origin: string;
  status: string;
  firstSeen: string;
  lastSeen: string;
};

export type LibrarySnapshot = {
  threads: Thread[];
  models: ModelSettings;
  vocabulary: VocabularyEntry[];
};

export type LibraryThread = Thread;
