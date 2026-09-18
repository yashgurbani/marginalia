import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ReaderStore } from '../daemon/store.ts';
import { startServer } from '../daemon/server.ts';
import { replyOriginParts } from '../contracts/reply-origins.ts';
import type { CandidateReply } from '../contracts/reply.ts';
import type { ReadingJournal } from '../contracts/journal.ts';
import { exportJournalDay, mountJournal } from '../ui/library/journal-view.ts';
import { mountLibrary } from '../ui/library/index.ts';
import { HelperClient } from '../ui/helper.ts';
import { validateSavedPassage } from '../ui/library/passage.ts';
import { dom, button, settle, until, deferred } from './t05-dom.ts';
import { asHost } from './t05-harness.ts';

function keep(store: ReaderStore, id: string, text = 'Source passage.', whole = false) {
  store.apply({ id: `keep-${id}`, kind: 'keep', threadId: id, note: 'First note.',
    capture: { url: 'https://example.test/paper', title: 'Saved paper', pageType: 'paper', text, capturedAt: '2026-09-01T00:00:00Z', extractionVersion: 'test' },
    anchor: whole ? { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 } : { exact: text, prefix: '', suffix: '', start: 0, end: text.length } });
}
function fixture(store: ReaderStore, t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-18T00:30:00Z') });
  try {
  keep(store, 'a'); t.mock.timers.tick(600000);
  keep(store, 'b', 'Changed source passage.', true); t.mock.timers.tick(1200000);
  store.apply({ id: 'highlight-a', kind: 'highlight', threadId: 'a', highlighted: true, expectedRevision: store.get('a')!.revision });
  t.mock.timers.tick(600000);
  const reply: CandidateReply = { schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Saved illustration', summary: 'Generated summary.', sourceBindings: [], parameters: [], assumptions: [], limitations: [], blocks: [{ id: 'text', type: 'text', md: 'An analogy.' }], checks: [], staticFallback: 'An analogy.' };
  reply.origins = { version: 1, parts: Object.fromEntries(replyOriginParts(reply).map(part => [part.path, { kind: 'authored', description: 'Generated explanation.' }])) };
  store.commitReply({ id: 'reply-a', threadId: 'a', reply });
  t.mock.timers.tick(86400000 - 2400000);
  store.apply({ id: 'edit-a', kind: 'note', threadId: 'a', noteId: 'keep-a-note', text: 'Later note.', expectedRevision: 1 });
  } finally { t.mock.timers.reset(); }
}

test('journal uses saved activity dates and local calendar boundaries, preserving immutable versions and note history', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); fixture(store, t);
  const before = JSON.stringify(store.events()), journal = store.readingJournal('UTC');
  assert.equal(journal.coverage, 'saved-activity'); assert.deepEqual(journal.days.map(day => day.date), ['2026-09-19', '2026-09-18']);
  const day = journal.days[1]; assert.equal(day.sources.length, 2); assert.notEqual(day.sources[0].id, day.sources[1].id);
  assert.equal(day.sources[0].items.find(item => item.kind === 'note')?.note?.text, 'First note.');
  assert.equal(journal.days[0].sources[0].items[0].note?.text, 'Later note.');
  assert.equal(day.sources[0].items.find(item => item.kind === 'note')?.currentNoteRevision, 2);
  assert.ok(day.sources[0].items.some(item => item.kind === 'highlight')); assert.ok(day.sources[0].items.some(item => item.kind === 'reply'));
  assert.ok(day.sources[1].items.some(item => item.kind === 'bookmark'));
  assert.deepEqual(store.readingJournal('America/Los_Angeles').days.map(day => day.date), ['2026-09-18', '2026-09-17']);
  assert.deepEqual(store.readingJournal('UTC'), journal); assert.equal(JSON.stringify(store.events()), before);
  assert.throws(() => store.readingJournal('Invented/Zone'), /valid journal time zone/);
  assert.equal(day.sources[0].items[0].at, '2026-09-18T00:30:00.000Z', 'capture date is not substituted for saved activity');
});

test('removed notes, highlights, replies and threads stay out of the journal and day exports', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); fixture(store, t);
  store.apply({ id: 'remove-note', kind: 'note-remove', threadId: 'a', noteId: 'keep-a-note', removed: true, expectedRevision: 2 });
  store.apply({ id: 'remove-highlight', kind: 'highlight', threadId: 'a', highlighted: false, expectedRevision: store.get('a')!.revision });
  store.setReplyRemoved({ id: 'remove-reply', replyVersionId: 'reply-a', removed: true, expectedRevision: store.reply('reply-a')!.revision });
  store.apply({ id: 'remove-b', kind: 'remove', threadId: 'b', removed: true, expectedRevision: store.get('b')!.revision });
  const journal = store.readingJournal('UTC'); assert.equal(journal.days.length, 1); assert.equal(journal.days[0].sources.length, 1);
  assert.deepEqual(journal.days[0].sources[0].items.map(item => item.kind), ['passage']);
  const output = exportJournalDay(journal.days[0]); assert.doesNotMatch(output.json + output.markdown, /First note|Later note|Saved illustration|Changed source/);
});

test('day JSON and Markdown retain exact origins, source identity, historical notes and complete saved replies', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); fixture(store, t);
  const day = store.readingJournal('UTC').days[1], output = exportJournalDay(day), json = JSON.parse(output.json);
  assert.deepEqual(json.sources, day.sources); assert.equal(json.coverage, 'saved-activity');
  assert.match(output.markdown, /First note/); assert.doesNotMatch(output.markdown, /Later note/); assert.match(output.markdown, /saved agent reply/);
  assert.ok(output.markdown.includes(day.sources[0].hash)); assert.match(output.markdown, /marginalia.reply.v1/);
  assert.match(output.markdown, /current revision: 2/);
});

test('Library journal reads only on explicit open and opens exact saved passages without provider actions', async t => {
  const e = dom(t), store = new ReaderStore(':memory:'); t.after(() => store.close()); fixture(store, t);
  let reads = 0, opens = 0;
  const mount = mountLibrary(asHost(e.root), { listThreads: async () => store.list(), exportThread: async id => store.exportThread(id), onClose() {}, onOpenThread() { throw new Error('Expected exact passage callback'); },
    readJournal: async zone => { reads++; return store.readingJournal(zone); }, onOpenPassage: async (thread, passage, current) => {
      assert.equal(current(), true); validateSavedPassage(passage, store.sourceVersion(thread.sourceVersionId)!, thread.id); opens++;
    } });
  await settle(); assert.equal(reads, 0); button(e.root, 'Activity').click(); await until(() => !!e.root.querySelector('.ml-journal')?.textContent.includes('Later note.'));
  assert.equal(reads, 1); button(e.root, 'Open saved passage').click(); await until(() => opens === 1);
  button(e.root, 'Library').click(); assert.equal(reads, 1); mount.destroy();
});

test('journal export refreshes removed work and disposal fences late loading and downloads', async t => {
  const e = dom(t), store = new ReaderStore(':memory:'); t.after(() => store.close()); fixture(store, t);
  const blobs: Blob[] = []; t.mock.method(URL, 'createObjectURL', (blob: Blob) => { blobs.push(blob); return 'blob:day'; }); t.mock.method(URL, 'revokeObjectURL', () => {});
  let current = store.readingJournal('UTC');
  const mount = mountJournal(asHost(e.root), { read: async () => current, open: async () => {} }); await until(() => e.root.textContent.includes('Later note.'));
  store.apply({ id: 'remove-a', kind: 'remove', threadId: 'a', removed: true, expectedRevision: store.get('a')!.revision }); current = store.readingJournal('UTC');
  button(e.root, 'Export day').click(); await settle(); await settle(); assert.equal(blobs.length, 0, 'removed selected day is not downloaded');
  button(e.root, 'Export day').click(); await until(() => blobs.length === 2); assert.doesNotMatch(await blobs[0].text(), /Later note|First note.*a/);
  mount.destroy();
  const pending = deferred<ReadingJournal>(); const late = mountJournal(asHost(e.root), { read: () => pending.promise, open: async () => {} });
  late.destroy(); pending.resolve(current); await settle(); assert.equal(e.root.textContent, ''); assert.equal(blobs.length, 2);
});

test('journal helper route is paired and read-only with unchanged real job and egress tables', async t => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
  try {
    fixture(helper.store, t); const origin = 'chrome-extension://' + 'a'.repeat(32), path = '/api/read/library-journal?timeZone=UTC';
    assert.equal((await fetch(helper.origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const paired = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: helper.challenge }) });
    const credential = (await paired.json() as { token: string }).token;
    const counts = () => ['jobs', 'egress_events'].map(table => (helper.store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);
    const before = counts(), events = JSON.stringify(helper.store.events());
    const response = await fetch(helper.origin + path, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200); const payload = await response.json() as { journal: ReadingJournal }; assert.equal(payload.journal.days.length, 2);
    assert.deepEqual(counts(), before); assert.equal(JSON.stringify(helper.store.events()), events);
  } finally { await helper.close(); }
});

test('journal HelperClient selects the origin-bound read route with the exact calendar zone', async t => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { calls.push({ path: new URL(url).pathname + new URL(url).search, method: init.method!, body: init.body }); return Response.json({ journal: { days: [] } }); });
  const client = new HelperClient('http://127.0.0.1:43120'); client.token = 'x'.repeat(43);
  await client.readingJournal('America/Los_Angeles');
  assert.deepEqual(calls, [{ path: '/api/read/library-journal?timeZone=America%2FLos_Angeles', method: 'POST', body: '{}' }]);
});

test('opening a passage during export restores the export control, preserves focus and ignores late export', async t => {
  const e = dom(t), store = new ReaderStore(':memory:'); t.after(() => store.close()); fixture(store, t);
  const snapshot = store.readingJournal('UTC'), pending = deferred<ReadingJournal>(); let reads = 0, downloads = 0;
  t.mock.method(URL, 'createObjectURL', () => { downloads++; return 'blob:unexpected'; });
  const mount = mountJournal(asHost(e.root), { read: () => ++reads === 1 ? Promise.resolve(snapshot) : pending.promise, open: async () => { throw new Error('Removed'); } });
  await until(() => e.root.textContent.includes('Later note.'));
  button(e.root, 'Export day').click(); const open = button(e.root, 'Open saved passage'); open.focus(); open.click(); await settle();
  assert.equal(button(e.root, 'Export day').disabled, false); assert.equal(e.document.activeElement, open);
  pending.resolve(snapshot); await settle(); assert.equal(downloads, 0); assert.equal(button(e.root, 'Export day').disabled, false); mount.destroy();
});
