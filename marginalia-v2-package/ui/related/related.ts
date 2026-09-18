import type { RelatedRequest } from '../../contracts/related.ts';
import type { RelatedTransport } from './transport.ts';

export type RelatedMount = {
  show(request: RelatedRequest): Promise<void>;
  clear(): void;
  destroy(): void;
};

export function mountRelated(host: HTMLElement, transport: RelatedTransport): RelatedMount {
  const doc = host.ownerDocument, root = doc.createElement('section'); root.className = 'm-related';
  host.replaceChildren(root);
  let generation = 0, destroyed = false, controller: AbortController | undefined;
  const current = (value: number) => !destroyed && value === generation;
  const clear = () => { ++generation; controller?.abort(); controller = undefined; root.replaceChildren(); };

  async function show(request: RelatedRequest) {
    clear(); if (destroyed) return;
    const own = generation, abort = controller = new AbortController();
    try {
      const response = await transport.findRelated(request, abort.signal);
      if (!current(own) || response.results.length === 0) return;
      const heading = doc.createElement('h3'); heading.textContent = 'Related in your library';
      const list = doc.createElement('ul');
      for (const item of response.results.slice(0, 3)) {
        const row = doc.createElement('li'), link = doc.createElement('a'), excerpt = doc.createElement('p');
        link.textContent = item.sourceTitle; link.setAttribute('href', `#thread=${encodeURIComponent(item.threadId)}`);
        excerpt.textContent = item.note?.excerpt ?? item.sourceExcerpt;
        row.setAttribute('data-kind', item.kind); row.append(link, excerpt); list.append(row);
      }
      root.append(heading, list);
    } catch { if (current(own)) root.replaceChildren(); }
    finally { if (current(own)) controller = undefined; }
  }

  return { show, clear, destroy() { if (destroyed) return; clear(); destroyed = true; root.remove(); } };
}
