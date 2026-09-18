import { answerCollection, validCollectionInput } from '../collection-answer.ts';
import type { ReaderStore } from '../store.ts';
import type { ApiRouteContext } from './types.ts';

/** Mount inside the server's authenticated API wrapper, before generic reader routes. */
export function createCollectionAnswerRoutes(reader: ReaderStore) {
  return async (context: ApiRouteContext): Promise<boolean> => {
    const { request, response, url, send } = context;
    if (url.pathname !== '/api/library-answer') return false;
    if (request.method !== 'GET') { send(response, 405, { error: 'Use GET to search saved work.' }); return true; }
    if (!context.requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to reopen saved work.' }); return true; }
    const input = { query: url.searchParams.get('q') ?? '',
      ...(url.searchParams.has('thread') ? { threadIds: url.searchParams.getAll('thread') } : {}) };
    if (!validCollectionInput(input)) { send(response, 400, { error: 'Use a question up to 500 characters and at most 100 saved thread identifiers.' }); return true; }
    send(response, 200, { answer: answerCollection(reader, input) }); return true;
  };
}
