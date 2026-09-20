import type { SelectionAction } from './selection-actions.ts';

type Rect = { left: number; right: number; top: number; bottom: number };
/** A bar is optional when the selected text leaves no safe viewport space. */
export function selectionBarPosition(rects: readonly Rect[], width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const usable = rects.filter(r => [r.left, r.right, r.top, r.bottom].every(Number.isFinite) && r.right > r.left && r.bottom > r.top);
  const gap = 8;
  if (![width, height, viewportWidth, viewportHeight].every(n => Number.isFinite(n) && n > 0) || !usable.length || width > viewportWidth - gap * 2 || height > viewportHeight - gap * 2) return null;
  const top = Math.min(...usable.map(r => r.top)), bottom = Math.max(...usable.map(r => r.bottom));
  const left = Math.max(gap, Math.min(usable[0].left, viewportWidth - width - gap));
  if (bottom < 0 || top > viewportHeight) return null;
  if (bottom + gap + height <= viewportHeight - gap) return { left, top: Math.max(gap, bottom + gap) };
  if (top - gap - height >= gap) return { left, top: top - gap - height };
  return null;
}

const controls: { action: SelectionAction; label: string; path: string }[] = [
  { action: 'keep', label: 'Keep', path: 'M6 3h12v18l-6-4-6 4V3Z' },
  { action: 'note', label: 'Note', path: 'M5 4h10l4 4v12H5V4Zm10 0v5h4M8 13h8M8 16h6' },
  { action: 'ask', label: 'Ask', path: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01M4 3h16v16H9l-5 3V3Z' },
  { action: 'simulate', label: 'Simulate it', path: 'M4 5v14h16M7 15c3 0 3-7 6-7s3 5 6 5M7 15h.01M13 8h.01M19 13h.01' },
];
const css = `
:host{color-scheme:light dark;font:14px/1.4 system-ui,sans-serif;direction:ltr}
*{box-sizing:border-box}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:3px;background:oklch(.993 .003 255);color:oklch(.245 .016 255);border:1px solid oklch(.800 .010 255);border-radius:6px;width:142px}
button{all:unset;box-sizing:border-box;display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;border-radius:3px;cursor:pointer;color:inherit;touch-action:manipulation}
button:hover{background:oklch(.925 .030 255)}
button:focus-visible{outline:2px solid oklch(.500 .120 255);outline-offset:-2px}
button:disabled{opacity:.5;cursor:wait}
svg{display:block;width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.status{flex-basis:100%;font:13px/1.4 system-ui,sans-serif;padding:0 7px;overflow-wrap:anywhere}
[hidden]{display:none!important}
@media(prefers-color-scheme:dark){.bar{background:oklch(.250 .012 255);color:oklch(.925 .008 255);border-color:oklch(.540 .012 255)}button:hover{background:oklch(.330 .050 255)}button:focus-visible{outline-color:oklch(.760 .095 255)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

export function createSelectionBar(onAction: (action: SelectionAction) => Promise<boolean>) {
  let host: HTMLElement | undefined, shadow: ShadowRoot | undefined, row: HTMLElement | undefined, status: HTMLElement | undefined;
  let range: Range | undefined, buttons: HTMLButtonElement[] = [], generation = 0, pending = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  function hide() { generation++; clearTimeout(expiry); host?.remove(); host = undefined; shadow = undefined; range = undefined; buttons = []; pending = false; }
  function position() {
    if (!host || !row || !range || !range.startContainer.isConnected || !range.endContainer.isConnected) { hide(); return; }
    const bounds = row.getBoundingClientRect();
    const placement = selectionBarPosition(Array.from(range.getClientRects()), bounds.width, bounds.height, innerWidth, innerHeight);
    if (!placement) { hide(); return; }
    host.style.setProperty('left', placement.left + 'px', 'important');
    host.style.setProperty('top', placement.top + 'px', 'important');
  }
  function show(selectedRange: Range) {
    hide(); range = selectedRange.cloneRange();
    const epoch = generation;
    host = document.createElement('div'); host.id = 'marginalia-host-selection-' + crypto.randomUUID();
    for (const [property, value] of Object.entries({ all: 'initial', position: 'fixed', display: 'block', margin: '0', padding: '0', border: '0', width: 'max-content', height: 'auto', 'z-index': '2147483647', 'user-select': 'none' })) host.style.setProperty(property, value, 'important');
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = css;
    row = document.createElement('div'); row.className = 'bar'; row.setAttribute('role', 'toolbar'); row.setAttribute('aria-label', 'Passage actions');
    status = document.createElement('span'); status.className = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
    for (const { action, label, path } of controls) {
      const button = document.createElement('button'); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'path'); drawing.setAttribute('d', path); svg.append(drawing); button.append(svg);
      button.addEventListener('pointerdown', event => { if (event.isTrusted) event.preventDefault(); });
      button.addEventListener('click', event => {
        if (!event.isTrusted || pending) return;
        pending = true; buttons.forEach(control => { control.disabled = true; });
        // Invoke synchronously: the content route opens the native shell in this
        // user gesture's message task, before asynchronous authorization checks.
        let request: Promise<boolean>;
        try { request = onAction(action); } catch (error) { request = Promise.reject(error); }
        void request.then(accepted => {
          if (generation !== epoch || !status) return;
          if (accepted && action !== 'keep') { hide(); return; }
          status.textContent = accepted ? 'Kept' : 'The action did not finish; please try again.'; status.hidden = false;
          buttons.forEach(control => { control.disabled = false; control.hidden = accepted; }); pending = false;
          position(); if (accepted) expiry = setTimeout(hide, 1800);
        }).catch(() => {
          if (generation !== epoch || !status) return;
          pending = false; status.textContent = 'The action did not finish; please try again.'; status.hidden = false; buttons.forEach(control => { control.disabled = false; }); position();
        });
      });
      buttons.push(button); row.append(button);
    }
    row.addEventListener('keydown', event => {
      if (!event.isTrusted) return;
      const index = buttons.indexOf(shadow?.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : -1;
      if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
    });
    row.append(status); shadow.append(style, row); document.documentElement.append(host); position();
  }
  return {
    show, hide, position,
    commandStatus(text: 'Kept' | 'Try again' | 'Select a passage first' | 'The passage changed. Select it again.') {
      if (!host?.isConnected || !status || pending) return;
      status.textContent = text; status.hidden = false;
      buttons.forEach(button => { button.hidden = text === 'Kept'; });
      position();
      if (text === 'Kept') expiry = setTimeout(hide, 1800);
    },
    owns: (event: Event) => !!host && event.composedPath().includes(host),
    visible: () => !!host?.isConnected,
    focused: () => !!shadow?.activeElement,
    focus: () => buttons[0]?.focus(),
    matches(selection: Selection | null) {
      if (!range || !selection || !selection.rangeCount || selection.isCollapsed) return false;
      const current = selection.getRangeAt(0);
      return current.startContainer === range.startContainer && current.endContainer === range.endContainer && current.startOffset === range.startOffset && current.endOffset === range.endOffset;
    },
  };
}
