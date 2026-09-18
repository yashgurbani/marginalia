export const JOURNAL_RECAP_SCHEMA = 'marginalia.journal-summary.v1' as const;

export type JournalRecapCounts = {
  items: number;
  sources: number;
  threads: number;
  bookmarks: number;
  passages: number;
  highlights: number;
  notes: number;
  replies: number;
};

export type JournalRecapSource = { id: string; hash: string; title: string; url: string };
export type JournalRecapSnippet = {
  id: string;
  kind: 'source' | 'note';
  text: string;
  truncated: boolean;
  savedAt: string;
  threadId: string;
  threadLink: string;
  source: JournalRecapSource;
};
export type JournalRecapTopic = {
  id: string;
  label: string;
  basis: 'reader-grouping' | 'local-overlap' | 'saved-activity';
  counts: Pick<JournalRecapCounts, 'items' | 'sources' | 'threads'>;
  sourceIds: string[];
  threadIds: string[];
  terms: string[];
  truncated: boolean;
};
export type JournalRecap = {
  schema: typeof JOURNAL_RECAP_SCHEMA;
  kind: 'local-recap';
  label: 'Local recap';
  coverage: 'saved-activity';
  date: string;
  timeZone: string;
  description: string;
  counts: JournalRecapCounts;
  topics: JournalRecapTopic[];
  snippets: JournalRecapSnippet[];
};
export type JournalRecapResponse = { summary: JournalRecap };

export function journalRecapFrom(value: unknown): JournalRecap {
  if (!record(value) || !record(value.summary)) invalid();
  const summary = value.summary;
  if (summary.schema !== JOURNAL_RECAP_SCHEMA || summary.kind !== 'local-recap' || summary.label !== 'Local recap'
    || summary.coverage !== 'saved-activity' || !date(summary.date) || !text(summary.timeZone, 100)
    || !text(summary.description, 1_000) || !recapCounts(summary.counts)
    || !Array.isArray(summary.topics) || summary.topics.length > 256 || !summary.topics.every(topic)
    || !Array.isArray(summary.snippets) || summary.snippets.length > 24 || !summary.snippets.every(snippet)) invalid();
  const recap = summary as JournalRecap;
  return {
    ...recap,
    snippets: recap.snippets.map(value => ({
      ...value,
      // The old route is accepted only for a validated local cache payload;
      // never pass it through to the renderer, which assigns href directly.
      threadLink: value.threadLink === legacyThreadLink(value.threadId) ? rootThreadLink(value.threadId) : value.threadLink,
    })),
  };
}

export function journalRecapIsEmpty(summary: JournalRecap): boolean { return summary.counts.items === 0; }

function topic(value: unknown): value is JournalRecapTopic {
  return record(value) && text(value.id, 500) && text(value.label, 300)
    && ['reader-grouping', 'local-overlap', 'saved-activity'].includes(String(value.basis))
    && topicCounts(value.counts) && stringList(value.sourceIds, 128, 500) && stringList(value.threadIds, 128, 100)
    && stringList(value.terms, 16, 300) && typeof value.truncated === 'boolean';
}
function snippet(value: unknown): value is JournalRecapSnippet {
  return record(value) && text(value.id, 500) && ['source', 'note'].includes(String(value.kind)) && text(value.text, 240)
    && typeof value.truncated === 'boolean' && timestamp(value.savedAt) && id(value.threadId)
    && typeof value.threadLink === 'string' && [rootThreadLink(value.threadId), legacyThreadLink(value.threadId)].includes(value.threadLink)
    && source(value.source);
}
function source(value: unknown): value is JournalRecapSource {
  return record(value) && text(value.id, 500) && text(value.hash, 500) && text(value.title, 300) && safeUrl(value.url);
}
function recapCounts(value: unknown): value is JournalRecapCounts {
  return record(value) && ['items', 'sources', 'threads', 'bookmarks', 'passages', 'highlights', 'notes', 'replies'].every(key => count(value[key]));
}
function topicCounts(value: unknown): value is Pick<JournalRecapCounts, 'items' | 'sources' | 'threads'> {
  return record(value) && count(value.items) && count(value.sources) && count(value.threads);
}
function invalid(): never { throw new Error('The helper returned an invalid journal recap.'); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, limit: number): value is string { return typeof value === 'string' && value.length <= limit; }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function id(value: unknown): value is string { return typeof value === 'string' && /^[\w-]{1,100}$/.test(value); }
function date(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function stringList(value: unknown, items: number, characters: number): value is string[] {
  return Array.isArray(value) && value.length <= items && value.every(item => text(item, characters));
}
function safeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_000) return false;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password; }
  catch { return false; }
}

function rootThreadLink(threadId: string) { return `/#thread=${encodeURIComponent(threadId)}`; }
function legacyThreadLink(threadId: string) { return `/library#thread=${encodeURIComponent(threadId)}`; }
