import type { LibraryImportPreviewResponse, LibraryImportResult } from '../../contracts/library-import.ts';

export interface LibraryImportTransport {
  preview(value: unknown, signal?: AbortSignal): Promise<LibraryImportPreviewResponse>;
  importSavedWork(value: unknown, previewDigest: string, signal?: AbortSignal): Promise<LibraryImportResult>;
}

/** A deterministic import boundary for UI tests and offline demos. */
export class FakeLibraryImportTransport implements LibraryImportTransport {
  previewResponse: LibraryImportPreviewResponse;
  importResponse: LibraryImportResult;
  readonly previews: unknown[] = [];
  readonly imports: { value: unknown; previewDigest: string }[] = [];

  constructor(previewResponse: LibraryImportPreviewResponse, importResponse: LibraryImportResult) {
    this.previewResponse = structuredClone(previewResponse);
    this.importResponse = structuredClone(importResponse);
  }

  async preview(value: unknown): Promise<LibraryImportPreviewResponse> {
    this.previews.push(structuredClone(value));
    return structuredClone(this.previewResponse);
  }

  async importSavedWork(value: unknown, previewDigest: string): Promise<LibraryImportResult> {
    this.imports.push({ value: structuredClone(value), previewDigest });
    return structuredClone(this.importResponse);
  }
}
