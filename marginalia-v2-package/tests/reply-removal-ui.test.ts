import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaries, storage, asHost } from './t05-harness.ts';
import { dom, button, until, replaceGlobals } from './t05-dom.ts';
import type { SourceCapture, Thread } from '../contracts/reader.ts';
import { replyIsRemoved } from '../ui/persistence.ts';

const { mountMargin } = await import('../ui/margin.ts');
const { localPersistence, documentJournal } = await import('../ui/persistence.ts');
const capture: SourceCapture = {
  url: 'https://example.org/replies', title: 'Reply removal source', pageType: 'article',
  text: 'First passage. Second passage.', capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'test',
  sections: [{ title: 'First', start: 0, end: 15 }, { title: 'Second', start: 15, end: 30 }],
};
const source = { id: 'source', sourceId: 'page', hash: 'source-hash', text: capture.text, title: capture.title,
  capturedAt: capture.capturedAt, extractionVersion: capture.extractionVersion, pageType: capture.pageType, metadataStatus: 'provided' as const };

function env(t: import('node:test').TestContext) { return { ...dom(t), ...storage(t), namespace: crypto.randomUUID() }; }
async function seed(namespace: string) {
  const persistence = localPersistence(namespace), journal = documentJournal(namespace, persistence.journal);
  await journal.change({ id: 'keep', kind: 'keep', threadId: 'thread', capture,
    anchor: { exact: 'First passage.', prefix: '', suffix: ' Second passage.', start: 0, end: 14 }, note: 'Reader question stays.' });
  const threads = structuredClone(journal.state.threads); threads[0].sourceVersionId = source.id;
  await journal.sync(async () => {}, async () => threads);
  const thread = structuredClone(journal.state.threads[0]) as Thread;
  const versions = ['first', 'middle', 'last'].map((id, index) => ({
    id, threadId: thread.id, parentId: null, supersedes: null, hash: `hash-${id}`,
    reply: { schema: 't05.fixture', intent: index === 1 ? 'evidence' : 'define', title: `${id} reply` },
    validation: {}, answeredNote: null, revision: 1, createdAt: `2026-09-18T00:00:0${index}Z`, deletedAt: null,
  })) as any[];
  const views = versions.map(version => ({ replyVersionId: version.id, parameters: { x: 1 }, view: {}, revision: 1, updatedAt: capture.capturedAt }));
  await persistence.replies.cache('http://localhost:43120', thread.id, source, versions, views);
  return { persistence, journal, thread, versions };
}

test('reply removal reducer distinguishes local undo, acknowledged restore and conflict without losing reply data', async t => {
  const e = env(t), seeded = await seed(e.namespace);
  const middle = (await seeded.persistence.replies.list(seeded.thread.id))[1];
  await seeded.persistence.replies.setRemoved(middle, true);
  let records = await seeded.persistence.replies.list(seeded.thread.id);
  assert.deepEqual(records.map(replyIsRemoved), [false, true, false]);
  assert.equal(records[1].removal?.status, 'local');
  assert.equal(records[1].version.reply.title, 'middle reply');

  await seeded.persistence.replies.setRemoved(records[1], false);
  records = await seeded.persistence.replies.list(seeded.thread.id);
  assert.equal(records[1].removal, undefined, 'pre-ack Undo cancels the unsent intent');

  await seeded.persistence.replies.setRemoved(records[1], true);
  records = await seeded.persistence.replies.list(seeded.thread.id);
  const removeId = records[1].removal!.operationId;
  await seeded.persistence.replies.syncRemoval(records[1], async change => ({
    ...records[1].version, revision: 2, deletedAt: capture.capturedAt,
  }));
  records = await seeded.persistence.replies.list(seeded.thread.id);
  assert.equal(records[1].removal?.status, 'acknowledged');
  await seeded.persistence.replies.setRemoved(records[1], false);
  records = await seeded.persistence.replies.list(seeded.thread.id);
  assert.notEqual(records[1].removal?.operationId, removeId, 'post-ack Undo is a new operation');
  assert.equal(records[1].removal?.expectedRevision, 2);
  assert.equal(records[1].removalHistory?.[0].operationId, removeId);
  assert.equal(replyIsRemoved(records[1]), false);

  const last = records[2]; await seeded.persistence.replies.setRemoved(last, true);
  records = await seeded.persistence.replies.list(seeded.thread.id);
  await assert.rejects(seeded.persistence.replies.syncRemoval(records[2], async () => {
    throw Object.assign(new Error('This reply changed elsewhere.'), { name: 'Conflict' });
  }), { name: 'Conflict' });
  records = await seeded.persistence.replies.list(seeded.thread.id);
  assert.equal(records[2].removal?.status, 'conflict');
  assert.equal(records[2].removal?.desiredRemoved, true);
  assert.equal(records[2].version.deletedAt, null, 'helper snapshot remains available beside the local intent');
});

test('mounted Remove reply hides only the middle reply and the Undo toast restores the same saved reply', async t => {
  const e = env(t), seeded = await seed(e.namespace); boundaries.replyMounts.length = 0;
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false });
  await until(() => e.root.querySelectorAll('.m-saved-reply').length === 3);
  button(e.root, 'Ask about this note').click();
  const question = e.root.querySelector('[aria-label="Your question"]')!; question.value = 'Why does this follow?'; question.fire('input'); await api.drain();
  const middle = e.root.querySelector('[data-reply-version="middle"]')!;
  button(middle, 'Remove reply').click(); await api.drain();
  assert.equal(e.root.querySelector('[data-reply-version="middle"]'), null);
  assert.ok(e.root.querySelector('[data-reply-version="first"]'));
  assert.ok(e.root.querySelector('[data-reply-version="last"]'));
  assert.match(e.root.textContent, /Reader question stays\./);
  assert.equal(e.root.querySelector('[aria-label="Your question"]'), question); assert.equal(question.value, 'Why does this follow?');
  assert.equal(seeded.journal.state.threads[0].highlighted, false);
  assert.match(e.root.querySelector('.m-toast')!.textContent, /Reply removed\.Undo/);
  assert.match(e.root.textContent, /Removed replies \(1\)/);
  button(e.root.querySelector('.m-toast')!, 'Undo').click(); await api.drain();
  assert.ok(e.root.querySelector('[data-reply-version="middle"]'));
  assert.equal((await seeded.persistence.replies.list(seeded.thread.id))[1].version.id, 'middle');
  api.destroy(); await api.drain();
});

for (const outcome of ['acknowledged', 'committed-response-lost', 'not-committed'] as const) test(`offline removal survives remount and explicit save reconciles Undo (${outcome})`, async t => {
  const lostAck = outcome !== 'acknowledged';
  const e = env(t), seeded = await seed(e.namespace);
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  const calls: { path: string; body?: any }[] = []; let helperRevision = 1;
  const receipts = new Map<string, { body: unknown; reply: any }>();
  replaceGlobals(t, { fetch: async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname, body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    if (path === '/api/position') return Response.json({ anchor: null });
    if (path === '/api/reply-removal') {
      if (outcome === 'not-committed' && calls.filter(call => call.path === path).length === 1) throw new Error('Request never arrived');
      const receipt = receipts.get(body.id);
      if (receipt) {
        assert.deepEqual(body, receipt.body, 'receipt replay preserves the exact original body');
        return Response.json({ reply: receipt.reply });
      }
      if (body.expectedRevision !== helperRevision) return Response.json({ error: 'This reply changed elsewhere.' }, { status: 409 });
      helperRevision++;
      const original = seeded.versions.find(version => version.id === body.replyVersionId)!;
      const reply = { ...original, revision: helperRevision, deletedAt: body.removed ? capture.capturedAt : null };
      receipts.set(body.id, { body: structuredClone(body), reply });
      if (outcome === 'committed-response-lost' && helperRevision === 2) throw new Error('Acknowledgement lost after commit');
      return Response.json({ reply });
    }
    throw new Error('Unexpected outbound request: ' + path);
  } });

  let api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: e.document.location.origin });
  await until(() => e.root.querySelectorAll('.m-saved-reply').length === 3);
  const initialCalls = calls.length;
  button(e.root.querySelector('[data-reply-version="middle"]')!, 'Remove reply').click(); await api.drain();
  assert.equal(calls.length, initialCalls, 'local removal does not send');
  api.destroy(); await api.drain();

  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: e.document.location.origin });
  await until(() => /Removed replies \(1\)/.test(e.root.textContent));
  assert.equal(calls.filter(call => call.path === '/api/reply-removal').length, 0, 'reconnect/remount does not drain removal intent');
  button(e.root, 'Save reply changes to helper').click(); await api.drain();
  const removal = calls.filter(call => call.path === '/api/reply-removal');
  assert.equal(removal.length, 1); assert.equal(removal[0].body.removed, true); assert.equal(removal[0].body.expectedRevision, 1);
  assert.deepEqual(Object.keys(removal[0].body).sort(), ['expectedRevision', 'id', 'removed', 'replyVersionId', 'threadId']);
  const removeOperationId = removal[0].body.id;

  const removedHistory = e.root.querySelector('.m-removed-replies')!;
  button(removedHistory, 'Undo').click(); await api.drain();
  assert.ok(e.root.querySelector('[data-reply-version="middle"]'), 'Undo renders immediately before helper sync');
  assert.equal(e.root.querySelector('.m-removed-replies'), null);
  assert.equal(calls.filter(call => call.path === '/api/reply-removal').length, 1, 'post-ack Undo is local until explicit save');
  let middle = (await seeded.persistence.replies.list(seeded.thread.id)).find(record => record.version.id === 'middle')!;
  assert.equal(middle.removal?.status, lostAck ? 'pending' : 'local');
  assert.equal(middle.removal?.expectedRevision, lostAck ? 1 : 2);
  if (lostAck) assert.equal(middle.removal?.operationId, removeOperationId);
  else assert.notEqual(middle.removal?.operationId, removeOperationId);
  api.destroy(); await api.drain();
  api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, helperOrigin: e.document.location.origin });
  await until(() => !!e.root.querySelector('[data-reply-version="middle"]'));
  assert.equal(calls.filter(call => call.path === '/api/reply-removal').length, 1, 'reopening local Undo sends nothing');
  assert.match(e.root.textContent, /Reader question stays\./);
  assert.equal(seeded.journal.state.threads[0].highlighted, false);
  button(e.root, 'Save reply changes to helper').click(); await api.drain();
  const operations = calls.filter(call => call.path === '/api/reply-removal');
  assert.equal(operations.length, lostAck ? 3 : 2);
  if (lostAck) assert.deepEqual(operations[1].body, operations[0].body);
  const restore = operations.at(-1)!;
  assert.equal(restore.body.removed, false); assert.equal(restore.body.expectedRevision, 2);
  assert.notEqual(restore.body.id, operations[0].body.id);
  middle = (await seeded.persistence.replies.list(seeded.thread.id)).find(record => record.version.id === 'middle')!;
  assert.equal(middle.removal?.status, 'acknowledged'); assert.equal(middle.version.revision, 3);
  assert.equal(middle.version.deletedAt, null); assert.equal(helperRevision, 3);
  assert.equal(calls.some(call => /ask|retriev|solver|recompute|job/.test(call.path)), false);
  api.destroy(); await api.drain();
});

test('an old removal receipt preserves a newer helper snapshot and the queued local choice as a conflict', async t => {
  const e = env(t), seeded = await seed(e.namespace);
  const middle = (await seeded.persistence.replies.list(seeded.thread.id))[1];
  await seeded.persistence.replies.setRemoved(middle, true);
  const receipt = { ...middle.version, revision: 2, deletedAt: capture.capturedAt };
  let sent: unknown;
  await assert.rejects(seeded.persistence.replies.syncRemoval(middle, async change => {
    sent = change; throw new Error('Lost response');
  }), /Lost response/);
  await seeded.persistence.replies.setRemoved(middle, false);
  const newer = { ...middle.version, revision: 3, deletedAt: null };
  await seeded.persistence.replies.cache(middle.origin, middle.version.threadId, middle.source, [newer], [middle.remoteView]);
  let calls = 0;
  await assert.rejects(seeded.persistence.replies.syncRemoval(middle, async change => {
    calls++; assert.deepEqual(change, sent); return receipt;
  }), { name: 'Conflict' });
  assert.equal(calls, 1, 'no compensating operation follows an obsolete receipt');
  const current = (await seeded.persistence.replies.list(seeded.thread.id))[1];
  assert.deepEqual(current.version, newer);
  assert.equal(current.removal?.status, 'conflict');
  assert.equal(current.removal?.desiredRemoved, true);
  assert.equal(current.removal?.queuedRemoved, false);
  assert.equal(replyIsRemoved(current), false);
});
