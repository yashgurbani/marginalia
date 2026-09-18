import type { InstantSelection, InstantTransport } from './transport.ts';

export type InstantDefinitionMount = {
  show(selection: InstantSelection): Promise<void>;
  clear(): void;
  destroy(): void;
};

export function mountInstantDefinition(host: HTMLElement, transport: InstantTransport, options: { quietErrors?: boolean } = {}): InstantDefinitionMount {
  const root = host.ownerDocument.createElement('div'); root.className = 'm-instant-definition';
  host.replaceChildren(root);
  let generation = 0, destroyed = false, controller: AbortController | undefined;
  const current = (value: number) => !destroyed && value === generation;
  const clear = () => { ++generation; controller?.abort(); controller = undefined; root.textContent = ''; root.className = 'm-instant-definition'; };

  async function show(selection: InstantSelection) {
    clear(); if (destroyed) return;
    const own = generation, abort = controller = new AbortController();
    root.textContent = 'Instant help is working.'; root.className = 'm-instant-definition m-instant-definition--working';
    let terminal = false;
    try {
      for await (const event of transport.requestDefinition(selection, abort.signal)) {
        if (!current(own)) return;
        if (event.type === 'text-delta') {
          if (root.classList.contains('m-instant-definition--working')) root.textContent = '';
          root.className = 'm-instant-definition'; root.textContent += event.text;
        }
        else if (event.type === 'reply') { terminal = true; root.textContent = event.reply.summary; root.className = 'm-instant-definition'; }
        else {
          terminal = true;
          if (event.state === 'paused-at-limit') { root.textContent = 'Instant help is unavailable right now. Usage is shown in Settings.'; root.className = 'm-instant-definition m-instant-definition--unavailable'; }
          else { root.textContent = 'Instant help is unavailable.'; root.className = 'm-instant-definition m-instant-definition--unavailable'; }
        }
      }
      if (current(own) && !terminal) { root.textContent = 'Instant help is unavailable.'; root.className = 'm-instant-definition m-instant-definition--unavailable'; }
    } catch (error) {
      if (current(own) && !(error instanceof DOMException && error.name === 'AbortError')) {
        root.textContent = 'Instant help is unavailable.';
        root.className = `m-instant-definition m-instant-definition--unavailable${options.quietErrors ? ' m-instant-definition--quiet' : ''}`;
      }
    } finally { if (current(own)) controller = undefined; }
  }

  return { show, clear, destroy() { if (destroyed) return; clear(); destroyed = true; root.remove(); } };
}
