import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as protocol from '../extension/lib/protocol.ts';
import * as actions from '../extension/lib/selection-actions.ts';
import * as respond from '../extension/lib/respond.ts';
import { ReaderJournal, type JournalState } from '../ui/journal.ts';
import { deferred, settle } from './t05-dom.ts';

const sourceSnapshot = (): protocol.Snapshot => ({ document: 'capture', revision: 1, position: 0,
  capture: { url: 'https://example.org/article', title: 'Article', text: 'A passage here.', pageType: 'article', capturedAt: '2026-09-19T00:00:00Z', extractionVersion: 'dom-safe-text-v1' },
  anchor: { exact: 'passage', start: 2, end: 9, prefix: 'A ', suffix: ' here.' }, sections: [{ title: 'Article', start: 0, end: 15 }] });
function harness(sharedSession = new Map<string, unknown>()) {
  const listeners: Record<string, (...args: any[]) => any> = {}, opens: unknown[] = [], messages: any[] = [], menus: any[] = [];
  const claims = new Map<string, actions.ContentActionRequest>();
  const saves: JournalState[] = []; let saveFailure: 'before' | 'after' | null = null;
  const event = (name: string) => ({ addListener(fn: (...args: any[]) => any) { listeners[name] = fn; } });
  let snapshot = sourceSnapshot(), browserDocument = 'browser-document', hosts: unknown = [], journalState: JournalState | undefined;
  let storageGate: Promise<void> = Promise.resolve(), loadGate: Promise<void> = Promise.resolve(), captures = true;
  const tab = { id: 42, url: snapshot.capture.url, windowId: 8, incognito: false };
  const locks = new Map<string, Promise<unknown>>();
  const navigator = { locks: { request<T>(key: string, operation: () => Promise<T>) { const work = (locks.get(key) ?? Promise.resolve()).then(operation); locks.set(key, work.catch(() => {})); return work; } } };
  const browser = {
    alarms: { onAlarm: event('alarm') }, action: { onClicked: event('toolbar') },
    contextMenus: { onClicked: event('menu'), removeAll: async () => { menus.length = 0; }, create: (item: unknown, callback: () => void) => { menus.push(item); callback(); } },
    sidePanel: { open: (args: unknown) => { opens.push(args); return Promise.resolve(); } },
    runtime: { id: 'fixture', getURL: (path: string) => 'chrome-extension://fixture/' + path.replace(/^\//, ''), onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup'),
      sendMessage: async (m: unknown) => { messages.push(m); }, getContexts: async () => [{ contextType: 'SIDE_PANEL', documentId: 'panel', documentUrl: 'chrome-extension://fixture/panel.html', windowId: 8, tabId: -1, incognito: false }] },
    storage: { local: { setAccessLevel: async () => {}, get: async () => { await storageGate; return { excludedHosts: hosts }; } },
      session: { setAccessLevel: async () => {}, get: async (key: string | null) => key === null ? Object.fromEntries(sharedSession) : { [key]: sharedSession.get(key) },
        set: async (value: Record<string, unknown>) => { for (const [key, item] of Object.entries(value)) sharedSession.set(key, structuredClone(item)); }, remove: async (key: string) => { sharedSession.delete(key); } }, onChanged: event('policy') },
    tabs: { onRemoved: event('removed'), onActivated: event('activated'), get: async () => tab, query: async () => [tab],
      sendMessage: async (_tab: number, m: any) => {
        messages.push(m);
        if (m.type === 'claim-selection-action') {
          const claim = claims.get(m.gesture);
          const accepted = !!claim && claim.operation === m.operation && claim.action === m.action && claim.document === m.document && claim.revision === m.revision;
          if (accepted) claims.delete(m.gesture);
          return { ok: true, value: accepted };
        }
        return { ok: true, value: m.type === 'snapshot' ? structuredClone(snapshot) : m.type === 'action-capture' ? captures : true };
      } },
    webNavigation: { onCommitted: event('committed'), onHistoryStateUpdated: event('history'), getFrame: async () => ({ documentId: browserDocument, documentLifecycle: 'active', url: tab.url }), getAllFrames: async () => [] },
  };
  const dependencies: Record<string, unknown> = {
    'wxt/utils/define-background': { defineBackground: (fn: () => void) => fn() }, 'wxt/browser': { browser },
    '../lib/instant-lifecycle.ts': { sourceHash: async () => '' }, '../lib/instant-worker.ts': { instantWorker: () => ({ release: async () => {} }) },
    '../lib/respond.ts': respond, '../lib/protocol.ts': protocol, '../lib/helper-reconnect.ts': { helperReconnect: () => ({}) },
    '../lib/surface-identity.ts': {}, '../../contracts/reader.ts': {}, '../../contracts/resume.ts': {}, '../lib/selection-actions.ts': actions,
    '../../ui/journal.ts': { ReaderJournal }, '../../ui/persistence.ts': { localPersistence: () => ({ journal: { load: async () => { await loadGate; return structuredClone(journalState); }, save: async (value: JournalState) => {
      saves.push(structuredClone(value)); if (saveFailure === 'before') throw new Error('Storage failed.');
      journalState = structuredClone(value); if (saveFailure === 'after') throw new Error('Commit response lost.');
    } } }) },
  };
  const output = ts.transpileModule(readFileSync(new URL('../extension/entrypoints/background.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(output, { exports: {}, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, URL, URLSearchParams, Promise, Error, crypto, structuredClone, navigator, console, TextEncoder });
  const choose = (action: string, extra = {}, target = tab) => listeners.menu({ menuItemId: 'marginalia:' + action, frameId: 0, selectionText: 'passage', ...extra }, target);
  const surface = (action: string) => new Promise<any>(resolve => listeners.message({ type: 'surface', version: 1, action }, { id: 'fixture', url: 'chrome-extension://fixture/panel.html', documentId: 'panel' }, resolve));
  const gesture = (action: actions.SelectionAction, operation: string = crypto.randomUUID()) => {
    const request: actions.ContentActionRequest = { type: 'selection-action', version: 1, action, gesture: crypto.randomUUID(), operation, document: snapshot.document, revision: snapshot.revision };
    claims.set(request.gesture, request); return structuredClone(request);
  };
  const content = (message: unknown, sender = {}) => new Promise<any>(resolve => listeners.message(message, { id: 'fixture', url: tab.url, tab, documentId: browserDocument, frameId: 0, ...sender }, resolve));
  const syncJournal = () => navigator.locks.request('marginalia-extension-reader', async () => {
    const journal = new ReaderJournal({ load: async () => structuredClone(journalState), save: async value => { journalState = structuredClone(value); } });
    await journal.load();
    const remote = structuredClone(journal.state.threads), sent: string[] = [];
    await journal.sync(async change => { sent.push(change.id); }, async () => remote);
    return sent;
  });
  return { listeners, opens, messages, menus, tab, choose, surface, sharedSession, gesture, content, saves, setSaveFailure: (failure: typeof saveFailure) => { saveFailure = failure; },
    syncJournal,
    state: () => journalState, setHosts: (v: unknown) => { hosts = v; }, setStorageGate: (v: Promise<void>) => { storageGate = v; }, setLoadGate: (v: Promise<void>) => { loadGate = v; },
    setSnapshot: (v: protocol.Snapshot) => { snapshot = v; }, setDocument: (v: string) => { browserDocument = v; }, setCapture: (v: boolean) => { captures = v; } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await settle(); };

test('menus install once per install/startup and keep Read later page-only', async () => {
  const h = harness(); await flush(); assert.equal(h.menus.length, 0);
  h.listeners.installed(); await flush(); assert.equal(h.menus.length, 6);
  assert.deepEqual(h.menus.filter(m => m.contexts.includes('selection')).map(m => m.title), ['Keep', 'Note', 'Ask', 'Simulate it']);
  assert.deepEqual(h.menus.filter(m => m.contexts.includes('page')).map(m => m.title), ['Read later', 'Open Marginalia']);
  h.listeners.startup(); await flush(); assert.equal(h.menus.length, 6);
});
test('menu and toolbar native opening occurs before asynchronous cold policy', async () => {
  const h = harness(), gate = deferred<void>(); h.setStorageGate(gate.promise);
  h.choose('simulate'); assert.equal(h.opens.length, 1); assert.equal(h.sharedSession.size, 0);
  h.listeners.toolbar(h.tab); assert.equal(h.opens.length, 2);
  gate.resolve(); await flush(); assert.equal((h.sharedSession.get('selection-action:42') as actions.ActionRequest).action, 'simulate');
});
test('Keep stays panel-closed and repeated concurrent clicks create one local kept passage', async () => {
  const h = harness(); await flush(); h.choose('keep'); h.choose('keep'); await flush();
  assert.equal(h.opens.length, 0); assert.equal(h.state()?.threads.length, 1); assert.equal(h.state()?.pending.length, 1);
  assert.equal(h.messages.some(m => m.type === 'action-kept'), true);
});
test('exclusion while Keep waits for journal load prevents a write', async () => {
  const h = harness(), gate = deferred<void>(); await flush(); h.setLoadGate(gate.promise); h.choose('keep'); await flush();
  h.setHosts(['example.org']); h.listeners.policy({ excludedHosts: { newValue: ['example.org'] } }, 'local'); gate.resolve(); await flush();
  assert.equal(h.state(), undefined);
});
test('mismatched selected text, subframe, incognito and stale capture cannot enqueue work', async () => {
  for (const kind of ['text', 'frame', 'incognito', 'capture']) {
    const h = harness(); await flush();
    if (kind === 'capture') h.setCapture(false);
    h.choose('keep', kind === 'text' ? { selectionText: 'other passage' } : kind === 'frame' ? { frameId: 2 } : {}, kind === 'incognito' ? { ...h.tab, incognito: true } : h.tab);
    await flush(); assert.equal(h.state(), undefined); assert.equal(h.sharedSession.size, 0);
  }
});
test('pending Simulate intent survives worker reconstruction and is consumed once', async () => {
  const h = harness(); await flush(); h.choose('simulate'); await flush();
  const next = harness(h.sharedSession); await flush();
  const reply = await next.surface('take-selection-action'); assert.equal(reply.ok, true); assert.equal(reply.value.action, 'simulate');
  const again = await next.surface('take-selection-action'); assert.equal(again.value, null);
});
test('pending action is refused after a source identity change and cleared on navigation', async () => {
  const h = harness(); await flush(); h.choose('ask'); await flush(); h.setDocument('new-document');
  assert.equal((await h.surface('take-selection-action')).value, null);
  h.choose('note'); await flush(); h.listeners.committed({ tabId: 42, frameId: 0, url: h.tab.url }); await flush();
  assert.equal(h.sharedSession.has('selection-action:42'), false);
});
test('tab activation neutralizes private panel immediately', async () => {
  const h = harness(); await flush(); h.messages.length = 0; h.listeners.activated();
  assert.equal(h.messages[0]?.type, 'panel-source-pending');
});
test('same-document top-frame navigation immediately neutralizes the panel and clears intent', async () => {
  const h = harness(); await flush(); h.choose('simulate'); await flush();
  assert.equal(h.sharedSession.has('selection-action:42'), true);
  h.messages.length = 0;
  h.listeners.history({ tabId: 42, frameId: 2, url: h.tab.url + '/frame' });
  assert.equal(h.messages.length, 0, 'subframe history leaves the top-frame surface intact');
  assert.equal(h.sharedSession.has('selection-action:42'), true);
  h.listeners.history({ tabId: 42, frameId: 0, url: h.tab.url + '/next' });
  assert.equal(h.messages[0]?.type, 'panel-source-pending', 'neutralization begins before asynchronous cleanup or panel polling');
  await flush();
  assert.equal(h.sharedSession.has('selection-action:42'), false);
  assert.equal(h.messages.some(message => message.type === 'instant-navigation'), true);
});

test('exclude then allow clears earlier queued intent instead of resurrecting it', async () => {
  const h = harness(); await flush(); h.choose('simulate'); await flush();
  h.setHosts(['example.org']); h.listeners.policy({ excludedHosts: { newValue: ['example.org'] } }, 'local');
  h.setHosts([]); h.listeners.policy({ excludedHosts: { newValue: [] } }, 'local');
  await flush(); assert.equal((await h.surface('take-selection-action')).value, null);
});

function panelHarness(action: actions.PanelAction, stale = false) {
  class Element { hidden = false; textContent = ''; addEventListener() {} replaceChildren() {} }
  const nodes = Object.fromEntries(['connection', 'exclude', 'controls', 'helper-status', 'margin', 'connect', 'disconnect', 'trusted-open'].map(id => [id, new Element()]));
  const s = sourceSnapshot(), calls: string[] = [], delivered: unknown[] = [];
  let pending: actions.ActionRequest | null = { id: 'one', action, browserDocument: 'browser-document', snapshot: structuredClone(s), expires: Date.now() + 30_000 };
  if (stale) pending.snapshot.revision++;
  let tick: () => void = () => {};
  const document = { visibilityState: 'visible', querySelector: (id: string) => nodes[id.slice(1)], getElementById: (id: string) => nodes[id], addEventListener() {} };
  const window: any = { addEventListener() {} }; window.top = window;
  const surface = { restoredPosition: false, destroy() {}, select() {}, setReadingPosition() {}, clearAutoAssist() {}, flushReadingPosition: async () => {},
    selectionAction: async (value: string, anchor: unknown) => { delivered.push({ value, anchor }); return false; }, readLater: async () => { delivered.push('read-later'); return true; } };
  const dependencies: Record<string, unknown> = {
    '../../../ui/forget/client.ts': { ForgetClient: class {} }, '../../lib/panel-instant.ts': { panelInstantTransport: () => ({}) }, '../../lib/panel-controls.ts': { connectionControls: () => {} }, '../../lib/library-link.ts': {},
    '../../lib/protocol.ts': protocol, '../../lib/respond.ts': { readReply: (value: unknown) => value }, '../../lib/selection-actions.ts': actions,
    '../../lib/helper-origin.ts': { DEFAULT_HELPER_ORIGIN: 'http://127.0.0.1:43120', helperOrigin: async () => undefined },
    '../../../ui/margin.ts': { mountMargin: async () => surface },
    'wxt/browser': { browser: { runtime: { id: 'fixture', onMessage: { addListener() {} }, sendMessage: async (m: any) => {
      calls.push(m.action); if (m.action === 'read') return structuredClone(s);
      if (m.action === 'take-selection-action') { const once = pending; pending = null; return once; }
      if (m.action === 'helper-status') return { enabled: false }; return null;
    } }, tabs: {} } },
  };
  const output = ts.transpileModule(readFileSync(new URL('../extension/entrypoints/panel/main.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(output, { exports: {}, require: (name: string) => { if (name.endsWith('.css')) return {}; assert.ok(name in dependencies, name); return dependencies[name]; }, URLSearchParams, AbortController, Promise, Error, structuredClone, document, window, location: { hash: '' }, setInterval: (fn: () => void) => { tick = fn; return 1; }, clearInterval() {} });
  return { delivered, calls, tick: () => tick() };
}
test('panel dispatches the frozen UI API once and never retries a blocked false result', async () => {
  for (const action of ['note', 'ask', 'simulate', 'read-later'] as const) {
    const h = panelHarness(action); await flush(); h.tick(); await flush();
    assert.equal(h.delivered.length, 1);
    if (action === 'read-later') assert.equal(h.delivered[0], 'read-later');
    else assert.deepEqual(h.delivered[0], { value: action, anchor: sourceSnapshot().anchor });
    assert.equal(h.calls.some(value => /send|connect|prepare|start/.test(value)), false);
  }
});
test('panel refuses a consumed action for a different snapshot revision', async () => {
  const h = panelHarness('simulate', true); await flush(); assert.equal(h.delivered.length, 0);
});

test('content bar Keep requires a one-use isolated gesture and stays panel-closed', async () => {
  const h = harness(); await flush(); const request = h.gesture('keep');
  assert.equal((await h.content(request)).value.kept, true);
  assert.equal((await h.content(request)).value.accepted, false, 'replay cannot run another mutation');
  assert.equal(h.state()?.threads.length, 1); assert.equal(h.opens.length, 0);
});
test('content bar native opening precedes cold policy and Simulate keeps its anchored intent', async () => {
  const h = harness(); await flush(); const gate = deferred<void>(); h.setStorageGate(gate.promise);
  const response = h.content(h.gesture('simulate')); await Promise.resolve();
  assert.equal(h.opens.length, 1); assert.equal(h.sharedSession.size, 0);
  gate.resolve(); const accepted = await response;
  assert.equal(accepted.value.queued, true); assert.equal(accepted.value.panel, true);
  const request = h.sharedSession.get('selection-action:42') as actions.ActionRequest;
  assert.equal(request.action, 'simulate'); assert.deepEqual(request.snapshot.anchor, sourceSnapshot().anchor);
});
test('content action refuses spoofed senders, unclaimed tokens, stale identities and extra authority', async () => {
  for (const kind of ['extension', 'subframe', 'browser-document', 'unclaimed', 'capture', 'revision', 'extra', 'action']) {
    const h = harness(); await flush(); let request: Record<string, unknown> = h.gesture('keep');
    const sender = kind === 'extension' ? { id: 'other' } : kind === 'subframe' ? { frameId: 1 } : kind === 'browser-document' ? { documentId: 'older-document' } : {};
    if (kind === 'unclaimed') request.gesture = crypto.randomUUID();
    if (kind === 'capture') request.document = 'other-capture';
    if (kind === 'revision') request.revision = 999;
    if (kind === 'extra') request.capture = sourceSnapshot().capture;
    if (kind === 'action') request.action = 'read-later';
    await h.content(request, sender); assert.equal(h.state(), undefined, kind); assert.equal(h.sharedSession.size, 0, kind);
  }
});
test('authenticated panel focus dismisses only the page bar and preserves pending intent', async () => {
  const h = harness(); await flush(); h.choose('simulate'); await flush();
  const before = structuredClone(h.sharedSession.get('selection-action:42'));
  assert.equal((await h.surface('dismiss-selection-bar')).value, true);
  assert.deepEqual(h.sharedSession.get('selection-action:42'), before);
  assert.equal(h.messages.at(-1).type, 'selection-bar-dismiss');
  assert.equal(h.messages.at(-1).document, sourceSnapshot().document);
});

function contentHarness() {
  const events = new Map<string, (event?: any) => void>(), sent: any[] = [], actionGate = deferred<unknown>();
  let now = Date.now(); class Clock extends Date { static now() { return now; } }
  let incoming: (...args: any[]) => unknown = () => {}, allowed = true, capturable = true, visible = false, focused = false, shows = 0, sourceChange: () => void = () => {};
  let onAction: (action: actions.SelectionAction) => Promise<boolean> = async () => false;
  const range = { cloneRange() { return this; } }, selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => range };
  const element = () => ({ style: { setProperty() {} }, append() {}, remove() {}, contains: () => false, textContent: '', setAttribute() {} });
  const document = { visibilityState: 'visible', body: element(), documentElement: element(), createElement: element, createRange: () => ({}) };
  const window: any = {}; window.top = window;
  const bar = { show() { shows++; visible = true; }, hide() { visible = false; focused = false; }, position() {}, owns: (event: any) => event.inBar === true, visible: () => visible, focused: () => focused, focus() { focused = true; }, matches: () => !selection.isCollapsed };
  const browser = { runtime: { id: 'fixture', getURL: (path: string) => 'chrome-extension://fixture/' + path, onMessage: { addListener(fn: typeof incoming) { incoming = fn; } },
    sendMessage: async (m: any) => { sent.push(m); return m.type === 'selection-action' ? actionGate.promise : { ok: true, value: { allowed } }; } } };
  const dependencies: Record<string, unknown> = {
    'wxt/utils/define-content-script': { defineContentScript: (value: unknown) => value }, 'wxt/browser': { browser },
    '../lib/auto-assist/index.ts': { FrequencyPageScorer: class {}, createAutoAssistController: () => ({ clear() {}, dispose() {} }), paintAutoAssistMarks() {}, AUTO_ASSIST_CSS: '' },
    '../lib/auto-assist/anchors.ts': {}, '../lib/instant-lifecycle.ts': {}, '../lib/respond.ts': respond, '../lib/protocol.ts': protocol,
    '../lib/selection-actions.ts': actions, '../lib/selection-bar.ts': { createSelectionBar: (fn: typeof onAction) => { onAction = fn; return bar; } },
    '../../contracts/resume.ts': { resumeThreadId: () => null }, '../../contracts/reader.ts': { HIGHLIGHT_COLOURS: [] },
    '../lib/capture.ts': { captureSelection: (id: string, revision: number, required: boolean) => capturable || !required ? { ...sourceSnapshot(), document: id, revision } : null,
      locate: () => null, projectPage: () => ({ text: sourceSnapshot().capture.text, nodes: [] }) },
  };
  const output = ts.transpileModule(readFileSync(new URL('../extension/entrypoints/content.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, URL, Promise, Error, crypto, structuredClone, console, Date: Clock,
    document, window, location: { href: sourceSnapshot().capture.url }, getSelection: () => selection, innerHeight: 640, CSS: {},
    MutationObserver: class { constructor(callback: (changes: unknown[]) => void) { sourceChange = () => callback([{ target: document.body }]); } observe() {} disconnect() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} });
  exports.default.main({ addEventListener: (target: unknown, type: string, handler: (event?: any) => void) => events.set((target === window ? 'window:' : 'document:') + type, handler), onInvalidated() {} });
  const message = (m: unknown, sender = { id: 'fixture' }) => new Promise<any>(resolve => incoming(m, sender, resolve));
  return { sent, events, selection, bar, sourceChange, message, actionGate, advance: (ms: number) => { now += ms; }, action: (action: actions.SelectionAction) => onAction(action),
    select: () => events.get('document:pointerup')!({ isTrusted: true }), shown: () => shows, setAllowed: (value: boolean) => { allowed = value; }, setCapturable: (value: boolean) => { capturable = value; } };
}
test('content selection shows only the bar; Escape and panel focus dismiss without losing an in-flight gesture', async () => {
  const h = contentHarness(); h.select(); await flush(); assert.equal(h.shown(), 1);
  assert.equal(h.sent.some(m => m.type === 'open' || m.type === 'selection-action'), false);
  let prevented = 0;
  const tab = { isTrusted: true, key: 'Tab', shiftKey: false, preventDefault: () => { prevented++; } };
  h.events.get('document:keydown')!(tab); h.events.get('document:keydown')!(tab);
  assert.equal(prevented, 1, 'Tab enters once rather than trapping subsequent page navigation');
  h.events.get('document:keydown')!({ isTrusted: true, key: 'Escape', preventDefault() {} }); assert.equal(h.bar.visible(), false);
  h.select(); await flush(); const saving = h.action('keep'); const request = h.sent.at(-1);
  assert.equal(request.type, 'selection-action');
  await h.message({ type: 'selection-bar-dismiss', version: 1, document: request.document }); assert.equal(h.bar.visible(), false);
  const claim = { ...request, type: 'claim-selection-action' };
  assert.equal((await h.message(claim)).value, true, 'focus dismissal retains the already chosen anchor');
  assert.equal((await h.message(claim)).value, false, 'the isolated token can be claimed only once');
  h.actionGate.resolve({ ok: true, value: { kept: true } }); assert.equal(await saving, true);
});
test('content keeps the bar hidden on denied or uncapturable editable selections', async () => {
  for (const kind of ['denied', 'editable']) {
    const h = contentHarness(); if (kind === 'denied') h.setAllowed(false); else h.setCapturable(false);
    h.select(); await flush(); assert.equal(h.shown(), 0); assert.equal(h.sent.some(m => m.type === 'open' || m.type === 'selection-action'), false);
  }
});
test('source mutation dismisses the bar and invalidates a pending content token', async () => {
  const h = contentHarness(); h.select(); await flush(); const saving = h.action('keep'), request = h.sent.at(-1);
  h.sourceChange(); assert.equal(h.bar.visible(), false);
  assert.equal((await h.message({ ...request, type: 'claim-selection-action' })).value, false);
  h.actionGate.resolve({ ok: true, value: { accepted: false } }); assert.equal(await saving, false);
});

test('Keep retry retains the exact mutation and needs a fresh gesture after failed or uncertain persistence', async () => {
  for (const failure of ['before', 'after'] as const) {
    const h = harness(); await flush(); h.setSaveFailure(failure); const first = h.gesture('keep');
    assert.equal((await h.content(first)).ok, false); await flush(); assert.equal(h.saves.length, 1, 'nothing automatically retries');
    assert.equal((await h.content(first)).value.accepted, false);
    const source = sourceSnapshot(); source.capture.capturedAt = '2026-09-19T02:00:00Z'; h.setSnapshot(source);
    h.setSaveFailure(null); const retry = h.gesture('keep', first.operation);
    assert.notEqual(retry.gesture, first.gesture); assert.equal((await h.content(retry)).value.kept, true);
    assert.equal(h.state()?.threads.length, 1); assert.equal(h.state()?.pending[0].id, first.operation);
    if (failure === 'before') assert.deepEqual(h.saves[0].pending[0], h.saves[1].pending[0], 'capture time, thread and mutation identity are unchanged');
    else assert.equal(h.saves.length, 1, 'a durable commit with a lost reply is detected on reload');
    assert.equal(h.sharedSession.has('selection-keep:42'), true, 'success retains bounded retry identity until expiry or source cleanup');
  }
});
test('Keep retry after a lost runtime acknowledgement and actual journal sync preserves the acknowledged mutation', async () => {
  const h = harness(); await flush(); const first = h.gesture('keep');
  // The worker fully succeeds; simulate transport losing this completed reply,
  // rather than throwing from journal.save before worker cleanup can run.
  assert.equal((await h.content(first)).value.kept, true);
  const originalReceipt = structuredClone(h.sharedSession.get('selection-keep:42'));
  const original = structuredClone(h.state()!.pending[0]);
  assert.deepEqual(await h.syncJournal(), [first.operation]);
  assert.equal(h.state()!.pending.length, 0);
  assert.equal(h.state()!.acknowledged?.[0].id, first.operation);
  const durable = structuredClone(h.state());
  assert.equal((await h.content(first)).value.accepted, false, 'old gesture cannot replay after success');
  assert.equal((await h.content({ ...first, gesture: crypto.randomUUID() })).value.accepted, false, 'a receipt is not gesture authority');
  const source = sourceSnapshot(); source.capture.capturedAt = '2026-09-19T02:00:00Z'; h.setSnapshot(source);
  const retried = await h.content(h.gesture('keep', first.operation));
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.value.kept, true);
  assert.deepEqual(h.state(), durable, 'acknowledged retry adds no thread, outbox entry or acknowledgement');
  assert.equal(h.saves.length, 1, 'retry needs no second journal save');
  const receipt = h.sharedSession.get('selection-keep:42') as actions.KeepReceipt;
  assert.deepEqual(receipt, originalReceipt, 'success and retries never extend the original deadline or replace its payload');
  assert.equal(receipt.threadId, original.threadId);
  assert.deepEqual(receipt.snapshot.capture, original.kind === 'keep' ? original.capture : undefined);
});
test('content retry keeps its mutation ID but mints a fresh trusted-activation token', async () => {
  const h = contentHarness(); h.select(); await flush();
  h.actionGate.resolve({ ok: false, error: 'Storage failed.' });
  await assert.rejects(h.action('keep')); const first = h.sent.at(-1);
  await assert.rejects(h.action('keep')); const retry = h.sent.at(-1);
  assert.equal(retry.operation, first.operation); assert.notEqual(retry.gesture, first.gesture);
});

test('Keep receipt has bounded count/bytes, expires, and survives worker restart without becoming authority', async () => {
  const h = harness(); await flush(); h.setSaveFailure('before'); const request = h.gesture('keep');
  assert.equal((await h.content(request)).ok, false);
  const receipt = structuredClone(h.sharedSession.get('selection-keep:42')) as actions.KeepReceipt;
  assert.ok(receipt.expires <= Date.now() + actions.KEEP_RECEIPT_TTL);
  const restarted = harness(h.sharedSession); await flush();
  assert.equal((await restarted.content({ ...request, gesture: crypto.randomUUID() })).value.accepted, false, 'stored payload is not authorization');
  assert.equal((await restarted.content(restarted.gesture('keep', request.operation))).value.kept, true);
  assert.deepEqual(restarted.saves[0].pending[0], h.saves[0].pending[0]);
  assert.equal(restarted.sharedSession.has('selection-keep:42'), true);

  const capped = harness(); await flush();
  for (let index = 0; index < actions.KEEP_RECEIPT_LIMIT; index++) capped.sharedSession.set('selection-keep:' + (100 + index), { ...receipt, operation: crypto.randomUUID() });
  assert.equal((await capped.content(capped.gesture('keep'))).ok, false); assert.equal(capped.state(), undefined);
  for (const value of capped.sharedSession.values()) (value as actions.KeepReceipt).expires = Date.now() - 1;
  assert.equal((await capped.content(capped.gesture('keep'))).value.kept, true);
  assert.equal(capped.sharedSession.size, 1, 'expired receipts are removed before retaining the new successful attempt');

  const oversized = harness(); await flush(); const large = sourceSnapshot();
  large.capture.text = '\u0001'.repeat(400_000); large.anchor = { exact: '\u0001', start: 0, end: 1, prefix: '', suffix: '' }; large.sections[0].end = large.capture.text.length;
  oversized.setSnapshot(large);
  assert.equal((await oversized.content(oversized.gesture('keep'))).ok, false); assert.equal(oversized.state(), undefined); assert.equal(oversized.sharedSession.size, 0);
});
test('successful and failed Keep receipts are removed on exclusion and both navigation paths', async () => {
  for (const failure of [null, 'before'] as const) for (const event of ['policy', 'history', 'committed', 'removed']) {
    const h = harness(); await flush(); h.setSaveFailure(failure); await h.content(h.gesture('keep'));
    assert.equal(h.sharedSession.has('selection-keep:42'), true);
    if (event === 'policy') h.listeners.policy({ excludedHosts: { newValue: ['example.org'] } }, 'local');
    else if (event === 'removed') h.listeners.removed(42);
    else h.listeners[event]({ tabId: 42, frameId: 0, url: h.tab.url + '/new' });
    await flush(); assert.equal(h.sharedSession.has('selection-keep:42'), false, event);
  }
});
test('successful Keep receipts cannot bypass expiry, source identity or policy on retry after sync', async () => {
  for (const stale of ['expiry', 'document', 'revision', 'text', 'anchor', 'browser-document', 'policy']) {
    const h = harness(); await flush(); const first = h.gesture('keep');
    assert.equal((await h.content(first)).value.kept, true); await h.syncJournal();
    const durable = structuredClone(h.state()), source = sourceSnapshot();
    if (stale === 'expiry') (h.sharedSession.get('selection-keep:42') as actions.KeepReceipt).expires = Date.now() - 1;
    if (stale === 'document') source.document = 'new-capture';
    if (stale === 'revision') source.revision++;
    if (stale === 'text') source.capture.text += ' changed';
    if (stale === 'anchor') source.anchor = { exact: 'here', start: 10, end: 14, prefix: 'A passage ', suffix: '.' };
    if (stale === 'browser-document') h.setDocument('new-browser-document');
    if (stale === 'policy') h.setHosts(['example.org']);
    h.setSnapshot(source);
    const reply = await h.content(h.gesture('keep', first.operation));
    assert.notEqual(reply.value?.kept, true, stale);
    assert.deepEqual(h.state(), durable, stale + ' must leave the acknowledged record unchanged');
    assert.equal(h.saves.length, 1);
    if (stale === 'expiry') assert.equal(h.sharedSession.has('selection-keep:42'), false);
  }
});

test('a deliberate Keep from a different capture remains distinct and retains earlier notes', async () => {
  const h = harness(); await flush(); await h.content(h.gesture('keep'));
  const thread = h.state()!.threads[0];
  thread.notes.push({ id: 'reader-note', threadId: thread.id, text: 'My earlier note', revision: 1, createdAt: '2026-09-19T00:00:00Z', deletedAt: null });
  const next = sourceSnapshot(); next.revision++; next.capture.title = 'A different edition'; h.setSnapshot(next);
  assert.equal((await h.content(h.gesture('keep'))).value.kept, true);
  assert.equal(h.state()!.threads.length, 2); assert.equal(h.state()!.threads.find(value => value.id === thread.id)!.notes[0].text, 'My earlier note');
});

test('isolated gesture expires after ten seconds and expired Keep retry asks for a new selection', async () => {
  const h = contentHarness(); h.select(); await flush(); const pending = h.action('keep'), request = h.sent.at(-1);
  h.advance(10_001); assert.equal((await h.message({ ...request, type: 'claim-selection-action' })).value, false);
  h.actionGate.resolve({ ok: true, value: { accepted: false } }); assert.equal(await pending, false);
  const count = h.sent.length; h.advance(actions.KEEP_RECEIPT_TTL);
  assert.equal(await h.action('keep'), false); assert.equal(h.sent.length, count); assert.equal(h.bar.visible(), false);
});
