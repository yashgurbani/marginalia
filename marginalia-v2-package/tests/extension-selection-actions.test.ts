import test from 'node:test';
import assert from 'node:assert/strict';
import { actionMatches, retainedKeep, sameSelection, selectionBarModel, validContentAction, type ActionRequest, type SelectionBarModel, type SelectionBarCallbacks } from '../extension/lib/selection-actions.ts';
import { createSelectionBar, selectionBarPosition } from '../extension/lib/selection-bar.ts';
import { deferred, replaceGlobals, settle } from './t05-dom.ts';
import { ReaderJournal } from '../ui/journal.ts';
import type { Snapshot } from '../extension/lib/protocol.ts';

const snapshot = (): Snapshot => ({ document: 'capture-one', revision: 3, position: 0,
  capture: { url: 'https://example.org/article', title: 'Article', text: 'A passage here.', pageType: 'article', capturedAt: '2026-09-19T00:00:00Z', extractionVersion: 'dom-safe-text-v1' },
  anchor: { exact: 'passage', start: 2, end: 9, prefix: 'A ', suffix: ' here.' }, sections: [{ title: 'Article', start: 0, end: 15 }] });

test('pending action requires the exact document, capture, revision, anchor and lifetime', () => {
  const s = snapshot(), request: ActionRequest = { id: 'action', action: 'simulate', browserDocument: 'browser-one', snapshot: s, expires: 1000 };
  assert.equal(actionMatches(request, 'browser-one', structuredClone(s), 999), true);
  assert.equal(actionMatches(request, 'browser-two', s, 999), false);
  assert.equal(actionMatches(request, 'browser-one', s, 1000), false);
  for (const modify of [
    (v: Snapshot) => { v.document = 'new'; }, (v: Snapshot) => { v.revision++; },
    (v: Snapshot) => { v.capture.url += '/other'; }, (v: Snapshot) => { v.capture.text += 'changed'; },
    (v: Snapshot) => { v.anchor!.start++; }, (v: Snapshot) => { v.anchor!.end++; },
    (v: Snapshot) => { v.anchor!.prefix = 'different'; }, (v: Snapshot) => { v.anchor!.suffix = 'different'; },
    (v: Snapshot) => { v.anchor!.exact = 'different'; }, (v: Snapshot) => { v.anchor = null; },
  ]) { const altered = structuredClone(s); modify(altered); assert.equal(sameSelection(s, altered), false); }
});

test('Keep reuses only a live record with retained full capture and anchor evidence', async () => {
  const journal = new ReaderJournal({ load: async () => undefined, save: async () => {} }), s = snapshot();
  await journal.change({ id: 'save', kind: 'keep', threadId: 'thread', capture: s.capture, anchor: s.anchor! });
  assert.equal(retainedKeep(journal.state, s), 'thread');
  for (const modify of [
    (v: Snapshot) => { v.capture.text += ' changed'; }, (v: Snapshot) => { v.capture.title = 'Other edition'; },
    (v: Snapshot) => { v.capture.author = 'Other author'; }, (v: Snapshot) => { v.capture.sections = [{ title: 'Other section', start: 0, end: 15 }]; },
    (v: Snapshot) => { v.anchor!.prefix = 'different'; }, (v: Snapshot) => { v.anchor!.suffix = 'different'; },
  ]) { const altered = structuredClone(s); modify(altered); assert.equal(retainedKeep(journal.state, altered), undefined); }
  const unbound = structuredClone(journal.state); unbound.pending = [];
  assert.equal(retainedKeep(unbound, s), undefined, 'empty source identity alone proves nothing');
  const deleted = structuredClone(journal.state); deleted.threads[0].deletedAt = '2026-09-19T01:00:00Z';
  assert.equal(retainedKeep(deleted, s), undefined);
});

test('content action contract accepts only the bounded four-action identity packet', () => {
  const packet = { type: 'selection-action', version: 1, action: 'keep', gesture: crypto.randomUUID(), operation: crypto.randomUUID(), document: 'capture', revision: 1 };
  assert.equal(validContentAction(packet), true);
  for (const change of [{ action: 'read-later' }, { revision: NaN }, { revision: -1 }, { gesture: 'page-token' }, { operation: 'invented' }, { document: '' }, { document: 'a'.repeat(65) }, { capture: snapshot().capture }, { version: 2 }]) assert.equal(validContentAction({ ...packet, ...change }), false);
});

test('bar placement at 360 and 440px never intersects selected text or clips the viewport', () => {
  for (const viewport of [360, 440]) for (const selected of [
    [{ left: 16, right: 320, top: 10, bottom: 30 }],
    [{ left: viewport - 30, right: viewport - 5, top: 590, bottom: 620 }],
    [{ left: 16, right: 330, top: 100, bottom: 130 }, { left: 16, right: 200, top: 132, bottom: 158 }],
  ]) {
    const place = selectionBarPosition(selected, 144, 40, viewport, 640)!;
    assert.ok(place); assert.ok(place.left >= 8 && place.left + 144 <= viewport - 8);
    assert.ok(place.top >= 8 && place.top + 40 <= 632);
    for (const rect of selected) assert.ok(place.top >= rect.bottom + 8 || place.top + 40 <= rect.top - 8);
  }
  assert.equal(selectionBarPosition([{ left: 8, right: 350, top: 0, bottom: 640 }], 144, 40, 360, 640), null);
  assert.equal(selectionBarPosition([{ left: 8, right: 350, top: 700, bottom: 720 }], 144, 40, 360, 640), null);
  assert.equal(selectionBarPosition([], 144, 40, 360, 640), null);
});

function barDom(t: import('node:test').TestContext) {
  const dimensions = { barWidth: 144, barHeight: 40, dialogWidth: 300, dialogHeight: 240 };
  class Element {
    parent: Element | null = null; children: Element[] = []; attrs = new Map<string, string>(); listeners = new Map<string, ((e: any) => void)[]>();
    tag: string; id = ''; className = ''; textContent = ''; title = ''; type = ''; hidden = false; disabled = false; activeElement: Element | null = null;
    mode = ''; shadow?: Element;
    value = ''; placeholder = ''; isContentEditable = false;
    get tagName() { return this.tag.toUpperCase(); }
    style: Record<string, unknown> & { setProperty(k: string, v: string, priority: string): void } = { setProperty(k, v, priority) { this[k] = [v, priority]; } };
    constructor(tag: string) { this.tag = tag; }
    get isConnected(): boolean { return this === document.documentElement || !!this.parent?.isConnected; }
    append(...nodes: Element[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    attachShadow({ mode }: { mode: string }) { this.shadow = new Element('shadow'); this.shadow.parent = this; this.shadow.mode = mode; return this.shadow; }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); }
    addEventListener(type: string, listener: (e: any) => void) { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list); }
    emit(type: string, properties = {}): { prevented: boolean; stopped: boolean } {
      const e = { isTrusted: false, target: this, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, composedPath: () => [this], ...properties };
      for (const listener of this.listeners.get(type) ?? []) listener(e);
      if (!e.stopped && this.parent) {
        const bubbled = this.parent.emit(type, e); e.prevented = bubbled.prevented; e.stopped = bubbled.stopped;
      }
      return e;
    }
    focus() { let root: Element | null = this; while (root && root.tag !== 'shadow') root = root.parent; if (root) { root.activeElement = this; document.activeElement = root.parent; } else document.activeElement = this; }
    contains(element: Element | null): boolean { return !!element && (element === this || this.children.some(child => child.contains(element))); }
    querySelectorAll(tag: string): Element[] { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
    getBoundingClientRect() { return this.className === 'more' ? { width: dimensions.dialogWidth, height: dimensions.dialogHeight } : { width: dimensions.barWidth, height: dimensions.barHeight }; }
  }
  const document = { documentElement: new Element('html'), activeElement: null as Element | null, createElement: (tag: string) => new Element(tag), createElementNS: (_ns: string, tag: string) => new Element(tag) };
  replaceGlobals(t, { document, innerWidth: 360, innerHeight: 640 });
  const node = { isConnected: true };
  const range: any = { startContainer: node, endContainer: node, startOffset: 0, endOffset: 4, cloneRange() { return this; }, getClientRects: () => [{ left: 10, right: 200, top: 100, bottom: 124 }] };
  const get = () => { const host = document.documentElement.children[0], row = host.shadow!.children[1]; return { host, row, buttons: row.children.slice(0, 4), status: row.children[4] }; };
  const rich = () => {
    const host = document.documentElement.children.find(child => child.tag === 'div' && child.shadow)!;
    const row = host.shadow!.children[1], dialog = host.shadow!.children.find(child => child.className === 'more');
    const named = (name: string) => host.shadow!.querySelectorAll('button').find(control => control.attrs.get('aria-label') === name)!;
    return { host, row, dialog, named, input: dialog?.querySelectorAll('input')[0], controls: row.querySelectorAll('button'), status: row.children.find(child => child.className === 'status')! };
  };
  return { range, get, rich, dimensions, document, Element };
}

test('bar controlled DOM has four named icon buttons, blocks untrusted clicks and confirms a durable Keep', async t => {
  const e = barDom(t), gate = deferred<boolean>(); let calls = 0;
  const bar = createSelectionBar(() => { calls++; return gate.promise; }); t.after(bar.hide); bar.show(e.range);
  const { host, row, buttons, status } = e.get();
  assert.equal(host.shadow!.mode, 'closed');
  assert.deepEqual(buttons.map(b => b.attrs.get('aria-label')), ['Keep', 'Note', 'Ask', 'Simulate it']);
  assert.deepEqual(buttons.map(b => b.title), ['Keep', 'Note', 'Ask', 'Simulate it']);
  assert.ok(buttons.every(b => b.children[0].tag === 'svg'));
  buttons[0].emit('click'); assert.equal(calls, 0);
  buttons[0].emit('click', { isTrusted: true }); assert.equal(calls, 1, 'trusted activation invokes the route synchronously');
  assert.ok(buttons.every(b => b.disabled)); assert.equal(status.hidden, true);
  gate.resolve(true); await settle(); assert.equal(status.textContent, 'Kept'); assert.ok(buttons.every(b => b.hidden));
  bar.show(e.range); bar.focus(); const second = e.get(); second.row.emit('keydown', { isTrusted: true, key: 'ArrowRight' });
  assert.equal(second.host.shadow!.activeElement, second.buttons[1]);
  second.row.emit('keydown', { isTrusted: true, key: 'End' }); assert.equal(second.host.shadow!.activeElement, second.buttons[3]);
  assert.equal(row.attrs.get('role'), 'toolbar');
});

test('bar ignores stale completion after dismissal and keeps a refused action retryable', async t => {
  const e = barDom(t), gate = deferred<boolean>();
  const bar = createSelectionBar(() => gate.promise); t.after(bar.hide); bar.show(e.range);
  e.get().buttons[0].emit('click', { isTrusted: true }); bar.hide(); bar.show(e.range);
  gate.resolve(true); await settle(); assert.equal(e.get().status.hidden, true);
  bar.hide();
  const refused = createSelectionBar(async () => false); t.after(refused.hide); refused.show(e.range);
  const controls = e.get(); controls.buttons[0].emit('click', { isTrusted: true }); await settle();
  assert.equal(controls.status.textContent, 'The action did not finish; please try again.'); assert.ok(controls.buttons.every(b => !b.disabled && !b.hidden));
});

test('command status uses the existing quiet region without invoking an action', t => {
  const e = barDom(t); let calls = 0;
  const bar = createSelectionBar(async () => { calls++; return true; }); t.after(bar.hide);
  bar.show(e.range); bar.commandStatus('Kept');
  assert.equal(e.get().status.textContent, 'Kept'); assert.equal(e.get().status.attrs.get('aria-live'), 'polite');
  assert.ok(e.get().buttons.every(button => button.hidden)); assert.equal(calls, 0);
  bar.hide(); bar.commandStatus('Try again'); assert.equal(calls, 0);
});

test('bar reports a rejected action with a sentence and leaves the four controls retryable', async t => {
  const e = barDom(t);
  const bar = createSelectionBar(async () => { throw new Error('Connection failed'); }); t.after(bar.hide); bar.show(e.range);
  const controls = e.get(); controls.buttons[2].emit('click', { isTrusted: true }); await settle();
  assert.equal(controls.status.textContent, 'The action did not finish; please try again.');
  assert.equal(controls.status.hidden, false); assert.ok(controls.buttons.every(b => !b.disabled && !b.hidden));
});

const offers = [
  { id: 'simulation-1', label: 'Simulate it', kind: 'suggestion' as const },
  { id: 'example-2', label: 'Worked example', kind: 'suggestion' as const },
  { id: 'explain-3', label: 'Explain simply', kind: 'suggestion' as const },
  { id: 'define-4', label: 'Define', kind: 'define' as const },
];
function model(): SelectionBarModel {
  const s = snapshot();
  return { target: { document: s.document, revision: s.revision, anchor: s.anchor! }, scope: 'passage', offers,
    more: [{ id: 'evidence-5', label: 'What supports this', kind: 'suggestion' }, { id: 'notes-6', label: 'Connect to my notes', kind: 'suggestion' }, { id: 'critique-7', label: 'Critique it', kind: 'suggestion' }, { id: 'define-8', label: 'Define a term', kind: 'define' }] };
}
function actions(overrides: Partial<SelectionBarCallbacks> = {}): SelectionBarCallbacks {
  return { highlight: async () => true, note: async () => true, offer: async () => true, question: async () => true, ...overrides };
}

test('local offer model freezes exact identities, preserves host rank, never pads and limits a term to Define', () => {
  for (const count of [0, 1, 2, 3, 4]) {
    const input = model(), current = selectionBarModel({ ...input, offers: input.offers.slice(0, count) });
    assert.equal(current.offers.length, Math.min(3, count));
    assert.deepEqual(current.offers.map(offer => offer.id), offers.slice(0, Math.min(3, count)).map(offer => offer.id));
    assert.ok(Object.isFrozen(current) && Object.isFrozen(current.target) && Object.isFrozen(current.target.anchor) && Object.isFrozen(current.offers));
  }
  const word = selectionBarModel({ ...model(), scope: 'word' });
  assert.deepEqual(word.offers.map(offer => offer.id), ['define-4']);
  assert.equal(selectionBarModel({ ...model(), scope: 'word', offers: offers.slice(0, 3) }).offers.length, 0, 'missing Define never falls back to a different form');
  const deduplicated = selectionBarModel({ ...model(), offers: [offers[0], offers[0], { ...offers[1], label: '  ' }, offers[2]], more: [offers[0], offers[3]] });
  assert.deepEqual(deduplicated.offers.map(offer => offer.id), ['simulation-1', 'explain-3']);
  assert.deepEqual(deduplicated.more.map(offer => offer.id), ['define-4']);
  const original = structuredClone(model()); const frozen = selectionBarModel(original);
  (original.target as { document: string }).document = 'other'; (original.target.anchor as { exact: string }).exact = 'changed';
  (original.offers[0] as { id: string }).id = 'new';
  assert.equal(frozen.target.document, 'capture-one'); assert.equal(frozen.target.anchor.exact, 'passage'); assert.equal(frozen.offers[0].id, 'simulation-1');
});

test('accepted bar exposes Highlight, Note, ordered unpadded offers and More only with an explicit host model', t => {
  const e = barDom(t), bar = createSelectionBar(actions()); t.after(bar.hide);
  bar.show(e.range); assert.equal(bar.visible(), false, 'no model means no fabricated target or offers');
  for (const count of [0, 1, 2, 3, 4]) {
    bar.show(e.range, { ...model(), offers: offers.slice(0, count) });
    assert.deepEqual(e.rich().controls.map(control => control.attrs.get('aria-label')), ['Highlight', 'Add a note', ...offers.slice(0, Math.min(3, count)).map(offer => offer.label), 'More suggestions']);
    assert.ok(e.rich().row.children.some(child => child.attrs.get('role') === 'separator'));
    assert.equal(e.rich().host.shadow!.mode, 'closed');
    assert.ok(e.rich().controls.slice(2, -1).every(control => control.className === ''), 'rank gets no special resting class');
  }
  bar.show(e.range, { ...model(), scope: 'word' });
  assert.deepEqual(e.rich().controls.map(control => control.attrs.get('aria-label')), ['Highlight', 'Add a note', 'Define', 'More suggestions']);
  assert.equal(e.rich().named('Define').className, 'word-define', 'specific accepted Word treatment does not emphasize passage rank');
});

test('each accepted action synchronously delivers its frozen exact target once and never substitutes a generic action', async t => {
  const e = barDom(t), calls: unknown[] = [], gate = deferred<boolean>();
  const bar = createSelectionBar(actions({ highlight: target => { calls.push(['highlight', target]); return gate.promise; },
    note: async target => { calls.push(['note', target]); return true; }, offer: async (target, offer) => { calls.push(['offer', target, offer]); return true; } })); t.after(bar.hide);
  const original = structuredClone(model()); bar.show(e.range, original);
  const first = e.rich(); first.named('Highlight').emit('click'); assert.equal(calls.length, 0);
  first.named('Highlight').emit('click', { isTrusted: true });
  assert.deepEqual(calls, [['highlight', model().target]], 'callback is synchronous and target-exact');
  first.named('Highlight').emit('click', { isTrusted: true }); first.named('Add a note').emit('click', { isTrusted: true });
  assert.equal(calls.length, 1); assert.ok(first.controls.slice(0, -1).every(control => control.disabled));
  assert.equal(first.named('More suggestions').attrs.get('aria-disabled'), 'true');
  gate.resolve(true); await settle(); assert.equal(bar.visible(), false);
  bar.show(e.range, model()); first.named('Highlight').emit('click', { isTrusted: true }); assert.equal(calls.length, 1, 'old detached control cannot trigger the new target');
  e.rich().named('Add a note').emit('click', { isTrusted: true }); await settle();
  assert.deepEqual(calls[1], ['note', model().target]);
  bar.show(e.range, original); (original.offers[1] as { id: string }).id = 'changed';
  e.rich().named('Worked example').emit('click', { isTrusted: true }); await settle();
  assert.deepEqual(calls[2], ['offer', model().target, offers[1]]);
  bar.show(e.range, { ...model(), scope: 'word' }); e.rich().named('Define').emit('click', { isTrusted: true }); await settle();
  assert.deepEqual(calls[3], ['offer', model().target, offers[3]]);
});

test('More is a named dialog; Escape closes it first and returns focus, then dismisses to the prior page control', t => {
  const e = barDom(t), page = new e.Element('button'); e.document.documentElement.append(page); page.focus();
  const bar = createSelectionBar(actions()); t.after(bar.hide); bar.show(e.range, model());
  const more = e.rich().named('More suggestions'); more.emit('click', { isTrusted: true });
  assert.equal(more.attrs.get('aria-haspopup'), 'dialog'); assert.equal(more.attrs.get('aria-expanded'), 'true');
  let current = e.rich(); assert.equal(current.dialog!.attrs.get('role'), 'dialog'); assert.equal(current.dialog!.attrs.get('aria-label'), 'More suggestions');
  assert.equal(current.host.shadow!.activeElement, current.named('Close'));
  current.input!.focus(); const escaped = current.input!.emit('keydown', { isTrusted: true, key: 'Escape' });
  assert.ok(escaped.stopped && escaped.prevented); assert.equal(bar.visible(), true); assert.equal(e.rich().dialog, undefined);
  assert.equal(more.attrs.get('aria-expanded'), 'false'); assert.equal(e.rich().host.shadow!.activeElement, more);
  more.emit('click', { isTrusted: true }); e.rich().named('Close').emit('click', { isTrusted: true }); assert.equal(e.rich().dialog, undefined);
  current = e.rich(); current.row.emit('keydown', { isTrusted: true, key: 'Escape' });
  assert.equal(bar.visible(), false); assert.equal(e.document.activeElement, page);
});

test('trusted numeric shortcuts invoke ranked callbacks directly, once, while typing and composition stay untouched', async t => {
  const e = barDom(t), calls: string[] = [], gate = deferred<boolean>();
  const bar = createSelectionBar(actions({ offer: (_target, offer) => { calls.push(offer.id); return gate.promise; } })); t.after(bar.hide);
  bar.show(e.range, model()); bar.focus();
  for (const properties of [{}, { isTrusted: true, repeat: true }, { isTrusted: true, isComposing: true }, { isTrusted: true, ctrlKey: true }, { isTrusted: true, metaKey: true }, { isTrusted: true, altKey: true }, { isTrusted: true, shiftKey: true }]) {
    const event = e.rich().row.emit('keydown', { key: '2', ...properties }); assert.equal(event.prevented, false);
  }
  assert.equal(calls.length, 0);
  const event = e.rich().row.emit('keydown', { isTrusted: true, key: '2' }); assert.ok(event.prevented && event.stopped);
  assert.deepEqual(calls, ['example-2']); e.rich().row.emit('keydown', { isTrusted: true, key: '3' }); assert.equal(calls.length, 1);
  gate.resolve(false); await settle();
  e.rich().row.emit('keydown', { isTrusted: true, key: '/' }); let current = e.rich(); assert.equal(current.host.shadow!.activeElement, current.input);
  for (const key of ['1', '2', '3', '/', 'Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab']) {
    const typed = current.input!.emit('keydown', { isTrusted: true, key }); assert.equal(typed.prevented, false, key); assert.equal(typed.stopped, false, key);
  }
  assert.equal(calls.length, 1);
  const editable = new e.Element('div'); editable.isContentEditable = true; current.dialog!.append(editable); editable.focus();
  assert.equal(editable.emit('keydown', { isTrusted: true, key: '1' }).prevented, false);
  assert.equal(calls.length, 1);
});

test('More routes each explicit offer and exact custom text without sending on open or typing; refusal preserves draft', async t => {
  const e = barDom(t), calls: unknown[] = [];
  const bar = createSelectionBar(actions({ offer: async (target, offer) => { calls.push(['offer', target, offer]); return true; }, question: async (target, text) => { calls.push(['question', target, text]); return false; } })); t.after(bar.hide);
  for (const offer of model().more) {
    bar.show(e.range, model()); e.rich().named('More suggestions').emit('click', { isTrusted: true });
    e.rich().named(offer.label).emit('click', { isTrusted: true }); await settle();
    assert.deepEqual(calls.at(-1), ['offer', model().target, offer]);
  }
  const before = calls.length;
  bar.show(e.range, model()); e.rich().named('More suggestions').emit('click', { isTrusted: true }); const input = e.rich().input!; input.focus();
  input.value = '  Why 1 / 2?  '; input.emit('input', { isTrusted: true }); assert.equal(calls.length, before);
  for (const properties of [{}, { isTrusted: true, isComposing: true }, { isTrusted: true, repeat: true }, { isTrusted: true, shiftKey: true }]) input.emit('keydown', { key: 'Enter', ...properties });
  assert.equal(calls.length, before);
  input.emit('keydown', { isTrusted: true, key: 'Enter' }); input.emit('keydown', { isTrusted: true, key: 'Enter' }); assert.equal(calls.length, before + 1);
  await settle(); assert.deepEqual(calls.at(-1), ['question', model().target, '  Why 1 / 2?  ']);
  assert.equal(e.rich().input!.value, '  Why 1 / 2?  '); assert.equal(e.rich().input!.disabled, false); assert.equal(e.rich().host.shadow!.activeElement, input);
  assert.equal(e.rich().status.textContent, 'The action did not finish; please try again.');
  input.value = '  '; input.emit('keydown', { isTrusted: true, key: 'Enter' }); assert.equal(calls.length, before + 1);
});

test('geometry uses verified article bounds, flips the entire cluster and refuses unsafe or invisible selections', () => {
  for (const viewport of [360, 440, 1280]) {
    const column = { left: 30, right: viewport - 50 };
    for (const rect of [{ left: 20, right: 120, top: 1, bottom: 20 }, { left: viewport - 70, right: viewport - 55, top: 700, bottom: 730 }]) {
      const placed = selectionBarPosition([rect], 200, 50, viewport, 800, column)!;
      assert.ok(placed); assert.ok(placed.left >= column.left && placed.left + 200 <= column.right);
      assert.ok(placed.top >= rect.bottom + 8 || placed.top + 50 <= rect.top - 8);
    }
  }
  const rect = [{ left: 90, right: 260, top: 700, bottom: 740 }];
  assert.deepEqual(selectionBarPosition(rect, 300, 300, 1280, 800, { left: 80, right: 760 }), { left: 90, top: 392 });
  for (const column of [{ left: NaN, right: 800 }, { left: 500, right: 400 }, { left: 100, right: 110 }, { left: 1300, right: 1500 }]) assert.equal(selectionBarPosition(rect, 300, 50, 1280, 800, column), null);
  assert.equal(selectionBarPosition([{ left: -100, right: -10, top: 100, bottom: 120 }], 144, 40, 360, 800), null);
  assert.equal(selectionBarPosition([{ left: 400, right: 600, top: 100, bottom: 120 }], 144, 40, 360, 800), null);
  assert.equal(selectionBarPosition(rect, NaN, 40, 1280, 800), null);
});

test('dialog geometry uses measured dimensions and safely returns to toolbar if expanded space is unavailable', t => {
  const e = barDom(t), bar = createSelectionBar(actions()); t.after(bar.hide);
  e.dimensions.barWidth = 200; e.dimensions.dialogWidth = 280;
  bar.show(e.range, { ...model(), articleBounds: { left: 30, right: 330 } });
  e.rich().named('More suggestions').emit('click', { isTrusted: true });
  let current = e.rich(); assert.ok(current.dialog);
  const [left] = current.host.style.left as string[]; assert.equal(left, '30px');
  assert.equal(current.dialog!.style.top, '48px'); assert.equal(current.dialog!.style.maxWidth, '300px');
  e.dimensions.dialogHeight = 600; bar.position(); current = e.rich();
  assert.equal(current.dialog, undefined); assert.equal(bar.visible(), true); assert.equal(current.host.shadow!.activeElement, current.named('More suggestions'));
  e.range.startContainer.isConnected = false; bar.position(); assert.equal(bar.visible(), false);
});

test('accepted callbacks reject safely and stale completions cannot change a replacement selection', async t => {
  const e = barDom(t), gate = deferred<boolean>();
  const bar = createSelectionBar(actions({ highlight: () => gate.promise, note: () => { throw new Error('Unavailable'); } })); t.after(bar.hide);
  bar.show(e.range, model()); e.rich().named('Highlight').emit('click', { isTrusted: true }); bar.hide();
  bar.show(e.range, { ...model(), target: { ...model().target, revision: 4 } }); gate.resolve(true); await settle();
  assert.equal(bar.visible(), true); assert.equal(e.rich().status.hidden, true);
  e.rich().named('Add a note').emit('click', { isTrusted: true }); await settle();
  assert.equal(e.rich().status.hidden, false); assert.ok(e.rich().controls.every(control => !control.disabled));
  const exact: any = { rangeCount: 1, isCollapsed: false, getRangeAt: () => e.range };
  assert.equal(bar.matches(exact), true);
  assert.equal(bar.matches({ ...exact, getRangeAt: () => ({ ...e.range, startOffset: 1 }) }), false);
  assert.equal(bar.matches({ ...exact, isCollapsed: true }), false);
});

test('near-viewport selection cannot open a dialog too short to reach a full control', t => {
  const e = barDom(t), bar = createSelectionBar(actions()); t.after(bar.hide);
  e.range.getClientRects = () => [{ left: 10, right: 200, top: 70, bottom: 570 }];
  e.dimensions.dialogHeight = 14; // Browser can shrink overflow to padding/border only.
  bar.show(e.range, model()); assert.equal(bar.visible(), true);
  e.rich().named('More suggestions').emit('click', { isTrusted: true });
  const current = e.rich(); assert.equal(current.dialog, undefined); assert.equal(bar.visible(), true);
  assert.equal(current.host.shadow!.activeElement, current.named('More suggestions'));
  assert.equal(current.named('More suggestions').attrs.get('aria-expanded'), 'false');
});

test('callback observes keyboard focus before controls disable, and synchronous host replacement is not disabled', async t => {
  const e = barDom(t); let bar: ReturnType<typeof createSelectionBar>; let observed = false;
  bar = createSelectionBar(actions({ highlight: async () => {
    observed = bar.focused() && !e.rich().named('Highlight').disabled;
    bar.show(e.range, { ...model(), target: { ...model().target, revision: 4 } });
    return true;
  } })); t.after(bar.hide);
  bar.show(e.range, model()); bar.focus(); e.rich().named('Highlight').emit('click', { isTrusted: true });
  assert.equal(observed, true); assert.ok(e.rich().controls.every(control => !control.disabled));
  await settle(); assert.equal(bar.visible(), true); assert.equal(e.rich().status.hidden, true);
});

test('disconnected ranges refuse activation, and retargeted editable events never pick an offer', t => {
  const e = barDom(t); let calls = 0;
  const bar = createSelectionBar(actions({ offer: async () => { calls++; return true; }, highlight: async () => { calls++; return true; } })); t.after(bar.hide);
  bar.show(e.range, model()); bar.focus(); const input = new e.Element('input');
  const event = e.rich().row.emit('keydown', { isTrusted: true, key: '1', composedPath: () => [input, e.rich().row] });
  assert.equal(event.prevented, false); assert.equal(calls, 0);
  e.range.endContainer.isConnected = false; e.rich().named('Highlight').emit('click', { isTrusted: true });
  assert.equal(calls, 0); assert.equal(bar.visible(), false);
});

test('late refusal does not steal focus from a newer page interaction', async t => {
  const e = barDom(t), gate = deferred<boolean>(), page = new e.Element('input'); e.document.documentElement.append(page);
  const bar = createSelectionBar(actions({ highlight: () => gate.promise })); t.after(bar.hide);
  bar.show(e.range, model()); bar.focus(); const current = e.rich(); current.named('Highlight').emit('click', { isTrusted: true });
  current.host.shadow!.activeElement = null; page.focus(); gate.resolve(false); await settle();
  assert.equal(e.document.activeElement, page); assert.equal(current.host.shadow!.activeElement, null);
});

test('pending More action keeps Close usable and Escape returns to a focusable opener without dispatching twice', async t => {
  const e = barDom(t); let calls = 0;
  for (const dismiss of ['Close', 'Escape']) {
    const gate = deferred<boolean>();
    const bar = createSelectionBar(actions({ offer: () => { calls++; return gate.promise; } })); t.after(bar.hide);
    bar.show(e.range, model()); e.rich().named('More suggestions').emit('click', { isTrusted: true });
    let current = e.rich(); current.named('What supports this').focus(); current.named('What supports this').emit('click', { isTrusted: true });
    assert.equal(current.named('Close').disabled, false); assert.equal(current.named('What supports this').disabled, true);
    assert.equal(current.host.shadow!.activeElement, current.named('Close'), 'pending action moves focus to live dismissal control');
    assert.equal(current.named('More suggestions').disabled, false); assert.equal(current.named('More suggestions').attrs.get('aria-disabled'), 'true');
    if (dismiss === 'Close') current.named('Close').emit('click', { isTrusted: true });
    else current.dialog!.emit('keydown', { isTrusted: true, key: 'Escape' });
    current = e.rich(); assert.equal(current.dialog, undefined); assert.equal(current.host.shadow!.activeElement, current.named('More suggestions'));
    const before = calls; current.named('More suggestions').emit('click', { isTrusted: true }); current.named('Highlight').emit('click', { isTrusted: true });
    assert.equal(current.dialog, undefined); assert.equal(calls, before);
    gate.resolve(false); await settle(); assert.equal(current.named('More suggestions').attrs.get('aria-disabled'), 'false');
    current.named('More suggestions').emit('click', { isTrusted: true }); assert.ok(e.rich().dialog); bar.hide();
  }
  assert.equal(calls, 2);
});

test('native Enter default-action model cannot toggle More or retry a refused action on held-key repeats', async t => {
  const e = barDom(t); let calls = 0;
  const bar = createSelectionBar(actions({ highlight: async () => { calls++; return false; } })); t.after(bar.hide);
  bar.show(e.range, model());
  const press = (control: ReturnType<typeof e.rich>['controls'][number], repeat: boolean) => {
    const key = control.emit('keydown', { isTrusted: true, key: 'Enter', repeat });
    if (!key.prevented && !control.disabled) control.emit('click', { isTrusted: true });
    return key;
  };
  const more = e.rich().named('More suggestions'); more.focus(); press(more, false); assert.ok(e.rich().dialog);
  more.focus(); assert.equal(press(more, true).prevented, true); assert.ok(e.rich().dialog, 'held Enter cannot close More through a default click');
  e.rich().named('Close').emit('click', { isTrusted: true });
  const highlight = e.rich().named('Highlight'); highlight.focus(); press(highlight, false); await settle(); assert.equal(calls, 1);
  highlight.focus(); press(highlight, true); await settle(); assert.equal(calls, 1, 'settled refusal does not allow held Enter to retry');
  press(highlight, false); await settle(); assert.equal(calls, 2, 'a fresh deliberate Enter may retry');
  const spaceRepeat = highlight.emit('keydown', { isTrusted: true, key: ' ', repeat: true }); assert.equal(spaceRepeat.prevented, true);
});