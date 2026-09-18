import type { QuoteAnchor } from './reader.ts';

export const RELATED_KINDS = ['note', 'thread'] as const;
export type RelatedKind = typeof RELATED_KINDS[number];

export type RelatedRequest = {
  passage: QuoteAnchor;
  threadId?: string;
  sourceVersionId?: string;
  limit?: number;
};

export type RelatedPassageResult = {
  kind: RelatedKind;
  threadId: string;
  anchorId: string;
  sourceVersionId: string;
  sourceTitle: string;
  sourceUrl: string;
  anchor: QuoteAnchor;
  sourceExcerpt: string;
  note: { id: string; revision: number; excerpt: string } | null;
  matchedTerms: string[];
  score: number;
  reason: string;
};

export type RelatedResponse = { results: RelatedPassageResult[] };
