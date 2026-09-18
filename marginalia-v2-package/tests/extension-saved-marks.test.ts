import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dom, replaceGlobals } from './t05-dom.ts';
import { ReaderJournal, type JournalState } from '../ui/journal.ts';
import { ReaderStore } from '../daemon/store.ts';
import { validSavedMarks } from '../extension/lib/protocol.ts';

const boundary: any = {};
(globalThis as any).__savedMarksTest = boundary;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'wxt/browser') return { url: 'marks:browser', shortCircuit: true };
    if (specifier === 'wxt/utils/define-content-script') return { url: 'marks:script', shortCircuit: true };
    if (context.parentURL?.endsWith('/extension/entrypoints/content.ts') && specifier === '../lib/capture.ts') return { url: 'marks:capture', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    const code: Record<string, string> = {
      'marks:browser': 'export const browser=globalThis.__savedMarksTest.browser;',
      'marks:script': 'export const defineContentScript=value=>value;',
      'marks:capture': 'export const captureSelection=(document,revision)=>({...globalThis.__savedMarksTest.snapshot,document,revision}); export const locate=anchor=>globalThis.__savedMarksTest.locate(anchor); export const projectPage=()=>({text:globalThis.__savedMarksTest.snapshot.capture.text,nodes:[]});',
    };
    return code[url] ? { format: 'module', source: code[url], shortCircuit: true } : next(url, context);
  },
});

test('content saved maps follow journal reload/helper sync, refuse stale payloads and clear on exclusion/unmount/navigation', async t => {
  const e = dom(t), marks = new Map<string, any>(), events = new Map<string, Function>();
  let listener: Function, invalidated: Function, allowed = true;
  const source = e.document.createTextNode('Original passage'); e.document.body.append(source);
  const anchor = { exact: source.textContent, prefix: '', suffix: '', start: 0, end: source.textContent.length };
  const capture = { url: 'https://source.example/page', title: 'Original', pageType: 'article', text: source.textContent, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'dom-safe-text-v1' };
  boundary.snapshot = { capture, sections: [{ title: 'Original', start: 0, end: capture.text.length }], anchor: null, position: 0 };
  boundary.locate = (value: typeof anchor) => value.exact === source.textContent ? { startContainer: source, endContainer: source } : null;
  boundary.browser = { runtime: { id: 'extension', onMessage: { addListener(fn: Function) { listener = fn; } }, sendMessage: async () => ({ ok: true, value: { allowed } }) } };
  const view: any = {}; view.top = view;
  replaceGlobals(t, { window: view, location: new URL(capture.url), innerHeight: 900, CSS: { highlights: marks }, Highlight: class { ranges: unknown[]; constructor(...ranges: unknown[]) { this.ranges = ranges; } }, MutationObserver: class { observe() {} disconnect() {} } });
  (e.document as any).createRange = () => ({});
  const content = (await import('../extension/entrypoints/content.ts')).default;
  (content as any).main({ addEventListener(_target: unknown, type: string, fn: Function) { events.set(type, fn); }, onInvalidated(fn: Function) { invalidated = fn; } });
  t.after(() => invalidated());
  const message = (packet: object, sender = { id: 'extension' }) => new Promise<any>(resolve => listener({ version: 1, ...packet }, sender, (reply: any) => resolve(reply.value)));
  await message({ type: 'activate', panel: true });
  const identity = await message({ type: 'identity' });
  let saved: JournalState | undefined;
  const persistence = { load: async () => structuredClone(saved), save: async (state: JournalState) => { saved = structuredClone(state); } };
  let journal = new ReaderJournal(persistence);
  const helper = new ReaderStore(':memory:'); t.after(() => helper.close());
  await journal.change({ id: 'keep', kind: 'keep', threadId: 'thread', capture, anchor });
  const packet = () => ({ type: 'saved-marks', document: identity.document, url: capture.url, revision: 1, marks: journal.state.threads.filter(t => !t.deletedAt).map(t => ({ anchor: t.anchor, highlighted: t.highlighted })) });
  assert.equal(await message(packet()), true);
  assert.equal(marks.get('marginalia-kept').ranges.length, 1); assert.equal(marks.get('marginalia-highlighted-yellow').ranges.length, 0);
  await journal.change({ id: 'tint', kind: 'highlight', threadId: 'thread', highlighted: true, expectedRevision: 1 });
  await journal.sync(async change => { helper.apply(change); }, async () => helper.list());
  journal = new ReaderJournal(persistence); await journal.load();
  await message(packet()); assert.equal(marks.get('marginalia-highlighted-yellow').ranges[0].startContainer, source);
  await message({ type: 'highlight', document: identity.document, anchor });
  assert.equal(marks.has('marginalia-selection'), true); assert.equal(marks.get('marginalia-highlighted-yellow').ranges.length, 1);
  for (const wrong of [{ document: 'wrong' }, { url: 'https://other.example/' }, { revision: 0 }]) assert.equal(await message({ ...packet(), ...wrong }), false);
  assert.equal(await message(packet(), { id: 'spoof' }), undefined);
  await journal.change({ id: 'untint', kind: 'highlight', threadId: 'thread', highlighted: false, expectedRevision: 2 });
  await journal.sync(async change => { helper.apply(change); }, async () => helper.list());
  await message(packet()); assert.equal(marks.get('marginalia-highlighted-yellow').ranges.length, 0); assert.equal(marks.get('marginalia-kept').ranges.length, 1);
  await message({ ...packet(), marks: [] }); assert.equal(marks.get('marginalia-kept').ranges.length, 0);
  await message(packet()); await message({ type: 'excluded' }); assert.equal(marks.size, 0);
  await message({ type: 'activate', panel: true });
  await message({ ...packet(), revision: 2 }); events.get('pagehide')!(); assert.equal(marks.size, 0);
  await message({ type: 'activate', panel: true });
  allowed = false; assert.equal(await message({ ...packet(), revision: 3 }), false); assert.equal(marks.size, 0);
  assert.equal(source.textContent, capture.text); assert.equal(e.document.body.childNodes.includes(source), true);
});

test('saved mark protocol bounds selector count, total text, identities and flags', () => {
  const mark = { anchor: { exact: 'word', prefix: '', suffix: '', start: 0, end: 4 }, highlighted: true };
  const packet = { document: 'document', url: 'https://example.org/', revision: 1, marks: [mark] };
  assert.equal(validSavedMarks(packet), true);
  for (const change of [{ marks: Array(501).fill(mark) }, { revision: -1 }, { document: '' }, { url: 'file:///private' }, { marks: [{ ...mark, highlighted: 'yes' }] }, { marks: Array(100).fill({ ...mark, anchor: { ...mark.anchor, exact: 'a'.repeat(20000), end: 20000 } }) }]) assert.equal(validSavedMarks({ ...packet, ...change }), false);
});
