import { InstantClient } from '../../ui/instant/client.ts';
import type { InstantSelection } from '../../ui/instant/transport.ts';
import { acceptInstantEvent, type InstantPage } from './instant-lifecycle.ts';
export type PanelSend = (action: string, extra?: Record<string, unknown>) => Promise<unknown>;
// Allow the worker's 120 s preparation request, a 90 s turn, and 30 s margin.
export const INSTANT_POLL_WINDOW_MS = 240_000;
const POLL_INTERVAL_MS = 250;
async function wait(signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', stop); resolve(); };
    const timer = setTimeout(finish, POLL_INTERVAL_MS);
    const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(signal?.reason ?? new DOMException('Stopped.', 'AbortError')); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}
/** Reads the already-dispatched content selection. Mounting/reopening the margin never sends it again. */
export function panelInstantTransport(send: PanelSend, pause: (signal?: AbortSignal) => Promise<void> = wait) {
  return new InstantClient({
    async request(path, body, signal) {
      signal?.throwIfAborted();
      if (path === '/api/instant/settings') {
        const change = (body as { change?: unknown }).change;
        return { settings: await send(change ? 'instant-save-settings' : 'instant-settings', change ? { change } : {}) };
      }
      if (path === '/api/instant/usage') return send('instant-usage');
      if (path === '/api/instant/forget') return send('instant-forget', { pageId: (body as { pageKey: string }).pageKey });
      throw new Error('Unsupported instant help request.');
    },
    async *stream(path, body, signal) {
      if (path !== '/api/instant/definition') throw new Error('Unsupported instant help stream.');
      const selection = (body as { selection: InstantSelection }).selection;
      let text = '', selectedId: string | undefined;
      for (let attempt = 0; attempt < INSTANT_POLL_WINDOW_MS / POLL_INTERVAL_MS; attempt++) {
        signal?.throwIfAborted();
        const page = await send('instant-status') as InstantPage | null;
        signal?.throwIfAborted();
        if (page?.url === selection.sourceUrl && ['off', 'excluded', 'paused-at-limit'].includes(page.state)) { yield { type: 'state', state: page.state }; return; }
        // Before preparation returns, outcome_unknown has no pageId and is still pending.
        // A returned terminal preparation has no selection event to match below.
        if (page?.url === selection.sourceUrl && (page.state === 'failed' || (page.state === 'outcome_unknown' && page.pageId))) return;
        if (page?.url === selection.sourceUrl && page.selectionText === selection.text && page.pageId && page.selectionId) {
          if (selectedId && page.selectionId !== selectedId) return;
          selectedId = page.selectionId;
          const event = acceptInstantEvent(page.event, page.pageId, page.selectionId);
          if (event?.type === 'draft') {
            const next = event.text ?? ''; if (!next.startsWith(text)) throw new Error('The instant reply changed.');
            if (next.length > text.length) yield { type: 'text-delta', text: next.slice(text.length) }; text = next;
          } else if (event?.type === 'completed') { yield { type: 'reply', reply: event.reply }; return; }
          else if (event?.type === 'state') {
            if (['off', 'excluded', 'paused-at-limit'].includes(event.state ?? '')) yield { type: 'state', state: event.state };
            return;
          }
        }
        await pause(signal);
      }
    },
  });
}
