import test from 'node:test';
import assert from 'node:assert/strict';
import { ReaderStore } from '../daemon/store.ts';
import { LibrarySettingsService } from '../daemon/library.ts';
import { sourceCaptureFromVersion } from '../ui/library-entry.ts';
import { growthReply, growthSourceText } from '../fixtures/growth-reply.ts';

test('E31/E33/E38 preserve source metadata, exact related passages, and correction lineage together', () => {
  const store = new ReaderStore(':memory:');
  try {
    const sourceText = `${growthSourceText} Shared vortex passage.`;
    const anchorStart = sourceText.indexOf('Shared vortex passage.');
    store.apply({ id: 'integration-a', kind: 'keep', threadId: 'integration-a',
      capture: { url: 'https://example.org/a', title: 'Primary source', pageType: 'paper', author: 'Ada Reader', publicationDate: '2026-09-18', venue: 'Observed Journal', text: sourceText, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'dom-safe-text-v1' },
      anchor: { exact: 'Shared vortex passage.', prefix: '', suffix: '', start: anchorStart, end: anchorStart + 22 } });
    store.apply({ id: 'integration-b', kind: 'keep', threadId: 'integration-b',
      capture: { url: 'https://example.org/b', title: 'Related source', pageType: 'article', text: 'A related source contains Shared vortex passage. for comparison.', capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'dom-safe-text-v1' },
      anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 } });

    const version = store.sourceVersion(store.get('integration-a')!.sourceVersionId)!;
    assert.deepEqual(sourceCaptureFromVersion('https://example.org/a', version), {
      url: 'https://example.org/a', title: 'Primary source', pageType: 'paper', author: 'Ada Reader', publicationDate: '2026-09-18', venue: 'Observed Journal',
      text: sourceText, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'dom-safe-text-v1',
    });

    const library = new LibrarySettingsService(store);
    const related = library.related('integration-a');
    const match = related.find(result => result.threadId === 'integration-b');
    assert.ok(match, 'related search returns the other saved source');
    assert.equal(match!.evidenceLabel, 'source passage');
    const relatedSource = store.sourceVersion(store.get('integration-b')!.sourceVersionId)!;
    assert.equal(relatedSource.text.slice(match!.start, match!.end), match!.passage);
    assert.match(match!.explanation, /Local word overlap/);

    store.commitReply({ id: 'integration-root', threadId: 'integration-a', reply: growthReply });
    store.commitReply({ id: 'integration-child', threadId: 'integration-a', reply: growthReply, parentId: 'integration-root' });
    store.commitReply({ id: 'integration-correction', threadId: 'integration-a', reply: growthReply, supersedes: 'integration-root' });
    const child = store.reply('integration-child')!;
    assert.ok(child.corrections?.some(item => item.ancestorId === 'integration-root' && item.correctionId === 'integration-correction'));
    const exported = store.exportThread('integration-a');
    assert.ok(exported.replies.find(reply => reply.id === 'integration-child')?.corrections?.length);
  } finally {
    store.close();
  }
});
