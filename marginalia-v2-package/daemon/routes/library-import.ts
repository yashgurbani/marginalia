import { importThread, previewThreadImport } from '../library-import.ts';
import type { ReaderStore } from '../store.ts';
import type { ApiRouteContext } from './types.ts';

export function createLibraryImportRoutes(reader: ReaderStore) {
  return async (context: ApiRouteContext): Promise<boolean> => {
    const { request, response, url, body, send, requireCurrentPairing } = context;
    if (request.method !== 'POST' || !['/api/import/thread', '/api/import/thread/preview'].includes(url.pathname)) return false;
    const value: unknown = await body(request);
    if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to import saved work.' }); return true; }
    const result = url.pathname.endsWith('/preview') ? previewThreadImport(reader, value)
      : importThread(reader, value, url.searchParams.get('previewDigest') ?? '');
    send(response, 200, result);
    return true;
  };
}
