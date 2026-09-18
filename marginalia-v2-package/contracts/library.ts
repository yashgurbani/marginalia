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

export const vocabularyOriginLabels = {
  used: 'Used in your note',
  'looked-up': 'You asked for a definition',
  stated: 'You chose Remember',
  legacy: 'Earlier entry; origin not recorded',
} as const;

export type VocabularyOriginKind = keyof typeof vocabularyOriginLabels;
export type VocabularySourceReference =
  | { kind: 'reader' }
  | { kind: 'note'; noteId: string; revision: number }
  | { kind: 'definition'; jobId: string; replyVersionId: string };

export type VocabularyOrigin = {
  operationId: string;
  origin: VocabularyOriginKind;
  observedAt: string;
  source: VocabularySourceReference;
};

export type VocabularyEntry = {
  term: string;
  status: string;
  firstSeen: string;
  lastSeen: string;
  origins?: VocabularyOrigin[];
  /** Read-only compatibility for pre-E22 snapshots; new stores return origins. */
  origin?: string;
};

export type VocabularyObservation = {
  operationId: string;
  term: string;
  /** H02: every new entry is created only by the explicit Remember action. */
  origin: 'stated';
  observedAt: string;
  source: VocabularySourceReference;
};

export type VocabularyObservationResult = {
  recorded: boolean;
  deleted: boolean;
  entry?: VocabularyEntry;
};

export type LibraryMatchKind = 'source' | 'note' | 'reply';

/** A local-only match with a passage locator into the immutable saved source. */
export type LibrarySearchResult = {
  threadId: string;
  sourceVersionId: string;
  sourceTitle: string;
  sourceUrl: string;
  kind: LibraryMatchKind;
  passage: string;
  start: number;
  end: number;
  matchExcerpt: string;
  matchedTerms: string[];
  explanation: string;
  evidenceLabel: 'source passage' | 'reader note' | 'saved reply — not source evidence';
};

export type RelatedLibraryResult = LibrarySearchResult & {
  kind: 'source';
  evidenceLabel: 'source passage';
};

export type LibrarySnapshot = {
  threads: Thread[];
  models: ModelSettings;
  vocabulary: VocabularyEntry[];
};

export type LibraryThread = Thread;
