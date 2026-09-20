import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaries, storage } from './t05-harness.ts';
import { dom, button, replaceGlobals, until } from './t05-dom.ts';
import type { SourceMetadata, SourceVersion, Thread } from '../contracts/reader.ts';

test('E33 actual webapp library opening preserves complete, partial and absent saved source metadata', async t => {
  const e = { ...dom(t), ...storage(t) };
  e.data('marginalia-reader').set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  const bundles = new Map<string, { schema: string; thread: Thread; source: SourceVersion; replies: []; replyViews: [] }>();
  const cases: { id: string; metadata: SourceMetadata; expected: string }[] = [
    { id: 'complete', metadata: { author: 'Ada Reader', publicationDate: '2026-09-17', venue: 'Observed Journal' }, expected: 'paper · Ada Reader · 2026-09-17 · Observed Journal' },
    { id: 'partial', metadata: { venue: 'Observed Journal' }, expected: 'paper · Observed Journal' },
    { id: 'absent', metadata: {}, expected: 'paper' },
  ];
  for (const { id, metadata } of cases) {
    const thread: Thread = { id, anchorId: `anchor-${id}`, sourceVersionId: `version-${id}`, sourceUrl: `https://invented-venue.example/2020/${id}`, sourceTitle: `Saved ${id}`, state: 'open', revision: 1, createdAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z', deletedAt: null, notes: [], highlighted: false, anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 } };
    const source: SourceVersion = { id: thread.sourceVersionId, sourceId: `source-${id}`, hash: `hash-${id}`, title: thread.sourceTitle, pageType: 'paper', text: 'The immutable saved passage.', capturedAt: thread.createdAt, extractionVersion: 'text-v1', metadataStatus: 'provided', ...metadata };
    bundles.set(id, { schema: 'marginalia.thread.v1', thread, source, replies: [], replyViews: [] });
  }
  const requests: string[] = [];
  replaceGlobals(t, { fetch: async (input: string) => {
    const url = new URL(input); requests.push(url.pathname);
    if (url.pathname === '/api/position') return Response.json({ anchor: null });
    if (url.pathname === '/api/read/export') return Response.json(bundles.get(url.searchParams.get('thread')!));
    if (url.pathname === '/api/read/replies') {
      const bundle = bundles.get(url.searchParams.get('threadId')!)!;
      return Response.json({ source: bundle.source, replies: [], views: [] });
    }
    throw new Error(`Unexpected request while opening saved work: ${url.pathname}`);
  } });
  // Import the real entrypoint, then invoke the library's wired opening callback.
  // Only the library rendering surface is replaced by the existing mount harness.
  await import('../webapp/main.ts');
  for (const { id, expected } of cases) {
    const previous = boundaries.libraryOptions;
    button(e.root, 'Library and settings').click();
    await until(() => boundaries.libraryOptions !== previous);
    await boundaries.libraryOptions.onOpenThread(bundles.get(id)!.thread);
    const workspace = e.root.querySelectorAll('.m-saved-workspace').find(node => !node.hidden);
    assert.ok(workspace, `fresh ${id} saved workspace opened`);
    const header = workspace.querySelector('.m-head')!;
    assert.equal(header.querySelector('.m-meta')!.textContent, expected);
    assert.equal(header.querySelector('h1')!.textContent, `Saved ${id}`);
    assert.equal(workspace.querySelector('.m-captured-text')!.textContent, bundles.get(id)!.source.text);
    assert.equal(header.textContent.includes('invented-venue'), false);
    // The header's one control is the collapse toggle; it carries no other actions.
    assert.equal(header.querySelectorAll('button').filter(control => !control.classList.contains('m-head-toggle')).length, 0);
    assert.equal(header.querySelector('.m-meta')!.textContent, expected);
  }
  const resumed: string[] = [];
  replaceGlobals(t, { location: { origin: e.document.location.origin, assign: (href: string) => { resumed.push(href); } } });
  const savedThread = bundles.get('complete')!.thread;
  for (const hash of ['', '#section', '#/chapter/2?mode=read', '#part%20two', '#marginalia-resume=old']) {
    await boundaries.libraryOptions.onResumePage({ ...savedThread, sourceUrl: savedThread.sourceUrl + hash });
    assert.equal(resumed.at(-1), savedThread.sourceUrl + '#marginalia-resume=v2:complete:' + encodeURIComponent(hash));
  }
  assert.equal(requests.filter(path => path === '/api/read/export').length, 3);
  assert.equal(requests.every(path => ['/api/position', '/api/read/export', '/api/read/replies'].includes(path)), true);
});
