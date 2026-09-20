import test from 'node:test';
import assert from 'node:assert/strict';
import { storage, asHost } from './t05-harness.ts';
import { dom, button, deferred, settle, replaceGlobals } from './t05-dom.ts';
import type { SourceCapture, QuoteAnchor } from '../contracts/reader.ts';
const { mountMargin } = await import('../ui/margin.ts');
const { documentJournal, localPersistence } = await import('../ui/persistence.ts');

const capture: SourceCapture = {
  url: 'https://example.org/surface-lifecycle', title: 'Surface lifecycle', pageType: 'article',
  text: 'First passage. Second passage.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'test',
  sections: [{ title: 'First', start: 0, end: 15 }, { title: 'Second', start: 15, end: 30 }],
};
const anchor: QuoteAnchor = { kind: 'quote', start: 0, end: 14, exact: 'First passage.', prefix: '', suffix: ' Second passage.' };

// Production mount/coordination with a connected DOM fixture: not browser layout evidence.
test('surface refresh retains editor, rail and host settings identity and dispatches each action once', async t => {
  let cleanup = async () => {}; t.after(() => cleanup());
  const e = { ...dom(t), ...storage(t) }, namespace = crypto.randomUUID();
  const requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => { requests.push(url); throw new Error('Unexpected request'); } });
  const journal = documentJournal(namespace, localPersistence(namespace).journal);
  await journal.load();
  await journal.change({ id: 'seed', kind: 'keep', threadId: 'thread', capture, anchor, note: 'Original note' });
  const hostSettings = e.document.createElement('section'), hostControl = e.document.createElement('button');
  hostControl.textContent = 'Host setting'; hostSettings.append(hostControl);
  let hostClicks = 0, libraryOpens = 0;
  hostControl.addEventListener('click', () => { hostClicks++; });
  const api = await mountMargin(asHost(e.root), { capture, storageName: namespace, allowHelper: false,
    settingsContent: asHost(hostSettings), onLibrary: () => { libraryOpens++; } });
  cleanup = async () => { api.destroy(); await api.drain(); };
  await api.drain();
  const note = e.root.querySelector('.m-note')!, rail = e.root.querySelector('.m-rail-thread')!;
  note.click(); await api.drain();
  const field = e.root.querySelector('[aria-label="Your note"]')!;
  field.value = 'Retained exact text\nSecond line'; field.fire('input'); await api.drain();
  field.focus(); field.selectionStart = 3; field.selectionEnd = 9; field.scrollTop = 17;
  for (let index = 0; index < 3; index++) { api.suspend(); api.resume(); await api.drain(); }
  assert.equal(e.root.querySelector('[aria-label="Your note"]'), field);
  assert.equal(e.root.querySelector('.m-rail-thread'), rail);
  assert.equal(e.document.activeElement, field);
  assert.deepEqual([field.selectionStart, field.selectionEnd, field.scrollTop], [3, 9, 17]);
  assert.equal(field.value, 'Retained exact text\nSecond line');
  assert.equal(journal.state.threads[0].notes[0].text, field.value);
  button(e.root, 'Settings').click();
  assert.equal(hostSettings.parentElement, e.root.querySelector('.m-settings'));
  hostControl.click(); assert.equal(hostClicks, 1);
  button(e.root, 'Close settings').click();
  assert.equal(e.document.activeElement, button(e.root, 'Settings'));
  button(e.root, 'Library').click(); assert.equal(libraryOpens, 1);
  assert.deepEqual(requests, []);
});

test('replacement waits for predecessor disposal writes, clears marks before position, and keeps one live surface', async t => {
  const gate = deferred<void>();
  let cleanup = async () => {}; t.after(async () => { gate.resolve(); await cleanup(); });
  const e = { ...dom(t), ...storage(t) }, namespace = crypto.randomUUID(), order: string[] = [];
  const entered = deferred<void>(); let writes = 0, restoring = false;
  const first = await mountMargin(asHost(e.root), { capture, storageName: namespace, allowHelper: false,
    readPosition: async () => undefined, positionDebounceMs: 60000,
    onSavedMarks: marks => { if (!marks.length) order.push('marks'); },
    onHighlight: value => { if (value === null) order.push('highlight'); },
    writePosition: async () => { writes++; order.push('position'); entered.resolve(); await gate.promise; order.push('durable'); },
  });
  cleanup = async () => { first.destroy(); await first.drain(); };
  await first.drain(); order.length = 0;
  first.setReadingPosition(16);
  const pending = mountMargin(asHost(e.root), { capture, storageName: namespace, allowHelper: false,
    readPosition: async () => { restoring = true; order.push('restore'); return undefined; },
  });
  await entered.promise;
  first.destroy(); first.destroy(); await settle();
  assert.equal(writes, 1); assert.equal(restoring, false);
  assert.deepEqual(order, ['marks', 'position', 'highlight']);
  assert.equal(e.root.querySelectorAll('.mg').length, 1);
  gate.resolve(); const second = await pending; await second.drain();
  cleanup = async () => { first.destroy(); second.destroy(); await first.drain(); await second.drain(); };
  assert.deepEqual(order, ['marks', 'position', 'highlight', 'durable', 'restore']);
  assert.equal(e.root.querySelectorAll('.m-note-editor').length, 1);
  assert.equal(e.root.querySelectorAll('.m-reply-frame').length, 1);
  assert.equal(e.root.querySelectorAll('.m-settings').length, 1);
  first.destroy(); assert.equal(e.root.classList.contains('m-app'), true);
  assert.equal(e.root.querySelectorAll('.mg').length, 1);
});
