import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestJourneys } from '../daemon/journeys.ts';
import type { JournalDay, JournalSource } from '../contracts/journal.ts';
import { ReaderStore } from '../daemon/store.ts';
import { JourneyEditsStore } from '../daemon/journey-edits.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountJourneys } from '../ui/library/journeys.ts';
import { dom, button, settle, deferred } from './t05-dom.ts';
import { mountJournal } from '../ui/library/journal-view.ts';
import { asHost } from './t05-harness.ts';
import { startServer } from '../daemon/server.ts';
import type { ReadingJournal } from '../contracts/journal.ts';
import { mountLibrary } from '../ui/library/index.ts';

function source(id: string, text: string, url = `https://example.test/${id}`): JournalSource {
  return { id, hash: id, url, title: id, items: [{ id, threadId: id, kind: 'passage', at: '2026-09-18T10:00:00Z', anchor: { exact: text, prefix: '', suffix: '', start: 0, end: text.length } }] };
}
const day = (...sources: JournalSource[]): JournalDay => ({ date: '2026-09-18', timeZone: 'UTC', sources });

test('two local subjects produce explained deterministic journeys independent of input order', () => {
  const input = day(source('a', 'Turbulence and enstrophy'), source('b', 'Enstrophy in turbulence'), source('c', 'Meter and stanza'), source('d', 'Stanza and meter'));
  const terms = ['turbulence', 'enstrophy', 'meter', 'stanza'];
  const result = suggestJourneys(input, terms);
  assert.equal(result.length, 2); assert.deepEqual(result.map(group => group.members.map(member => member.threadId)), [['a', 'b'], ['c', 'd']]);
  assert.equal(result[0].reasons[0].score, 5); assert.deepEqual(result[0].reasons[0].sharedTerms, ['enstrophy', 'turbulence']);
  assert.deepEqual(suggestJourneys({ ...input, sources: [...input.sources].reverse() }, [...terms].reverse()), result);
});

test('time and hostname alone cannot group unrelated saved work; a bridge cannot collapse topics', () => {
  assert.equal(suggestJourneys(day(source('a', 'one'), source('b', 'two')), []).length, 2);
  const result = suggestJourneys(day(source('a', 'red blue'), source('b', 'red blue green gold'), source('c', 'green gold')), ['red', 'blue', 'green', 'gold']);
  assert.deepEqual(result.map(group => group.members.map(member => member.threadId)), [['a', 'b'], ['c']]);
});

test('same captured address groups versions while preserving their identities', () => {
  const result = suggestJourneys(day(source('a', 'first', 'https://example.test/paper'), source('b', 'second', 'https://example.test/paper')), []);
  assert.equal(result.length, 1); assert.equal(result[0].reasons[0].sameAddress, true);
  assert.deepEqual(result[0].members.map(member => member.sourceVersionId), ['a', 'b']);
});

test('literal Unicode word matching avoids substrings and keeps note revisions within a thread', () => {
  const a = source('a', 'café flow'), b = source('b', 'cafe\u0301 flow'), c = source('c', 'caféteria flower');
  a.items.push({ ...a.items[0], id: 'note', kind: 'note', note: { noteId: 'n', revision: 2, text: 'Reader note', createdAt: a.items[0].at } });
  const result = suggestJourneys(day(a, b, c), ['café', 'flow']);
  assert.deepEqual(result.map(group => group.members.length), [2, 1]);
  assert.deepEqual(result[0].reasons[0].sharedTerms, ['café', 'flow']);
  assert.throws(() => suggestJourneys(day({ ...a, items: [{ ...a.items[0], at: 'invalid' }] }), []), /date needs review/);
});

test('remembered punctuation stays part of the term identity', () => {
  const result = suggestJourneys(day(source('a', 'C++ flow'), source('b', 'C# flow')), ['C++', 'flow']);
  assert.equal(result.length, 2);
  const same = suggestJourneys(day(source('a', 'C++ flow'), source('b', 'C++ flow')), ['C++', 'flow']);
  assert.deepEqual(same[0].reasons[0].sharedTerms, ['c++', 'flow']);
});

test('reader edits persist across service recreation, reject conflicts and filter removed passages on replay', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close());
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-18T10:00:00Z') });
  try {
    for (const id of ['a', 'b']) store.apply({ id: `keep-${id}`, kind: 'keep', threadId: id, capture: { url: `https://example.test/${id}`, title: id, text: id, pageType: 'paper', capturedAt: '2026-09-18T10:00:00Z', extractionVersion: 'test' }, anchor: { exact: id, prefix: '', suffix: '', start: 0, end: 1 } });
    const edits = new JourneyEditsStore(store), members = ['a', 'b'].map(threadId => ({ threadId, sourceVersionId: store.get(threadId)!.sourceVersionId }));
    const change = { operationId: 'save', date: '2026-09-18', timeZone: 'UTC', expectedRevision: 0, journeys: [{ id: 'reader-1', name: 'My question', members }] };
    const saved = edits.save(change); assert.equal(saved.revision, 1);
    assert.deepEqual(new JourneyEditsStore(store).read(change.date, 'UTC'), saved);
    assert.deepEqual(edits.save(change), saved);
    assert.throws(() => edits.save({ ...change, operationId: 'stale' }), /changed elsewhere/);
    assert.throws(() => edits.save({ ...change, journeys: [] }), /different content/);
    assert.equal(edits.read(change.date, 'America/Los_Angeles').revision, 0);
    store.apply({ id: 'remove-a', kind: 'remove', threadId: 'a', removed: true, expectedRevision: store.get('a')!.revision });
    assert.deepEqual(edits.save(change).journeys[0].members, [members[1]]);
    assert.throws(() => edits.save({ ...change, operationId: 'resurrect', expectedRevision: 1 }), /removed/);
    const split = edits.save({ ...change, operationId: 'rename', expectedRevision: 1, journeys: [{ id: 'reader-1', name: 'Renamed', members: [members[1]] }] });
    assert.equal(split.revision, 2); assert.equal(split.journeys[0].name, 'Renamed');
    assert.throws(() => edits.read('2026-02-30', 'UTC'), /valid journey day/);
    store.apply({ id: 'remove-b', kind: 'remove', threadId: 'b', removed: true, expectedRevision: store.get('b')!.revision });
    const emptyDay = edits.journal('UTC', []).days[0];
    assert.equal(emptyDay.date, change.date); assert.deepEqual(emptyDay.sources, []);
    assert.equal(emptyDay.journeys?.journeys[0].name, 'Renamed'); assert.deepEqual(emptyDay.journeys?.journeys[0].members, []);
  } finally { t.mock.timers.reset(); }
});

test('disk restart and regroup preserve reader merge, split, names and thread membership', t => {
  const directory = mkdtempSync(join(tmpdir(), 'marginalia-journeys-')), path = join(directory, 'reader.sqlite');
  let store = new ReaderStore(path);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-18T10:00:00Z') });
  try {
    for (const id of ['a', 'b', 'c']) store.apply({ id: `keep-${id}`, kind: 'keep', threadId: id, note: 'Reader text', capture: { url: `https://example.test/${id}`, title: id, text: 'flow energy', pageType: 'paper', capturedAt: new Date().toISOString(), extractionVersion: 'test' }, anchor: { exact: 'flow energy', prefix: '', suffix: '', start: 0, end: 11 } });
    let edits = new JourneyEditsStore(store);
    const members = ['a', 'b', 'c'].map(threadId => ({ threadId, sourceVersionId: store.get(threadId)!.sourceVersionId }));
    const base = { date: '2026-09-18', timeZone: 'UTC' };
    edits.save({ ...base, operationId: 'merge', expectedRevision: 0, journeys: [{ id: 'mine', name: 'My reading question', members }] });
    edits.save({ ...base, operationId: 'split', expectedRevision: 1, journeys: [{ id: 'mine', name: 'My reading question', members: members.slice(0, 2) }, { id: 'aside', name: 'Follow up', members: members.slice(2) }] });
    store.close(); store = new ReaderStore(path); edits = new JourneyEditsStore(store);
    store.apply({ id: 'edit-a', kind: 'note', threadId: 'a', noteId: 'keep-a-note', text: 'Revised reader text', expectedRevision: 1 });
    const projection = edits.journal('UTC', ['flow', 'energy']);
    assert.deepEqual(projection.days[0].journeys?.journeys.map(value => [value.name, value.members.length]), [['My reading question', 2], ['Follow up', 1]]);
    assert.equal(projection.days[0].journeys?.suggested.length, 0);
    assert.equal(projection.days[0].sources.flatMap(source => source.items).find(item => item.threadId === 'a' && item.kind === 'note')?.note?.text, 'Revised reader text');
  } finally { t.mock.timers.reset(); }
});

test('journey controls rename, merge and split locally before one explicit save', async t => {
  const e = dom(t), input = day(source('a', 'red blue'), source('b', 'red blue'), source('c', 'green gold'));
  input.journeys = { revision: 3, journeys: [
    { id: 'first', name: 'First', members: [{ threadId: 'a', sourceVersionId: 'a' }, { threadId: 'b', sourceVersionId: 'b' }] },
    { id: 'second', name: 'Second', members: [{ threadId: 'c', sourceVersionId: 'c' }] },
  ], suggested: [] };
  const changes: import('../contracts/journeys.ts').JourneyEditChange[] = [];
  const mount = mountJourneys(asHost(e.root), input, async change => { changes.push(change); });
  const inputs = () => e.root.querySelectorAll('input') as Array<import('./t05-dom.ts').TestElement & { checked: boolean }>;
  const names = () => inputs().filter(node => node.type !== 'checkbox');
  button(e.root, 'Open journey').click();
  names()[0].value = 'Reader name'; names()[0].fire('input');
  const boxes = inputs().filter(node => node.type === 'checkbox');
  boxes[2].checked = true; boxes[2].fire('change');
  button(e.root, 'Merge selected journeys').click(); assert.equal(names()[0].value, 'Reader name');
  const member = inputs().filter(node => node.type === 'checkbox')[0]; member.checked = true; member.fire('change');
  button(e.root, 'Split selected passages').click(); assert.equal(changes.length, 0);
  button(e.root, 'Save journeys').click(); await settle();
  assert.equal(changes.length, 1); assert.equal(changes[0].expectedRevision, 3); assert.deepEqual(changes[0].journeys.map(value => value.members.length), [2, 1]);
  mount.destroy();
});

test('journey detail opens page and passage members and supports proposal decisions', async t => {
  const e = dom(t), passage = source('passage', 'Read this passage');
  const page = source('page', ''); page.items[0] = { ...page.items[0], kind: 'bookmark', anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 } };
  const input = day(passage, page);
  input.journeys = {
    revision: 0,
    journeys: [{ id: 'accepted', name: 'Accepted', members: [{ threadId: 'passage', sourceVersionId: 'passage' }, { threadId: 'page', sourceVersionId: 'page' }] }],
    suggested: ['one', 'two', 'three'].map(id => ({ id, name: `Proposal ${id}`, members: [{ threadId: 'passage', sourceVersionId: 'passage' }], reasons: [], origin: 'local' as const, algorithm: 'saved-activity-complete-link.v1' as const })),
  };
  const opened: string[] = [], changes: import('../contracts/journeys.ts').JourneyEditChange[] = [];
  const mount = mountJourneys(asHost(e.root), input, async change => { changes.push(change); }, undefined, async (_source, item, current) => { assert.equal(current(), true); opened.push(item.kind); });
  t.after(() => mount.destroy());
  button(e.root, 'Open journey').click(); button(e.root, 'Open passage').click(); await settle(); button(e.root, 'Open page').click(); await settle();
  assert.deepEqual(opened, ['passage', 'bookmark']);
  button(e.root, 'Back to journeys').click(); button(e.root, 'Open proposal').click(); button(e.root, 'Accept').click(); await settle();
  assert.equal(changes[0].journeys.at(-1)?.name, 'Proposal one');
  button(e.root, 'Back to journeys').click(); button(e.root, 'Open proposal').click();
  const rename = e.root.querySelector('input')!; rename.value = 'Reader title'; rename.fire('input'); button(e.root, 'Rename and accept').click(); await settle();
  assert.equal(changes[1].journeys.at(-1)?.name, 'Reader title');
  button(e.root, 'Back to journeys').click(); button(e.root, 'Open proposal').click(); button(e.root, 'Dismiss').click();
  assert.match(e.root.textContent, /Proposal dismissed for this session/); assert.match(e.root.textContent, /No proposed journeys/);
  assert.deepEqual(mount.draft()?.dismissed, ['three']);
});

test('Journeys is a first-class Library page with accepted and proposed groups', async t => {
  const e = dom(t), accepted = source('accepted', 'saved question'), proposed = source('proposed', 'new question');
  const input = day(accepted, proposed);
  input.journeys = {
    revision: 2,
    journeys: [{ id: 'mine', name: 'Accepted reading', members: [{ threadId: 'accepted', sourceVersionId: 'accepted' }] }],
    suggested: [{ id: 'next', name: 'Proposed reading', members: [{ threadId: 'proposed', sourceVersionId: 'proposed' }], reasons: [], origin: 'local', algorithm: 'saved-activity-complete-link.v1' }],
  };
  let reads = 0;
  const mount = mountLibrary(asHost(e.root), {
    listThreads: async () => [], exportThread: async id => ({ id }), onOpenThread() {}, onClose() {},
    readJournal: async () => { reads++; return { schema: 'marginalia.journal.v1', coverage: 'saved-activity', timeZone: 'UTC', days: [input] }; },
    saveJourneys: async () => {},
  });
  t.after(() => mount.destroy()); await settle();
  assert.equal(reads, 0); button(e.root, 'Journeys').click(); await settle();
  assert.equal(reads, 1); assert.match(e.root.textContent, /Accepted reading/); assert.match(e.root.textContent, /Proposed reading/);
  assert.doesNotMatch(e.root.textContent, /Open saved passage/);
  button(e.root, 'Open journey').click(); const name = e.root.querySelector('input[data-journal-focus]')!; name.value = 'Draft reading'; name.fire('input'); name.focus();
  assert.equal(e.document.activeElement.dataset.journalFocus, 'journey-name:mine');
  button(e.root, 'Library').click(); button(e.root, 'Journeys').click();
  assert.equal(reads, 1); assert.equal(e.root.querySelector('input[data-journal-focus]')!.value, 'Draft reading');
});

test('journey member opening uses the Journal stale-member checks', async t => {
  const e = dom(t), saved = source('saved', 'Current passage');
  const input = day(saved); input.journeys = { revision: 1, journeys: [{ id: 'journey', name: 'Saved journey', members: [{ threadId: 'saved', sourceVersionId: 'saved' }] }], suggested: [] };
  let opens = 0;
  const mount = mountLibrary(asHost(e.root), {
    listThreads: async () => [{ id: 'saved', anchorId: 'anchor', state: 'open', revision: 1, createdAt: saved.items[0].at, updatedAt: saved.items[0].at, deletedAt: null, sourceVersionId: 'saved', sourceUrl: saved.url, sourceTitle: saved.title, notes: [], highlighted: false, anchor: { ...saved.items[0].anchor, exact: 'Changed passage' } }],
    exportThread: async id => ({ id }), onOpenThread() {}, onOpenPassage: async () => { opens++; }, onClose() {},
    readJournal: async () => ({ schema: 'marginalia.journal.v1', coverage: 'saved-activity', timeZone: 'UTC', days: [input] }),
  });
  t.after(() => mount.destroy()); await settle(); button(e.root, 'Journeys').click(); await settle(); button(e.root, 'Open journey').click(); button(e.root, 'Open passage').click(); await settle();
  assert.equal(opens, 0); assert.match(e.root.textContent, /saved member is unavailable/);
});

test('paired journey route saves local edits with zero provider jobs or egress and rejects stale origins', async t => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
  try {
    helper.store.apply({ id: 'keep', kind: 'keep', threadId: 'a', capture: { url: 'https://example.test/a', title: 'A', text: 'Source', pageType: 'paper', capturedAt: new Date().toISOString(), extractionVersion: 'test' }, anchor: { exact: 'Source', prefix: '', suffix: '', start: 0, end: 6 } });
    const origin = 'chrome-extension://' + 'a'.repeat(32), headers = { Origin: origin, 'Content-Type': 'application/json' };
    const pair = await fetch(helper.origin + '/pair', { method: 'POST', headers, body: JSON.stringify({ challenge: helper.challenge }) });
    const credential = (await pair.json() as { token: string }).token;
    const authorized = { ...headers, Authorization: `Bearer ${credential}` };
    const response = await fetch(helper.origin + '/api/read/library-journal?timeZone=UTC', { method: 'POST', headers: authorized, body: '{}' });
    const journal = (await response.json() as { journal: ReadingJournal }).journal, savedDay = journal.days[0];
    const change = { operationId: 'save', date: savedDay.date, timeZone: 'UTC', expectedRevision: 0, journeys: savedDay.journeys!.suggested.map(({ id, name, members }) => ({ id, name, members })) };
    const counts = () => ['jobs', 'egress_events'].map(table => (helper.store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);
    const before = counts();
    const request = (sentHeaders: Record<string, string>) => fetch(helper.origin + '/api/journeys', { method: 'POST', headers: sentHeaders, body: JSON.stringify(change) });
    assert.equal((await request(headers)).status, 401);
    assert.equal((await request({ ...authorized, Origin: 'chrome-extension://' + 'b'.repeat(32) })).status, 401);
    assert.equal((await request(authorized)).status, 200); assert.deepEqual(counts(), before);
    const fresh = new JourneyEditsStore(helper.store).journal('UTC', []);
    assert.equal(fresh.days[0].journeys?.revision, 1); assert.equal(fresh.days[0].journeys?.suggested.length, 0);
  } finally { await helper.close(); }
});

test('journal preserves unsaved names across day switches and export; late save cannot revive a closed view', async t => {
  const e = dom(t), pending = deferred<ReadingJournal>(), saved = deferred<void>(); let reads = 0;
  const first: JournalDay = { ...day(), journeys: { revision: 0, journeys: [{ id: 'j', name: 'Original', members: [] }], suggested: [] } };
  const snapshot: ReadingJournal = { schema: 'marginalia.journal.v1', coverage: 'saved-activity', timeZone: 'UTC', days: [first, { ...first, date: '2026-09-17' }] };
  const mount = mountJournal(asHost(e.root), { read: () => ++reads === 1 ? Promise.resolve(snapshot) : pending.promise, open: async () => {}, saveJourneys: () => saved.promise });
  await settle(); button(e.root, 'Open journey').click(); const name = e.root.querySelector('input')!; name.value = 'My draft'; name.fire('input');
  let picker = e.root.querySelector('select')!; picker.value = '2026-09-17'; picker.fire('change');
  picker = e.root.querySelector('select')!; picker.value = '2026-09-18'; picker.fire('change');
  button(e.root, 'Open journey').click();
  assert.equal(e.root.querySelector('input')!.value, 'My draft');
  button(e.root, 'Export day').click(); button(e.root, 'Open journey').click(); assert.equal(e.root.querySelector('input')!.value, 'My draft');
  button(e.root, 'Save journeys').click(); mount.destroy(); saved.resolve(); pending.resolve(snapshot); await settle();
  assert.equal(e.root.textContent, '');
  assert.equal(reads, 2, 'disposed save completion starts no follow-up read');
});

test('save settled after day navigation advances its draft base while preserving a newer name', async t => {
  const e = dom(t), pending = deferred<void>(), changes: import('../contracts/journeys.ts').JourneyEditChange[] = [];
  const make = (date: string): JournalDay => ({ date, timeZone: 'UTC', sources: [], journeys: { revision: 0, journeys: [{ id: date, name: 'Original', members: [] }], suggested: [] } });
  const snapshot: ReadingJournal = { schema: 'marginalia.journal.v1', coverage: 'saved-activity', timeZone: 'UTC', days: [make('2026-09-18'), make('2026-09-17')] };
  const mount = mountJournal(asHost(e.root), { read: async () => structuredClone(snapshot), open: async () => {}, saveJourneys: async change => {
    changes.push(change); if (changes.length === 1) await pending.promise;
    snapshot.days[0].journeys = { revision: change.expectedRevision + 1, journeys: change.journeys, suggested: [] };
  } }); t.after(() => mount.destroy()); await settle();
  button(e.root, 'Open journey').click(); let name = e.root.querySelector('input')!; name.value = 'Saved name'; name.fire('input'); button(e.root, 'Save journeys').click();
  let picker = e.root.querySelector('select')!; picker.value = '2026-09-17'; picker.fire('change');
  picker = e.root.querySelector('select')!; picker.value = '2026-09-18'; picker.fire('change');
  button(e.root, 'Open journey').click();
  name = e.root.querySelector('input')!; name.value = 'Newer local name'; name.fire('input');
  pending.resolve(); await settle(); await settle();
  assert.equal(e.root.querySelector('input')!.value, 'Newer local name');
  button(e.root, 'Save journeys').click(); await settle();
  assert.equal(changes[1].expectedRevision, 1); assert.equal(changes[1].journeys[0].name, 'Newer local name');
});
