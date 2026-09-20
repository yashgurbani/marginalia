import { selectionBarModel, type SelectionAction, type SelectionBarCallbacks, type SelectionBarModel } from './selection-actions.ts';

type Rect = { left: number; right: number; top: number; bottom: number };
type Column = { left: number; right: number };
function horizontalSpace(viewportWidth: number, column?: Column) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || (column && (![column.left, column.right].every(Number.isFinite) || column.right <= column.left))) return null;
  const left = Math.max(8, column?.left ?? 8), right = Math.min(viewportWidth - 8, column?.right ?? viewportWidth - 8);
  return right > left ? { left, right } : null;
}
/** No placement is safer than obscuring the selection or clipping the article. */
export function selectionBarPosition(rects: readonly Rect[], width: number, height: number, viewportWidth: number, viewportHeight: number, column?: Column) {
  const usable = rects.filter(r => [r.left, r.right, r.top, r.bottom].every(Number.isFinite) && r.right > r.left && r.bottom > r.top);
  const space = horizontalSpace(viewportWidth, column), gap = 8;
  if (!space || ![width, height, viewportHeight].every(n => Number.isFinite(n) && n > 0) || !usable.length || width > space.right - space.left || height > viewportHeight - gap * 2) return null;
  const top = Math.min(...usable.map(r => r.top)), bottom = Math.max(...usable.map(r => r.bottom));
  if (bottom < 0 || top > viewportHeight || usable.every(r => r.right <= space.left || r.left >= space.right)) return null;
  const left = Math.max(space.left, Math.min(usable[0].left, space.right - width));
  if (bottom + gap + height <= viewportHeight - gap) return { left, top: Math.max(gap, bottom + gap) };
  if (top - gap - height >= gap) return { left, top: top - gap - height };
  return null;
}

// Until V12-04 adopts the explicit callbacks, preserve the existing caller's
// semantics. In particular, Keep must not masquerade as Highlight or Define.
const legacyControls: { action: SelectionAction; label: string; path: string }[] = [
  { action: 'keep', label: 'Keep', path: 'M6 3h12v18l-6-4-6 4V3Z' },
  { action: 'note', label: 'Note', path: 'M5 4h10l4 4v12H5V4Zm10 0v5h4M8 13h8M8 16h6' },
  { action: 'ask', label: 'Ask', path: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01M4 3h16v16H9l-5 3V3Z' },
  { action: 'simulate', label: 'Simulate it', path: 'M4 5v14h16M7 15c3 0 3-7 6-7s3 5 6 5M7 15h.01M13 8h.01M19 13h.01' },
];
const css = `
:host{color-scheme:light dark;font:14px/1.4 "IBM Plex Sans",system-ui,sans-serif;direction:ltr}
*{box-sizing:border-box}
.bar,.more{background:oklch(.993 .003 255);color:oklch(.245 .016 255);border:1px solid oklch(.800 .010 255);border-radius:12px;box-shadow:0 6px 24px oklch(.245 .016 255/.14)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:4px;width:max-content}
button{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:40px;min-height:40px;padding:0 10px;border-radius:8px;cursor:pointer;color:inherit;touch-action:manipulation;font:500 13px/1.4 "IBM Plex Sans",system-ui,sans-serif;overflow-wrap:anywhere;max-width:100%}
button.icon{width:40px;padding:0}
button:hover{background:oklch(.925 .030 255)}
.word-define{background:oklch(.925 .030 255);color:oklch(.380 .120 255)}
button:focus-visible,input:focus-visible{outline:2px solid oklch(.500 .120 255);outline-offset:2px}
button:disabled{opacity:.5;cursor:default}
svg{display:block;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.divider{width:1px;height:22px;margin:0 4px;background:oklch(.895 .008 255);flex:none}
.status{flex-basis:100%;font:13px/1.4 system-ui,sans-serif;padding:0 7px;overflow-wrap:anywhere}
.more{position:absolute;top:100%;left:0;width:300px;padding:6px;display:flex;flex-direction:column;gap:2px;overflow-y:auto}
.more button{text-align:left;justify-content:flex-start;flex-shrink:0;padding:0 12px}
.more .close{align-self:flex-end;justify-content:center;width:28px;min-width:28px;height:28px;min-height:28px;padding:0;border-radius:6px}
.more .rule{height:1px;margin:4px 6px;background:oklch(.895 .008 255);flex-shrink:0}
.question{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;flex-shrink:0}
input{border:0;background:transparent;min-width:0;width:100%;font:400 13px/1.4 "IBM Plex Sans",system-ui,sans-serif;color:inherit}
input::placeholder{color:oklch(.42 .014 255);opacity:1}
.shortcut{font:500 12px/1.4 system-ui,sans-serif;border:1px solid oklch(.800 .010 255);border-radius:4px;padding:1px 6px}
.hint{padding:6px 12px 4px;font-size:12px;color:oklch(.42 .014 255)}
[hidden]{display:none!important}
@media(prefers-color-scheme:dark){.bar,.more{background:oklch(.300 .013 255);color:oklch(.950 .006 255);border-color:oklch(.560 .013 255)}button:hover{background:oklch(.360 .025 255)}.word-define{background:oklch(.360 .025 255);color:oklch(.950 .006 255)}button:focus-visible,input:focus-visible{outline-color:oklch(.760 .110 255)}.divider,.more .rule{background:oklch(.560 .013 255)}.hint,input::placeholder{color:oklch(.760 .012 255)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
const failure = 'The action did not finish; please try again.';

export function createSelectionBar(actions: ((action: SelectionAction) => Promise<boolean>) | SelectionBarCallbacks) {
  const legacy = typeof actions === 'function' ? actions : undefined;
  const callbacks = typeof actions === 'function' ? undefined : actions;
  let host: HTMLElement | undefined, shadow: ShadowRoot | undefined, row: HTMLElement | undefined, status: HTMLElement | undefined;
  let range: Range | undefined, model: SelectionBarModel | undefined, buttons: HTMLButtonElement[] = [], toolbar: HTMLButtonElement[] = [], ranked: HTMLButtonElement[] = [];
  let rankedActions: (() => void)[] = [];
  const dismissControls = new Set<HTMLButtonElement>();
  let dialog: HTMLElement | undefined, moreButton: HTMLButtonElement | undefined, question: HTMLInputElement | undefined;
  let generation = 0, pending = false, previousFocus: HTMLElement | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function hide(restoreFocus = false) {
    const target = previousFocus;
    generation++; clearTimeout(expiry); host?.remove(); host = undefined; shadow = undefined; row = undefined; status = undefined;
    range = undefined; model = undefined; buttons = []; toolbar = []; ranked = []; rankedActions = []; dialog = undefined; moreButton = undefined; question = undefined; pending = false; previousFocus = undefined;
    dismissControls.clear();
    if (restoreFocus && target?.isConnected) target.focus();
  }
  function position() {
    if (!host || !row || !range || !range.startContainer.isConnected || !range.endContainer.isConnected) { hide(); return; }
    const space = horizontalSpace(innerWidth, model?.articleBounds);
    if (!space) { hide(); return; }
    row.style.maxWidth = space.right - space.left + 'px';
    const bounds = row.getBoundingClientRect();
    let width = bounds.width, height = bounds.height;
    if (dialog) {
      dialog.style.maxWidth = space.right - space.left + 'px';
      const rects = Array.from(range.getClientRects()).filter(rect => [rect.top, rect.bottom].every(Number.isFinite) && rect.bottom > rect.top);
      const above = Math.min(...rects.map(rect => rect.top)) - 16;
      const below = innerHeight - Math.max(...rects.map(rect => rect.bottom)) - 16;
      const availableHeight = Math.min(innerHeight - 16, Math.max(above, below)) - bounds.height - 8;
      // Keep at least one full 40px control plus dialog padding and border
      // reachable. A zero-height scrolling dialog would be an invisible trap.
      if (availableHeight < 54) { closeMore(); position(); return; }
      dialog.style.maxHeight = availableHeight + 'px';
      const dialogBounds = dialog.getBoundingClientRect();
      width = Math.max(width, dialogBounds.width); height += 8 + dialogBounds.height;
      dialog.style.top = bounds.height + 8 + 'px';
      dialog.style.left = Math.max(0, width - dialogBounds.width) + 'px';
    }
    const placement = selectionBarPosition(Array.from(range.getClientRects()), width, height, innerWidth, innerHeight, model?.articleBounds);
    if (!placement) {
      // The bar can still fit when an expanded dialog cannot. Do not hide the
      // selected passage behind the dialog or lose the working toolbar.
      if (dialog) { closeMore(); position(); } else hide();
      return;
    }
    host.style.setProperty('left', placement.left + 'px', 'important');
    host.style.setProperty('top', placement.top + 'px', 'important');
  }
  function setPending(value: boolean) {
    const active = shadow?.activeElement as HTMLButtonElement | HTMLInputElement | null;
    pending = value; buttons.forEach(button => { button.disabled = value && button !== moreButton && !dismissControls.has(button); });
    // More remains a focus-return target while its actions are unavailable.
    moreButton?.setAttribute('aria-disabled', String(value));
    if (question) question.disabled = value;
    row?.setAttribute('aria-busy', String(value));
    // Keep keyboard dismissal in this surface after disabling an action/input.
    // If the host moved focus during the callback, active is already elsewhere.
    if (value && active?.disabled) (Array.from(dismissControls)[0] ?? moreButton)?.focus();
  }
  function activate(invoke: () => Promise<boolean>, confirmation?: string) {
    if (pending || !host?.isConnected) return;
    if (!range?.startContainer.isConnected || !range.endContainer.isConnected) { hide(); return; }
    const epoch = generation;
    const focused = shadow?.activeElement as HTMLElement | null;
    pending = true;
    // Keep the callback in the trusted event's synchronous message task.
    // Dispatch before disabling the focused control: host target checks can use
    // shadow focus when keyboard entry has collapsed the native selection.
    let request: Promise<boolean>;
    try { request = invoke(); } catch (error) { request = Promise.reject(error); }
    if (generation === epoch) setPending(true);
    void request.then(accepted => {
      if (generation !== epoch || !status) return;
      if (accepted && !confirmation) { hide(); return; }
      status.textContent = accepted ? confirmation! : failure; status.hidden = false;
      setPending(false);
      if (accepted) {
        buttons.forEach(button => { button.hidden = true; });
        closeMore(false); position(); expiry = setTimeout(() => hide(), 1800);
      } else { position(); restoreActionFocus(); }
    }).catch(() => {
      if (generation !== epoch || !status) return;
      setPending(false); status.textContent = failure; status.hidden = false; position();
      restoreActionFocus();
    });
    function restoreActionFocus() {
      // A newer page interaction wins over a late refusal. Disabling a control
      // may clear shadow focus, but only restore while this host still owns it.
      if (focused?.isConnected && (shadow?.activeElement === focused || document.activeElement === host)) focused.focus();
    }
  }
  function button(label: string, invoke: () => void, path?: string, dismiss = false) {
    const epoch = generation;
    const control = document.createElement('button'); control.type = 'button'; control.title = label; control.setAttribute('aria-label', label);
    if (path) {
      control.className = 'icon';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'path'); drawing.setAttribute('d', path); svg.append(drawing); control.append(svg);
    } else control.textContent = label;
    control.addEventListener('pointerdown', event => { if (event.isTrusted) event.preventDefault(); });
    control.addEventListener('click', event => { if (event.isTrusted && generation === epoch && control.isConnected && (!pending || dismiss)) invoke(); });
    if (dismiss) dismissControls.add(control);
    buttons.push(control); return control;
  }
  function closeMore(focus = true) {
    if (!dialog) return;
    const removed = Array.from(dialog.querySelectorAll('button'));
    buttons = buttons.filter(control => !removed.includes(control));
    removed.forEach(control => dismissControls.delete(control));
    dialog.remove(); dialog = undefined; question = undefined;
    moreButton?.setAttribute('aria-expanded', 'false');
    if (focus && moreButton?.isConnected) moreButton.focus();
  }
  function openMore() {
    if (!host || !shadow || !model || !callbacks || !moreButton || pending) return;
    if (dialog) { closeMore(); position(); return; }
    const current = model;
    dialog = document.createElement('div'); dialog.className = 'more'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'More suggestions');
    const close = button('Close', () => { closeMore(); position(); }, 'M6 6l12 12M18 6L6 18', true); close.className = 'close'; dialog.append(close);
    for (const offer of current.more) dialog.append(button(offer.label, () => activate(() => callbacks.offer(current.target, offer))));
    const rule = document.createElement('div'); rule.className = 'rule'; dialog.append(rule);
    const label = document.createElement('label'); label.className = 'question';
    question = document.createElement('input'); question.type = 'text'; question.placeholder = 'Or type your own question'; question.setAttribute('aria-label', 'Type your own question about this passage');
    const input = question, epoch = generation;
    input.addEventListener('keydown', event => {
      if (!event.isTrusted || epoch !== generation || !input.isConnected || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key !== 'Enter') return;
      const text = input.value;
      if (!text?.trim() || pending) return;
      event.preventDefault(); event.stopPropagation(); activate(() => callbacks.question(current.target, text));
    });
    const shortcut = document.createElement('span'); shortcut.className = 'shortcut'; shortcut.textContent = '/'; shortcut.setAttribute('aria-hidden', 'true');
    label.append(question, shortcut); dialog.append(label);
    const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = '1 2 3 picks a suggestion. / types your own. Esc closes.'; dialog.append(hint);
    dialog.addEventListener('keydown', keydown); shadow.append(dialog); moreButton.setAttribute('aria-expanded', 'true');
    position(); if (dialog) close.focus();
  }
  function editable(target: EventTarget | null) {
    const element = target as HTMLElement | null;
    return !!element && (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable);
  }
  function keydown(event: KeyboardEvent) {
    if (!event.isTrusted || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) {
      // Native Enter activation generates a trusted click after keydown. Merely
      // ignoring a repeat would still toggle More or retry a completed action.
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'BUTTON' && !editable(target) && !event.composedPath().some(editable) && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (dialog) { closeMore(); position(); } else hide(true);
      return;
    }
    if (editable(event.target) || editable(shadow?.activeElement ?? null) || event.composedPath().some(editable)) return;
    if (!event.shiftKey && /^[123]$/.test(event.key)) {
      const chosen = ranked[Number(event.key) - 1];
      if (chosen && !pending) { event.preventDefault(); event.stopPropagation(); rankedActions[Number(event.key) - 1]?.(); }
      return;
    }
    if (!event.shiftKey && event.key === '/' && callbacks && !pending) {
      event.preventDefault(); event.stopPropagation(); if (!dialog) openMore(); question?.focus(); return;
    }
    const controls = dialog && dialog.contains(shadow?.activeElement ?? null)
      ? buttons.filter(control => dialog?.contains(control)) : toolbar;
    const available = controls.filter(control => !control.hidden && !control.disabled);
    const index = available.indexOf(shadow?.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % available.length : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + available.length - 1) % available.length : -1;
    if (next >= 0 && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); available[next]?.focus(); }
  }
  function show(selectedRange: Range, suppliedModel?: SelectionBarModel) {
    hide();
    if (callbacks && !suppliedModel) return; // No guessed target, ranking or route.
    model = suppliedModel && callbacks ? selectionBarModel(suppliedModel) : undefined;
    range = selectedRange.cloneRange();
    previousFocus = typeof (document.activeElement as HTMLElement | null)?.focus === 'function' ? document.activeElement as HTMLElement : undefined;
    host = document.createElement('div'); host.id = 'marginalia-host-selection-' + crypto.randomUUID();
    for (const [property, value] of Object.entries({ all: 'initial', position: 'fixed', display: 'block', margin: '0', padding: '0', border: '0', width: 'max-content', height: 'auto', 'z-index': '2147483647', 'user-select': 'none' })) host.style.setProperty(property, value, 'important');
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = css;
    row = document.createElement('div'); row.className = 'bar'; row.setAttribute('role', 'toolbar'); row.setAttribute('aria-label', 'Passage actions');
    status = document.createElement('span'); status.className = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
    if (legacy) {
      for (const { action, label, path } of legacyControls) row.append(button(label, () => activate(() => legacy(action), action === 'keep' ? 'Kept' : undefined), path));
    } else if (model && callbacks) {
      const current = model;
      row.append(button('Highlight', () => activate(() => callbacks.highlight(current.target)), 'M4 20h6L20 10l-6-6L4 14z'));
      row.append(button('Add a note', () => activate(() => callbacks.note(current.target)), 'M5 4h14v12l-4 4H5zM9 9h6M9 13h4'));
      const divider = document.createElement('span'); divider.className = 'divider'; divider.setAttribute('role', 'separator'); row.append(divider);
      for (const offer of current.offers) {
        const invoke = () => activate(() => callbacks.offer(current.target, offer));
        const control = button(offer.label, invoke);
        // The accepted Word board specifically tints its sole Define action;
        // passage offer ranking still has equal resting treatment.
        if (current.scope === 'word') control.className = 'word-define';
        ranked.push(control); rankedActions.push(invoke); row.append(control);
      }
      moreButton = button('More suggestions', openMore, 'M4 12h.01M12 12h.01M20 12h.01');
      moreButton.setAttribute('aria-haspopup', 'dialog'); moreButton.setAttribute('aria-expanded', 'false'); row.append(moreButton);
    }
    toolbar = [...buttons]; row.addEventListener('keydown', keydown);
    row.append(status); shadow.append(style, row); document.documentElement.append(host); position();
  }
  return {
    show, hide: () => hide(), position,
    commandStatus(text: 'Kept' | 'Try again' | 'Select a passage first' | 'The passage changed. Select it again.') {
      if (!legacy || !host?.isConnected || !status || pending) return;
      status.textContent = text; status.hidden = false;
      buttons.forEach(button => { button.hidden = text === 'Kept'; }); position();
      if (text === 'Kept') expiry = setTimeout(() => hide(), 1800);
    },
    owns: (event: Event) => !!host && event.composedPath().includes(host),
    visible: () => !!host?.isConnected,
    focused: () => !!shadow?.activeElement,
    focus: () => toolbar.find(control => !control.disabled && !control.hidden)?.focus(),
    matches(selection: Selection | null) {
      if (!range || !selection || !selection.rangeCount || selection.isCollapsed) return false;
      const current = selection.getRangeAt(0);
      return current.startContainer === range.startContainer && current.endContainer === range.endContainer && current.startOffset === range.startOffset && current.endOffset === range.endOffset;
    },
  };
}
