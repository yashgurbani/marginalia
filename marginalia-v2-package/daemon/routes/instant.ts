import type { InstantHelpSettingsChange } from '../../contracts/instant.ts';
import type { InstantPageInput, InstantSelectionInput, InstantService } from '../instant/index.ts';
import type { ApiRouteContext } from './types.ts';

/** Called inside the helper's existing origin/authenticated API router. */
export function createInstantRoutes(service: InstantService) {
  return async (context: ApiRouteContext) => {
    const { request, response, url, requestOrigin, principal, requireCurrentPairing, send, body, emptyBody } = context;
    if (url.pathname === '/api/read/instant/settings') {
      if (request.method !== 'POST') { send(response, 405, { error: 'Use POST for this read operation.' }); return true; }
      if (!requestOrigin) { send(response, 401, { error: 'Origin required.' }); return true; }
      await emptyBody(request, true);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pairing changed. Pair again.' }); return true; }
      send(response, 200, service.settings()); return true;
    }
    if (!url.pathname.startsWith('/api/instant/')) return false;
    if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to use instant help.' }); return true; }
    const owner = JSON.stringify([principal.pairingId, principal.origin]);
    if (url.pathname === '/api/instant/settings' && request.method === 'GET') { send(response, 200, service.settings()); return true; }
    if (request.method !== 'POST') { send(response, 405, { error: 'Use POST for this instant help operation.' }); return true; }
    const value: unknown = await body(request);
    if (!requireCurrentPairing()) { send(response, 401, { error: 'Pairing changed. Pair again.' }); return true; }
    if (url.pathname === '/api/instant/policy/unexclude') { send(response, 200, service.unexcludePolicy(value)); return true; }
    if (url.pathname === '/api/instant/policy') { send(response, 200, service.syncPolicy((value as { excludedHosts?: unknown })?.excludedHosts)); return true; }
    if (url.pathname === '/api/instant/usage') { send(response, 200, { usage: service.usage() }); return true; }
    if (url.pathname === '/api/instant/settings') { send(response, 200, service.saveSettings(value as InstantHelpSettingsChange)); return true; }
    if (url.pathname === '/api/instant/prepare') { send(response, 200, await service.prepare(owner, value as InstantPageInput, requireCurrentPairing)); return true; }
    if (url.pathname === '/api/instant/release') {
      const pageId = (value as { pageId?: unknown })?.pageId;
      if (typeof pageId !== 'string') throw new Error('A page is required.');
      service.release(owner, pageId); send(response, 200, { released: true }); return true;
    }
    if (url.pathname === '/api/instant/select') {
      let connected = true, terminal = false, sequence = 0;
      response.on('close', () => { connected = false; });
      const result = service.select(owner, value as InstantSelectionInput, () => connected && requireCurrentPairing(), event => {
        sequence = event.sequence; terminal ||= event.type !== 'draft';
        if (!response.headersSent) response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        if (connected && !response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) { connected = false; response.end(); }
      });
      const state = await result;
      if (connected && terminal) { response.end(); return true; }
      if (connected) { if (!response.headersSent) response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }); response.end(`event: state\ndata: ${JSON.stringify({ type: 'state', pageId: (value as InstantSelectionInput).pageId, selectionId: (value as InstantSelectionInput).selectionId, sequence, state })}\n\n`); }
      return true;
    }
    send(response, 404, { error: 'Unknown instant help operation.' }); return true;
  };
}




