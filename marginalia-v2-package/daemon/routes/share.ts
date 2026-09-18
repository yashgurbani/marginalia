import { renderShareHtml, renderShareMarkdown, renderShareText, shareRecord } from '../share.ts';
import type { ReaderStore } from '../store.ts';
import type { ApiRouteContext } from './types.ts';

type ShareFormat = 'markdown' | 'html' | 'text';

export function createShareRoutes(reader: Pick<ReaderStore, 'exportThread'>) {
  return async (context: ApiRouteContext): Promise<boolean> => {
    const { request, response, url, requireCurrentPairing, send } = context;
    if (url.pathname !== '/api/share/thread') return false;
    if (request.method !== 'GET') {
      send(response, 405, { error: 'Use GET to download a thread copy.' });
      return true;
    }
    if (!requireCurrentPairing()) {
      send(response, 401, { error: 'Pair with the local helper to download a thread copy.' });
      return true;
    }
    const threadId = url.searchParams.get('thread');
    if (!threadId || !/^[\w-]{1,100}$/.test(threadId)) {
      send(response, 400, { error: 'A saved thread is required.' });
      return true;
    }
    const format = url.searchParams.get('format');
    if (format !== 'markdown' && format !== 'html' && format !== 'text') {
      send(response, 400, { error: 'Choose markdown, html or text for the thread copy.' });
      return true;
    }
    let exported: unknown;
    try { exported = reader.exportThread(threadId); }
    catch { send(response, 404, { error: 'This thread is unavailable.' }); return true; }
    const rawThread = exported && typeof exported === 'object' && !Array.isArray(exported)
      ? (exported as Record<string, unknown>).thread : undefined;
    if (!rawThread || typeof rawThread !== 'object' || Array.isArray(rawThread) || (rawThread as Record<string, unknown>).deletedAt !== undefined && (rawThread as Record<string, unknown>).deletedAt !== null) {
      send(response, 404, { error: 'This thread is unavailable.' });
      return true;
    }
    let rendered: string;
    try {
      const record = shareRecord(exported);
      rendered = format === 'markdown' ? renderShareMarkdown(record) : format === 'html' ? renderShareHtml(record) : renderShareText(record);
    } catch {
      send(response, 404, { error: 'This thread is unavailable.' });
      return true;
    }
    const contentType = format === 'markdown' ? 'text/markdown; charset=utf-8' : format === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `attachment; filename="marginalia-thread-${threadId}.${format}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Length', Buffer.byteLength(rendered, 'utf8'));
    response.writeHead(200);
    response.end(rendered);
    return true;
  };
}

export type { ShareFormat };
