import type { NoteVersion, QuoteAnchor, ReplyVersion } from './reader.ts';
import type { JourneyEdits, SuggestedJourney } from './journeys.ts';

export type JournalItem = {
  id: string; threadId: string; kind: 'bookmark' | 'passage' | 'highlight' | 'note' | 'reply';
  at: string; anchor: QuoteAnchor; note?: NoteVersion; currentNoteRevision?: number; reply?: ReplyVersion;
};
export type JournalSource = { id: string; hash: string; url: string; title: string; items: JournalItem[] };
export type JournalDay = { date: string; timeZone: string; sources: JournalSource[]; journeys?: JourneyEdits & { suggested: SuggestedJourney[] } };
/** Existing saved timestamps establish activity, not every reading visit. */
export type ReadingJournal = { schema: 'marginalia.journal.v1'; coverage: 'saved-activity'; timeZone: string; days: JournalDay[] };
