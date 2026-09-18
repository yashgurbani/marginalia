import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { interactiveGrowthReply, interactiveGrowthSourceText } from '../fixtures/interactive-growth-reply.ts';
import { growthDefaultParameters } from '../fixtures/growth-reply.ts';
import { prepareWorkspace, readReplyFile } from '../daemon/jobs/workspace.ts';
import { loadHostInstructions } from '../daemon/jobs/host-instructions.ts';
import { runHostChecks, classificationViews } from '../contracts/host-checks.ts';
import { calculateReply, initialRendererState } from '../renderer/state.ts';

test('Simulate it recipe passes workspace admission with no saved solver and restores changed local inputs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'a1-simulate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = await loadHostInstructions('simulate');
  assert.ok(bundle?.text.includes('## Packaged kernel recipe'));
  const schema = await readFile(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8');
  const sourceText = interactiveGrowthSourceText;
  const workspace = await prepareWorkspace(root, 'attempt', {
    schema: 'marginalia.job-packet.v1', intent: 'simulate', question: 'Try this model',
    source: { url: 'https://example.test/synthetic', title: 'Synthetic test passage', pageType: 'article', capturedAt: null, sourceHash: 'a'.repeat(64), sourceVersionId: 'source' },
    selection: { exact: sourceText, prefix: '', suffix: '', start: 0, end: sourceText.length, originalEnd: sourceText.length, omittedCharacters: 0 },
    adjacentContext: { before: '', after: '', basis: 'bounded-character-context' }, availableCapabilities: [], omissions: [],
  }, schema);
  await writeFile(join(workspace, 'reply.json'), JSON.stringify(interactiveGrowthReply));
  const reply = await readReplyFile(workspace, 'reply.json', sourceText, []);
  assert.ok(reply);
  assert.ok(reply.parameters.every(p => p.sourceBinding && sourceText.includes(p.sourceBinding.selector.exact)));
  assert.ok(reply.assumptions.some(a => a.editable && a.binding));
  assert.equal(reply.blocks.some(b => b.type === 'solver'), false);
  const before = calculateReply(reply, growthDefaultParameters);
  const changed = { ...growthDefaultParameters, gamma: 0.8 };
  const after = calculateReply(reply, changed);
  assert.notDeepEqual(before.models.get('growth-model'), after.models.get('growth-model'));
  assert.equal(after.models.get('growth-model')?.ok, true);
  const report = runHostChecks(reply, changed);
  assert.equal(classificationViews(reply, changed, report)[0].state, 'verified');
  const checkedLabel = classificationViews(reply, changed, report)[0].label;
  assert.equal(typeof checkedLabel, 'string');
  assert.match(checkedLabel ?? '', /Settles/);
  const restored = initialRendererState(reply, JSON.parse(JSON.stringify({ parameters: changed, view: {} })));
  assert.deepEqual(restored.parameters, changed);
  assert.deepEqual(calculateReply(reply, restored.parameters), after);
  assert.equal(interactiveGrowthReply.parameters[0].default, 0.5);
});
