import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSourceCapture, wholePageAnchor, type SourceCapture, type SourceMetadata } from '../contracts/reader.ts';
import { extractPageMetadata } from '../extension/lib/capture.ts';
import { validSnapshot } from '../extension/lib/protocol.ts';
import { ReaderStore } from '../daemon/store.ts';
import { savedThreadCapture } from '../ui/library-entry.ts';

const capture: SourceCapture = { url: 'https://example.org/2020/Author', title: 'A paper', pageType: 'paper', text: 'By Fictional Person, published in Fictional Journal in 1999.', capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'dom-safe-text-v1', sections: [{ title: 'Page', start: 0, end: 56 }] };
const metadata = { author: 'Ada Reader', publicationDate: '2026-09-17', venue: 'Observed Journal' };
function snapshot(c: SourceCapture) { return { document: 'doc', capture: c, sections: c.sections, anchor: null, position: 0, revision: 1 }; }
function documentWith(entries: Record<string, string>[]) {
  return { querySelectorAll(selector: string) {
    assert.equal(selector, 'meta');
    return entries.map(attributes => ({ getAttribute: (name: string) => attributes[name] ?? null }));
  } } as unknown as Pick<Document, 'querySelectorAll'>;
}

test('E33 extraction reads explicit local metadata with no URL, prose, or network inference', t => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected metadata lookup'); };
  t.after(() => { globalThis.fetch = previous; });
  assert.deepEqual(extractPageMetadata(documentWith([
    { name: 'citation_author', content: metadata.author },
    { property: 'article:published_time', content: metadata.publicationDate },
    { name: 'citation_journal_title', content: metadata.venue },
  ])), metadata);
  assert.deepEqual(extractPageMetadata(documentWith([{ name: 'author', content: '  Ada   Reader  ' }])), { author: 'Ada Reader' });
  assert.deepEqual(extractPageMetadata(documentWith([])), {});
  assert.deepEqual(extractPageMetadata(documentWith([
    { name: 'author', content: 'x'.repeat(501) },
    { name: 'date', content: '2026-02-30' },
    { name: 'publisher', content: 'bad\u0000value' },
  ])), {});
});

test('E33 contracts accept partial and legacy metadata and reject malformed optional fields', () => {
  for (const fields of [{}, metadata, { author: metadata.author }, { publicationDate: '2024-02-29' }, { publicationDate: '2026' }, { publicationDate: '2026/09/17' }]) {
    const value = { ...capture, ...fields }; validateSourceCapture(value); assert.equal(validSnapshot(snapshot(value)), true);
  }
  for (const fields of [{ author: null }, { author: [] }, { author: '' }, { author: ' x ' }, { author: 'x'.repeat(501) }, { venue: 3 }, { venue: 'bad\nvalue' }, { publicationDate: 'today' }, { publicationDate: '12' }, { publicationDate: '2026-02-29' }, { publicationDate: '2026-13-01' }, { publicationDate: false }]) {
    const value = { ...capture, ...fields } as unknown as SourceCapture;
    assert.throws(() => validateSourceCapture(value), /metadata/); assert.equal(validSnapshot(snapshot(value)), false);
  }
});

test('E33 source metadata survives immutable identity, SQLite reopen, export and saved-reader opening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e33-metadata-')), filename = join(directory, 'reader.sqlite');
  let store = new ReaderStore(filename);
  try {
    function save(id: string, fields: SourceMetadata = {}) {
      store.apply({ id, threadId: id, kind: 'keep', capture: { ...capture, ...fields }, anchor: wholePageAnchor() });
      return store.sourceVersion(store.get(id)!.sourceVersionId)!;
    }
    const legacy = save('legacy'), complete = save('complete', metadata);
    assert.equal('author' in legacy, false); assert.equal('publicationDate' in legacy, false); assert.equal('venue' in legacy, false);
    const variants = [legacy, complete, save('author', { ...metadata, author: 'Another author' }), save('date', { ...metadata, publicationDate: '2026-09-16' }), save('venue', { ...metadata, venue: 'Another venue' })];
    assert.equal(new Set(variants.map(v => v.id)).size, variants.length);
    assert.equal(save('same', metadata).id, complete.id);
    for (const field of ['author', 'publicationDate', 'venue']) assert.throws(() => store.db.prepare(`UPDATE source_versions SET ${field}=? WHERE id=?`).run('changed', complete.id), /immutable/);
    store.close(); store = new ReaderStore(filename);
    assert.deepEqual(store.sourceVersion(complete.id), complete); assert.deepEqual(store.sourceVersion(legacy.id), legacy);
    const thread = store.get('complete')!;
    const reopened = savedThreadCapture(store.exportThread(thread.id), thread);
    for (const field of ['author', 'publicationDate', 'venue'] as const) assert.equal(reopened.capture[field], metadata[field]);
    assert.equal('author' in savedThreadCapture(store.exportThread('legacy'), store.get('legacy')!).capture, false);
    assert.deepEqual(store.db.pragma('foreign_key_check'), []);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
