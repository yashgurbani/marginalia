import type { LibrarySearchResult } from '../../contracts/library.ts';

export type LibrarySearchOptions = {
  search(query: string): Promise<LibrarySearchResult[]>;
  related?(threadId: string): Promise<LibrarySearchResult[]>;
  open(result: LibrarySearchResult, current: () => boolean): Promise<void>;
};

/** The input remains mounted while results arrive, preserving edits and focus. */
export function mountLibrarySearch(host: HTMLElement, options: LibrarySearchOptions) {
  const root = element('section'), title = element('h2', 'Search saved work');
  root.className = 'ml-search';
  const form = element('form'), label = element('label', 'Words to find '), input = element('input');
  input.type = 'search'; input.maxLength = 300; input.dataset.mlFocus = 'library-query';
  const search = element('button', 'Search'); search.type = 'submit';
  label.append(input); form.append(label, search);
  const status = element('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const results = element('ol'); results.className = 'ml__thread-list';
  root.append(title, element('p', 'Search original saved sources, current notes, and reply titles, summaries and text fallbacks on this computer. Up to 20 matches for the first 12 words. No model request.'), form, status, results);
  host.append(root);
  let generation = 0, destroyed = false;
  const active = () => !destroyed && root.parentElement === host;
  async function run(work: () => Promise<LibrarySearchResult[]>, heading: string) {
    const request = ++generation;
    title.textContent = heading; results.replaceChildren(); status.textContent = 'Searching saved work…';
    try {
      const found = await work();
      if (!active() || request !== generation) return;
      status.textContent = found.length ? `${found.length} local match${found.length === 1 ? '' : 'es'}.` : 'No local matches. Try different words.';
      for (const result of found) {
        const row = element('li'); row.className = 'ml-thread';
        const copy = element('div'); copy.className = 'ml-thread__copy';
        copy.append(element('h3', result.sourceTitle || result.sourceUrl), element('p', result.sourceUrl),
          element('p', result.evidenceLabel), element('blockquote', result.matchExcerpt), element('p', result.explanation));
        if (result.kind !== 'source') copy.append(element('p', 'Attached source passage'), element('blockquote', result.passage));
        const open = element('button', 'Open cited passage'); open.type = 'button';
        open.addEventListener('click', () => {
          if (!active() || request !== generation || open.disabled) return;
          open.disabled = true;
          void options.open(result, () => active() && request === generation).catch(error => {
            if (active() && request === generation) status.textContent = error instanceof Error ? error.message : 'The saved passage could not be opened.';
          }).finally(() => { if (active() && request === generation) open.disabled = false; });
        });
        row.append(copy, open); results.append(row);
      }
    } catch (error) {
      if (active() && request === generation) status.textContent = error instanceof Error ? error.message : 'Local search is unavailable. Try again.';
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); if (!active()) return;
    const query = input.value.trim();
    if (!query) { generation++; results.replaceChildren(); status.textContent = 'Enter words to search saved work.'; return; }
    void run(() => options.search(query), 'Search saved work');
  });
  return {
    related(threadId: string, title: string) {
      if (active() && options.related) void run(() => options.related!(threadId), `Related to ${title || 'this saved thread'}`);
    },
    cancel() { generation++; results.replaceChildren(); status.textContent = ''; },
    destroy() { destroyed = true; generation++; root.remove(); },
  };
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}
