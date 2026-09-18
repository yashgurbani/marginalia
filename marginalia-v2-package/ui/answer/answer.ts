import type { LibraryAnswer, LibraryAnswerCitation, LibraryAnswerReason } from '../../contracts/library-answer.ts';
import type { LibraryAnswerTransport } from './transport.ts';

export type LibraryAnswerMount = { ask(query: string, threadIds?: readonly string[]): Promise<void>; clear(): void; destroy(): void };

export function mountLibraryAnswer(host: HTMLElement, transport: LibraryAnswerTransport): LibraryAnswerMount {
  const doc = host.ownerDocument, root = doc.createElement('section'); root.className = 'm-library-answer'; host.replaceChildren(root);
  let generation = 0, destroyed = false, controller: AbortController | undefined;
  const clear = () => { ++generation; controller?.abort(); controller = undefined; root.replaceChildren(); };

  async function ask(query: string, threadIds: readonly string[] = []) {
    clear(); if (destroyed) return;
    const own = generation, abort = controller = new AbortController();
    try {
      const answer = await transport.answer(query, threadIds, abort.signal);
      if (current(own)) render(answer);
    } catch (error) { if (current(own) && !aborted(error)) renderUnavailable(); }
    finally { if (current(own)) controller = undefined; }
  }

  function heading() { return node('h3', 'Saved-passage answer'); }
  function render(answer: LibraryAnswer) {
    const content: HTMLElement[] = [heading()];
    if (answer.status === 'abstained') content.push(node('p', abstention(answer.reason)));
    for (const citation of answer.citations) content.push(renderCitation(citation));
    root.replaceChildren(...content);
  }
  function renderCitation(citation: LibraryAnswerCitation) {
    const item = node('article', undefined, 'm-library-answer__citation');
    item.append(node('p', citation.excerpt));
    const link = node('a', citation.sourceTitle || 'Saved source');
    link.href = `/library#thread=${encodeURIComponent(citation.threadId)}`;
    item.append(link); return item;
  }
  function renderUnavailable() { root.replaceChildren(heading(), node('p', 'Saved-passage answers are unavailable.')); }
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
    const value = doc.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value;
  }
  function current(own: number) { return !destroyed && own === generation; }
  return { ask, clear, destroy() { if (destroyed) return; clear(); destroyed = true; root.remove(); } };
}

function abstention(reason: LibraryAnswerReason | undefined) {
  if (reason === 'ambiguous-support') return 'The saved excerpts differ, so no answer is shown.';
  if (reason === 'invalid-query') return 'This question could not be searched in saved work.';
  return 'No exact saved excerpt was found.';
}
function aborted(error: unknown) { return error instanceof DOMException && error.name === 'AbortError'; }
