import { el, button } from '../dom.ts';
import type { SurfaceAction } from './types.ts';

export function mountLibrarySurface(slots: { history: HTMLElement; requests: HTMLElement; retained: HTMLElement }, actions: {
  openLibrary: SurfaceAction; hasExternalLibrary(): boolean; useExternalLibrary(): boolean;
}) {
  const element = el('section', undefined, 'm-local-library'); element.hidden = true;
  element.setAttribute('aria-label', 'Library work on this page');
  element.append(el('h2', 'Work on this page'), slots.history, slots.requests, slots.retained);
  if (actions.hasExternalLibrary()) element.append(button('Open Library', () => actions.openLibrary?.()));
  element.append(button('Close Library', () => { element.hidden = true; control.focus({ preventScroll: true }); }));
  const focusAction = () => {
    const target = [...element.querySelectorAll<HTMLButtonElement>('button')].find(control =>
      !control.disabled && control.tabIndex >= 0 && !control.hidden && !control.closest('[hidden]') && !control.closest('[aria-hidden="true"]'));
    target?.focus();
  };
  const control = button('Library', () => {
    if (actions.hasExternalLibrary() && actions.useExternalLibrary()) actions.openLibrary();
    else { element.hidden = !element.hidden; if (!element.hidden) focusAction(); }
  });
  return { element, control, focusAction };
}
