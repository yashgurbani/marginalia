import { el, button } from '../dom.ts';

export function mountRecoverySurface(view: {
  threadId: string; state: 'moved' | 'lost' | 'unsure'; observed: boolean; pending: boolean; message?: string;
}, lookAgain: (control: HTMLButtonElement) => void) {
  const marker = el('div', undefined, 'm-reader-note');
  marker.append(el('p', 'You were here', 'm-meta'));
  const attachmentCopy = view.state === 'moved'
    ? view.observed ? 'This passage moved. This attachment is saved; the original quotation is still here.' : 'This passage moved. The original quotation is still here.'
    : view.state === 'unsure'
      ? 'More than one passage could match. The original quotation is still here.'
      : 'This passage could not be found. The original quotation is still here.';
  const message = el('p', view.message ?? attachmentCopy, 'm-meta m-attachment-status');
  message.setAttribute('role', 'status');
  const look = button(view.state === 'moved' ? 'Remember this attachment' : 'Look again', () => lookAgain(look));
  look.dataset.focusKey = view.threadId + ':reattach';
  look.className = 'm-reattach-action'; look.disabled = view.pending;
  marker.append(message); if (!view.observed) marker.append(look);
  return marker;
}
