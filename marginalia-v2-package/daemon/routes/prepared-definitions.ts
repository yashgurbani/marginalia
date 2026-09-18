import type { InstantService } from '../instant/index.ts';
import { createPreparedDefinitions, type PreparedTerm } from '../instant/prepared-definitions.ts';
import type { ApiRouteContext } from './types.ts';
import { instantPrincipalKey } from './instant-forget.ts';

/** Principal-scoped engines share the resident service's queue, policy and budget admission. */
export function createPreparedDefinitionRoutes(service: InstantService) {
  const engines = new Map<string, ReturnType<typeof createPreparedDefinitions>>();
  const currentOwners = new Map<string, () => boolean>();
  return {
    forget(owner: string, pageId: string) { engines.get(owner)?.forget(pageId); },
    prune() { for (const [owner, current] of currentOwners) if (!current()) { engines.get(owner)?.close(); engines.delete(owner); currentOwners.delete(owner); } },
    close() { for (const engine of engines.values()) engine.close(); engines.clear(); currentOwners.clear(); },
    async handle(context: ApiRouteContext): Promise<boolean> {
      const { request, response, url, principal, requireCurrentPairing, send, body } = context;
      if (!['/api/instant/definitions/prepare', '/api/instant/definitions/dismiss'].includes(url.pathname)) return false;
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to use auto assist.' }); return true; }
      if (request.method !== 'POST') { send(response, 405, { error: 'Use POST for this operation.' }); return true; }
      const value: unknown = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pairing changed. Pair again.' }); return true; }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A page is required.');
      const input = value as Record<string, unknown>;
      if (typeof input.pageId !== 'string' || !input.pageId.trim() || input.pageId.length > 2000 || input.pageId.includes('\0')) throw new Error('A page is required.');
      const owner = instantPrincipalKey(principal);
      if (url.pathname.endsWith('/dismiss')) {
        if (Object.keys(input).some(key => !['pageId', 'normalizedTerm'].includes(key)) || typeof input.normalizedTerm !== 'string' || !input.normalizedTerm.trim() || input.normalizedTerm.length > 128) throw new Error('A term is required.');
        engines.get(owner)?.dismiss(input.pageId, input.normalizedTerm.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase());
        send(response, 200, { dismissed: true }); return true;
      }
      if (Object.keys(input).some(key => !['pageId', 'terms'].includes(key)) || !Array.isArray(input.terms) || input.terms.length > 30) throw new Error('At most 30 terms are allowed.');
      for (const term of input.terms) {
        if (!term || typeof term !== 'object' || Array.isArray(term) ||
            Object.keys(term).some(key => !['candidateId', 'term', 'normalizedTerm', 'start', 'end', 'contextHash'].includes(key)) ||
            typeof term.candidateId !== 'string' || !term.candidateId || term.candidateId.length > 256 ||
            typeof term.term !== 'string' || !term.term.trim() || term.term.length > 128 ||
            typeof term.normalizedTerm !== 'string' || term.normalizedTerm !== term.term.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase() ||
            !Number.isSafeInteger(term.start) || !Number.isSafeInteger(term.end) || term.start < 0 || term.end - term.start !== term.term.length ||
            typeof term.contextHash !== 'string' || !/^[a-f0-9]{64}$/iu.test(term.contextHash)) throw new Error('Invalid prepared term.');
      }
      const page = service.preparedPage(owner, input.pageId);
      if (!page) { send(response, 200, { state: 'stale', definitions: [] }); return true; }
      let engine = engines.get(owner);
      if (!engine) {
        // Bound caches even when old pairings no longer make requests.
        if (engines.size >= 64) { const oldest = engines.keys().next().value!; engines.get(oldest)!.close(); engines.delete(oldest); currentOwners.delete(oldest); }
        engine = createPreparedDefinitions(service.createPreparedDefinitionAdapter(owner, requireCurrentPairing));
        engines.set(owner, engine);
        currentOwners.set(owner, requireCurrentPairing);
      }
      send(response, 200, await engine.prepare(page, input.terms as PreparedTerm[]));
      return true;
    },
  };
}
