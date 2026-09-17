import test from 'node:test';
import assert from 'node:assert/strict';
import './t05-harness.ts';
import { storage } from './t05-harness.ts';
import { deferred, settle } from './t05-dom.ts';
import { ReaderJournal, type JournalState } from '../ui/journal.ts';
import { wholePageAnchor, type ReaderMutation, type SourceCapture, type Thread } from '../contracts/reader.ts';
const { replySaveLifecycle, retryDraftMutation, documentJournal, documentDraft, documentQuestion, sourceBoundJournal, unsavedDrafts, unsavedQuestions, keepDeviceConflict, resolveHelperConflict, localPersistence } = await import('../ui/persistence.ts');
const capture: SourceCapture = { url: 'https://example.org/a', title: 'A', pageType: 'article', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'test', text: 'First passage. Second passage.' };
const keep = (id = 'keep'): Extract<ReaderMutation, {kind:'keep'}> => ({ kind: 'keep', id, threadId: id + '-thread', capture, anchor: wholePageAnchor(), note: 'Reader note' });
const state = (x: number) => ({ parameters: { x }, view: {} });
function memory() {
  let durable: JournalState | undefined, fail = false;
  const persistence = { load: async () => structuredClone(durable), save: async (value: JournalState) => { if (fail) throw new Error('quota'); durable = structuredClone(value); } };
  return { journal: new ReaderJournal(persistence), persistence, durable: () => structuredClone(durable), fail(value: boolean) { fail = value; } };
}
const lock = async (operation: () => Promise<void>) => operation();
test('A -> pending B -> final A is serialized at teardown and ignores closed renderer callbacks', async () => {
  const gate = deferred(), writes: number[] = []; let active = state(1);
  const writer = replySaveLifecycle(active, async next => { writes.push(next.parameters.x); if (writes.length === 1) await gate.promise; active = next; });
  const b = writer.save(state(2)); await settle(); const final = writer.close(state(1)); await writer.save(state(99));
  assert.deepEqual(writes, [2]); gate.resolve(); await Promise.all([b, final]); assert.deepEqual(writes, [2, 1]); assert.deepEqual(active, state(1));
});
test('explicit flush orders final A while untouched normalized mount writes nothing', async () => {
  const gate = deferred(), writes: number[] = []; const writer = replySaveLifecycle(state(1), async next => { if (next.parameters.x === 2) await gate.promise; writes.push(next.parameters.x); });
  await writer.flush(state(1)); assert.deepEqual(writes, []); const b = writer.save(state(2)), a = writer.flush(state(1)); gate.resolve(); await Promise.all([b, a]); await writer.close(state(1)); assert.deepEqual(writes, [2, 1]);
});
test('recovered competing view is preserved but is not active completed state; ordinary failure stays retryable', async () => {
  let error: Error | undefined = new Error('quota'); const writer = replySaveLifecycle(state(1), async () => { if (error) throw error; });
  await assert.rejects(writer.flush(state(2)), /quota/); const completed = writer.status().completed;
  error = Object.assign(new Error('history'), { name: 'RecoveredViewConflict' }); await writer.flush(state(2)); assert.equal(writer.status().completed, completed); assert.notEqual(writer.status().preserved, completed);
  error = undefined; await writer.flush(state(3)); assert.equal(writer.status().completed, writer.status().preserved);
});
test('retry persists unrelated unsaved journal then applies the intended immutable note exactly once', async () => {
  const m = memory(); await m.journal.load(); m.fail(true); await assert.rejects(m.journal.change(keep('older')), /quota/); m.fail(false);
  const mutation = keep('intended'), draft = { text: mutation.note!, anchor: mutation.anchor, source: capture, mutation };
  assert.equal((await retryDraftMutation(m.journal, draft)).kind, 'applied'); assert.equal((await retryDraftMutation(m.journal, draft)).kind, 'applied'); assert.deepEqual(m.durable()!.threads.map(t => t.id), ['older-thread', 'intended-thread']);
});
test('durable conflict is not an applied note; keep-device resolution unlocks but retains the draft', async () => {
  const m = memory(); await m.journal.change(keep());
  const mutation: ReaderMutation = { id: 'stale-note', kind: 'note', threadId: 'keep-thread', noteId: 'keep-note', text: 'My revised note', expectedRevision: 0 };
  const draft = { text: mutation.text, anchor: wholePageAnchor(), source: capture, mutation };
  await assert.rejects(retryDraftMutation(m.journal, draft), /changed/); assert.equal(m.journal.unsaved, false);
  await keepDeviceConflict(m.journal, lock, mutation.id);
  const result = await retryDraftMutation(m.journal, draft); assert.equal(result.kind, 'resolved');
  if (result.kind === 'resolved') { assert.equal(result.draft.text, mutation.text); assert.equal(result.draft.mutation, undefined); assert.equal(result.draft.revision, 1); }
  assert.equal(m.journal.state.threads[0].notes[0].text, 'Reader note'); assert.equal(m.journal.state.resolutions![0].resolution, 'kept-device');
});
test('failed keep-device persistence cannot masquerade as a durable choice; retry preserves text and source', async () => {
  const m = memory(); await m.journal.change(keep());
  const mutation: ReaderMutation = { id: 'conflict', kind: 'note', threadId: 'keep-thread', noteId: 'keep-note', text: 'draft', expectedRevision: 0 };
  await assert.rejects(m.journal.change(mutation)); const draft = { text: mutation.text, anchor: wholePageAnchor(), source: capture, mutation };
  m.fail(true); await assert.rejects(keepDeviceConflict(m.journal, lock, mutation.id), /quota/); assert.equal(m.journal.unsaved, true);
  await assert.rejects(retryDraftMutation(m.journal, draft), /quota/); m.fail(false);
  const result = await retryDraftMutation(m.journal, draft); assert.equal(result.kind, 'resolved'); assert.equal(m.journal.unsaved, false); assert.equal(draft.text, 'draft');
});
test('T07 chosen state and deliberate absence survive list/reload without any upload', async () => {
  const m = memory(); await m.journal.change(keep()); const original = structuredClone(m.journal.state.threads); await m.journal.sync(async () => {}, async () => original);
  const mutation: ReaderMutation = { id: 'conflict', kind: 'note', threadId: 'keep-thread', noteId: 'keep-note', text: 'draft', expectedRevision: 0 };
  await assert.rejects(m.journal.change(mutation)); await keepDeviceConflict(m.journal, lock, mutation.id);
  const remote = structuredClone(original); remote[0].revision = 99; remote[0].notes[0].text = 'helper';
  await m.journal.sync(async () => assert.fail('No upload was requested'), async () => remote);
  const loaded = new ReaderJournal(m.persistence); await loaded.load(); assert.equal(loaded.state.threads[0].notes[0].text, 'Reader note');
  const absent = memory(); const absentChange = { ...mutation, id: 'absent-choice' }; await assert.rejects(absent.journal.change(absentChange)); await keepDeviceConflict(absent.journal, lock, absentChange.id);
  await absent.journal.sync(async () => assert.fail('No upload'), async () => remote); assert.equal(absent.journal.state.threads.length, 0); assert.equal(absent.journal.state.resolutions![0].deviceVersion, null);
});
test('helper resolution acquires shared lock before reading and loading current journal', async () => {
  const m = memory(); await m.journal.change(keep()); await assert.rejects(m.journal.change({ kind: 'note', id: 'conflict', threadId: 'keep-thread', noteId: 'keep-note', text: 'draft', expectedRevision: 0 }));
  const gate = deferred(), order: string[] = [];
  const work = resolveHelperConflict(m.journal, async fn => { await gate.promise; order.push('lock'); await fn(); }, 'conflict', async () => { order.push('read'); assert.equal(m.journal.state.threads[0].notes[0].text, 'new device baseline'); return m.durable()!.threads; });
  assert.deepEqual(order, []); const other = new ReaderJournal(m.persistence); await other.load(); await other.change({ kind: 'note', id: 'new', threadId: 'keep-thread', noteId: 'keep-note', text: 'new device baseline', expectedRevision: 1 });
  gate.resolve(); await work; assert.deepEqual(order, ['lock', 'read']);
});
test('document journal handoff retains private CAS baseline and never overwrites a competing tab', async () => {
  const m = memory(), namespace = crypto.randomUUID(), first = documentJournal(namespace, m.persistence); await first.load(); m.fail(true); await assert.rejects(first.change(keep())); m.fail(false);
  const other = new ReaderJournal(m.persistence); await other.change(keep('other')); const second = documentJournal(namespace, m.persistence);
  assert.equal(first, second); await assert.rejects(second.retryPersistence(), /changed elsewhere/); assert.equal(m.durable()!.threads[0].id, 'other-thread');
});
test('draft/question hydration cannot replace interim input; failed snapshots retain namespace/source identity', async () => {
  const namespace = crypto.randomUUID(), load = deferred<any>(); let fail = true;
  const io = { read: () => load.promise, write: async () => { if (fail) throw new Error('quota'); } };
  const buffer = documentDraft(namespace, 'd', capture, io), reading = buffer.load();
  const draft = { text: 'Latest', anchor: wholePageAnchor(), source: capture, position: 7 };
  await assert.rejects(buffer.save(draft)); load.resolve({ ...draft, text: 'older' }); assert.equal((await reading)!.text, 'Latest');
  assert.equal((await documentDraft(namespace, 'd', capture, io).load())!.position, 7); assert.equal(unsavedDrafts(namespace, capture.url).length, 1); assert.equal(unsavedDrafts(namespace, 'https://other/').length, 0);
  const q = documentQuestion(namespace, 'q', capture.url, { read: async () => undefined, write: io.write });
  await assert.rejects(q.save({ capture, anchor: wholePageAnchor(), question: 'Why?', context: 'My context' })); assert.equal(unsavedQuestions(namespace, capture.url)[0].draft!.question, 'Why?');
  fail = false; await buffer.flush(); assert.equal(buffer.unsaved(), false);
});
test('source export includes orphan keep and chosen version history but excludes unrelated/ambiguous records', () => {
  const mine = keep('orphan'), other = { ...keep('other'), capture: { ...capture, url: 'https://other.example/' } };
  const journal: JournalState = { threads: [], pending: [], conflicts: [{ change: mine, message: 'recover' }, { change: other, message: 'private' }], resolutions: [{ change: mine, message: 'choice', resolvedAt: 'now', resolution: 'kept-device', deviceVersion: null }] };
  const exported = sourceBoundJournal(journal, capture.url); assert.equal(exported.conflicts.length, 1); assert.equal(exported.resolutions.length, 1); assert.ok(!JSON.stringify(exported).includes('private'));
  journal.pending.push({ ...other, threadId: mine.threadId }); assert.equal(sourceBoundJournal(journal, capture.url).conflicts.length, 0);
});
test('restore identity persists before send, survives lost acknowledgement, and returns only canonical restored state', async t => {
  storage(t); const p = localPersistence(crypto.randomUUID()); const m = memory(); await m.journal.change(keep());
  const removed: Thread = { ...m.journal.state.threads[0], sourceVersionId: 'source', deletedAt: 'yesterday', revision: 3 }, restored = { ...removed, revision: 4, deletedAt: null };
  const identities: ReaderMutation[] = []; let fail = true;
  const send = async (value: ReaderMutation) => { identities.push(value); if (fail) throw new Error('ack lost'); };
  await assert.rejects(p.library.restore('http://localhost', removed, send, async () => [restored])); fail = false;
  assert.deepEqual(await p.library.restore('http://localhost', removed, send, async () => [restored]), restored); assert.deepEqual(identities[0], identities[1]);
  await assert.rejects(p.library.restore('http://localhost', { ...removed, revision: 4 }, send, async () => [{ ...removed, revision: 6 }]), /not confirmed/);
});
