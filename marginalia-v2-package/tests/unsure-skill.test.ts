import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { CandidateReply } from '../contracts/reply.ts';
import { validateReply } from '../contracts/reply.ts';
import { loadHostInstructions } from '../daemon/jobs/host-instructions.ts';

const files = [
  new URL('../skills/unsure/SKILL.md', import.meta.url),
  new URL('../skills/unsure/IO.md', import.meta.url),
];

const authoredReply = (): CandidateReply => ({
  schema: 'marginalia.reply.v1',
  intent: 'unsure',
  status: 'complete',
  title: 'What this passage establishes',
  summary: 'The passage supports one interpretation and leaves a material detail open.',
  origins: { version: 1, parts: {
    '/title': { kind: 'authored', description: 'A descriptive title for the assessment.' },
    '/summary': { kind: 'authored', description: 'A concise authored assessment.' },
    '/staticFallback': { kind: 'authored', description: 'A text alternative for the reply.' },
    '/sourceBindings/0': { kind: 'source-page', binding: 'claim' },
    '/limitations/0': { kind: 'authored', description: 'A limit identified from the captured context.' },
    '/blocks/0': { kind: 'authored', description: 'An interpretation, missing information and suggested next kind.' },
    '/blocks/1': { kind: 'authored', description: 'One clarifying question.' },
    '/blocks/1/answers/0': { kind: 'authored', description: 'A reader-selectable answer.' },
  } },
  sourceBindings: [{ name: 'claim', meaning: 'the claim being interpreted', relation: 'interpreted', selector: { exact: 'The effect depends on scale.' } }],
  parameters: [],
  assumptions: [],
  limitations: ['The passage does not identify the relevant scale.'],
  blocks: [
    { id: 'assessment', type: 'text', md: 'The passage supports a scale-dependent effect. It does not say which scale applies here. The missing information is the scale used in this case. A worked example would fit next because it can make that scale concrete.' },
    { id: 'clarify', type: 'question', prompt: 'Which scale does this case use?', answers: [{ id: 'local', label: 'Local scale', value: 'Use the local scale.' }], allowFreeText: true },
  ],
  checks: [],
  staticFallback: 'The passage supports a scale-dependent effect, but the relevant scale is missing.',
});

test('unsure instructions keep the reply declarative, bounded and tool-free', async () => {
  let instructions = '';
  for (const file of files) {
    const bytes = await readFile(file);
    assert.ok(bytes.byteLength <= 16 * 1024, `${file.pathname} exceeds the loader bound`);
    instructions += new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  for (const phrase of ['supported interpretation', 'missing information', 'at most one question', 'no tools', 'no fetch', 'no code execution', 'reply.json', 'complete per-part origins']) {
    assert.ok(instructions.includes(phrase), `unsure instructions are missing: ${phrase}`);
  }
  const bundle = await loadHostInstructions('unsure');
  assert.ok(bundle);
  assert.equal(bundle.kind, 'unsure');
});

test('an authored unsure reply accepts one question and refuses two', () => {
  const reply = authoredReply();
  assert.equal(validateReply(reply, { sourceText: 'The effect depends on scale.', requireOrigins: true }).ok, true);

  const twoQuestions: CandidateReply = {
    ...reply,
    origins: { version: 1, parts: {
      ...reply.origins!.parts,
      '/blocks/2': { kind: 'authored', description: 'A second clarifying question.' },
    } },
    blocks: [...reply.blocks, { id: 'clarify-again', type: 'question', prompt: 'Which setting applies?', answers: [], allowFreeText: true }],
  };
  const refused = validateReply(twoQuestions, { sourceText: 'The effect depends on scale.', requireOrigins: true });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.ok(refused.errors.includes('$.blocks: a reply may contain at most one clarifying question.'));
});
