import type { JournalDay, JournalItem, JournalSource } from '../contracts/journal.ts';
import type { ReaderStore } from './store.ts';
import { JourneyEditsStore } from './journey-edits.ts';

export const JOURNAL_SUMMARY_SCHEMA = 'marginalia.journal-summary.v1' as const;
export const JOURNAL_SUMMARY_LABEL = 'Local recap' as const;
// The helper serves the webapp entrypoint at `/`. Keep the saved thread ID in
// the fragment so the page can choose the saved-work action without treating
// it as a public URL or a provider instruction.
const JOURNAL_THREAD_PATH = '/#thread=';
const MAX_SNIPPETS = 24;
const MAX_SNIPPET_CHARACTERS = 240;
const MAX_TITLE_CHARACTERS = 300;
const MAX_TOPIC_LIST_ITEMS = 128;

export type JournalSummaryBasis = 'reader-grouping' | 'local-overlap' | 'saved-activity';
export type JournalSummaryCounts = {
  items: number; sources: number; threads: number; bookmarks: number; passages: number;
  highlights: number; notes: number; replies: number;
};
export type JournalSummarySource = { id: string; hash: string; title: string; url: string };
export type JournalSummarySnippet = {
  id: string; kind: 'source' | 'note'; text: string; truncated: boolean; savedAt: string;
  threadId: string; threadLink: string; source: JournalSummarySource;
};
export type JournalSummaryTopic = {
  id: string; label: string; basis: JournalSummaryBasis;
  counts: Pick<JournalSummaryCounts, 'items' | 'sources' | 'threads'>;
  sourceIds: string[]; threadIds: string[]; terms: string[]; truncated: boolean;
};
export type JournalSummary = {
  schema: typeof JOURNAL_SUMMARY_SCHEMA; kind: 'local-recap'; label: typeof JOURNAL_SUMMARY_LABEL;
  coverage: 'saved-activity'; date: string; timeZone: string;
  description: string; counts: JournalSummaryCounts; topics: JournalSummaryTopic[];
  snippets: JournalSummarySnippet[];
};
export type JournalSummaryService = {
  summarize(input: { date: string; timeZone: string }): JournalSummary;
};

/**
 * A local projection over the existing saved-activity journal. It never starts
 * a provider turn and never treats a timestamp as evidence of reading.
 */
export function createJournalSummaryService(store: ReaderStore, vocabulary: () => readonly string[] = () => []): JournalSummaryService {
  const journal = new JourneyEditsStore(store);
  return {
    summarize(input) {
      validateDay(input.date);
      if (typeof input.timeZone !== 'string' || input.timeZone.length === 0 || input.timeZone.length > 100) throw new Error('Choose a valid journal time zone.');
      const snapshot = journal.journal(input.timeZone, safeVocabulary(vocabulary()));
      const day = snapshot.days.find(candidate => candidate.date === input.date);
      return summarizeDay(day, input.date, snapshot.timeZone);
    },
  };
}

function safeVocabulary(value: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((term): term is string => typeof term === 'string' && term.length <= 300);
}

function summarizeDay(day: JournalDay | undefined, date: string, timeZone: string): JournalSummary {
  const sources = day?.sources ?? [];
  const items = sources.flatMap(source => source.items);
  const counts = countItems(sources, items);
  return {
    schema: JOURNAL_SUMMARY_SCHEMA,
    kind: 'local-recap',
    label: JOURNAL_SUMMARY_LABEL,
    coverage: 'saved-activity',
    date,
    timeZone,
    description: 'This local recap only counts saved activity. It does not infer reading visits or provide generated knowledge.',
    counts,
    topics: topicsFor(day, sources, items),
    snippets: snippetsFor(sources),
  };
}

function countItems(sources: JournalSource[], items: JournalItem[]): JournalSummaryCounts {
  const threads = new Set(items.map(item => item.threadId));
  return {
    items: items.length,
    sources: sources.length,
    threads: threads.size,
    bookmarks: items.filter(item => item.kind === 'bookmark').length,
    passages: items.filter(item => item.kind === 'passage').length,
    highlights: items.filter(item => item.kind === 'highlight').length,
    notes: items.filter(item => item.kind === 'note').length,
    replies: items.filter(item => item.kind === 'reply').length,
  };
}

type TopicMember = { sourceId: string; threadId: string };
type TopicInput = { id: string; label: string; basis: JournalSummaryBasis; members: TopicMember[]; terms: string[] };

function topicsFor(day: JournalDay | undefined, sources: JournalSource[], items: JournalItem[]): JournalSummaryTopic[] {
  const groups: TopicInput[] = [];
  for (const journey of day?.journeys?.journeys ?? []) groups.push({ id: `reader:${journey.id}`, label: journey.name, basis: 'reader-grouping', members: journey.members.map(member => ({ sourceId: member.sourceVersionId, threadId: member.threadId })), terms: [] });
  for (const journey of day?.journeys?.suggested ?? []) groups.push({ id: `local:${journey.id}`, label: journey.name, basis: 'local-overlap', members: journey.members.map(member => ({ sourceId: member.sourceVersionId, threadId: member.threadId })), terms: [...new Set(journey.reasons.flatMap(reason => reason.sharedTerms))] });

  const itemKeys = new Map<string, JournalItem[]>();
  for (const source of sources) for (const item of source.items) {
    const key = memberKey(source.id, item.threadId), existing = itemKeys.get(key);
    if (existing) existing.push(item); else itemKeys.set(key, [item]);
  }
  const covered = new Set<string>();
  const result = groups.map(group => {
    const members = uniqueMembers(group.members), visible = members.flatMap(member => {
      const values = itemKeys.get(memberKey(member.sourceId, member.threadId)) ?? [];
      for (const value of values) covered.add(memberKey(member.sourceId, value.threadId));
      return values.map(value => ({ sourceId: member.sourceId, item: value }));
    });
    const sourceIds = [...new Set(visible.map(value => value.sourceId))].sort(compare);
    const threadIds = [...new Set(visible.map(value => value.item.threadId))].sort(compare);
    const limitReached = sourceIds.length > MAX_TOPIC_LIST_ITEMS || threadIds.length > MAX_TOPIC_LIST_ITEMS;
    return {
      id: group.id,
      label: boundedTitle(group.label || 'Saved activity'),
      basis: group.basis,
      counts: { items: visible.length, sources: sourceIds.length, threads: threadIds.length },
      sourceIds: sourceIds.slice(0, MAX_TOPIC_LIST_ITEMS),
      threadIds: threadIds.slice(0, MAX_TOPIC_LIST_ITEMS),
      terms: [...new Set(group.terms)].sort(compare).slice(0, 16),
      truncated: limitReached,
    };
  }).filter(topic => topic.counts.items > 0);
  const uncovered = items.filter(item => !covered.has(memberKey(findSourceId(sources, item), item.threadId)));
  if (uncovered.length) {
    const sourceIds = [...new Set(uncovered.map(item => findSourceId(sources, item)))].sort(compare);
    const threadIds = [...new Set(uncovered.map(item => item.threadId))].sort(compare);
    result.push({ id: 'saved-activity:unassigned', label: 'Saved activity', basis: 'saved-activity', counts: { items: uncovered.length, sources: sourceIds.length, threads: threadIds.length }, sourceIds: sourceIds.slice(0, MAX_TOPIC_LIST_ITEMS), threadIds: threadIds.slice(0, MAX_TOPIC_LIST_ITEMS), terms: [], truncated: sourceIds.length > MAX_TOPIC_LIST_ITEMS || threadIds.length > MAX_TOPIC_LIST_ITEMS });
  }
  return result.sort((a, b) => compare(a.id, b.id));
}

function snippetsFor(sources: JournalSource[]): JournalSummarySnippet[] {
  const candidates: JournalSummarySnippet[] = [];
  for (const source of sources) {
    const stableSource = stableSourceLink(source);
    for (const item of source.items) {
      if (item.note?.text) candidates.push(snippet(`note:${item.note.noteId}:${item.note.revision}`, 'note', item.note.text, item.at, item.threadId, stableSource));
      if (item.anchor.exact) candidates.push(snippet(`source:${item.id}`, 'source', item.anchor.exact, item.at, item.threadId, stableSource));
    }
  }
  return candidates.sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt) || compare(a.id, b.id)).slice(0, MAX_SNIPPETS);
}

function snippet(id: string, kind: JournalSummarySnippet['kind'], text: string, savedAt: string, threadId: string, source: JournalSummarySource): JournalSummarySnippet {
  return { id, kind, text: text.slice(0, MAX_SNIPPET_CHARACTERS), truncated: text.length > MAX_SNIPPET_CHARACTERS, savedAt, threadId, threadLink: `${JOURNAL_THREAD_PATH}${encodeURIComponent(threadId)}`, source };
}

function stableSourceLink(source: JournalSource): JournalSummarySource {
  let parsed: URL;
  try { parsed = new URL(source.url); } catch { throw new Error('A saved recap source link needs review.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || source.url.length > 8000) throw new Error('A saved recap source link needs review.');
  return { id: source.id, hash: source.hash, title: boundedTitle(source.title), url: source.url };
}

function uniqueMembers(members: TopicMember[]): TopicMember[] {
  const seen = new Set<string>();
  return members.filter(member => {
    const key = memberKey(member.sourceId, member.threadId);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function memberKey(sourceId: string, threadId: string) { return `${sourceId}\u0000${threadId}`; }
function findSourceId(sources: JournalSource[], item: JournalItem) {
  return sources.find(source => source.items.some(candidate => candidate.id === item.id && candidate.threadId === item.threadId))?.id ?? '';
}
function boundedTitle(value: string) { return value.slice(0, MAX_TITLE_CHARACTERS); }
function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

function validateDay(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Choose a valid journal day.');
}
