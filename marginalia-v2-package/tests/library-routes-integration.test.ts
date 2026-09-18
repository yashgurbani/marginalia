import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../daemon/server.ts';
import { ReaderStore } from '../daemon/store.ts';

test('library import, recap, answer, share and ambient policy are mounted behind pairing', async () => {
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
  const origin = 'chrome-extension://' + 'b'.repeat(32);
  const source = new ReaderStore(':memory:');
  try {
    source.apply({ id: 'keep-import', kind: 'keep', threadId: 'imported-gradient', capture: {
      url: 'https://example.org/gradient', title: 'Gradient', pageType: 'article', text: 'A gradient measures change across space.',
      capturedAt: '2026-09-18T10:00:00.000Z', extractionVersion: 'test-v1',
    }, anchor: { exact: 'gradient', prefix: 'A ', suffix: ' measures', start: 2, end: 10 }, note: 'Gradient is useful for change.' });
    const exported = source.exportThread('imported-gradient');
    const paths = ['/api/ambient/policy?sourceUrl=https://example.org&type=article',
      '/api/library-journal-summary?date=2026-09-18&timeZone=UTC', '/api/library-answer?q=gradient',
      '/api/share/thread?thread=imported-gradient&format=text'];
    for (const path of paths) assert.equal((await fetch(helper.origin + path)).status, 401);
    assert.equal((await fetch(helper.origin + '/api/import/thread/preview', { method: 'POST', body: '{}' })).status, 401);
    const pairing = await fetch(helper.origin + '/pair', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ challenge: helper.challenge }) });
    const { token } = await pairing.json();
    const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const previewResponse = await fetch(helper.origin + '/api/import/thread/preview', { method: 'POST', headers, body: JSON.stringify(exported) });
    assert.equal(previewResponse.status, 200);
    const { preview } = await previewResponse.json();
    assert.equal(helper.store.list().length, 0);
    const imported = await fetch(helper.origin + '/api/import/thread?previewDigest=' + preview.digest, { method: 'POST', headers, body: JSON.stringify(exported) });
    assert.equal(imported.status, 200); assert.equal((await imported.json()).imported.threadId, 'imported-gradient');
    const ambient = await fetch(helper.origin + paths[0], { headers });
    assert.equal(ambient.status, 200); assert.equal((await ambient.json()).policy.reason, 'auto-assist-disabled');
    helper.consent.setExclusion('https://example.org', true);
    const excluded = await fetch(helper.origin + '/api/ambient/policy?sourceUrl=https://sub.example.org&type=article', { headers });
    assert.equal((await excluded.json()).policy.reason, 'site-excluded');
    const recap = await fetch(helper.origin + paths[1], { headers });
    assert.equal(recap.status, 200); assert.equal((await recap.json()).summary.kind, 'local-recap');
    const alias = await fetch(helper.origin + '/api/read/library-journal-summary?date=2026-09-18&timeZone=UTC', { method: 'POST', headers, body: '{}' });
    assert.equal(alias.status, 200);
    const answer = await fetch(helper.origin + paths[2], { headers });
    assert.equal(answer.status, 200); assert.ok((await answer.json()).answer.citations.length);
    const share = await fetch(helper.origin + paths[3], { headers });
    assert.equal(share.status, 200); assert.match(share.headers.get('content-disposition') ?? '', /attachment/);
    assert.match(await share.text(), /gradient/i);
    assert.equal(helper.jobs.list().length, 0);
  } finally { source.close(); await helper.close(); }
});
