import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../daemon/server.ts';
import { wholeLibraryExport, type LibraryThreadExport } from '../ui/library/export.ts';

test('E12 uses the authenticated E05 reader export route and preserves complete removed records', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
  try {
    const capture = { url: 'https://example.org/export', title: 'Retained source', pageType: 'article', text: '🙂 saved words', capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'test' };
    helper.store.apply({ id: 'export-keep', kind: 'keep', threadId: 'export-thread', capture,
      anchor: { exact: 'saved words', prefix: '🙂 ', suffix: '', start: 3, end: 14 }, note: 'Retained note' });
    const thread = helper.store.get('export-thread')!;
    helper.store.apply({ id: 'export-remove', kind: 'remove', threadId: thread.id, removed: true, expectedRevision: thread.revision });
    const expected = JSON.parse(JSON.stringify(helper.store.exportThread(thread.id)));
    const before = JSON.stringify(helper.store.events());
    const endpoint = `${helper.origin}/api/export?thread=${thread.id}`;
    assert.equal((await fetch(endpoint)).status, 401);
    const paired = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: helper.origin },
      body: JSON.stringify({ challenge: helper.pairing.issue() }) });
    assert.equal(paired.status, 200);
    const { token } = await paired.json() as { token: string };
    const headers = { Origin: helper.origin, Authorization: `Bearer ${token}` };
    const response = await fetch(endpoint, { headers });
    assert.equal(response.status, 200);
    const record = await response.json() as LibraryThreadExport;
    assert.deepEqual(record, expected);
    const output = wholeLibraryExport([record]);
    assert.deepEqual(JSON.parse(JSON.parse(output.jsonLd).first.items[0]['marginalia:recordJson']), expected);
    assert.match(output.markdown, /Retained note/);
    assert.equal(JSON.stringify(helper.store.events()), before, 'export does not write history or source');
    assert.equal((await fetch(endpoint, { headers: { ...headers, Origin: 'chrome-extension://' + 'a'.repeat(32) } })).status, 401);
    helper.pairing.revoke(token);
    assert.equal((await fetch(endpoint, { headers })).status, 401);
  } finally { await helper.close(); }
});
