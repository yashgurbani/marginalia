import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadHostInstructions, hostInstructionText } from '../daemon/jobs/host-instructions.ts';

test('the actual installed definition bundle is included verbatim and is not a runtime or tool grant', async () => {
  const bundle = await loadHostInstructions('define'); assert.ok(bundle);
  const skill = await readFile(new URL('../skills/define/SKILL.md', import.meta.url), 'utf8');
  const contract = await readFile(new URL('../skills/define/references/runtime-contract.md', import.meta.url), 'utf8');
  assert.ok(bundle.text.includes(skill)); assert.ok(bundle.text.includes(contract));
  assert.equal(bundle.sha256, createHash('sha256').update(bundle.text).digest('hex'));
  assert.deepEqual(bundle.documents.map(file => file.sha256), [skill, contract].map(text => createHash('sha256').update(text).digest('hex')));
  assert.equal(hostInstructionText(bundle, 'define'), bundle.text);
  assert.throws(() => hostInstructionText({ ...bundle, text: bundle.text + 'altered' }, 'define'), /binding/);
  assert.throws(() => hostInstructionText(bundle, 'simulate'), /binding/);
});

test('loading is host-selected, bounded, stable and refreshed on a new preparation', async t => {
  const root = await mkdtemp(join(tmpdir(), 't06-instructions-')); t.after(() => rm(root, { recursive: true, force: true }));
  const url = pathToFileURL(root + '/');
  assert.equal(await loadHostInstructions('simulate', url), undefined); // No accidental document loading for another intent.
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
  assert.equal(bom!.documents[0].sha256, createHash('sha256').update('\ufeffsafe instructions').digest('hex')); await link(join(root, 'SKILL.md'), join(root, 'other'));
  await assert.rejects(loadHostInstructions('define', url), /authoritative/);
});
