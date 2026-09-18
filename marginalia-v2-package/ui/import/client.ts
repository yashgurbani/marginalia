import { libraryImportPreviewFrom, libraryImportResultFrom, type LibraryImportPreviewResponse, type LibraryImportResult } from '../../contracts/library-import.ts';
import type { LibraryImportTransport } from './transport.ts';

export interface LibraryImportHttpGateway {
  request(path: string, body: unknown, signal?: AbortSignal): Promise<unknown>;
}

/** Authentication, origin policy, and JSON serialization belong to the injected gateway. */
export class LibraryImportClient implements LibraryImportTransport {
  private readonly gateway: LibraryImportHttpGateway;
  constructor(gateway: LibraryImportHttpGateway) { this.gateway = gateway; }

  async preview(value: unknown, signal?: AbortSignal): Promise<LibraryImportPreviewResponse> {
    return libraryImportPreviewFrom(await this.gateway.request('/api/import/thread/preview', value, signal));
  }

  async importSavedWork(value: unknown, previewDigest: string, signal?: AbortSignal): Promise<LibraryImportResult> {
    const path = `/api/import/thread?previewDigest=${encodeURIComponent(previewDigest)}`;
    return libraryImportResultFrom(await this.gateway.request(path, value, signal));
  }
}
