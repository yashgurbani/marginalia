import test from 'node:test';
import assert from 'node:assert/strict';
import { ReaderStore } from '../daemon/store.ts';
import { LibrarySettingsService } from '../daemon/library.ts';
import { startServer } from '../daemon/server.ts';
import { validateSavedPassage, focusSavedPassage } from '../ui/library/passage.ts';
import { replyOriginParts } from '../contracts/reply-origins.ts';
import type { CandidateReply } from '../contracts/reply.ts';

function keep(store: ReaderStore, id: string, text: string, url = `https://example.org/${id}`, note?: string) {
  store.apply({ id: `keep-${id}`, kind: 'keep', threadId: id,
    capture: { url, title: `Saved ${id}`, pageType: 'paper', text, capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' },
    anchor: { exact: text, prefix: '', suffix: '', start: 0, end: text.length }, ...(note ? { note } : {}) });
}

test('local FTS search returns exact saved source coordinates, literal words and bounded results', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); const library = new LibrarySettingsService(store);
  keep(store, 'a', 'A vortex stretches. Café and λ describe an example.');
  keep(store, 'b', 'A vortex rotates.');
  for (const query of ['vortex', 'cafe', 'λ', '"vortex" OR missing', 'vortex*']) {
    const results = library.search(query);
    if (query.includes('missing')) { assert.deepEqual(results, []); continue; }
    assert.ok(results.length);
    for (const result of results) {
      const source = store.sourceVersion(result.sourceVersionId)!;
      assert.equal(source.text.slice(result.start, result.end), result.passage);
      assert.equal(result.evidenceLabel, 'source passage');
      assert.equal(result.sourceTitle, `Saved ${result.threadId}`);
      validateSavedPassage(result, source, result.threadId);
      assert.throws(() => validateSavedPassage({ ...result, passage: 'fabricated' }, source, result.threadId));
    }
  }
  assert.equal(library.search('vortex', 1).length, 1);
  assert.deepEqual(library.search(''), []);
  assert.throws(() => library.search('x'.repeat(301)));
  assert.throws(() => library.search('vortex', 0));
});

test('notes and generated replies keep their origin and cite the original source anchor', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); const library = new LibrarySettingsService(store);
  keep(store, 'a', 'Original source text.', undefined, 'My thermodynamics question.');
  const reply: CandidateReply = { schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Illustration', summary: 'Generated thermodynamics analogy.', sourceBindings: [], parameters: [], assumptions: [], limitations: [], blocks: [{ id: 'text', type: 'text', md: 'An analogy.' }], checks: [], staticFallback: 'An analogy.' };
  reply.origins = { version: 1, parts: Object.fromEntries(replyOriginParts(reply).map(part =>
    [part.path, { kind: 'authored', description: 'Generated explanation; not source evidence.' }])) };
  store.commitReply({ id: 'reply-a', threadId: 'a', reply });
  const results = library.search('thermodynamics');
  assert.equal(results.length, 2);
  assert.deepEqual(new Set(results.map(value => value.evidenceLabel)), new Set(['reader note', 'saved reply — not source evidence']));
  for (const result of results) { assert.equal(result.passage, 'Original source text.'); assert.match(result.explanation, /source anchor/); }
  const note = store.get('a')!.notes[0];
  store.apply({ id: 'remove-note', kind: 'note-remove', threadId: 'a', noteId: note.id, expectedRevision: note.revision, removed: true });
  store.setReplyRemoved({ id: 'remove-reply', replyVersionId: 'reply-a', expectedRevision: 1, removed: true });
  assert.deepEqual(library.search('thermodynamics'), []);
});

test('related passages explain bounded local overlap and exclude current source and generated matches', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); const library = new LibrarySettingsService(store);
  keep(store, 'a', 'Vortex stretching connects rotation. ' + 'Extra context. '.repeat(40));
  keep(store, 'b', 'Vortex rotation appears here.');
  keep(store, 'c', 'Unrelated source.', undefined, 'Vortex');
  const related = library.related('a');
  assert.deepEqual(related.map(value => value.threadId), ['b']);
  assert.ok(related[0].matchedTerms.includes('vortex'));
  assert.match(related[0].explanation, /first 300 characters/);
  assert.match(related[0].explanation, /does not establish a supporting source/);
  assert.equal(related[0].kind, 'source');
});

test('thread soft-removal deletes FTS material, retains shared source until last removal, and restore reindexes', t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close()); const library = new LibrarySettingsService(store);
  keep(store, 'a', 'Shared vortex source.', 'https://example.org/shared', 'Privateword note.');
  keep(store, 'b', 'Shared vortex source.', 'https://example.org/shared');
  const sourceId = store.get('a')!.sourceVersionId;
  store.apply({ id: 'remove-a', kind: 'remove', threadId: 'a', expectedRevision: 1, removed: true });
  assert.deepEqual(library.search('Privateword'), []);
  assert.deepEqual(library.search('vortex').map(value => value.threadId), ['b']);
  store.apply({ id: 'remove-b', kind: 'remove', threadId: 'b', expectedRevision: 1, removed: true });
  assert.deepEqual(library.search('vortex'), []);
  assert.equal(store.db.prepare('SELECT COUNT(*) FROM search').pluck().get(), 0);
  assert.ok(store.sourceVersion(sourceId), 'Soft removal retains restorable source; it is not physical erasure.');
  assert.throws(() => library.related('a'), /unavailable/);
  store.apply({ id: 'restore-a', kind: 'remove', threadId: 'a', expectedRevision: 2, removed: false });
  assert.equal(library.search('vortex').length, 1); assert.equal(library.search('Privateword').length, 1);
});

test('paired search and related read routes use no provider and reject unpaired and malformed requests', async t => {
  let providerCalls = 0;
  const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => { providerCalls++; return {}; } });
  t.after(() => helper.close());
  keep(helper.store, 'a', 'Vortex stretching.'); keep(helper.store, 'b', 'A second vortex.');
  const origin = 'chrome-extension://' + 'a'.repeat(32), token = helper.pairing.exchange(helper.challenge, origin);
  const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  for (const path of ['library-search?q=vortex', 'library-related?thread=a']) {
    const get = await fetch(`${helper.origin}/api/${path}`, { headers });
    const post = await fetch(`${helper.origin}/api/read/${path}`, { method: 'POST', headers, body: '{}' });
    assert.equal(get.status, 200); assert.equal(post.status, 200); assert.deepEqual(await post.json(), await get.json());
    assert.equal((await fetch(`${helper.origin}/api/${path}`)).status, 401);
    assert.equal((await fetch(`${helper.origin}/api/read/${path}`, { method: 'POST', headers, body: '{"send":true}' })).status, 400);
  }
  assert.equal((await fetch(`${helper.origin}/api/library-search?q=${'x'.repeat(301)}`, { headers })).status, 400);
  assert.equal(providerCalls, 0);
  assert.equal(helper.jobs.list().length, 0);
});

test('opening a citation selects exact text across existing nodes without changing the source', () => {
  const nodes = [{ textContent: 'Before. ' }, { textContent: 'Vortex ' }, { textContent: 'stretching. After.' }];
  const calls: unknown[] = []; let index = 0;
  const range = { setStart: (...args: unknown[]) => calls.push(['start', ...args]), setEnd: (...args: unknown[]) => calls.push(['end', ...args]), getBoundingClientRect: () => ({ top: 140 }) };
  const root = { textContent: nodes.map(node => node.textContent).join(''), focus: () => {}, ownerDocument: {
    createTreeWalker: () => ({ nextNode: () => nodes[index++] ?? null }), createRange: () => range,
    getSelection: () => ({ removeAllRanges: () => {}, addRange: (value: unknown) => assert.equal(value, range) }),
    defaultView: { scrollBy: (value: unknown) => calls.push(value) },
  } };
  const before = JSON.stringify(nodes);
  focusSavedPassage(root as unknown as HTMLElement, { start: 8, end: 26, passage: 'Vortex stretching.' } as import('../contracts/library.ts').LibrarySearchResult);
  assert.deepEqual(calls[0], ['start', nodes[1], 0]);
  assert.deepEqual(calls[1], ['end', nodes[2], 11]);
  assert.equal(JSON.stringify(nodes), before);
});
