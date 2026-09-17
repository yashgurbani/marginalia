import { el, button } from './dom.ts';

export type NoteEditorState = {
  text: string; attachment: string; saving: boolean; locked: boolean;
  canChange: boolean; message: string;
};
export type AttachmentChoice = { label: string; choose(): void };

/** Keep the actual textarea connected through save failures, thread refreshes and
 * permission/status updates. The owner retains the draft and its frozen source. */
export function mountNoteEditor(host: HTMLElement, actions: {
  edit(text: string): void; save(): void; discard(): void; ask(): void;
  attachments(): AttachmentChoice[];
}) {
  const body = el('div', undefined, 'm-note-editor'); body.hidden = true;
  const attachment = el('div', undefined, 'm-attachment'), label = el('span');
  const choices = el('div', undefined, 'm-choose-anchor'); choices.hidden = true;
  const change = button('Change', () => {
    if (change.disabled) return;
    // A displayed set stays stable until an explicit selection or cancellation.
    const options = actions.attachments();
    choices.replaceChildren(...options.map(option => button(option.label, () => {
      choices.hidden = true; option.choose(); field.focus({ preventScroll: true });
    })), button('Cancel attachment change', () => { choices.hidden = true; change.focus(); }));
    choices.hidden = false; choices.querySelector('button')?.focus();
  });
  attachment.append(label, change);
  const field = el('textarea'); field.setAttribute('aria-label', 'Your note');
  field.placeholder = 'Your note'; field.maxLength = 20000;
  const save = button('Save note', actions.save), discard = button('Discard draft', actions.discard);
  const ask = button('Save note and review a question', actions.ask); ask.hidden = true;
  const row = el('div', undefined, 'm-actions'); row.append(save, discard, ask);
  const status = el('p', '', 'm-meta'); status.setAttribute('role', 'status');
  field.addEventListener('input', () => {
    if (field.readOnly) return;
    actions.edit(field.value); ask.hidden = !field.value.trimEnd().endsWith('?');
  });
  field.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !field.readOnly) {
      event.preventDefault(); actions.save();
    }
  });
  body.append(attachment, choices, field, row, el('small', 'Enter saves; Shift+Enter adds a line. Asking always needs a separate action.', 'm-meta'), status);
  host.append(body);
  return {
    update(state?: NoteEditorState) {
      body.hidden = !state;
      if (!state) { choices.hidden = true; return; }
      // Do not reset selection or scrollTop when the backing text has not changed.
      if (field.value !== state.text) field.value = state.text;
      label.textContent = state.attachment;
      field.readOnly = state.saving || state.locked;
      save.disabled = state.saving || !state.text.trim();
      discard.disabled = state.saving || state.locked;
      change.hidden = !state.canChange; change.disabled = state.saving || state.locked;
      ask.hidden = !state.text.trimEnd().endsWith('?'); ask.disabled = state.saving || state.locked;
      status.textContent = state.message;
    },
    focus() { field.focus({ preventScroll: true }); },
    element: field,
  };
}
