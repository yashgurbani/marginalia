import { validateSourceCapture, type Thread, type SourceCapture, type SourceVersion, type ReplyVersion, type ReplyViewState } from '../contracts/reader.ts';

export type SavedThreadBundle = { schema: 'marginalia.thread.v1'; thread: Thread; source: SourceVersion; replies: ReplyVersion[]; replyViews: ReplyViewState[] };

/** Shared conversion for every saved-reader opening route. Keep optional facts absent. */
export function sourceCaptureFromVersion(url: string, source: SourceVersion): SourceCapture {
  if (source.metadataStatus !== 'provided' || source.title === null || source.pageType === null || source.capturedAt === null || source.extractionVersion === null) {
    throw new Error('This older thread remains exportable, but its original capture metadata is incomplete. Opening an editable captured view needs a supported legacy-source contract.');
  }
  const capture: SourceCapture = { url, title: source.title, pageType: source.pageType, text: source.text,
    ...(source.author !== undefined ? { author: source.author } : {}),
    ...(source.publicationDate !== undefined ? { publicationDate: source.publicationDate } : {}),
    ...(source.venue !== undefined ? { venue: source.venue } : {}),
    capturedAt: source.capturedAt, extractionVersion: source.extractionVersion, ...(source.sections ? { sections: structuredClone(source.sections) } : {}) };
  validateSourceCapture(capture);
  return capture;
}

/** The library exports ReaderStore records, not a synthetic current-page capture.
 * Legacy records remain exportable; missing evidence is never filled from defaults. */
export function savedThreadCapture(value: unknown, requested: Thread): { bundle: SavedThreadBundle; capture: SourceCapture } {
  if (!value || typeof value !== 'object') throw new Error('The helper returned no saved thread. Reload the library.');
  const bundle = value as Partial<SavedThreadBundle>;
  const thread = bundle.thread, source = bundle.source;
  if (bundle.schema !== 'marginalia.thread.v1' || !thread || !source || thread.id !== requested.id || thread.deletedAt ||
    !Number.isSafeInteger(thread.revision) || thread.revision < requested.revision || thread.sourceUrl !== requested.sourceUrl ||
    thread.sourceVersionId !== requested.sourceVersionId || source.id !== thread.sourceVersionId || !Array.isArray(thread.notes) ||
    !Array.isArray(bundle.replies) || !Array.isArray(bundle.replyViews)) throw new Error('The helper did not return the current nonremoved thread and its original source. Reload the library; existing work is unchanged.');
  const capture = sourceCaptureFromVersion(thread.sourceUrl, source);
  const ids = new Set<string>();
  for (const reply of bundle.replies) {
    if (!reply || reply.threadId !== thread.id || typeof reply.id !== 'string' || ids.has(reply.id)) throw new Error('The saved reply identities do not match this thread. Nothing was opened.');
    ids.add(reply.id);
  }
  if (bundle.replyViews.some(view => !view || !ids.has(view.replyVersionId)) || new Set(bundle.replyViews.map(view => view.replyVersionId)).size !== bundle.replyViews.length) throw new Error('The saved views do not match the exported replies.');
  return { bundle: { schema: 'marginalia.thread.v1', thread, source, replies: bundle.replies, replyViews: bundle.replyViews }, capture };
}
