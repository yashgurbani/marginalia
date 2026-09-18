import test from 'node:test';
import assert from 'node:assert/strict';
import type { Note, QuoteAnchor, Thread } from '../contracts/reader.ts';
import { wholeLibraryExport, bibtexLibraryExport } from '../ui/library/export.ts';
import { ReaderStore } from '../daemon/store.ts';
import { dom, button, until, settle, deferred } from './t05-dom.ts';
import { asHost } from './t05-harness.ts';
import { mountLibrary } from '../ui/library/index.ts';

const exportedAt = new Date('2026-09-18T12:00:00.000Z');

test('real store exports all thread states, removed notes and retained versions without mutating source or history', () => {
  const store = new ReaderStore(':memory:');
  try {
    for (const state of ['open', 'parked', 'done', 'archived', 'removed'] as const) {
      store.apply({ id: `keep-${state}`, kind: 'keep', threadId: state,
        capture: { url: `https://example.org/${state}`, title: state, pageType: 'article', text: '🙂 quote', capturedAt: exportedAt.toISOString(), extractionVersion: 'fixture' },
        anchor: { exact: 'quote', prefix: '🙂 ', suffix: '', start: 3, end: 8 }, note: `initial ${state}` });
      const savedNote = store.get(state)!.notes[0];
      store.apply({ id: `edit-${state}`, kind: 'note', threadId: state, noteId: savedNote.id, text: `revised ${state}`, expectedRevision: savedNote.revision });
      if (state === 'removed') {
        store.apply({ id: 'remove-note', kind: 'note-remove', threadId: state, noteId: savedNote.id, removed: true, expectedRevision: 2 });
        store.apply({ id: 'remove-thread', kind: 'remove', threadId: state, removed: true, expectedRevision: store.get(state)!.revision });
      } else if (state !== 'open') store.apply({ id: `state-${state}`, kind: 'thread-state', threadId: state, state, expectedRevision: store.get(state)!.revision });
    }
    const records = store.list(undefined, true).map(value => store.exportThread(value.id));
    const before = JSON.stringify(store.events());
    const output = wholeLibraryExport(records, exportedAt);
    const items = JSON.parse(output.jsonLd).first.items;
    assert.equal(items.length, 5);
    for (const record of records) {
      const item = items.find((item: ParsedAnnotation) => item['marginalia:threadId'] === record.thread.id);
      assert.deepEqual(JSON.parse(item['marginalia:recordJson']), JSON.parse(JSON.stringify(record)));
      assert.equal(record.noteVersions.length, 2);
      assert.deepEqual(item.target.selector[1], { type: 'TextPositionSelector', start: 2, end: 7 });
      assert.equal(item['marginalia:highlightColour'], undefined);
    }
    assert.equal(JSON.stringify(store.events()), before);
    assert.deepEqual(store.list(undefined, true).map(value => store.exportThread(value.id)), records);
  } finally { store.close(); }
});

function note(id: string, text: string, deletedAt: string | null = null): Note {
  return { id, threadId: id.startsWith('a') ? 'thread-a' : 'thread-b', text, revision: deletedAt ? 3 : 1, createdAt: '2026-09-17T08:30:00.000Z', deletedAt };
}

function thread(input: Partial<Thread> & Pick<Thread, 'id' | 'anchorId' | 'anchor'>): Thread {
  return {
    sourceVersionId: `source-${input.id}`,
    sourceTitle: 'Repeated # page — λ',
    sourceUrl: 'https://example.com/repeated-page',
    state: 'open', revision: 1,
    createdAt: '2026-09-17T08:00:00.000Z', updatedAt: '2026-09-17T09:00:00.000Z',
    deletedAt: null, notes: [], highlighted: true,
    ...input,
  };
}

type QuoteSelector = {
  type: 'TextQuoteSelector'; exact: string; prefix: string; suffix: string;
};

type ParsedAnnotation = {
  'marginalia:threadId': string;
  'marginalia:sourceVersionId': string;
  'marginalia:state': Thread['state'];
  'marginalia:revision': number;
  'marginalia:deletedAt': string | null;
  'marginalia:highlightColour'?: Thread['highlightColour'];
  'marginalia:anchorId': string;
  'marginalia:kind': string;
  'marginalia:recordJson': string;
  target: { source: string; selector: QuoteSelector[] };
  body: Array<{
    value: string;
    created: string;
    'marginalia:noteId': string;
    'marginalia:threadId': string;
    'marginalia:revision': number;
    'marginalia:deletedAt': string | null;
  }>;
};

test('whole-library export round trips every thread, note, state, and anchor across repeated page groups', () => {
  const anchorA: QuoteAnchor = { kind: 'quote', exact: 'αλφα **not bold**\nsecond line', prefix: 'before [', suffix: '] after', start: 7, end: 36 };
  const anchorB: QuoteAnchor = { kind: 'section', exact: 'same page', prefix: '', suffix: ' suffix', start: 70, end: 79 };
  const removedAt = '2026-09-18T10:00:00.000Z';
  const threads = [
    thread({ id: 'thread-b', anchorId: 'anchor-b', anchor: anchorB, state: 'archived', revision: 4, deletedAt: removedAt,
      notes: [note('b-note', 'removed | note > still exported', removedAt)] }),
    thread({ id: 'thread-a', anchorId: 'anchor-a', anchor: anchorA, notes: [
      note('a-one', '# heading? [link](https://invalid) — café 🙂'),
      note('a-two', 'backslash \\ and `code`\n下一行'),
    ] }),
  ];

  const output = wholeLibraryExport(threads.map(value => ({ thread: value })), exportedAt);
  const parsed = JSON.parse(output.jsonLd) as { type: string; total: number; first: { type: string; items: ParsedAnnotation[] } };
  assert.equal(parsed.type, 'AnnotationCollection');
  assert.equal(parsed.total, threads.length);
  assert.equal(parsed.first.type, 'AnnotationPage');

  const roundTripped = new Map(parsed.first.items.map(item => [item['marginalia:threadId'], item]));
  for (const original of threads) {
    const item = roundTripped.get(original.id);
    assert.ok(item, `missing ${original.id}`);
    assert.equal(item['marginalia:sourceVersionId'], original.sourceVersionId);
    assert.equal(item['marginalia:state'], original.state);
    assert.equal(item['marginalia:revision'], original.revision);
    assert.equal(item['marginalia:deletedAt'], original.deletedAt);
    assert.equal(item.target.source, original.sourceUrl);
    assert.deepEqual(item.target.selector, [{
      type: 'TextQuoteSelector', exact: original.anchor.exact, prefix: original.anchor.prefix, suffix: original.anchor.suffix,
    }]);
    assert.equal(item['marginalia:anchorId'], original.anchorId);
    assert.equal(item['marginalia:kind'], original.anchor.kind);
    assert.deepEqual(JSON.parse(item['marginalia:recordJson']), { thread: original });
    assert.deepEqual(item.body.map(body => ({
      id: body['marginalia:noteId'], threadId: body['marginalia:threadId'], text: body.value,
      revision: body['marginalia:revision'], createdAt: body.created, deletedAt: body['marginalia:deletedAt'],
    })), original.notes.map(value => ({
      id: value.id, threadId: original.id, text: value.text, revision: value.revision,
      createdAt: value.createdAt, deletedAt: value.deletedAt,
    })));
  }

  assert.equal((output.markdown.match(/^## Repeated \\# page — λ$/gm) ?? []).length, 1, 'same-page threads share one page heading');
  assert.match(output.markdown, /^### Thread `thread-a`$/m);
  assert.match(output.markdown, /^### Thread `thread-b`$/m);
  assert.ok(output.markdown.includes(String.raw`> αλφα \*\*not bold\*\*`));
  assert.ok(output.markdown.includes(String.raw`> \# heading? \[link\]\(https://invalid\) — café 🙂`));
  assert.match(output.markdown, /State: removed \(2026-09-18T10:00:00\.000Z\)/);
  assert.match(output.markdown, /> 下一行/);
  assert.match(output.markdown, /Highlight colour: yellow/);
  assert.equal(roundTripped.get('thread-a')!['marginalia:highlightColour'], 'yellow');
});

test('W3C sibling selectors independently select the full quote with emoji before and inside it', () => {
  const text = '🙂 before selected 🐈 words after';
  const exact = 'selected 🐈 words', start = text.indexOf(exact), end = start + exact.length;
  const value = thread({ id: 'emoji', anchorId: 'emoji-anchor', anchor: { kind: 'quote', exact, prefix: '🙂 before ', suffix: ' after', start, end } });
  const item = JSON.parse(wholeLibraryExport([{ thread: value, source: { text } }], exportedAt).jsonLd).first.items[0];
  assert.equal(item.target.type, 'SpecificResource');
  const [quote, position] = item.target.selector;
  assert.deepEqual(quote, { type: 'TextQuoteSelector', exact, prefix: '🙂 before ', suffix: ' after' });
  assert.equal(Object.hasOwn(quote, 'refinedBy'), false);
  assert.equal(position.type, 'TextPositionSelector');
  assert.equal([...text].slice(position.start, position.end).join(''), quote.exact);
  assert.equal(position.start, start - 1);
  assert.equal(position.end, end - 2);
  assert.deepEqual(JSON.parse(item['marginalia:recordJson']).thread.anchor, value.anchor);
});

test('whole-page notes target the resource itself and do not invent highlighting', () => {
  const value = thread({ id: 'page', anchorId: 'page-anchor', highlighted: false,
    anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 },
    notes: [{ ...note('page-note', 'About this page'), threadId: 'page' }] });
  const item = JSON.parse(wholeLibraryExport([{ thread: value }], exportedAt).jsonLd).first.items[0];
  assert.deepEqual(item.target, { id: value.sourceUrl });
  assert.deepEqual(item.motivation, ['commenting']);
  assert.deepEqual(JSON.parse(item['marginalia:recordJson']).thread, value);
  const kept = JSON.parse(wholeLibraryExport([{ thread: { ...value, notes: [] } }], exportedAt).jsonLd).first.items[0];
  assert.deepEqual(kept.motivation, ['bookmarking']);
});

test('missing or mismatched retained source never produces guessed standard positions', () => {
  const value = thread({ id: 'legacy', anchorId: 'legacy-anchor', anchor: { exact: 'quote', prefix: '', suffix: '', start: 4, end: 9 } });
  for (const source of [undefined, { text: 'different source' }]) {
    const item = JSON.parse(wholeLibraryExport([{ thread: value, source }], exportedAt).jsonLd).first.items[0];
    assert.equal(item.target.selector.length, 1);
    assert.equal(item.target.selector[0].type, 'TextQuoteSelector');
    assert.deepEqual(JSON.parse(item['marginalia:recordJson']).thread.anchor, value.anchor);
  }
});

test('both files preserve complete helper records including reply/history payloads and hostile Markdown fences', () => {
  const value = thread({ id: 'complete', anchorId: 'anchor', anchor: { exact: 'x', prefix: '', suffix: '', start: 0, end: 1 } });
  const records = [{ schema: 'marginalia.thread.v1', thread: value, source: { text: 'x', hash: 'retained-source' },
    noteVersions: [{ noteId: 'old-note', revision: 1, text: 'earlier words' }],
    replies: [{ id: 'reply', reply: { summary: 'computed, not evidence', blocks: [{ text: '```\n# injected\n~~~~' }] }, deletedAt: null }],
    replyViews: [{ replyVersionId: 'reply', parameters: { x: 2 }, view: { expanded: true } }],
    attachments: [{ targetVersionId: 'other', state: 'lost' }], targetVersions: [{ text: 'changed source' }],
    execution: { authority: 'host-recorded', jobs: [], missingTables: ['jobs'] } }];
  const output = wholeLibraryExport(records, exportedAt);
  const items = JSON.parse(output.jsonLd).first.items;
  assert.deepEqual(items.map((item: ParsedAnnotation) => JSON.parse(item['marginalia:recordJson'])), records);
  const appendix = output.markdown.match(/^(`{4,})json\n([\s\S]*)\n\1\n$/m);
  assert.ok(appendix, 'retained record appendix has a fence longer than saved content');
  assert.deepEqual(JSON.parse(appendix[2]), records);
});

test('empty library exports valid empty collections and retained records', () => {
  const output = wholeLibraryExport([], exportedAt);
  const collection = JSON.parse(output.jsonLd);
  assert.equal(collection.total, 0);
  assert.deepEqual(collection.first.items, []);
  assert.match(output.markdown, /```json\n\[\]\n```/);
});

test('whole-library export rejects duplicate thread identities', () => {
  const value = thread({ id: 'thread-a', anchorId: 'anchor-a', anchor: { exact: 'x', prefix: '', suffix: '', start: 0, end: 1 } });
  assert.throws(() => wholeLibraryExport([{ thread: value }, { thread: value }], exportedAt), /more than once/);
});

test('BibTeX deduplicates captures, keeps removed sources, and preserves stable unique keys across order changes', () => {
  const base = thread({ id: 'a', anchorId: 'aa', anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 }, sourceVersionId: 'capture-a' });
  const records = [{ thread: base, source: { id: 'capture-a', text: 'x', title: 'Captured title' } },
    { thread: { ...base, id: 'b', deletedAt: '2026-09-18' }, source: { id: 'capture-a', text: 'x', title: 'Captured title' } },
    { thread: { ...base, id: 'c', sourceVersionId: 'capture-b', deletedAt: '2026-09-18' }, source: { id: 'capture-b', text: 'y', title: 'Earlier retained title' } }];
  const output = bibtexLibraryExport(records); assert.equal(output.match(/@misc\{/g)?.length, 2);
  assert.equal(output, bibtexLibraryExport([...records].reverse())); assert.match(output, /Earlier retained title/);
  const keys = [...output.matchAll(/@misc\{([^,]+)/g)].map(value => value[1]); assert.equal(new Set(keys).size, 2);
  assert.ok(wholeLibraryExport(records, exportedAt).markdown.includes('removed'));
});

test('BibTeX uses only captured metadata and escapes syntax without losing Unicode names', () => {
  const value = thread({ id: 'a', anchorId: 'aa', anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 }, sourceVersionId: 'v' });
  const output = bibtexLibraryExport([{ thread: value, source: { id: 'v', text: 'x', title: 'A {model} & 10% _x #1 $5 \\ ~ ^', author: 'Élodie Müller', publicationDate: '2026-09-18', venue: 'Captured venue' } }]);
  assert.ok(output.includes('A \\textbraceleft{}model\\textbraceright{} \\& 10\\% \\_x \\#1 \\$5 \\textbackslash{} \\textasciitilde{} \\textasciicircum{}'));
  assert.match(output, /author = \{Élodie Müller\}/); assert.match(output, /year = \{2026\}/); assert.match(output, /date = \{2026-09-18\}/);
  const missing = bibtexLibraryExport([{ thread: value, source: { text: 'x' } }]);
  assert.doesNotMatch(missing, /title =|author =|year =|date =|howpublished =/); assert.match(missing, /url =/);
  assert.equal(bibtexLibraryExport([]), '');
});

test('BibTeX rejects mismatched source identities and conflicting metadata for one immutable capture', () => {
  const value = thread({ id: 'a', anchorId: 'aa', anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 }, sourceVersionId: 'v' });
  assert.throws(() => bibtexLibraryExport([{ thread: value, source: { id: 'other', text: 'x' } }]), /differs/);
  assert.throws(() => bibtexLibraryExport([{ thread: value, source: { text: 'x', title: 'First' } }, { thread: { ...value, id: 'b' }, source: { text: 'x', title: 'Other' } }]), /disagrees/);
});

test('BibTeX keeps unmatched captured braces outside the bibliography grammar', () => {
  const value = thread({ id: 'a', anchorId: 'aa', anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 } });
  for (const title of ['Unclosed {', 'Unopened }', '\\input{hostile}']) {
    const output = bibtexLibraryExport([{ thread: value, source: { text: '', title } }]);
    assert.equal([...output].filter(c => c === '{').length, [...output].filter(c => c === '}').length);
    assert.doesNotMatch(output, /\\input\{/);
    assert.match(output, /\\textbrace(?:left|right)\{\}/);
  }
});

test('BibTeX URL fields preserve queries and existing escapes while encoding grammar-breaking characters', () => {
  const value = thread({ id: 'a', anchorId: 'aa', sourceUrl: 'https://example.org/a_b%20c?q=x&v={a}\\b#part', anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 } });
  const output = bibtexLibraryExport([{ thread: value }]);
  assert.ok(output.includes('url = {https://example.org/a_b%20c?q=x&v=%7Ba%7D%5Cb#part}'));
  assert.doesNotMatch(output, /%2520|\\_|\\&/);
});

test('explicit BibTeX action downloads all retained captures once and disposal fences late export', async t => {
  const e = dom(t), blobs: Blob[] = [], value = thread({ id: 'a', anchorId: 'aa', anchor: { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 } });
  let lists = 0;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { blobs.push(blob); return 'blob:bibtex'; }); t.mock.method(URL, 'revokeObjectURL', () => {});
  let mounted = mountLibrary(asHost(e.root), { listThreads: async () => { lists++; return [value]; }, exportThread: async () => ({ thread: value, source: { text: '', title: 'Captured' } }), onClose() {}, onOpenThread() {} });
  await settle(); assert.equal(blobs.length, 0);
  const action = button(e.root, 'Export BibTeX'); action.click(); action.click(); await until(() => blobs.length === 1); await settle();
  assert.equal(lists, 2); assert.match(blobs[0].type, /bibtex/); assert.match(await blobs[0].text(), /title = \{Captured\}/); mounted.destroy();
  const pending = deferred<unknown>();
  mounted = mountLibrary(asHost(e.root), { listThreads: async () => [value], exportThread: async () => pending.promise, onClose() {}, onOpenThread() {} });
  await settle(); button(e.root, 'Export BibTeX').click(); await settle(); mounted.destroy();
  pending.resolve({ thread: value }); await settle(); await settle(); assert.equal(blobs.length, 1);
});

