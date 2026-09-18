import type { ThreadState } from './reader.ts';

export const LIBRARY_IMPORT_LIMIT_BYTES = 2 * 1024 * 1024;

export type LibraryImportPreview = {
  threadId: string;
  sourceTitle: string;
  noteCount: number;
  removedNoteCount: number;
  removed: boolean;
  highlighted: boolean;
  state: ThreadState;
  digest: string;
  status: 'new' | 'imported';
};

export type LibraryImportPreviewResponse = { preview: LibraryImportPreview; warnings: string[] };
export type LibraryImportResult = { imported: { threadId: string; revision: number }; warnings: string[] };

export function libraryImportPreviewFrom(value: unknown): LibraryImportPreviewResponse {
  if (!record(value) || !record(value.preview) || !warnings(value.warnings)) invalid('preview');
  const preview = value.preview;
  if (!id(preview.threadId) || !text(preview.sourceTitle, 1_000) || !count(preview.noteCount) || !count(preview.removedNoteCount)
    || typeof preview.removed !== 'boolean' || typeof preview.highlighted !== 'boolean'
    || !['open', 'parked', 'done', 'archived'].includes(String(preview.state))
    || typeof preview.digest !== 'string' || !/^[a-f0-9]{64}$/.test(preview.digest)
    || !['new', 'imported'].includes(String(preview.status))) invalid('preview');
  return value as LibraryImportPreviewResponse;
}

export function libraryImportResultFrom(value: unknown): LibraryImportResult {
  if (!record(value) || !record(value.imported) || !id(value.imported.threadId)
    || !positive(value.imported.revision) || !warnings(value.warnings)) invalid('result');
  return value as LibraryImportResult;
}

function invalid(kind: string): never { throw new Error(`The helper returned an invalid import ${kind}.`); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function id(value: unknown): value is string { return typeof value === 'string' && /^[\w-]{1,100}$/.test(value); }
function text(value: unknown, limit: number): value is string { return typeof value === 'string' && value.length <= limit; }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function warnings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every(item => text(item, 2_000));
}
