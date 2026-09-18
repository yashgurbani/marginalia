import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import type { FrozenJobContext, HostInstructionBundle, ProviderJobPacket } from '../contracts/jobs.ts';
import { prepareEnvelope } from '../daemon/jobs/envelope.ts';
import { loadHostInstructions, hostInstructionText } from '../daemon/jobs/host-instructions.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const canonicalInstructionText = (text: string) => text.replace(/\r\n?/g, '\n');
const installed = {
  define: ['../skills/define/SKILL.md', '../skills/define/references/runtime-contract.md'],
  simulate: ['../skills/simulate/SKILL.md', '../skills/simulate/IO.md'],
  evidence: ['../skills/evidence/SKILL.md', '../skills/evidence/IO.md'],
  explore: ['../skills/explore/SKILL.md', '../skills/explore/IO.md'],
  instantiate: ['../skills/instantiate/SKILL.md', '../skills/instantiate/IO.md'],
  derive: ['../skills/derive/SKILL.md', '../skills/derive/IO.md'],
  diagram: ['../skills/diagram/SKILL.md', '../skills/diagram/IO.md'],
} as const;

test('every supported instruction bundle includes its canonical installed content with matching digests', async () => {
  for (const [intent, paths] of Object.entries(installed)) {
    const bundle = await loadHostInstructions(intent as HostInstructionBundle['kind']); assert.ok(bundle);
    assert.equal(bundle.kind, intent);
    const documents = await Promise.all(paths.map(async path => canonicalInstructionText(await readFile(new URL(path, import.meta.url), 'utf8'))));
    for (const document of documents) { assert.ok(bundle.text.includes(document)); assert.ok(Buffer.byteLength(document) <= 16 * 1024); }
    assert.ok(Buffer.byteLength(bundle.text) <= 34 * 1024);
    assert.equal(bundle.sha256, digest(bundle.text));
    assert.deepEqual(bundle.documents.map(file => file.sha256), documents.map(digest));
    assert.equal(hostInstructionText(bundle, intent as HostInstructionBundle['kind']), bundle.text);
  }
});

test('definition instruction bytes retain the installed digest fixture', async () => {
  const bundle = await loadHostInstructions('define'); assert.ok(bundle);
  assert.equal(bundle.sha256, 'b9db5652bac51b329f26ef806d4981033e0f02f1d4e52f81b5b19758b933d611');
  assert.match(bundle.text, /Reply admission revision: result-claims-origins-v1/);
  assert.match(bundle.text, /Every new reply requires complete per-part origins/);
  assert.match(bundle.text, /No model declaration or generic check certifies arbitrary prose/);
});

test('instruction bindings have one digest for CRLF and LF installations', async t => {
  const root = await mkdtemp(join(tmpdir(), 't06-instruction-eol-')); t.after(() => rm(root, { recursive: true, force: true }));
  const url = pathToFileURL(root + '/'); await mkdir(join(root, 'references'));
  await writeFile(join(root, 'SKILL.md'), 'first line\r\nsecond line\r\n');
  await writeFile(join(root, 'references/runtime-contract.md'), 'contract line\r\n');
  const crlf = await loadHostInstructions('define', url); assert.ok(crlf);
  await writeFile(join(root, 'SKILL.md'), 'first line\nsecond line\n');
  await writeFile(join(root, 'references/runtime-contract.md'), 'contract line\n');
  const lf = await loadHostInstructions('define', url); assert.ok(lf);
  assert.deepEqual(crlf, lf);
});

test('instruction bindings reject altered bytes and every cross-intent use', async () => {
  const intents = Object.keys(installed) as HostInstructionBundle['kind'][];
  for (const [index, intent] of intents.entries()) {
    const bundle = await loadHostInstructions(intent); assert.ok(bundle);
    assert.throws(() => hostInstructionText({ ...bundle, text: bundle.text + 'altered' }, intent), /binding/);
    assert.throws(() => hostInstructionText(bundle, intents[(index + 1) % intents.length]), /binding/);
  }
});

test('loading is host-selected, bounded, stable and refreshed on a new preparation', async t => {
  const root = await mkdtemp(join(tmpdir(), 't06-instructions-')); t.after(() => rm(root, { recursive: true, force: true }));
  const url = pathToFileURL(root + '/');
  assert.equal(await loadHostInstructions('unsure', url), undefined); // Unsupported intent cannot select a path.
  await assert.rejects(loadHostInstructions('define', url));
  await mkdir(join(root, 'references')); await writeFile(join(root, 'SKILL.md'), 'first instructions');
  await writeFile(join(root, 'references/runtime-contract.md'), 'integration boundary');
  const first = await loadHostInstructions('define', url); assert.ok(first);
  await writeFile(join(root, 'SKILL.md'), 'revised instructions');
  const next = await loadHostInstructions('define', url); assert.ok(next); assert.notEqual(next.sha256, first.sha256);
  assert.ok(hostInstructionText(first, 'define').includes('first instructions')); // A frozen job keeps its actual reviewed bytes.
  await writeFile(join(root, 'SKILL.md'), 'x'.repeat(16 * 1024 + 1)); await assert.rejects(loadHostInstructions('define', url), /bounded/);
  await writeFile(join(root, 'SKILL.md'), Buffer.from([0xff, 0xfe])); await assert.rejects(loadHostInstructions('define', url), /encoded data/);
  await writeFile(join(root, 'SKILL.md'), '\ufeffsafe instructions');
  const bom = await loadHostInstructions('define', url); assert.ok(bom!.text.includes('\ufeffsafe instructions'));
  assert.equal(bom!.documents[0].sha256, digest('\ufeffsafe instructions')); await link(join(root, 'SKILL.md'), join(root, 'other'));
  await assert.rejects(loadHostInstructions('define', url), /authoritative/);
});

test('a prepared simulate envelope derives its instruction label from the bundle kind', async () => {
  const hostInstructions = await loadHostInstructions('simulate'); assert.ok(hostInstructions);
  const outgoing: ProviderJobPacket = {
    schema: 'marginalia.job-packet.v1', intent: 'simulate', question: 'Show the behavior.',
    source: { url: 'https://example.test/page', title: 'Example', pageType: null, capturedAt: null, sourceHash: 'source-hash', sourceVersionId: 'source-version' },
    selection: { exact: 'selected', prefix: '', suffix: '', start: 0, end: 8, originalEnd: 8, omittedCharacters: 0 },
    adjacentContext: { before: '', after: '', basis: 'bounded-character-context' },
    availableCapabilities: [], omissions: [],
  };
  const context: FrozenJobContext = {
    hostInstructions, threadId: 'thread', sourceVersionId: 'source-version', sourceUrl: 'https://example.test/page',
    sourceTitle: 'Example', sourcePageType: null, sourceCapturedAt: null, sourceHash: 'source-hash', sourceText: 'selected',
    passage: { exact: 'selected', prefix: '', suffix: '', start: 0, end: 8 }, question: 'Show the behavior.', intent: 'simulate',
    preparedPayloadDigest: '0'.repeat(64), modelSettingsRevision: 1, modelCompatibilityKey: 'test', outgoing,
  };
  const prepared = prepareEnvelope({ sourceUrl: context.sourceUrl, scope: 'cloud-inference', recipient: 'provider', provider: 'app-server',
    model: 'test', mode: 'structured-final', policyKey: 'policy', context, replySchemaText: '{}' });
  const instruction = prepared.outgoing.find(part => part.label === 'Pinned simulate instructions');
  assert.ok(instruction);
  assert.equal(instruction.sha256, hostInstructions.sha256);
});
