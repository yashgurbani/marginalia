import test from 'node:test';
import assert from 'node:assert/strict';
import { mountNoteEditor, type NoteEditorState } from '../ui/note-editor.ts';

/** Connected-tree fixture; not browser layout, accessibility or IME conformance evidence. */
class Element extends EventTarget {
  children: Element[] = []; parent: Element | null = null; text = ''; value = '';
  type = ''; hidden = false; disabled = false; readOnly = false; maxLength = 0; placeholder = '';
  className = ''; selectionStart = 0; selectionEnd = 0; scrollTop = 0;
  attrs = new Map<string, string>();
  readonly tag: string; readonly doc: Doc;
  constructor(tag: string, doc: Doc) { super(); this.tag = tag; this.doc = doc; }
  get textContent(): string { return this.text + this.children.map(n => n.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  get isConnected(): boolean { return this === this.doc.body || !!this.parent?.isConnected; }
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  getAttribute(key: string) { return this.attrs.get(key) ?? null; }
  append(...children: Element[]) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  replaceChildren(...children: Element[]) { for (const child of [...this.children]) child.remove(); this.text = ''; this.append(...children); }
  contains(node: Element | null): boolean { return !!node && (this === node || this.children.some(n => n.contains(node))); }
  remove() { if (!this.parent) return; if (this.contains(this.doc.active)) this.doc.active = this.doc.body; this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
  querySelectorAll(selector: string): Element[] { return this.children.flatMap(n => [...(n.tag === selector ? [n] : []), ...n.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { if (this.isConnected && !this.disabled) this.doc.active = this; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  key(values: Record<string, unknown>) { const event = new Event('keydown', { cancelable: true }); for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value }); this.dispatchEvent(event); return event; }
}
class Doc {
  body = new Element('body', this); active = this.body;
  createElement(tag: string) { return new Element(tag, this); }
}
const initial: NoteEditorState = { text: 'Reader words', attachment: 'Original passage', saving: false, locked: false, canChange: true, message: '' };
function fixture(t: import('node:test').TestContext) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = new Doc(); Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  t.after(() => { if (before) Object.defineProperty(globalThis, 'document', before); else Reflect.deleteProperty(globalThis, 'document'); });
  const calls: string[] = [];
  const editor = mountNoteEditor(doc.body as unknown as HTMLElement, {
    edit: text => calls.push('edit:' + text), save: () => calls.push('save'), discard: () => calls.push('discard'), ask: () => calls.push('ask'),
    attachments: () => [{ label: 'Another passage', choose: () => calls.push('choose') }],
  });
  editor.update(initial);
  const field = doc.body.querySelector('textarea')!;
  const button = (text: string) => { const node = doc.body.querySelectorAll('button').find(n => n.textContent === text); assert.ok(node, text); return node; };
  return { doc, editor, field, button, calls };
}

test('save failure and status updates retain the same connected textarea, focus, caret and scroll', t => {
  const { doc, editor, field } = fixture(t); field.focus(); field.selectionStart = 3; field.selectionEnd = 7; field.scrollTop = 24;
  editor.update({ ...initial, saving: true }); editor.update({ ...initial, message: 'Not saved; retry' });
  assert.equal(doc.body.querySelector('textarea'), field); assert.equal(field.isConnected, true); assert.equal(doc.active, field);
  assert.deepEqual([field.selectionStart, field.selectionEnd, field.scrollTop], [3, 7, 24]); assert.equal(field.value, initial.text);
});
test('typing into a fresh draft enables Save, and clearing it disables Save without an owner refresh', t => {
  const { editor, field, button, calls } = fixture(t);
  editor.update({ ...initial, text: '' });
  const save = button('Save note'); assert.equal(save.disabled, true);
  field.value = 'A new thought'; field.dispatchEvent(new Event('input'));
  assert.equal(save.disabled, false); assert.deepEqual(calls, ['edit:A new thought']);
  field.value = ' \n '; field.dispatchEvent(new Event('input'));
  assert.equal(save.disabled, true); save.click();
  assert.deepEqual(calls, ['edit:A new thought', 'edit: \n ']);
  field.value = 'Keep this thought'; field.dispatchEvent(new Event('input')); save.click();
  assert.deepEqual(calls, ['edit:A new thought', 'edit: \n ', 'edit:Keep this thought', 'save']);
});
test('a question mark offers Ask but input does not save or send', t => {
  const { editor, field, button, calls } = fixture(t); field.value = 'Why?'; field.dispatchEvent(new Event('input'));
  assert.deepEqual(calls, ['edit:Why?']); assert.equal(button('Save note and review a question').hidden, false);
  const hintId = field.getAttribute('aria-describedby'); assert.ok(hintId);
  const hint = field.doc.body.querySelector('small')!; assert.equal((hint as any).id, hintId);
  assert.equal(hint.textContent, 'Enter saves; Shift+Enter adds a line. Asking always needs a separate action.');
  const status = field.doc.body.querySelectorAll('p').at(-1)!;
  assert.equal(status.textContent, 'Save note and review a question is now available.');
  field.value = 'Why exactly?'; field.dispatchEvent(new Event('input'));
  assert.equal(status.textContent, 'Save note and review a question is now available.', 'the same appearance is not announced again per keystroke');
  editor.update({ ...initial, text: field.value }); button('Save note and review a question').click();
  assert.deepEqual(calls, ['edit:Why?', 'edit:Why exactly?', 'ask']);
});
test('Enter saves once, while Shift+Enter and composing Enter do not invoke save', t => {
  const { field, calls } = fixture(t);
  assert.equal(field.key({ key: 'Enter', shiftKey: true, isComposing: false }).defaultPrevented, false);
  assert.equal(field.key({ key: 'Enter', shiftKey: false, isComposing: true }).defaultPrevented, false);
  assert.equal(field.key({ key: 'Enter', shiftKey: false, isComposing: false }).defaultPrevented, true);
  assert.deepEqual(calls, ['save']);
});
test('attachment choices are stable, explicit, and cannot be applied after a save starts', t => {
  const { editor, button, calls } = fixture(t); button('Change').click(); const stale = button('Another passage');
  editor.update({ ...initial, saving: true }); stale.click(); assert.deepEqual(calls, []);
  editor.update(initial); stale.click(); assert.deepEqual(calls, [], 'hidden stale choice stays invalid after save');
  button('Change').click(); button('Another passage').click(); assert.deepEqual(calls, ['choose']);
});
test('a detached old attachment choice cannot act after the editor is cleared', t => {
  const { editor, button, calls } = fixture(t); button('Change').click(); const stale = button('Another passage'); editor.update(); stale.click();
  assert.deepEqual(calls, []);
});
test('locked mutation retains readable text but refuses input, attachment changes, discard and Ask', t => {
  const { editor, field, button, calls } = fixture(t); editor.update({ ...initial, text: 'Pending?', locked: true });
  field.dispatchEvent(new Event('input')); field.key({ key: 'Enter', isComposing: false }); button('Change').click(); button('Discard draft').click(); button('Save note and review a question').click();
  assert.equal(field.readOnly, true); assert.equal(field.disabled, false); assert.deepEqual(calls, []);
  button('Save note').click(); assert.deepEqual(calls, ['save'], 'explicit retry remains available');
});
