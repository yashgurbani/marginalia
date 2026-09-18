import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateReply, type CandidateReply, type PartOrigin, type DiagramBlock } from '../contracts/reply.ts';
import { LEGACY_ORIGIN_NOTICE, replyOriginParts } from '../contracts/reply-origins.ts';
import { dom } from './t05-dom.ts';
import { growthReply, growthSourceText } from '../fixtures/growth-reply.ts';
import { ReaderStore } from '../daemon/store.ts';
import { readReplyFile } from '../daemon/jobs/workspace.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

registerHooks({
  resolve(specifier, context, next) { return specifier.endsWith('.css') ? { url: 'origins:css', shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === 'origins:css' ? { format: 'module', source: '', shortCircuit: true } : next(url, context); },
});
const { mountReply } = await import('../renderer/index.ts');

const sourceText = 'Heat moves from the warmer body to the cooler body.';
const authored: PartOrigin = { kind: 'authored', description: 'An explanatory description supplied by the author.' };
function fixture(): CandidateReply {
  const reply: CandidateReply = {
    schema: 'marginalia.reply.v1', intent: 'diagram', status: 'complete', title: 'Heat transfer', summary: 'An explanation of the passage.',
    sourceBindings: [{ name: 'heat', meaning: 'Direction of heat transfer', relation: 'quoted', selector: { exact: sourceText } }],
    parameters: [], assumptions: [{ id: 'a', text: 'Two bodies.', editable: false }], limitations: ['No measured rate.'], checks: [], staticFallback: 'Heat transfer explanation.',
    requiredCapabilities: ['network.citations', 'network.shelf', 'media.image'],
    blocks: [
      { id: 'diagram', type: 'diagram', correspondence: 'source', nodes: [{ id: 'hot', label: 'Warmer body', binding: 'heat' }, { id: 'cold', label: 'Cooler body', binding: 'heat' }], edges: [{ id: 'flow', from: 'hot', to: 'cold', label: 'Heat transfer', binding: 'heat' }], groups: [{ id: 'bodies', label: 'Bodies', nodes: ['hot', 'cold'] }] },
      { id: 'notes', type: 'text', md: 'What happens at equal temperatures?' },
      { id: 'calculation', type: 'text', md: 'A worked calculation.' },
      { id: 'analogy', type: 'text', md: 'Water flowing downhill is an analogy.' },
      { id: 'citation', type: 'citations', entries: [{ id: 'c', claim: 'A statement to assess.', support: 'The author offers a reason.', source: 'A retrieved page', date: '2026-09-18', fetched: true, url: 'https://example.org/heat' }] },
      { id: 'steps', type: 'steps', steps: [{ id: 's', text: 'Identify the warmer body.' }] },
      { id: 'table', type: 'table', columns: [{ key: 'temp', label: 'Temperature' }], rows: [{ temp: 30 }] },
      { id: 'question', type: 'question', prompt: 'Which body?', answers: [{ id: 'hot-answer', label: 'Warmer', value: 'warmer' }], allowFreeText: false },
      { id: 'shelf', type: 'shelf', items: [{ id: 'reading', title: 'Thermodynamics', reason: 'Background on heat.', url: 'https://example.org/book' }] },
      { id: 'image', type: 'media', kind: 'image', url: 'https://example.org/image', alt: 'Two bodies.', transcript: 'Heat transfers.', timecodes: [{ seconds: 0, label: 'Start' }] },
      { id: 'comparison', type: 'compare', variants: [{ id: 'one', label: 'First', blocks: ['notes'] }, { id: 'two', label: 'Second', blocks: ['analogy'] }] },
    ],
  };
  reply.origins = { version: 1, parts: Object.fromEntries(replyOriginParts(reply).map(part => [part.path, structuredClone(authored)])) };
  const parts = reply.origins.parts;
  for (const path of ['/sourceBindings/0', '/blocks/0/nodes/0', '/blocks/0/nodes/1', '/blocks/0/edges/0']) parts[path] = { kind: 'source-page', binding: 'heat' };
  parts['/blocks/1'] = { kind: 'reader-note', noteId: 'note-1', revision: 2 };
  parts['/blocks/2'] = { kind: 'computed', description: 'Using the stated temperature difference.' };
  parts['/blocks/3'] = { kind: 'analogy', description: 'Water flow illustrates direction only.' };
  parts['/blocks/4/entries/0/source'] = { kind: 'fetched', url: 'https://example.org/heat' };
  return reply;
}
const validate = (reply: unknown) => validateReply(reply, { sourceText, requireOrigins: true });

test('E30 complete mixed origins validate and every nested reader-visible part needs its own origin', () => {
  assert.deepEqual(validate(fixture()).errors, []);
  for (const path of ['/title', '/summary', '/staticFallback', '/sourceBindings/0', '/assumptions/0', '/limitations/0', '/blocks/0', '/blocks/0/nodes/0', '/blocks/0/edges/0', '/blocks/0/groups/0', '/blocks/4/entries/0/claim', '/blocks/4/entries/0/support', '/blocks/4/entries/0/source', '/blocks/5/steps/0', '/blocks/6/columns/0', '/blocks/6/rows/0/temp', '/blocks/7/answers/0', '/blocks/8/items/0/title', '/blocks/8/items/0/reason', '/blocks/9/alt', '/blocks/9/transcript', '/blocks/9/timecodes/0', '/blocks/10/variants/0']) {
    const reply = fixture(); delete reply.origins!.parts[path];
    const result = validate(reply);
    assert.equal(result.ok, false, path);
    assert.ok(result.errors.some(error => error.includes(path) && error.includes('requires an origin')), path);
  }
});

test('E30 source correspondence rejects missing node/edge bindings and mismatched origins', () => {
  for (const field of ['nodes', 'edges'] as const) {
    const reply = fixture(), diagram = reply.blocks[0] as DiagramBlock;
    delete diagram[field][0].binding;
    assert.match(validate(reply).errors.join(' '), /binding: source correspondence requires a source binding/);
  }
  const unknown = fixture(); (unknown.blocks[0] as DiagramBlock).edges[0].binding = 'absent';
  assert.match(validate(unknown).errors.join(' '), /unknown source binding/);
  const wrong = fixture(); wrong.origins!.parts['/blocks/0/edges/0'] = { kind: 'analogy', description: 'A comparison.' };
  assert.match(validate(wrong).errors.join(' '), /source correspondence requires the matching page origin/);
  const unspecified = fixture(); delete (unspecified.blocks[0] as DiagramBlock).correspondence;
  assert.match(validate(unspecified).errors.join(' '), /declare source correspondence or illustration/);
});

test('E30 an illustrative diagram can honestly have non-page origins without invented source spans', () => {
  const reply = fixture(), diagram = reply.blocks[0] as DiagramBlock;
  diagram.correspondence = 'illustration';
  for (const field of ['nodes', 'edges'] as const) diagram[field].forEach((part, i) => {
    delete part.binding; reply.origins!.parts[`/blocks/0/${field}/${i}`] = { kind: 'analogy', description: 'Illustrative only.' };
  });
  assert.deepEqual(validate(reply).errors, []);
});

test('E30 origin declarations cannot smuggle authority, unknown fields, unsafe links or invalid references', () => {
  for (const origin of [{ kind: 'supported', description: 'Verified' }, { kind: 'fetched', url: 'https://example.org', supported: true }, { kind: 'fetched', url: 'https://127.0.0.1/private' }, { kind: 'reader-note', noteId: 'note', revision: 0 }, { kind: 'source-page', binding: 'missing' }, { kind: 'computed', description: '<script>unsafe</script>' }]) {
    const reply = fixture(); reply.origins!.parts['/title'] = origin as PartOrigin;
    assert.equal(validate(reply).ok, false, JSON.stringify(origin));
  }
  const reply = fixture(); reply.origins!.parts['/nonexistent'] = authored;
  assert.match(validate(reply).errors.join(' '), /unknown reader-visible part/);
  const altered = fixture(); altered.sourceBindings[0].selector.exact = 'Absent words';
  assert.match(validate(altered).errors.join(' '), /selector does not match/);
});

test('E30 legacy is readable explicitly, while origin-required admission rejects missing origins', () => {
  const reply = fixture(); delete reply.origins;
  assert.equal(validateReply(reply, { sourceText }).ok, true);
  assert.match(validate(reply).errors.join(' '), /origins: required for a new reply/);
});

test('E30 renderer exposes all origins, preserves separate fetched/support meaning, and binds edges', t => {
  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_ns: string, tag: string) { return document.createElement(tag); } });
  const highlights: unknown[] = [], navigations: unknown[] = [];
  const reply = fixture(), snapshot = JSON.stringify(reply);
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText, onSourceHighlight: value => highlights.push(value), onSourceNavigate: value => navigations.push(value) });
  t.after(() => mounted.destroy());
  for (const wording of ['From this page', 'Quoted from the captured passage', 'From your note, revision 2', 'Computed from an authored rule', 'An analogy', 'Fetched material; retrieval alone does not establish support', 'Authored explanation; not evidence by itself', 'Author-supplied support assessment; fetching alone does not establish support']) assert.ok(root.textContent.includes(wording), wording);
  assert.equal(root.querySelectorAll('a').length, 0, 'origin display does not enable remote navigation or retrieval');
  const edge = root.querySelectorAll('g').find(node => node.id.endsWith('-edge-flow'))!;
  assert.ok(edge, 'SVG connection has a source control');
  assert.equal(edge.getAttribute('tabindex'), '0');
  edge.fire('focus'); edge.fire('keydown', { key: 'Enter' });
  assert.deepEqual(highlights.at(-1), reply.sourceBindings[0]);
  assert.deepEqual(navigations.at(-1), reply.sourceBindings[0]);
  const textEdge = root.querySelectorAll('button').find(node => node.textContent === 'Source for connection Heat transfer')!;
  assert.ok(textEdge); textEdge.click(); assert.equal(navigations.length, 2);
  assert.equal(JSON.stringify(reply), snapshot, 'rendering does not rewrite saved origins');
});

test('E30 old saved replies show an honest origin-unavailable state without inventing provenance', t => {
  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_ns: string, tag: string) { return document.createElement(tag); } });
  const reply = fixture(); delete reply.origins;
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText }); t.after(() => mounted.destroy());
  assert.ok(root.textContent.includes(LEGACY_ORIGIN_NOTICE));
  assert.equal(root.querySelectorAll('[data-origin]').length, 0);
});

test('E30 invalid partial provenance fails closed in renderer', t => {
  const { root } = dom(t); const reply = fixture(); delete reply.origins!.parts['/blocks/1'];
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText }); t.after(() => mounted.destroy());
  assert.match(root.textContent, /could not be safely displayed/);
  assert.doesNotMatch(root.textContent, /What happens at equal temperatures/);
});

test('E30 origin coverage includes inputs, illustration and computed model/sample parts', () => {
  const reply = structuredClone(growthReply);
  reply.origins = { version: 1, parts: Object.fromEntries(replyOriginParts(reply).map(part => [part.path, structuredClone(authored)])) };
  assert.equal(validateReply(reply, { sourceText: growthSourceText, requireOrigins: true }).ok, true);
  for (const path of ['/illustration', '/parameters/0']) {
    const copy = structuredClone(reply); delete copy.origins!.parts[path];
    assert.equal(validateReply(copy, { sourceText: growthSourceText }).ok, false);
  }
});

test('E30 published schema includes distinct origins and source-diagram edge requirements', () => {
  const schema = JSON.parse(readFileSync(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8'));
  assert.ok(schema.properties.origins);
  assert.ok(schema.required.includes('origins'), 'the schema sent to providers requires origins');
  assert.equal(schema.$defs.partOrigin.oneOf.length, 4);
  assert.ok(schema.$defs.diagramBlock.properties.edges.items.properties.binding);
  assert.deepEqual(schema.$defs.diagramBlock.allOf[0].then.properties.edges.items.required, ['binding']);
});

test('E30 immutable reply admission refuses origin-less new data and round-trips declared origins', () => {
  const store = new ReaderStore(':memory:');
  try {
    store.apply({ id: 'keep-origin', kind: 'keep', threadId: 'origin-thread', capture: {
      url: 'https://example.org/source', title: 'Source', pageType: 'article', text: sourceText,
      capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1',
    }, anchor: { exact: sourceText, prefix: '', suffix: '', start: 0, end: sourceText.length } });
    const reply = fixture(), capabilities = reply.requiredCapabilities!;
    const missing = structuredClone(reply); delete missing.origins;
    assert.throws(() => store.commitReply({ id: 'missing', threadId: 'origin-thread', reply: missing }, capabilities), /origins: required for a new reply/);
    assert.equal(store.reply('missing'), undefined);
    store.commitReply({ id: 'with-origin', threadId: 'origin-thread', reply }, capabilities);
    assert.deepEqual(store.reply('with-origin')!.reply.origins, reply.origins);
    assert.deepEqual(store.exportThread('origin-thread').replies[0].reply.origins, reply.origins);
  } finally { store.close(); }
});

test('E30 partial and final workspace admission reject missing origins before display or commit', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'e30-origins-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  for (const name of ['reply.partial.json', 'reply.json'] as const) {
    const reply = fixture(); reply.status = name === 'reply.json' ? 'complete' : 'partial';
    const missing = structuredClone(reply); delete missing.origins;
    await writeFile(join(workspace, name), JSON.stringify(missing));
    await assert.rejects(readReplyFile(workspace, name, sourceText, reply.requiredCapabilities!), /origins: required for a new reply/);
    await writeFile(join(workspace, name), JSON.stringify(reply));
    assert.deepEqual((await readReplyFile(workspace, name, sourceText, reply.requiredCapabilities!))?.origins, reply.origins);
  }
});

