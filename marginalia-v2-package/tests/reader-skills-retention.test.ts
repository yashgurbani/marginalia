import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderStore } from '../daemon/store.ts';
import { startServer } from '../daemon/server.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

for (const target of ['reply', 'thread'] as const) test(`skill provenance follows retained ${target} history through removal, reopen and restore`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'reader-skill-retention-'));
  const filename = join(root, 'reader.sqlite');
  let store = new ReaderStore(filename);
  const provenance = { name: 'last30days', catalogRevision: 'b'.repeat(64), execution: 'requested' as const };
  try {
    store.apply({ id: 'keep', kind: 'keep', threadId: 'thread', capture: {
      url: 'https://example.org/page', title: 'Page', pageType: 'article', text: 'Selected passage.',
      capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1',
    }, anchor: { exact: 'Selected passage.', prefix: '', suffix: '', start: 0, end: 17 } });
    const candidate = withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'unsure', status: 'complete',
      title: 'Skill answer', summary: 'Descriptive answer', sourceBindings: [], parameters: [], assumptions: [],
      limitations: [], checks: [], staticFallback: 'Answer', blocks: [{ type: 'text', id: 'answer', md: 'Answer' }] });
    store.commitReply({ id: 'reply', threadId: 'thread', reply: candidate, readerSkill: provenance });
    const remove = (removed: boolean, expectedRevision: number) => {
      if (target === 'reply') store.setReplyRemoved({ id: removed ? 'remove' : 'restore', replyVersionId: 'reply', removed, expectedRevision });
      else store.apply({ id: removed ? 'remove' : 'restore', kind: 'remove', threadId: 'thread', removed, expectedRevision });
    };
    remove(true, 1);
    assert.ok(target === 'reply' ? store.reply('reply')!.deletedAt : store.get('thread')!.deletedAt);
    assert.equal(target === 'reply' ? store.replies('thread').length : store.list().length, 0);
    assert.equal(store.db.prepare("SELECT count(*) FROM search WHERE entityId='reply' AND kind='reply'").pluck().get(), 0);
    store.close(); store = new ReaderStore(filename);
    assert.equal(store.db.prepare('SELECT count(*) FROM reply_versions').pluck().get(), 1);
    assert.equal(store.db.prepare('SELECT count(*) FROM reply_reader_skills').pluck().get(), 1);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(store.reply('reply')!.readerSkill, provenance);
    assert.deepEqual(store.exportThread('thread').replies[0].readerSkill, provenance);
    const helper = await startServer({ database: filename, port: 0 });
    try {
      const origin = 'chrome-extension://' + 'a'.repeat(32);
      const token = helper.pairing.exchange(helper.challenge, origin);
      const read = (path: string) => fetch(helper.origin + path, { method: 'POST',
        headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal((await read('/api/read/reply-view?threadId=thread&replyVersionId=reply')).status, 404);
      const history = await read('/api/read/replies?threadId=thread');
      assert.equal(history.status, target === 'thread' ? 404 : 200);
      if (target === 'reply') {
        const body = await history.json() as { replies: { deletedAt: string; readerSkill: unknown }[] };
        assert.ok(body.replies[0].deletedAt);
        assert.deepEqual(body.replies[0].readerSkill, provenance);
      }
      const exported = await read('/api/read/export?thread=thread');
      assert.equal(exported.status, 200, 'paired export retains removed history under the existing contract');
      assert.deepEqual((await exported.json() as { replies: { readerSkill: unknown }[] }).replies[0].readerSkill, provenance);
      assert.equal(helper.jobs.list().length, 0);
    } finally { await helper.close(); }
    remove(false, 2);
    assert.equal(store.get('thread')!.deletedAt, null);
    assert.equal(store.reply('reply')!.deletedAt, null);
    assert.deepEqual(store.replies('thread')[0].readerSkill, provenance);
    assert.deepEqual(store.reply('reply')!.reply, candidate);
    assert.equal(store.db.prepare("SELECT count(*) FROM search WHERE entityId='reply' AND kind='reply'").pluck().get(), 1);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
