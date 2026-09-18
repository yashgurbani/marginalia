import type { JournalSummaryService } from '../journal-synthesis.ts';
import type { ApiRouteContext } from './types.ts';

export const JOURNAL_SUMMARY_PATH = '/api/library-journal-summary';
export const JOURNAL_SUMMARY_READ_PATH = '/api/read/library-journal-summary';

/** Read-only route seam for the library's bounded local saved-activity recap. */
export function createJournalSummaryRoute(service: JournalSummaryService) {
  return async (context: ApiRouteContext): Promise<boolean> => {
    const alias = context.url.pathname === JOURNAL_SUMMARY_READ_PATH;
    if (!alias && context.url.pathname !== JOURNAL_SUMMARY_PATH) return false;
    const expectedMethod = alias ? 'POST' : 'GET';
    if (context.request.method !== expectedMethod) {
      context.send(context.response, 405, { error: `Use ${expectedMethod} for this journal summary.` }); return true;
    }
    if (alias) {
      if (!context.requestOrigin) { context.send(context.response, 401, { error: 'Origin required.' }); return true; }
      await context.emptyBody(context.request, true);
    }
    if (!context.requireCurrentPairing()) { context.send(context.response, 401, { error: 'Pair with the local helper to read your saved recap.' }); return true; }
    const date = context.url.searchParams.get('date'), timeZone = context.url.searchParams.get('timeZone');
    if (!date || !timeZone) throw new Error('A journal date and time zone are required.');
    const summary = service.summarize({ date, timeZone });
    if (!context.requireCurrentPairing()) { context.send(context.response, 401, { error: 'Pairing changed before the saved recap was read.' }); return true; }
    context.send(context.response, 200, { summary });
    return true;
  };
}
