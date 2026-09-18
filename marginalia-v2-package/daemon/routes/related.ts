import type { ReaderStore } from '../store.ts';
import { findRelatedPassages } from '../transforms/explore/related.ts';
import type { ApiRouteContext } from './types.ts';

/** Local related-passage lookup. It never creates a job or calls a provider. */
export function createRelatedRoutes(store: ReaderStore) {
  return async (context: ApiRouteContext): Promise<boolean> => {
    if (context.url.pathname !== '/api/library-related') return false;
    if (context.request.method !== 'POST') return false;
    const value = await context.body(context.request);
    if (!context.requireCurrentPairing()) {
      context.send(context.response, 401, { error: 'Pair with the local helper to read related passages.' }); return true;
    }
    const results = findRelatedPassages(store, value);
    if (!context.requireCurrentPairing()) {
      context.send(context.response, 401, { error: 'Pairing changed before related passages were read.' }); return true;
    }
    context.send(context.response, 200, { results });
    return true;
  };
}
