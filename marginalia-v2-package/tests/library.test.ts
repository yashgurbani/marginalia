import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountLibrary, type MountLibraryOptions } from '../ui/library/index.ts';
import type { Thread } from '../contracts/reader.ts';
import type { LibrarySearchResult, ModelSettings, VocabularyEntry } from '../contracts/library.ts';
import type { ConsentGrant, SiteExclusion } from '../contracts/consent.ts';

// Dependency-free DOM surface for the repository's node:test harness. This runs
// the real library and consent mounts, but does not claim browser/layout evidence.
class TestElement extends EventTarget {
  tagName: string;
  doc: TestDocument;
  children: TestElement[] = [];
  parentElement: TestElement | null = null;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  className = ''; id = ''; value = ''; type = ''; href = ''; download = '';
  hidden = false; disabled = false; readOnly = false;
  selectionStart = 0; selectionEnd = 0;
  private text = '';
  constructor(tag: string, doc: TestDocument) { super(); this.tagName = tag.toUpperCase(); this.doc = doc; }
  get firstElementChild() { return this.children[0] ?? null; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value ?? ''; }
  get isConnected(): boolean { return this === this.doc.body || !!this.parentElement?.isConnected; }
  get visible(): boolean { return !this.hidden && (!this.parentElement || this.parentElement.visible); }
  append(...nodes: TestElement[]) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes: TestElement[]) { for (const child of [...this.children]) child.remove(); this.text = ''; this.append(...nodes); }
  remove() {
    if (!this.parentElement) return;
    if (this.contains(this.doc.activeElement)) this.doc.activeElement = this.doc.body;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null;
  }
  contains(node: TestElement | null): boolean { return !!node && (node === this || this.children.some(child => child.contains(node))); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); if (name === 'class') this.className = value; if (name === 'id') this.id = value; }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  matches(selector: string): boolean {
    if (selector === '[data-ml-focus]') return this.dataset.mlFocus !== undefined;
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector: string): TestElement[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): TestElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  focus() { if (this.isConnected && this.visible && !this.disabled) this.doc.activeElement = this; }
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
  click() {
    if (this.disabled) return;
    const proceed = this.dispatchEvent(new Event('click', { cancelable: true }));
    if (proceed && this.type === 'submit') this.closest('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  }
}
class TestDocument {
  body: TestElement;
  activeElement: TestElement;
  created: TestElement[] = [];
  constructor() { this.body = new TestElement('body', this); this.activeElement = this.body; }
  createElement(tag: string) { const element = new TestElement(tag, this); this.created.push(element); return element; }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const now = '2026-09-17T08:00:00.000Z';
const models = (revision = 1, fast = 'luna', deep = 'astra'): ModelSettings => ({ fast, deep, revision, updatedAt: now, compatibilityKey: 'a'.repeat(64) });
const term = (name = 'entropy'): VocabularyEntry => ({ term: name, origin: 'lookup', status: 'active', firstSeen: now, lastSeen: now });
const thread = (id = 'one', removed = false): Thread => ({ id, anchorId: `anchor-${id}`, sourceVersionId: `source-${id}`, sourceTitle: id, sourceUrl: `https://example.com/${id}`, state: 'open', revision: 1, createdAt: now, updatedAt: now, deletedAt: removed ? now : null, notes: [], highlighted: false, anchor: { exact: 'a passage', prefix: '', suffix: '', start: 0, end: 9 } });
const grant: ConsentGrant = { id: 'grant-one', site: 'https://example.com', recipient: 'Codex', scope: 'cloud-inference', decision: 'allow-site', revision: 1, createdAt: now };
function button(root: TestElement, text: string) {
  const found = root.querySelectorAll('button').find(node => node.visible && node.textContent === text);
  assert.ok(found, `Button not found: ${text}`); return found;
}
function keyed(root: TestElement, key: string) {
  const found = root.querySelectorAll('[data-ml-focus]').find(node => node.visible && node.dataset.mlFocus === key);
  assert.ok(found, `Control not found: ${key}`); return found;
}
function section(root: TestElement, title: string) {
  const found = root.querySelectorAll('section').find(node => node.children.some(child => child.tagName === 'H3' && child.textContent === title));
  assert.ok(found, `Section not found: ${title}`); return found;
}
function edit(input: TestElement, value: string) { input.value = value; input.dispatchEvent(new Event('input')); }
function setup(t: TestContext, options: Partial<MountLibraryOptions> = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), doc = new TestDocument();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  const host = doc.createElement('div'); doc.body.append(host);
  const adapters: MountLibraryOptions = { listThreads: async () => [thread()], exportThread: async id => ({ id }), onOpenThread() {}, onClose() {}, loadModels: async () => models(), listVocabulary: async () => [], ...options };
  let mount = mountLibrary(host as unknown as HTMLElement, adapters);
  t.after(() => { mount.destroy(); if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); });
  return { host, doc, adapters, destroy: () => mount.destroy(), remount: (next: Partial<MountLibraryOptions>) => { mount = mountLibrary(host as unknown as HTMLElement, { ...adapters, ...next }); }, live: () => host.querySelector('.ml__live')?.textContent ?? '', settings: async () => { button(host, 'Settings').click(); await settle(); } };
}

const searchResult = (passage = 'a passage'): LibrarySearchResult => ({ threadId: 'one', sourceVersionId: 'source-one', sourceTitle: 'Saved source', sourceUrl: 'https://example.com/one', kind: 'source', passage, start: 0, end: passage.length, matchExcerpt: passage, matchedTerms: ['passage'], explanation: 'Local text match.', evidenceLabel: 'source passage' });

test('library search waits for submission, preserves the typed draft and opens its cited passage', async t => {
  const queries: string[] = [], pending = deferred<LibrarySearchResult[]>(); let opened: LibrarySearchResult | undefined;
  const h = setup(t, { search: query => { queries.push(query); return pending.promise; }, onOpenPassage: (_thread, result) => { opened = result; } });
  await settle(); const input = keyed(h.host, 'library-query');
  edit(input, 'passage'); assert.deepEqual(queries, []);
  button(h.host, 'Search').click(); await settle(); assert.deepEqual(queries, ['passage']);
  edit(input, 'new draft'); input.focus(); input.setSelectionRange(2, 5);
  pending.resolve([searchResult()]); await settle();
  assert.equal(keyed(h.host, 'library-query'), input); assert.equal(input.value, 'new draft');
  assert.equal(h.doc.activeElement, input); assert.equal(input.selectionStart, 2);
  button(h.host, 'Open cited passage').click(); await settle(); assert.deepEqual(opened, searchResult());
});

test('new search owns results and a destroyed library ignores pending completions', async t => {
  const first = deferred<LibrarySearchResult[]>(), second = deferred<LibrarySearchResult[]>(); let calls = 0;
  const h = setup(t, { search: () => ++calls === 1 ? first.promise : second.promise, onOpenPassage() {} });
  await settle(); edit(keyed(h.host, 'library-query'), 'first'); button(h.host, 'Search').click();
  edit(keyed(h.host, 'library-query'), 'second'); button(h.host, 'Search').click();
  second.resolve([searchResult('new match')]); await settle(); first.resolve([searchResult('stale match')]); await settle();
  assert.match(h.host.textContent, /new match/); assert.doesNotMatch(h.host.textContent, /stale match/);
  h.destroy(); assert.equal(h.host.textContent, '');
});

test('related results are deliberate and removed search targets cannot open', async t => {
  let calls = 0, opened = 0, removed = false;
  const h = setup(t, { listThreads: async () => [thread('one', removed)], search: async () => [searchResult()], related: async id => { assert.equal(id, 'one'); calls++; return [searchResult()]; }, onOpenPassage: () => { opened++; } });
  await settle(); assert.equal(calls, 0); button(h.host, 'Related saved passages').click(); await settle(); assert.equal(calls, 1);
  removed = true; button(h.host, 'Open cited passage').click(); await settle();
  assert.equal(opened, 0); assert.match(h.host.textContent, /no longer available/);
});

test('leaving library fences a pending cited-passage open', async t => {
  let reads = 0, opened = 0; const refresh = deferred<Thread[]>();
  const h = setup(t, { listThreads: () => ++reads === 1 ? Promise.resolve([thread()]) : refresh.promise, search: async () => [searchResult()], onOpenPassage: () => { opened++; } });
  await settle(); edit(keyed(h.host, 'library-query'), 'passage'); button(h.host, 'Search').click(); await settle();
  button(h.host, 'Open cited passage').click(); await settle(); await h.settings(); refresh.resolve([thread()]); await settle();
  assert.equal(opened, 0);
});

test('section results publish independently even when other settings never settle', async t => {
  const waiting = deferred<ModelSettings>();
  const h = setup(t, { loadModels: () => waiting.promise, listVocabulary: () => new Promise(() => {}), permissions: { load: async () => { throw new Error('permission read failed'); }, revoke: async g => g, setExcluded: async () => { throw new Error(); } } });
  await h.settings();
  assert.match(section(h.host, 'Permissions and exclusions').textContent, /permission read failed/);
  assert.ok(section(h.host, 'Model choices').querySelector('.ml__skeleton'));
  assert.equal(h.host.querySelectorAll('button').some(b => b.textContent === 'Revoke'), false);
});

test('provider availability shows unsupported connections without selection, credential entry or runtime readiness', async t => {
  let saves = 0;
  const h = setup(t, { saveModels: async change => { saves++; return models(2, change.fast, change.deep); } });
  await h.settings();
  const availability = section(h.host, 'Provider availability');
  assert.match(availability.textContent, /OpenAI CodexConnection implemented; readiness not established/);
  assert.match(availability.textContent, /This list does not establish that asking is ready/);
  for (const label of ['Local models', 'Other providers', 'Your own agent']) {
    assert.ok(availability.querySelectorAll('li').some(item => item.textContent.startsWith(`${label}Unavailable`)));
  }
  for (const tag of ['input', 'select', 'button', 'form']) assert.equal(availability.querySelectorAll(tag).length, 0);
  assert.match(availability.textContent, /Credentials stay in the local helper and are never entered here/);
  const modelSection = section(h.host, 'Model choices');
  assert.match(modelSection.textContent, /changing a name does not add another provider or verify model availability/);
  const before = availability.textContent;
  edit(modelSection.querySelector('input')!, 'some-local-model');
  button(h.host, 'Save model choices').click(); await settle();
  assert.equal(saves, 1);
  assert.equal(section(h.host, 'Provider availability').textContent, before);
});

test('build provider limitations remain visible when model settings are unavailable or still loading', async t => {
  const h = setup(t, { loadModels: () => new Promise(() => {}) });
  await h.settings();
  assert.ok(section(h.host, 'Model choices').querySelector('.ml__skeleton'));
  assert.match(section(h.host, 'Provider availability').textContent, /Local modelsUnavailable/);
  h.remount({ loadModels: undefined }); await h.settings();
  assert.match(section(h.host, 'Model choices').textContent, /unavailable/);
  assert.match(section(h.host, 'Provider availability').textContent, /Other providersUnavailable/);
});

test('settings disclose every retained local copy with location, removal, and export behavior', async t => {
  const h = setup(t);
  await h.settings();
  const inventory = section(h.host, 'Copies kept on this computer');
  const text = inventory.textContent;
  for (const copy of ['Source versions', 'Note versions', 'Reply versions and views', 'Full-text search copies', 'Pending work and conflicts', 'Saved-reply cache and recovery history', 'Pre-upgrade backups', 'Downloaded exports']) assert.match(text, new RegExp(copy));
  assert.equal(inventory.querySelectorAll('dt').length, 8);
  assert.equal(inventory.querySelectorAll('.m-retained-copies__location').length, 8);
  assert.equal(inventory.querySelectorAll('dd').filter(node => node.textContent.startsWith('Remove:')).length, 8);
  assert.equal(inventory.querySelectorAll('dd').filter(node => node.textContent.startsWith('Export:')).length, 8);
  assert.match(text, /not a promise that old bytes were securely overwritten/);
  assert.doesNotMatch(text, /[A-Z]:\\|pairing token|credential|\.sqlite\.backups/i);
});

test('model and vocabulary retries/results preserve pending revoke, permission input, and focus', async t => {
  const saving = deferred<ConsentGrant>(), modelRetry = deferred<ModelSettings>(), vocabularyRetry = deferred<VocabularyEntry[]>();
  let modelReads = 0, vocabularyReads = 0, permissionReads = 0, signal: AbortSignal | undefined;
  const h = setup(t, {
    loadModels: () => { if (++modelReads === 1) throw new Error('models unavailable'); return modelRetry.promise; },
    saveModels: async change => models(2, change.fast, change.deep), deleteVocabulary: async () => {},
    listVocabulary: () => { if (++vocabularyReads === 1) return Promise.reject(new Error('words unavailable')); return vocabularyRetry.promise; },
    permissions: { load: async () => { permissionReads++; return { grants: [grant], exclusions: [] }; }, revoke: (_g, s) => { signal = s; return saving.promise; }, setExcluded: async () => { throw new Error(); } },
  });
  await h.settings(); button(h.host, 'Revoke').click(); await settle();
  const permissionRoot = h.host.querySelector('.m-consent-settings')!, input = permissionRoot.querySelector('input')!;
  edit(input, 'https://kept.example'); input.focus();
  button(section(h.host, 'Model choices'), 'Try again').click();
  button(section(h.host, 'Vocabulary'), 'Try again').click(); await settle();
  modelRetry.resolve(models()); vocabularyRetry.resolve([term()]); await settle();
  assert.equal(permissionReads, 1); assert.equal(signal?.aborted, false);
  assert.ok(h.host.querySelector('.m-consent-settings') === permissionRoot);
  assert.equal(input.value, 'https://kept.example'); assert.ok(h.doc.activeElement === input);
  button(h.host, 'Save model choices').click(); button(section(h.host, 'Vocabulary'), 'Delete').click(); button(h.host, 'Delete entropy').click(); await settle();
  assert.equal(permissionReads, 1); assert.equal(signal?.aborted, false); assert.ok(h.host.querySelector('.m-consent-settings') === permissionRoot);
  saving.resolve({ ...grant, revokedAt: now, revision: 2 }); await settle();
  assert.match(permissionRoot.textContent, /Revoked/);
});

test('pending exclusion survives leaving and reentering Settings', async t => {
  const saving = deferred<SiteExclusion>(); let reads = 0, signal: AbortSignal | undefined;
  const h = setup(t, { permissions: { load: async () => { reads++; return { grants: [], exclusions: [] }; }, revoke: async g => g, setExcluded: (_site, _excluded, _revision, s) => { signal = s; return saving.promise; } } });
  await h.settings();
  const permissions = h.host.querySelector('.m-consent-settings')!;
  edit(permissions.querySelector('input')!, 'https://example.com'); button(permissions, 'Exclude site').click(); await settle();
  button(h.host, 'Library').click(); await h.settings();
  assert.equal(signal?.aborted, false); assert.equal(reads, 1); assert.ok(h.host.querySelector('.m-consent-settings') === permissions);
  saving.resolve({ site: 'https://example.com', excluded: true, revision: 1, updatedAt: now }); await settle();
  assert.match(permissions.textContent, /Excluded/);
});

test('failed authority refresh replaces cached controls and remains independent of sibling work', async t => {
  let reads = 0; const words = deferred<VocabularyEntry[]>();
  const h = setup(t, { listVocabulary: () => words.promise, permissions: { load: async () => { if (++reads > 1) throw new Error('current authority unavailable'); return { grants: [grant], exclusions: [] }; }, revoke: async g => g, setExcluded: async () => { throw new Error(); } } });
  await h.settings(); assert.ok(button(h.host, 'Revoke'));
  button(h.host, 'Library').click(); await h.settings(); words.resolve([]); await settle();
  assert.match(section(h.host, 'Permissions and exclusions').textContent, /current authority unavailable/);
  assert.ok(h.host.querySelector('.m-consent-settings') === null);
});

for (const outcome of ['resolve', 'reject'] as const) test(`late library ${outcome} preserves model draft, node, and caret`, async t => {
  const threads = deferred<Thread[]>();
  const h = setup(t, { listThreads: () => threads.promise });
  await h.settings(); const input = section(h.host, 'Model choices').querySelector('input')!;
  edit(input, 'reader-draft'); input.focus(); input.setSelectionRange(2, 7);
  if (outcome === 'resolve') threads.resolve([thread()]); else threads.reject(new Error('library unavailable'));
  await settle();
  assert.ok(section(h.host, 'Model choices').querySelector('input') === input);
  assert.equal(input.value, 'reader-draft'); assert.ok(h.doc.activeElement === input);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 7]);
  button(h.host, 'Library').click(); await h.settings();
  assert.ok(section(h.host, 'Model choices').querySelector('input') === input); assert.equal(input.value, 'reader-draft');
});

test('newest export owns the preview; closing invalidates outstanding success and failure', async t => {
  const a = deferred<unknown>(), b = deferred<unknown>(), c = deferred<unknown>(); let calls = 0;
  const h = setup(t, { exportThread: () => [a.promise, b.promise, c.promise][calls++] }); await settle();
  button(h.host, 'Export JSON').click(); button(h.host, 'Export JSON').click(); await settle();
  b.resolve({ winner: 'B' }); await settle(); a.resolve({ stale: 'A' }); await settle();
  assert.match(h.host.querySelector('pre')!.textContent, /"B"/); assert.doesNotMatch(h.host.querySelector('pre')!.textContent, /stale/);
  button(h.host, 'Export JSON').click(); await settle(); button(h.host, 'Close preview').click();
  c.reject(new Error('stale export failure')); await settle();
  assert.ok(h.host.querySelector('pre') === null); assert.equal(h.live(), 'Export preview closed.');
});

test('closed preview cannot be reopened by a pending successful export', async t => {
  const pending = deferred<unknown>(); let calls = 0;
  const h = setup(t, { exportThread: () => ++calls === 1 ? Promise.resolve({ first: true }) : pending.promise }); await settle();
  button(h.host, 'Export JSON').click(); await settle(); button(h.host, 'Export JSON').click(); await settle(); button(h.host, 'Close preview').click();
  pending.resolve({ late: true }); await settle(); assert.ok(h.host.querySelector('pre') === null);
});

test('inert paged export freezes exact JSON and requests download only on explicit action', async t => {
  const data = { text: '<script>alert(1)</script> ' + '\u03bb\ud83d\ude42'.repeat(9000) }, frozen = JSON.stringify(data, null, 2);
  let downloaded: Blob | undefined, requests = 0;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { downloaded = blob; requests++; return 'blob:library-test'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const h = setup(t, { exportThread: async () => data }); await settle(); button(h.host, 'Export JSON').click(); await settle();
  data.text = 'changed after serialization';
  let seen = h.host.querySelector('pre')!.textContent;
  while (!button(h.host, 'Next page').disabled) { button(h.host, 'Next page').click(); seen += h.host.querySelector('pre')!.textContent; }
  assert.equal(seen, frozen); assert.equal(requests, 0); assert.equal(h.doc.created.some(node => node.tagName === 'SCRIPT'), false);
  button(h.host, 'Download this JSON').click();
  assert.equal(await downloaded!.text(), frozen); assert.equal(requests, 1); assert.equal(h.live(), 'JSON export download requested.');
});

test('Export everything re-reads all visibility states and requests local Markdown and JSON-LD downloads', async t => {
  const active = thread('active'), removed = thread('removed', true);
  const blobs: Blob[] = [], filenames: string[] = []; let lists = 0;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { blobs.push(blob); return `blob:library-${blobs.length}`; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const h = setup(t, {
    listThreads: async () => { lists++; return [active, removed]; },
    exportThread: async id => ({ thread: id === active.id ? active : removed }),
  });
  await settle();
  const before = h.doc.created.length;
  button(h.host, 'Export everything').click(); await settle();
  for (const node of h.doc.created.slice(before)) if (node.tagName === 'A' && node.download) filenames.push(node.download);
  assert.equal(lists, 2, 'the export refreshes the initial library listing');
  assert.deepEqual(filenames, ['marginalia-library.md', 'marginalia-library.jsonld']);
  assert.equal(blobs.length, 2);
  assert.match(await blobs[0].text(), /^# Marginalia library export/);
  const json = JSON.parse(await blobs[1].text()) as { total: number; first: { items: Array<{ 'marginalia:deletedAt': string | null }> } };
  assert.equal(json.total, 2); assert.equal(json.first.items.some(item => item['marginalia:deletedAt'] !== null), true);
  assert.equal(h.live(), 'Markdown and Web Annotation downloads requested for 2 threads.');
});

test('whole-library read failure or wrong identity produces no partial downloads and permits retry', async t => {
  let requests = 0, mode = 'failure';
  t.mock.method(URL, 'createObjectURL', () => { requests++; return 'blob:fixture'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const h = setup(t, { listThreads: async () => [thread('one'), thread('two')], exportThread: async id => {
    if (id === 'two' && mode === 'failure') throw new Error('read failed');
    return { thread: thread(mode === 'wrong' ? 'wrong' : id) };
  } });
  await settle(); button(h.host, 'Export everything').click(); await settle();
  assert.equal(requests, 0); assert.equal(h.live(), 'read failed');
  mode = 'wrong'; button(h.host, 'Export everything').click(); await settle();
  assert.equal(requests, 0); assert.match(h.live(), /different thread/);
  mode = 'success'; button(h.host, 'Export everything').click(); await settle();
  assert.equal(requests, 2);
});

test('destroying the library fences delayed whole-library downloads and duplicate clicks share one read', async t => {
  const pending = deferred<unknown>(); let reads = 0, downloads = 0;
  t.mock.method(URL, 'createObjectURL', () => { downloads++; return 'blob:fixture'; });
  const h = setup(t, { exportThread: () => { reads++; return pending.promise; } });
  await settle(); const action = button(h.host, 'Export everything');
  action.click(); action.click(); await settle(); assert.equal(reads, 1);
  h.destroy(); pending.resolve({ thread: thread() }); await settle();
  assert.equal(downloads, 0);
});

test('model save captures submitted values, blocks duplicate saves, and keeps later edits', async t => {
  const saved = deferred<ModelSettings>(); const changes: Array<{ fast: string; deep: string; expectedRevision: number }> = [];
  const h = setup(t, { saveModels: change => { changes.push(change); return changes.length === 1 ? saved.promise : Promise.resolve(models(3, change.fast, change.deep)); } }); await h.settings();
  const input = section(h.host, 'Model choices').querySelector('input')!;
  edit(input, 'submitted'); button(h.host, 'Save model choices').click(); edit(input, 'newer edit'); button(h.host, 'Save model choices').click(); await settle();
  assert.deepEqual(changes, [{ fast: 'submitted', deep: 'astra', expectedRevision: 1 }]);
  saved.resolve(models(2, 'submitted')); await settle(); assert.equal(input.value, 'newer edit');
  button(h.host, 'Save model choices').click(); await settle(); assert.equal(changes[1].expectedRevision, 2); assert.equal(changes[1].fast, 'newer edit');
});

test('a newer model load supersedes an older save response without discarding reader edits', async t => {
  const save = deferred<ModelSettings>(); let reads = 0;
  const h = setup(t, { loadModels: async () => ++reads === 1 ? models() : models(3, 'elsewhere'), saveModels: () => save.promise }); await h.settings();
  const input = section(h.host, 'Model choices').querySelector('input')!;
  edit(input, 'my edit'); button(h.host, 'Save model choices').click(); await settle();
  button(h.host, 'Library').click(); await h.settings();
  save.resolve(models(2, 'my edit')); await settle();
  assert.equal(input.value, 'my edit'); assert.match(section(h.host, 'Model choices').textContent, /Saved choices changed elsewhere/);
  assert.notEqual(h.live(), 'Model choices saved.');
  button(h.host, 'Discard edits and reload').click(); await settle();
  assert.equal(section(h.host, 'Model choices').querySelector('input')!.value, 'elsewhere');
});

test('new model save supersedes an older load failure and synchronous save throws remain recoverable', async t => {
  const stale = deferred<ModelSettings>(); let loads = 0, saves = 0;
  const h = setup(t, { loadModels: () => ++loads === 1 ? Promise.resolve(models()) : stale.promise, saveModels: () => { if (++saves === 1) throw new Error('save unavailable'); return Promise.resolve(models(2, 'edited')); } });
  await h.settings(); button(h.host, 'Library').click(); await h.settings();
  edit(section(h.host, 'Model choices').querySelector('input')!, 'edited'); button(h.host, 'Save model choices').click(); await settle();
  assert.match(h.live(), /save unavailable/); assert.equal(button(h.host, 'Save model choices').disabled, false);
  button(h.host, 'Save model choices').click(); await settle(); stale.reject(new Error('obsolete load failure')); await settle();
  assert.doesNotMatch(section(h.host, 'Model choices').textContent, /obsolete load failure/); assert.equal(h.live(), 'Model choices saved.');
});

test('vocabulary deletion reconciles the current list after navigation and fences pre-delete reads', async t => {
  const deletion = deferred<void>(), olderRead = deferred<VocabularyEntry[]>(), freshRead = deferred<VocabularyEntry[]>(); let reads = 0, deletes = 0;
  const h = setup(t, { listVocabulary: () => [Promise.resolve([term()]), olderRead.promise, freshRead.promise][reads++], deleteVocabulary: () => { deletes++; return deletion.promise; } });
  await h.settings(); button(section(h.host, 'Vocabulary'), 'Delete').click(); button(h.host, 'Delete entropy').click(); await settle();
  button(h.host, 'Library').click(); await h.settings(); deletion.resolve(); await settle();
  assert.equal(deletes, 1); assert.equal(reads, 3);
  freshRead.resolve([term('enthalpy')]); await settle(); olderRead.resolve([term()]); await settle();
  assert.match(section(h.host, 'Vocabulary').textContent, /enthalpy/); assert.doesNotMatch(section(h.host, 'Vocabulary').textContent, /entropy/);
});

test('deletion completion re-reads rather than removing a term recreated in the authoritative store', async t => {
  const deletion = deferred<void>(); let reads = 0;
  const h = setup(t, { listVocabulary: async () => { reads++; return [term()]; }, deleteVocabulary: () => deletion.promise }); await h.settings();
  button(section(h.host, 'Vocabulary'), 'Delete').click(); button(h.host, 'Delete entropy').click(); await settle();
  deletion.resolve(); await settle(); assert.equal(reads, 2); assert.match(section(h.host, 'Vocabulary').textContent, /entropy/); assert.equal(button(section(h.host, 'Vocabulary'), 'Delete').disabled, false);
});

test('synchronous vocabulary deletion failure restores a usable current action', async t => {
  const h = setup(t, { listVocabulary: async () => [term()], deleteVocabulary: () => { throw new Error('delete unavailable'); } }); await h.settings();
  button(section(h.host, 'Vocabulary'), 'Delete').click(); button(h.host, 'Delete entropy').click(); await settle();
  assert.match(h.live(), /delete unavailable/); assert.equal(button(section(h.host, 'Vocabulary'), 'Delete').disabled, false);
});

for (const mode of ['throw', 'reject'] as const) for (const action of ['open', 'restored', 'close', 'permissions'] as const) test(`${action} owns a ${mode}ing callback and reports the correct lifecycle`, async t => {
  const failure = () => { if (mode === 'throw') throw new Error('adapter unavailable'); return Promise.reject(new Error('adapter unavailable')); };
  const h = setup(t, { listThreads: async () => [thread('one', action === 'restored')], restoreThread: async () => ({ ...thread(), revision: 2 }), onOpenThread: failure, onClose: failure, onManagePermissions: failure }); await settle();
  if (action === 'permissions') { await h.settings(); button(h.host, 'Manage permissions').click(); }
  else if (action === 'restored') { button(h.host, 'Removed').click(); button(h.host, 'Restore and open').click(); }
  else if (action === 'open') keyed(h.host, 'open-one').click();
  else button(h.host, 'Close').click();
  await settle(); assert.match(h.live(), /adapter unavailable/);
  assert.match(h.live(), action === 'restored' ? /restored but could not be opened/ : action === 'close' ? /library could not be closed/ : action === 'permissions' ? /Permissions could not be opened/ : /thread could not be opened/);
});

for (const bad of ['identity', 'removed'] as const) test(`restoration still rejects a bad ${bad} before opening`, async t => {
  let opened = 0;
  const h = setup(t, { listThreads: async () => [thread('one', true)], restoreThread: async () => bad === 'identity' ? thread('two') : thread('one', true), onOpenThread: () => { opened++; } });
  await settle(); button(h.host, 'Removed').click(); button(h.host, 'Restore and open').click(); await settle();
  assert.equal(opened, 0); assert.match(h.live(), bad === 'identity' ? /different thread/ : /did not restore/);
});

test('navigation supersedes pending restore/open work and older callback errors', async t => {
  const restore = deferred<Thread>(), open = deferred<void>(); let opened = 0;
  const h = setup(t, { listThreads: async () => [thread('one', true), thread('two')], restoreThread: () => restore.promise, onOpenThread: () => { opened++; return open.promise; } });
  await settle(); button(h.host, 'Removed').click(); button(h.host, 'Restore and open').click(); await settle();
  await h.settings(); restore.resolve(thread()); await settle(); assert.equal(opened, 0);
  button(h.host, 'Library').click(); keyed(h.host, 'filter-open').click();
  keyed(h.host, 'open-two').click(); await settle(); assert.equal(opened, 1); await h.settings(); open.reject(new Error('old open failure')); await settle();
  assert.doesNotMatch(h.live(), /old open failure/);
});

test('successful close destroys the mount and fences pending saves, deletions and exports', async t => {
  const save = deferred<ModelSettings>(), deletion = deferred<void>(), exported = deferred<unknown>(); let reads = 0;
  const h = setup(t, { saveModels: () => save.promise, listVocabulary: async () => { reads++; return [term()]; }, deleteVocabulary: () => deletion.promise, exportThread: () => exported.promise });
  await h.settings(); button(h.host, 'Save model choices').click(); button(section(h.host, 'Vocabulary'), 'Delete').click(); button(h.host, 'Delete entropy').click(); await settle();
  button(h.host, 'Library').click(); button(h.host, 'Export JSON').click(); await settle(); button(h.host, 'Close').click(); await settle();
  const readsAtClose = reads; save.reject(new Error('late save')); deletion.resolve(); exported.resolve({ late: true }); await settle();
  assert.equal(h.host.children.length, 0); assert.equal(reads, readsAtClose);
});

test('destroy before callback invocation prevents side effects; replacement mount rejects old completions', async t => {
  let opens = 0; const oldExport = deferred<unknown>();
  const h = setup(t, { onOpenThread: () => { opens++; }, exportThread: () => oldExport.promise }); await settle();
  button(h.host, 'Export JSON').click(); await settle(); keyed(h.host, 'open-one').click(); h.remount({ listThreads: async () => [thread('replacement')] });
  oldExport.resolve({ old: true }); await settle();
  assert.equal(opens, 0); assert.match(h.host.textContent, /replacement/); assert.ok(h.host.querySelector('pre') === null);
});

test('narrow model fields use content height and model wording does not claim installation', () => {
  const css = readFileSync(new URL('../ui/library/library.css', import.meta.url), 'utf8');
  assert.match(css.split('@media (max-width: 640px)')[1].split('@media')[0], /\.ml-models__field\s*\{\s*flex:\s*0 0 auto;/);
  const source = readFileSync(new URL('../ui/library/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /installed models|JSON export downloaded\./);
});


test('absent adapters retain honest model, vocabulary, and permission sections', async t => {
  const h = setup(t, { loadModels: undefined, listVocabulary: undefined }); await h.settings();
  for (const title of ['Model choices', 'Vocabulary', 'Permissions and exclusions']) assert.match(section(h.host, title).textContent, /unavailable/);
  assert.equal(h.host.querySelectorAll('input').length, 0);
});

test('synchronous permission failures release ownership and leave section retries usable', async t => {
  let reads = 0;
  const h = setup(t, { permissions: {
    load: async () => { reads++; return { grants: [grant], exclusions: [] }; },
    revoke: () => { throw new Error('revoke unavailable'); },
    setExcluded: () => { throw new Error('exclusion unavailable'); },
  } });
  await h.settings(); button(h.host, 'Revoke').click(); await settle();
  assert.match(section(h.host, 'Permissions and exclusions').textContent, /revoke unavailable/);
  assert.equal(button(h.host, 'Revoke').disabled, false);
  edit(h.host.querySelector('.m-consent-settings')!.querySelector('input')!, 'https://example.com');
  button(h.host, 'Exclude site').click(); await settle();
  assert.match(section(h.host, 'Permissions and exclusions').textContent, /exclusion unavailable/);
  button(h.host, 'Library').click(); await h.settings(); assert.equal(reads, 2);
});
