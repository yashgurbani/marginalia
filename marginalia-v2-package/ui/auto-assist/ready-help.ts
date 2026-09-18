import { AUTO_ASSIST_POSTURE_LIMITS, type AutoAssistPosture } from '../../contracts/auto-assist.ts';
import type { QuoteAnchor } from '../../contracts/reader.ts';

export type AutoAssistHelpState = 'ready' | 'preparing' | 'suggested' | 'paused-at-limit';
export type AutoAssistHelpItem = {
  candidateId: string;
  term: string;
  anchor: QuoteAnchor;
  state: AutoAssistHelpState;
  definition?: string;
};
export type AutoAssistReadyHelpState = {
  posture: AutoAssistPosture;
  readingPosition: number;
  assumes: readonly AutoAssistHelpItem[];
  items: readonly AutoAssistHelpItem[];
};
export type AutoAssistReadyHelpOptions = {
  sectionAt(position: number): number;
  open(item: AutoAssistHelpItem): void;
  ask(item: AutoAssistHelpItem): void;
  dismiss(item: AutoAssistHelpItem, signal: AbortSignal): Promise<void>;
  hold?(item: AutoAssistHelpItem): void;
};
export type AutoAssistReadyHelpMount = {
  update(state: AutoAssistReadyHelpState): void;
  clear(): void;
  position(): number | undefined;
  destroy(): void;
};

export function mountAutoAssistReadyHelp(
  assumesHost: HTMLElement,
  readyHost: HTMLElement,
  options: AutoAssistReadyHelpOptions,
): AutoAssistReadyHelpMount {
  const doc = readyHost.ownerDocument, abort = new AbortController();
  let state: AutoAssistReadyHelpState | undefined, destroyed = false, dismissing: string | undefined;
  const live = doc.createElement('p'); live.className = 'm-auto-assist-ready__status'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');

  function activeCandidate() {
    const active = doc.activeElement instanceof HTMLElement && (readyHost.contains(doc.activeElement) || assumesHost.contains(doc.activeElement)) ? doc.activeElement : undefined;
    return active?.dataset.autoAssistCandidate;
  }
  function nearest() {
    if (!state?.items.length) return;
    const focused = activeCandidate();
    return state.items.find(item => item.candidateId === focused) ?? [...state.items].sort((a, b) =>
      Math.abs(a.anchor.start - state!.readingPosition) - Math.abs(b.anchor.start - state!.readingPosition) || a.anchor.start - b.anchor.start)[0];
  }
  function render() {
    if (!state || destroyed) return;
    const active = doc.activeElement instanceof HTMLElement && (readyHost.contains(doc.activeElement) || assumesHost.contains(doc.activeElement)) ? doc.activeElement : undefined;
    const focusKey = active ? [active.dataset.autoAssistCandidate, active.dataset.autoAssistAction] : undefined;
    const limit = AUTO_ASSIST_POSTURE_LIMITS[state.posture].assumesTerms;
    const assumes = doc.createElement('section'); assumes.className = 'm-auto-assist-assumes';
    assumes.append(node('h2', 'Assumes:'));
    const assumesList = node('div', undefined, 'm-auto-assist-assumes__terms');
    for (const item of state.assumes.slice(0, limit)) assumesList.append(action(item.term, item, 'open', () => options.open(item)));
    assumes.append(assumesList); assumesHost.replaceChildren(assumes); assumesHost.hidden = !assumesList.children.length;

    const selected = nearest();
    const list = node('section', undefined, 'm-auto-assist-ready'); list.setAttribute('aria-label', 'Ready help');
    const currentSection = options.sectionAt(state.readingPosition);
    for (const item of state.items) {
      const size = item.candidateId === selected?.candidateId ? 'full' : Math.abs(options.sectionAt(item.anchor.start) - currentSection) <= 1 ? 'line' : 'tick';
      const row = node('article', undefined, `m-auto-assist-ready__item m-auto-assist-ready__item--${size}`);
      row.dataset.autoAssistCandidate = item.candidateId;
      const term = action(item.term, item, 'open', () => options.open(item)); term.className = 'm-auto-assist-ready__term';
      row.append(term);
      if (size === 'full') {
        row.append(node('p', itemCopy(item), 'm-auto-assist-ready__definition'));
        const controls = node('div', undefined, 'm-auto-assist-ready__actions');
        const dismiss = action('Dismiss and mark familiar', item, 'dismiss', () => { void dismissItem(item); }); dismiss.disabled = dismissing === item.candidateId;
        controls.append(dismiss, action('Ask', item, 'ask', () => options.ask(item))); row.append(controls);
      }
      row.addEventListener('focusin', () => options.hold?.(item), { signal: abort.signal });
      list.append(row);
    }
    readyHost.replaceChildren(list, live); readyHost.hidden = !state.items.length && !live.textContent;
    if (focusKey?.[0]) Array.from([...assumesHost.querySelectorAll<HTMLElement>('button'), ...readyHost.querySelectorAll<HTMLElement>('button')])
      .find(control => control.dataset.autoAssistCandidate === focusKey[0] && control.dataset.autoAssistAction === focusKey[1])?.focus({ preventScroll: true });
  }
  async function dismissItem(item: AutoAssistHelpItem) {
    if (!state || dismissing || destroyed) return;
    dismissing = item.candidateId; render();
    try {
      await options.dismiss(item, abort.signal);
      if (destroyed || abort.signal.aborted || dismissing !== item.candidateId || !state) return;
      state = { ...state, assumes: state.assumes.filter(value => value.candidateId !== item.candidateId), items: state.items.filter(value => value.candidateId !== item.candidateId) };
      live.textContent = 'Underline dismissed. This term is now in Vocabulary as familiar.'; render();
      readyHost.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    } catch (error) {
      if (!destroyed && !(error instanceof DOMException && error.name === 'AbortError')) live.textContent = 'This term could not be marked familiar.';
    } finally { if (dismissing === item.candidateId) { dismissing = undefined; if (!destroyed) render(); } }
  }
  function action(label: string, item: AutoAssistHelpItem, kind: string, run: () => void) {
    const control = node('button', label); control.type = 'button'; control.dataset.autoAssistCandidate = item.candidateId; control.dataset.autoAssistAction = kind;
    control.addEventListener('click', run, { signal: abort.signal }); return control;
  }
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
    const value = doc.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value;
  }
  return {
    update(next) { if (destroyed) return; state = structuredClone(next); render(); },
    clear() { if (destroyed) return; state = undefined; dismissing = undefined; assumesHost.replaceChildren(); readyHost.replaceChildren(); assumesHost.hidden = true; readyHost.hidden = true; },
    position() { return nearest()?.anchor.start; },
    destroy() { if (destroyed) return; destroyed = true; abort.abort(); assumesHost.replaceChildren(); readyHost.replaceChildren(); },
  };
}

function itemCopy(item: AutoAssistHelpItem) {
  if (item.state === 'paused-at-limit') return 'Prepared definitions are paused for today. Ask still works.';
  if (item.state === 'preparing') return 'Preparing a short definition';
  if (item.state === 'suggested') return 'Suggested term';
  return item.definition?.trim() || 'Short definition ready';
}
