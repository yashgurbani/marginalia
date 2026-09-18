import { journalRecapIsEmpty, type JournalRecap } from '../../contracts/journal-recap.ts';
import type { JournalRecapTransport } from './transport.ts';

export type JournalRecapMount = { show(date: string, timeZone: string): Promise<void>; clear(): void; destroy(): void };

export function mountJournalRecap(host: HTMLElement, transport: JournalRecapTransport): JournalRecapMount {
  const doc = host.ownerDocument, root = doc.createElement('div'); root.className = 'm-journal-recap'; host.replaceChildren(root);
  let generation = 0, destroyed = false, controller: AbortController | undefined;
  const clear = () => { ++generation; controller?.abort(); controller = undefined; root.replaceChildren(); };

  async function show(date: string, timeZone: string) {
    clear(); if (destroyed) return;
    const own = generation, abort = controller = new AbortController();
    try {
      const summary = await transport.getRecap(date, timeZone, abort.signal);
      if (current(own) && !journalRecapIsEmpty(summary)) render(summary);
    } catch (error) { if (current(own) && !aborted(error)) root.replaceChildren(); }
    finally { if (current(own)) controller = undefined; }
  }

  function render(summary: JournalRecap) {
    const section = node('section', undefined, 'm-journal-recap__content');
    section.append(node('h3', 'Daily recap'));
    section.append(node('p', `${summary.counts.items} saved ${plural(summary.counts.items, 'item')} from ${summary.counts.sources} ${plural(summary.counts.sources, 'source')} on ${summary.date}.`));
    section.append(node('p', 'This recap was computed locally from saved activity.', 'm-journal-recap__description'));
    if (summary.topics.length) {
      const topics = node('ul', undefined, 'm-journal-recap__topics');
      for (const topic of summary.topics) {
        const item = node('li'); item.append(node('strong', topic.label), doc.createTextNode(`. ${topic.counts.items} saved ${plural(topic.counts.items, 'item')}.`)); topics.append(item);
      }
      section.append(topics);
    }
    if (summary.snippets.length) {
      const snippets = node('div', undefined, 'm-journal-recap__snippets');
      for (const snippet of summary.snippets) {
        const item = node('article', undefined, 'm-journal-recap__snippet');
        item.append(node('p', snippet.text));
        const link = node('a', snippet.source.title || 'Saved source'); link.href = snippet.threadLink;
        item.append(link); snippets.append(item);
      }
      section.append(snippets);
    }
    root.replaceChildren(section);
  }

  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
    const value = doc.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value;
  }
  function current(own: number) { return !destroyed && own === generation; }
  return { show, clear, destroy() { if (destroyed) return; clear(); destroyed = true; root.remove(); } };
}

function plural(count: number, noun: string) { return count === 1 ? noun : `${noun}s`; }
function aborted(error: unknown) { return error instanceof DOMException && error.name === 'AbortError'; }
