import test from 'node:test';
import assert from 'node:assert/strict';
import { mountNoteEditor, type NoteEditorState } from '../ui/note-editor.ts';
import { dom, button } from './t05-dom.ts';

const initial: NoteEditorState = { text: 'My note?', attachment: 'Section two', saving: false, locked: false, canChange: true, message: '' };
function setup(t: import('node:test').TestContext) {
  const { document, root } = dom(t), calls = { edits: [] as string[], saves: 0, asks: 0, discards: 0, choices: 0 };
  const editor = mountNoteEditor(root as unknown as HTMLElement, { edit: value => { calls.edits.push(value); }, save: () => { calls.saves++; }, ask: () => { calls.asks++; }, discard: () => { calls.discards++; }, attachments: () => [{ label: 'Whole page', choose: () => { calls.choices++; } }] });
  editor.update(initial); return { document, root, calls, editor, field: root.querySelector('textarea')! };
}
test('save/failure updates retain the connected textarea, focus, caret and scroll', t => {
  const { document, editor, field } = setup(t); field.focus(); field.setSelectionRange(3, 5); field.scrollTop = 42;
  editor.update({ ...initial, saving: true }); assert.equal(field.readOnly, true);
  editor.update({ ...initial, message: 'Saving failed. Retry or export.' });
  assert.equal(editor.element, field as unknown as HTMLTextAreaElement); assert.equal(field.isConnected, true); assert.equal(document.activeElement, field);
  assert.deepEqual([field.selectionStart, field.selectionEnd, field.scrollTop, field.value], [3, 5, 42, initial.text]);
});
test('an open attachment chooser cannot change a saving or locked mutation', t => {
  const { root, calls, editor } = setup(t);
  button(root, 'Change').click(); const choice = button(root, 'Whole page');
  editor.update({ ...initial, saving: true }); choice.click(); assert.equal(calls.choices, 0);
  editor.update(initial); choice.click(); assert.equal(calls.choices, 0, 'stale hidden chooser remains fenced');
  button(root, 'Change').click(); editor.update({ ...initial, locked: true }); button(root, 'Whole page').click(); assert.equal(calls.choices, 0);
  editor.update(initial); button(root, 'Change').click(); button(root, 'Whole page').click(); assert.equal(calls.choices, 1);
});
test('question mark offers a separate review action and typing never sends or saves', t => {
  const { root, calls, field } = setup(t);
  field.value = 'Does this follow?'; field.fire('input');
  assert.deepEqual(calls.edits, ['Does this follow?']); assert.equal(calls.asks, 0); assert.equal(calls.saves, 0);
  const ask = button(root, 'Save note and review a question'); assert.equal(ask.hidden, false); ask.click(); assert.equal(calls.asks, 1);
});
test('Enter saves once; Shift+Enter and composing input do not save', t => {
  const { calls, field, editor } = setup(t);
  assert.equal(field.fire('keydown', { key: 'Enter', shiftKey: true, isComposing: false }).defaultPrevented, false);
  field.fire('keydown', { key: 'Enter', shiftKey: false, isComposing: true }); assert.equal(calls.saves, 0);
  assert.equal(field.fire('keydown', { key: 'Enter', shiftKey: false, isComposing: false }).defaultPrevented, true); assert.equal(calls.saves, 1);
  editor.update({ ...initial, locked: true }); field.fire('keydown', { key: 'Enter', shiftKey: false }); assert.equal(calls.saves, 1);
});
test('hiding/reopening the editor preserves its DOM and closes stale attachment choices', t => {
  const { editor, root, field, calls } = setup(t); button(root, 'Change').click(); const choice = button(root, 'Whole page');
  editor.update(); choice.click(); assert.equal(calls.choices, 0);
  editor.update({ ...initial, text: 'Recovered draft' }); assert.equal(editor.element, field as unknown as HTMLTextAreaElement); assert.equal(field.value, 'Recovered draft');
});


test('typing enables Save and clearing the field disables it without replacing the editor', t => {
  const { editor, root, field, calls } = setup(t); editor.update({ ...initial, text: '' });
  const save = button(root, 'Save note'); assert.equal(save.disabled, true);
  field.value = 'A new note'; field.fire('input'); assert.equal(save.disabled, false); save.click(); assert.equal(calls.saves, 1);
  field.value = '  '; field.fire('input'); assert.equal(save.disabled, true); assert.ok(editor.element === (field as unknown as HTMLTextAreaElement));
});
