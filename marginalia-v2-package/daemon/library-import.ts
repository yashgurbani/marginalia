import { createHash } from 'node:crypto';
import { validateReaderMutation, validateSourceCapture, type ReaderMutation, type SourceCapture, type QuoteAnchor, type ThreadState } from '../contracts/reader.ts';
import { canonicalReplyData } from '../contracts/reply.ts';
import { ConflictError, type ReaderStore } from './store.ts';

export type ThreadImportPlan = {
  schema: 'marginalia.thread-import-plan.v1';
  threadId: string;
  mutations: ReaderMutation[];
  warnings: string[];
};
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_NOTES = 100;
const MAX_VERSIONS = 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (message: string): never => { throw new Error(message); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('The saved work must contain complete records.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) return fail('The saved work has an invalid identifier.');
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_VERSIONS) return fail('The saved note revision is outside the supported range.');
  return Number(value);
}
function removed(value: unknown): boolean {
  if (value === null) return false;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return fail('The saved removal date is invalid.');
  return true;
}

/** Reader-owned records only. Exported provider validation and execution are never authority. */
export function planThreadImport(value: unknown, options?: { threadId?: string }): ThreadImportPlan {
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { return fail('The saved work must be JSON.'); }
  if (!serialized || Buffer.byteLength(serialized) > MAX_BYTES) return fail('The saved work exceeds the 2 MB import limit.');
  // Detach the complete plan from a caller's mutable object and reject non-JSON values.
  const record = object(JSON.parse(serialized));
  if (record.schema !== 'marginalia.thread.v1') return fail('Only Marginalia thread version 1 JSON can be imported.');
  const thread = object(record.thread), source = object(record.source);
  const originalId = id(thread.id), threadId = options?.threadId === undefined ? originalId : id(options.threadId);
  if (threadId !== originalId) return fail('Import keeps the original thread identifier.');
  const sourceId = id(source.id);
  if (thread.sourceVersionId !== sourceId || source.metadataStatus !== 'provided') return fail('The saved work needs its complete original source capture.');
  const capture = {
    url: thread.sourceUrl, text: source.text, title: source.title, pageType: source.pageType,
    capturedAt: source.capturedAt, extractionVersion: source.extractionVersion,
    ...(source.sections === undefined ? {} : { sections: source.sections }),
    ...(source.author === undefined ? {} : { author: source.author }),
    ...(source.publicationDate === undefined ? {} : { publicationDate: source.publicationDate }),
    ...(source.venue === undefined ? {} : { venue: source.venue }),
  } as SourceCapture;
  validateSourceCapture(capture);
  if (source.hash !== hash(capture.text) || source.sourceId !== hash(capture.url)) return fail('The saved source does not match its recorded identity.');
  if (!Array.isArray(thread.notes) || thread.notes.length > MAX_NOTES) return fail('Import supports at most 100 notes per thread.');
  if (!Array.isArray(record.noteVersions) || record.noteVersions.length > MAX_VERSIONS) return fail('The saved work needs its note history, with at most 1000 versions.');
  const isRemoved = removed(thread.deletedAt);
  if (typeof thread.highlighted !== 'boolean' || !['open', 'parked', 'done', 'archived'].includes(String(thread.state))) return fail('The saved reader state is invalid.');
  const operation = (kind: string, identity = '') => 'import-' + hash(JSON.stringify([threadId, sourceId, kind, identity]));
  const mutations: ReaderMutation[] = [{ id: operation('keep'), kind: 'keep', threadId, capture, anchor: thread.anchor as QuoteAnchor }];
  const seen = new Set<string>(), versions = record.noteVersions.map(object);
  let threadRevision = 1;
  for (const rawNote of thread.notes) {
    const note = object(rawNote), noteId = id(note.id), noteRevision = revision(note.revision);
    if (seen.has(noteId) || note.threadId !== originalId) return fail('The saved notes have conflicting identifiers.');
    seen.add(noteId);
    const isNoteRemoved = removed(note.deletedAt);
    const history = versions.filter(item => item.noteId === noteId).sort((a, b) => Number(a.revision) - Number(b.revision));
    // Removal increments the revision without writing a note version. More complex
    // removal/restore histories cannot be reconstructed faithfully from this export.
    const expectedVersions = noteRevision - Number(isNoteRemoved);
    if (!history.length || history.length !== expectedVersions || history.at(-1)?.text !== note.text) return fail('This note history cannot be restored faithfully by this importer.');
    for (let index = 0; index < history.length; index++) {
      const version = history[index];
      if (version.revision !== index + 1) return fail('Notes with earlier removal or restore gaps are not supported yet.');
      mutations.push({ id: operation('note', `${noteId}:${index + 1}`), kind: 'note', threadId, noteId, text: version.text as string, expectedRevision: index });
      threadRevision++;
    }
    if (isNoteRemoved) {
      mutations.push({ id: operation('note-remove', noteId), kind: 'note-remove', threadId, noteId, removed: true, expectedRevision: expectedVersions });
      threadRevision++;
    }
  }
  if (versions.some(version => !seen.has(String(version.noteId)))) return fail('The saved note history belongs to an unknown note.');
  if (thread.highlighted) {
    mutations.push({ id: operation('highlight'), kind: 'highlight', threadId, highlighted: true, expectedRevision: threadRevision++ });
  }
  if (thread.state !== 'open') {
    mutations.push({ id: operation('state'), kind: 'thread-state', threadId, state: thread.state as ThreadState, expectedRevision: threadRevision++ });
  }
  if (isRemoved) mutations.push({ id: operation('remove'), kind: 'remove', threadId, removed: true, expectedRevision: threadRevision++ });
  for (const mutation of mutations) validateReaderMutation(mutation);
  if (thread.highlighted && (thread.anchor as QuoteAnchor).kind === 'whole-page') return fail('A whole-page thread cannot have a passage highlight.');
  const warnings = ['Only the source capture, passage, notes and reader state are imported. Replies, reply controls, attachment history, navigation and execution history are omitted.',
    'Original note text versions are retained. Save dates, removal dates and the thread revision are recorded anew.'];
  return { schema: 'marginalia.thread-import-plan.v1', threadId, mutations, warnings };
}

export function threadImportDigest(plan: ThreadImportPlan): string {
  return hash(canonicalReplyData(JSON.parse(JSON.stringify(plan))));
}

function availability(reader: ReaderStore, plan: ThreadImportPlan): 'new' | 'imported' {
  const receipts = plan.mutations.map(mutation => reader.db.prepare('SELECT digest FROM mutation_receipts WHERE id=?').get(mutation.id) as { digest: string } | undefined);
  const matching = receipts.every((receipt, index) => receipt?.digest === hash(canonicalReplyData(JSON.parse(JSON.stringify(plan.mutations[index])))));
  if (matching && reader.get(plan.threadId)) return 'imported';
  if (reader.get(plan.threadId) || receipts.some(Boolean)) throw new ConflictError('This thread already exists or differs from an earlier import. Your current saved work was kept.');
  for (const mutation of plan.mutations) {
    if (mutation.kind === 'note' && reader.db.prepare('SELECT id FROM notes WHERE id=?').get(mutation.noteId)) throw new ConflictError('A note identifier already belongs to saved work. Nothing was imported.');
  }
  return 'new';
}

export function previewThreadImport(reader: ReaderStore, value: unknown) {
  const plan = planThreadImport(value), first = plan.mutations[0];
  if (first.kind !== 'keep') throw new Error('Invalid import plan.');
  const status = availability(reader, plan);
  return { preview: { threadId: plan.threadId, sourceTitle: first.capture.title,
    noteCount: new Set(plan.mutations.flatMap(m => m.kind === 'note' ? [m.noteId] : [])).size,
    removedNoteCount: plan.mutations.filter(m => m.kind === 'note-remove' && m.removed).length,
    removed: plan.mutations.some(m => m.kind === 'remove' && m.removed),
    highlighted: plan.mutations.some(m => m.kind === 'highlight' && m.highlighted),
    state: plan.mutations.find(m => m.kind === 'thread-state')?.state ?? 'open',
    digest: threadImportDigest(plan), status }, warnings: plan.warnings };
}

export function importThread(reader: ReaderStore, value: unknown, previewDigest: string) {
  const plan = planThreadImport(value);
  if (previewDigest !== threadImportDigest(plan)) throw new ConflictError('Preview this saved work before importing it.');
  return reader.db.transaction(() => {
    const status = availability(reader, plan);
    if (status === 'new') for (const mutation of plan.mutations) reader.apply(mutation);
    const current = reader.get(plan.threadId)!;
    return { imported: { threadId: current.id, revision: current.revision }, warnings: [...plan.warnings,
      ...(status === 'imported' ? ['This saved work was already imported. Current edits and removals were kept.'] : [])] };
  }).immediate();
}
