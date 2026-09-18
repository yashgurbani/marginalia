import test from 'node:test';
import assert from 'node:assert/strict';
import { asHost, storage } from './t05-harness.ts';
import { button, dom, settle } from './t05-dom.ts';
import { ReaderStore } from '../daemon/store.ts';
import { LibrarySettingsService } from '../daemon/library.ts';
import { HelperClient } from '../ui/helper.ts';
import type { SourceCapture } from '../contracts/reader.ts';
import type { VocabularyObservation } from '../contracts/library.ts';
const { mountMargin } = await import('../ui/margin.ts');
const { mountLibrary } = await import('../ui/library/index.ts');

const capturedAt = '2026-09-18T09:00:00.000Z';
const capture: SourceCapture = { url: 'https://example.test/entropy', title: 'Entropy', pageType: 'article',
  text: 'Entropy is a measure used in this passage. Another sentence.', capturedAt, extractionVersion: 'test-v1',
  sections: [{ title: 'Page', start: 0, end: 60 }] };
const anchor = { exact: 'Entropy', prefix: '', suffix: ' is a measure used in this passage.', start: 0, end: 7 };

test('definition display and note save are inert; explicit Remember alone writes locally with zero model, retrieval, or execution calls', async t => {
  const environment = { ...dom(t), ...storage(t) }, namespace = crypto.randomUUID();
  const reader = new ReaderStore(':memory:'), library = new LibrarySettingsService(reader);
  t.after(() => reader.close());
  const observations: VocabularyObservation[] = [];
  let modelCalls = 0, retrievalCalls = 0, executionCalls = 0;
  const api = await mountMargin(asHost(environment.root), { capture, storageName: namespace, allowHelper: false,
    asking: () => { modelCalls++; return { open() {}, setVisible() {}, destroy() {} }; },
    rememberVocabulary: async observation => { observations.push(structuredClone(observation)); return library.recordVocabularyObservation(observation); } });

  api.select(anchor);
  assert.match(environment.root.textContent, /Entropy is a measure used in this passage/);
  assert.equal(observations.length, 0, 'showing a successful local definition is not Remember');
  button(environment.root, 'Write here\u2026').click();
  const note = environment.root.querySelector('[aria-label="Your note"]')!;
  note.value = 'Entropy belongs in this saved note.'; note.fire('input'); button(environment.root, 'Save note').click(); await api.drain();
  assert.equal(observations.length, 0, 'saving a note does not create vocabulary');
  assert.equal(environment.root.querySelectorAll('button').some(control => control.textContent === 'Skip'), false, 'no Skip path invents a vocabulary write');

  api.select(anchor); button(environment.root, 'Remember this term').click(); await api.drain();
  assert.equal(observations.length, 1);
  assert.deepEqual({ term: observations[0].term, origin: observations[0].origin, source: observations[0].source }, { term: 'Entropy', origin: 'stated', source: { kind: 'reader' } });
  assert.deepEqual({ modelCalls, retrievalCalls, executionCalls }, { modelCalls: 0, retrievalCalls: 0, executionCalls: 0 });
  assert.match(environment.root.textContent, /records your choice about the term\. It stays separate from claims about your knowledge/);

  const reloaded = new LibrarySettingsService(reader), [entry] = reloaded.vocabulary();
  assert.equal(entry.origins?.[0].origin, 'stated');
  const libraryHost = environment.document.createElement('div'); environment.document.body.append(libraryHost);
  const libraryMount = mountLibrary(asHost(libraryHost), { listThreads: async () => [], exportThread: async () => ({}), onOpenThread() {}, onClose() {},
    loadModels: async () => ({ fast: 'luna', deep: 'astra', revision: 0, updatedAt: null, compatibilityKey: 'a'.repeat(64) }),
    listVocabulary: async () => reloaded.vocabulary(), deleteVocabulary: async term => { reloaded.deleteVocabulary(term); } });
  button(libraryHost, 'Settings').click(); await settle();
  assert.match(libraryHost.textContent, /You said this was familiar/);

  reader.apply({ id: 'saved-note', kind: 'keep', threadId: 'saved-note-thread', note: 'Entropy belongs in this saved note.', capture,
    anchor });
  reloaded.deleteVocabulary('Entropy');
  assert.equal(reloaded.vocabulary().length, 0);
  assert.equal(reader.get('saved-note-thread')?.notes[0].text, 'Entropy belongs in this saved note.', 'deleting vocabulary leaves the saved note in place');
  libraryMount.destroy(); api.destroy(); await api.drain();
});

test('HelperClient Remember uses only the local observation route', async t => {
  const calls: Array<{ path: string; method: string }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ path: new URL(url).pathname, method: init.method! });
    return Response.json({ recorded: true, deleted: false });
  });
  const client = new HelperClient('http://127.0.0.1:43120'); client.token = 'x'.repeat(43);
  await client.observeVocabulary({ operationId: 'remember-route', term: 'Entropy', origin: 'stated', observedAt: capturedAt, source: { kind: 'reader' } });
  assert.deepEqual(calls, [{ path: '/api/vocabulary/observe', method: 'POST' }]);
});
