import type { Note, QuoteAnchor, Thread } from '../../contracts/reader.ts';

export type LibraryThreadExport = {
  thread: Thread;
  source?: { text: string };
  [key: string]: unknown;
};

export type WholeLibraryExport = {
  markdown: string;
  jsonLd: string;
};

type AnnotationBody = {
  id: string;
  type: 'TextualBody';
  value: string;
  format: 'text/plain';
  purpose: 'commenting';
  created: string;
  'marginalia:noteId': string;
  'marginalia:threadId': string;
  'marginalia:revision': number;
  'marginalia:deletedAt': string | null;
};

type WebAnnotation = {
  id: string;
  type: 'Annotation';
  motivation: Array<'highlighting' | 'commenting' | 'bookmarking'>;
  created: string;
  modified: string;
  body: AnnotationBody[];
  target: { id: string } | { type: 'SpecificResource'; source: string; selector: Array<
    { type: 'TextQuoteSelector'; exact: string; prefix: string; suffix: string }
    | { type: 'TextPositionSelector'; start: number; end: number }
  > };
  'marginalia:anchorId': string;
  'marginalia:kind': NonNullable<QuoteAnchor['kind']> | 'legacy-quote';
  'marginalia:recordJson': string;
  'marginalia:threadId': string;
  'marginalia:sourceVersionId': string;
  'marginalia:sourceTitle': string;
  'marginalia:state': Thread['state'];
  'marginalia:revision': number;
  'marginalia:deletedAt': string | null;
  'marginalia:highlighted': boolean;
};

/**
 * Produces two local, inert representations of the complete thread set supplied
 * by the helper. Marginalia metadata is additive to the W3C Web Annotation
 * shape; it is retained for a lossless Marginalia round trip, not presented as
 * evidence that another annotation product can import the file.
 */
export function wholeLibraryExport(records: readonly LibraryThreadExport[], exportedAt = new Date()): WholeLibraryExport {
  const seen = new Set<string>();
  for (const record of records) {
    if (!record?.thread || typeof record.thread.id !== 'string') throw new Error('A library export did not contain its thread.');
    if (seen.has(record.thread.id)) throw new Error(`The library returned thread ${record.thread.id} more than once.`);
    seen.add(record.thread.id);
  }
  const sorted = [...records].sort((a, b) => compareThreads(a.thread, b.thread));
  return {
    markdown: markdownLibrary(sorted, exportedAt),
    jsonLd: JSON.stringify(annotationLibrary(sorted, exportedAt), null, 2) + '\n',
  };
}

function annotationLibrary(records: readonly LibraryThreadExport[], exportedAt: Date) {
  const collectionId = 'urn:marginalia:library';
  return {
    '@context': [
      'http://www.w3.org/ns/anno.jsonld',
      { marginalia: 'https://marginalia.local/ns#' },
    ],
    id: collectionId,
    type: 'AnnotationCollection',
    label: 'Marginalia library export',
    'marginalia:exportedAt': exportedAt.toISOString(),
    total: records.length,
    first: {
      id: 'urn:marginalia:library:page:1',
      type: 'AnnotationPage',
      partOf: collectionId,
      startIndex: 0,
      items: records.map(annotation),
    },
  };
}

function annotation(record: LibraryThreadExport): WebAnnotation {
  const { thread } = record;
  const motivation: WebAnnotation['motivation'] = [];
  if (thread.highlighted && thread.anchor.kind !== 'whole-page') motivation.push('highlighting');
  if (thread.notes.length) motivation.push('commenting');
  if (!motivation.length) motivation.push('bookmarking');
  return {
    id: urn('thread', thread.id),
    type: 'Annotation',
    motivation,
    created: thread.createdAt,
    modified: thread.updatedAt,
    body: thread.notes.map(note => noteBody(thread.id, note)),
    target: annotationTarget(record),
    'marginalia:anchorId': thread.anchorId,
    'marginalia:kind': thread.anchor.kind ?? 'legacy-quote',
    // An explicit JSON string literal survives JSON-LD processing without
    // interpreting private record keys as vocabulary terms or losing arrays/nulls.
    // This preserves the helper's complete reader-owned export, including
    // replies, historical note versions, source captures and current views.
    'marginalia:recordJson': JSON.stringify(record),
    'marginalia:threadId': thread.id,
    'marginalia:sourceVersionId': thread.sourceVersionId,
    'marginalia:sourceTitle': thread.sourceTitle,
    'marginalia:state': thread.state,
    'marginalia:revision': thread.revision,
    'marginalia:deletedAt': thread.deletedAt,
    'marginalia:highlighted': thread.highlighted,
  };
}

function annotationTarget({ thread, source }: LibraryThreadExport): WebAnnotation['target'] {
  const anchor = thread.anchor;
  if (anchor.kind === 'whole-page') return { id: thread.sourceUrl };
  const selector: Extract<WebAnnotation['target'], { source: string }>['selector'] = [
    { type: 'TextQuoteSelector', exact: anchor.exact, prefix: anchor.prefix, suffix: anchor.suffix },
  ];
  // W3C positions count Unicode code points in the complete source. Internal
  // anchors count UTF-16 units. Without matching retained text, export only the
  // quote selector; the original offsets remain in recordJson for recovery.
  if (typeof source?.text === 'string' && source.text.slice(anchor.start, anchor.end) === anchor.exact) {
    selector.push({ type: 'TextPositionSelector', start: [...source.text.slice(0, anchor.start)].length,
      end: [...source.text.slice(0, anchor.end)].length });
  }
  return { type: 'SpecificResource', source: thread.sourceUrl, selector };
}

function noteBody(threadId: string, note: Note): AnnotationBody {
  return {
    id: urn('note', note.id),
    type: 'TextualBody',
    value: note.text,
    format: 'text/plain',
    purpose: 'commenting',
    created: note.createdAt,
    'marginalia:noteId': note.id,
    'marginalia:threadId': threadId,
    'marginalia:revision': note.revision,
    'marginalia:deletedAt': note.deletedAt,
  };
}

function markdownLibrary(records: readonly LibraryThreadExport[], exportedAt: Date): string {
  const threads = records.map(record => record.thread);
  const lines = ['# Marginalia library export', '', `Exported: ${exportedAt.toISOString()}`, '',
    'Saved threads, notes and their retained records. This is not a machine backup.', ''];
  const pages = new Map<string, Thread[]>();
  for (const thread of threads) {
    const page = pages.get(thread.sourceUrl);
    if (page) page.push(thread); else pages.set(thread.sourceUrl, [thread]);
  }
  for (const [sourceUrl, pageThreads] of pages) {
    const title = pageThreads.find(thread => thread.sourceTitle)?.sourceTitle || sourceUrl;
    lines.push(`## ${escapeMarkdown(title)}`, '', `Source: ${escapeMarkdown(sourceUrl)}`, '');
    for (const thread of pageThreads) {
      const state = thread.deletedAt ? `removed (${thread.deletedAt})` : thread.state;
      lines.push(
        `### Thread \`${thread.id}\``, '',
        `State: ${state}`, `Created: ${thread.createdAt}`, `Updated: ${thread.updatedAt}`,
        `Source version: \`${thread.sourceVersionId}\``,
        `Anchor: \`${thread.anchorId}\` (${thread.anchor.kind ?? 'legacy-quote'}, characters ${thread.anchor.start}–${thread.anchor.end})`, '',
        '#### Quote', '', ...markdownQuote(thread.anchor.exact), '',
        '#### Notes', '',
      );
      if (!thread.notes.length) lines.push('_No notes._', '');
      for (const note of thread.notes) {
        const noteState = note.deletedAt ? `removed (${note.deletedAt})` : 'saved';
        lines.push(
          `##### Note \`${note.id}\``, '',
          `State: ${noteState}`, `Created: ${note.createdAt}`, `Revision: ${note.revision}`, '',
          ...markdownQuote(note.text), '',
        );
      }
    }
  }
  lines.push('## Complete retained records', '',
    'The JSON below preserves each helper export, including replies, note history, source snapshots, attachments, saved views and recorded execution history when available.', '',
    'These historical records do not authorize execution or certify model claims.', '');
  const json = JSON.stringify(records, null, 2);
  // A note or reply may itself contain Markdown fences. Use a longer fence so
  // arbitrary saved text cannot terminate this inert appendix.
  let fenceLength = 3;
  for (const match of json.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = '`'.repeat(fenceLength);
  lines.push(fence + 'json', json, fence, '');
  return lines.join('\n').replace(/\n+$/, '\n');
}

function markdownQuote(value: string): string[] {
  const lines = value.split(/\r?\n/);
  return (lines.length ? lines : ['']).map(line => `> ${escapeMarkdown(line)}`);
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]{}()<>#+\-.!|>])/g, '\\$1');
}

function compareThreads(a: Thread, b: Thread): number {
  return a.sourceUrl.localeCompare(b.sourceUrl) || a.anchor.start - b.anchor.start
    || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function urn(kind: 'thread' | 'note', id: string): string {
  return `urn:marginalia:${kind}:${encodeURIComponent(id)}`;
}
