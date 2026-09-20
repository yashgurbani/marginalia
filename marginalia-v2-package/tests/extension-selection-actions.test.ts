import test from 'node:test';
import assert from 'node:assert/strict';
import { actionMatches, retainedKeep, sameSelection, validContentAction, type ActionRequest } from '../extension/lib/selection-actions.ts';
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
  class Element {
    parent: Element | null = null; children: Element[] = []; attrs = new Map<string, string>(); listeners = new Map<string, ((e: any) => void)[]>();
    tag: string; id = ''; className = ''; textContent = ''; title = ''; type = ''; hidden = false; disabled = false; activeElement: Element | null = null;
    mode = ''; shadow?: Element;
    style: Record<string, unknown> & { setProperty(k: string, v: string, priority: string): void } = { setProperty(k, v, priority) { this[k] = [v, priority]; } };
    constructor(tag: string) { this.tag = tag; }
    get isConnected(): boolean { return this === document.documentElement || !!this.parent?.isConnected; }
    append(...nodes: Element[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    attachShadow({ mode }: { mode: string }) { this.shadow = new Element('shadow'); this.shadow.parent = this; this.shadow.mode = mode; return this.shadow; }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); }
    addEventListener(type: string, listener: (e: any) => void) { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list); }
    emit(type: string, properties = {}) { const e = { isTrusted: false, preventDefault() {}, ...properties }; for (const listener of this.listeners.get(type) ?? []) listener(e); }
    focus() { let root: Element | null = this; while (root && root.tag !== 'shadow') root = root.parent; if (root) root.activeElement = this; }
    getBoundingClientRect() { return { width: 144, height: 40 }; }
  }
  const document = { documentElement: new Element('html'), createElement: (tag: string) => new Element(tag), createElementNS: (_ns: string, tag: string) => new Element(tag) };
  replaceGlobals(t, { document, innerWidth: 360, innerHeight: 640 });
  const node = { isConnected: true };
  const range: any = { startContainer: node, endContainer: node, startOffset: 0, endOffset: 4, cloneRange() { return this; }, getClientRects: () => [{ left: 10, right: 200, top: 100, bottom: 124 }] };
  const get = () => { const host = document.documentElement.children[0], row = host.shadow!.children[1]; return { host, row, buttons: row.children.slice(0, 4), status: row.children[4] }; };
  return { range, get };
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
  assert.equal(controls.status.textContent, 'Try again'); assert.ok(controls.buttons.every(b => !b.disabled && !b.hidden));
});

test('command status uses the existing quiet region without invoking an action', t => {
  const e = barDom(t); let calls = 0;
  const bar = createSelectionBar(async () => { calls++; return true; }); t.after(bar.hide);
  bar.show(e.range); bar.commandStatus('Kept');
  assert.equal(e.get().status.textContent, 'Kept'); assert.equal(e.get().status.attrs.get('aria-live'), 'polite');
  assert.ok(e.get().buttons.every(button => button.hidden)); assert.equal(calls, 0);
  bar.hide(); bar.commandStatus('Try again'); assert.equal(calls, 0);
});
