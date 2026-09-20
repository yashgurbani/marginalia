import test from 'node:test';
import assert from 'node:assert/strict';
import { dom, replaceGlobals, type TestElement } from './t05-dom.ts';
import { mountAskingCard, mountAskingDraft } from '../ui/asking/mount.ts';

function fixture(t: import('node:test').TestContext, phase: string, initial: any = {}) {
  const d = dom(t); replaceGlobals(t, { crypto: { randomUUID: () => 'asking-test' } });
  let state: any = { phase, message: '', sending: phase === 'sending', submitted: phase === 'sending', canAsk: true,
    canCancel: phase === 'sending', canRetry: false, canCheck: false, ...initial };
  let cancelled = 0, closed = 0, checked = 0, asked = 0; const repairs: string[] = [];
  const listeners = new Set<(value: any) => void>();
  const flow: any = {
    getBinding: () => ({ captureId: 'capture', threadId: 'thread', anchor: { exact: 'Passage', start: 0, end: 7, prefix: '', suffix: '' } }),
    getState: () => state, getAccess: () => ({ surface: 'native-panel', paired: true, canAuthorize: true, excluded: false }),
    subscribe(listener: (value: any) => void) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    reconcile() {}, openAsk() {}, ask: async () => { asked++; }, cancel() { cancelled++; }, refresh: async () => { checked++; }, retry: async () => {},
    invalidate() {}, close() { closed++; state = { ...state, phase: 'closed' }; }, dismissPreview() {}, choose: async () => { throw new Error('unused'); }, followup: async () => {},
  };
  const mounted = mountAskingCard(d.root as unknown as HTMLElement, {
    flow, onRepair: (blocker: string) => { repairs.push(blocker); }, mountConsent: () => ({ update() {}, destroy() {} }), mountReply: () => ({ getState: () => ({ parameters: {}, view: {} }), destroy() {} }),
    replyOptions: () => ({ capabilities: ['samples'] }),
  } as any);
  t.after(() => mounted.destroy());
  const root = d.root.querySelector('.m-asking')!;
  return { root, repairs, checked: () => checked, asked: () => asked, cancelled: () => cancelled, closed: () => closed };
}

test('Escape during sending asks once before dismissal and never emits cancel', t => {
  const h = fixture(t, 'sending');
  const first = h.root.fire('keydown', { key: 'Escape', stopPropagation() {}, target: h.root });
  assert.equal(first.defaultPrevented, true); assert.equal(h.root.isConnected, true); assert.equal(h.cancelled(), 0); assert.equal(h.closed(), 0);
  assert.match(h.root.textContent, /Press Escape again/);
  h.root.fire('keydown', { key: 'Escape', stopPropagation() {}, target: h.root });
  assert.equal(h.root.isConnected, false); assert.equal(h.cancelled(), 0); assert.equal(h.closed(), 1);
});

test('drafting Escape dismisses immediately and paragraph status text has no prohibited aria-label', t => {
  const h = fixture(t, 'suggestions');
  assert.equal(h.root.querySelectorAll('p').some(node => ['Reviewed plan', 'Elapsed time'].includes(node.getAttribute('aria-label') ?? '')), false);
  h.root.fire('keydown', { key: 'Escape', stopPropagation() {}, target: h.root });
  assert.equal(h.root.isConnected, false); assert.equal(h.cancelled(), 0);
});


test('draft offers reach review directly', async t => {
  const d = dom(t);
  const chosen: unknown[][] = [];
  const intents = ['define', 'derive', 'diagram', 'simulate'] as const;
  const mounted = mountAskingDraft(d.root as unknown as HTMLElement, {
    id: 'draft', question: 'Retained question', context: '',
    suggestions: intents.map(intent => ({ id: intent, label: intent, intent, question: intent + ' question', time: 'quick' })),
    onEdit() {}, async onChoose(...args) { chosen.push(args); }, onMore() {}, async onIdeas() { return []; },
    onClose() {}, onKeep() {}, onPark() {},
  });
  t.after(() => mounted.destroy());
  assert.equal(d.root.querySelector('textarea')!.value, 'Retained question');
  mounted.chooseIndex(2);
  await Promise.resolve();
  assert.deepEqual(chosen[0]?.slice(0, 3), ['diagram', 'diagram question', '']);
});

for (const blocker of ['excluded', 'unsupported', 'browser-owned-required', 'unpaired', 'helper-off', 'disconnected', 'signed-out', 'runtime-unavailable', 'unsaved-context', 'invalid-response']) test('C5 card repair navigates once for ' + blocker, t => {
  const h = fixture(t, blocker === 'excluded' ? 'excluded' : 'unavailable', { blocker });
  const repair = h.root.querySelector('.m-asking-repair')!;
  assert.equal(repair.hidden, false); repair.click();
  assert.deepEqual(h.repairs, [blocker]); assert.equal(h.asked(), 0); assert.equal(h.checked(), 0);
});
test('C5 invalid submitted response checks its existing identity without asking again', t => {
  const h = fixture(t, 'reply-unavailable', { blocker: 'invalid-response', submitted: true, canCheck: true });
  h.root.querySelector('.m-asking-repair')!.click();
  assert.equal(h.checked(), 1); assert.equal(h.asked(), 0); assert.deepEqual(h.repairs, []);
});
for (const phase of ['unknown', 'cancel_requested', 'timed_out']) test('C5 repair stays absent during ' + phase, t => {
  const h = fixture(t, phase, { blocker: 'invalid-response', submitted: true, canCheck: true });
  assert.equal(h.root.querySelector('.m-asking-repair')!.hidden, true);
  assert.equal(h.asked(), 0); assert.deepEqual(h.repairs, []);
});
