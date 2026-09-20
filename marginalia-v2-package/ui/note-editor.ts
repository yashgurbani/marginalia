import { el, button } from './dom.ts';

export type NoteEditorState = {
  text: string; attachment: string; saving: boolean; locked: boolean;
  canChange: boolean; message: string;
  continuous?: boolean;
};
export type AttachmentChoice = { label: string; choose(): void };

/** Keep the actual textarea connected through save failures, thread refreshes and
 * permission/status updates. The owner retains the draft and its frozen source. */
export function mountNoteEditor(host: HTMLElement, actions: {
  edit(text: string): void; save(): void; discard(): void; ask(): void;
  attachments(): AttachmentChoice[];
  chooseOffer?(id: string): void;
}) {
  let current: NoteEditorState | undefined;
  const body = el('div', undefined, 'm-note-editor'); body.hidden = true;
  const attachment = el('div', undefined, 'm-attachment'), label = el('span');
  const choices = el('div', undefined, 'm-choose-anchor'); choices.hidden = true;
  const change = button('Change', () => {
    if (!current || !current.canChange || current.saving || current.locked) return;
    // A displayed set stays stable until an explicit selection or cancellation.
    const options = actions.attachments();
    choices.replaceChildren(...options.map(option => button(option.label, () => {
      if (!current || !current.canChange || current.saving || current.locked || choices.hidden) return;
      choices.hidden = true; option.choose(); field.focus({ preventScroll: true });
    })), button('Cancel attachment change', () => { choices.hidden = true; change.focus(); }));
    choices.hidden = false; choices.querySelector('button')?.focus();
  });
  attachment.append(label, change);
  const field = el('textarea'); field.setAttribute('aria-label', 'Your note');
  const hint = el('small', '', 'm-meta'); hint.hidden = true;
  hint.id = `m-note-editor-hint-${crypto.randomUUID()}`; field.setAttribute('aria-describedby', hint.id);
  field.placeholder = 'Your note'; field.maxLength = 20000;
  const save = button('Save note', actions.save), discard = button('Discard draft', actions.discard);
  const ask = button('Ask', actions.ask);
  const offers = el('div', undefined, 'm-note-offers');
  const row = el('div', undefined, 'm-actions'); row.append(offers, save, discard, ask);
  const status = el('p', '', 'm-meta'); status.setAttribute('role', 'status');
  field.addEventListener('input', () => {
    if (field.readOnly) return;
    actions.edit(field.value);
    save.disabled = !!current?.saving || !field.value.trim();
    ask.disabled = !field.value.trim() || !!current?.locked;
  });
  // Native textarea Enter, Shift+Enter and IME composition all remain editing.
  body.append(attachment, choices, field, row, hint, status);
  host.append(body);
  return {
    update(state?: NoteEditorState) {
      current = state; body.hidden = !state;
      if (state?.saving || state?.locked || !state?.canChange) choices.hidden = true;
      if (!state) { choices.hidden = true; return; }
      // Do not reset selection or scrollTop when the backing text has not changed.
      if (field.value !== state.text) field.value = state.text;
      label.textContent = state.attachment;
      field.readOnly = (state.saving && !state.continuous) || state.locked;
      attachment.hidden = !!state.continuous;
      save.hidden = !!state.continuous; discard.hidden = !!state.continuous;
      save.disabled = state.saving || !state.text.trim();
      discard.disabled = state.saving || state.locked;
      change.hidden = !state.canChange; change.disabled = state.saving || state.locked;
      ask.hidden = false; ask.disabled = state.saving || state.locked || !state.text.trim();
      status.textContent = state.message; status.hidden = !state.message;
    },
    offers(values: readonly { id: string; label: string }[]) {
      offers.replaceChildren(...values.map(value => button(value.label, () => {
        if (current && !current.locked && !current.saving && field.value.trim()) actions.chooseOffer?.(value.id);
      })));
    },
    focus() { field.focus({ preventScroll: true }); },
    element: field,
  };
}
