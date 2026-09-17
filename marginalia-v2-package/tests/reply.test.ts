import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIndependentChecks,
  parseAndValidateReply,
  validateReply,
  type CandidateReply,
  type ReplyBlock,
  type ReplyCapability,
} from '../contracts/reply.ts';
import { classificationViews, runHostChecks, type HostCheckReport } from '../contracts/host-checks.ts';
import { growthDefaultParameters, growthReply, growthSourceText } from '../fixtures/growth-reply.ts';

const allCapabilities: ReplyCapability[] = ['samples', 'solver', 'media.audio', 'media.image', 'media.video', 'network.citations', 'network.shelf'];
const context = { sourceText: growthSourceText, capabilities: allCapabilities } as const;

function cloneReply(): CandidateReply {
  return structuredClone(growthReply);
}

function validate(candidate: unknown, capabilities: readonly ReplyCapability[] = allCapabilities) {
  return validateReply(candidate, { sourceText: growthSourceText, capabilities });
}

test('honest growth fixture validates and its independently checked headline covers divergence beyond the plot', () => {
  const validated = validate(growthReply);
  assert.equal(validated.ok, true, validated.ok ? '' : validated.errors.join('\n'));
  const browserResults = computeIndependentChecks(growthReply, growthDefaultParameters);
  assert.equal(browserResults[0]?.status, 'pass');
  assert.equal(browserResults[0]?.headline, 'Still rising at 8 s. This model diverges at 32.4 s.');
  const report = runHostChecks(growthReply, growthDefaultParameters);
  assert.deepEqual(classificationViews(growthReply, growthDefaultParameters, report), [{
    blockId: 'growth-classification', state: 'verified', label: 'Still rising at 8 s. This model diverges at 32.4 s.',
  }]);
  assert.equal(growthReply.parameters.find((parameter) => parameter.name === 'y0')?.unit, '1/s');
  assert.equal(growthReply.blocks.find((block) => block.id === 'growth-plot')?.type, 'plot');
});

test('contract-test fixture accepts every launch block and both declared model classes', () => {
  const candidate = cloneReply();
  candidate.requiredCapabilities = ['samples', 'solver', 'media.image', 'network.citations', 'network.shelf'];
  const contractOnlyBlocks: ReplyBlock[] = [
    { id: 'contract-map', type: 'model', kind: 'map', state: ['x'], next: { x: 'x+1' }, initial: { x: 'y0' }, iterations: 10 },
    { id: 'contract-table', type: 'table', columns: [{ key: 'field', label: 'Field' }], rows: [{ field: 'Contract test value' }] },
    { id: 'contract-diagram', type: 'diagram', nodes: [{ id: 'source-node', label: 'Contract test source', binding: 'gamma-source' }, { id: 'result-node', label: 'Contract test result' }], edges: [{ id: 'edge-one', from: 'source-node', to: 'result-node' }] },
    { id: 'contract-steps', type: 'steps', steps: [{ id: 'step-one', text: 'Contract test step.' }] },
    { id: 'contract-compare', type: 'compare', variants: [{ id: 'variant-a', label: 'Text', blocks: ['explanation'] }, { id: 'variant-b', label: 'Equation', blocks: ['growth-equation'] }] },
    { id: 'contract-question', type: 'question', prompt: 'Contract test question?', answers: [{ id: 'answer-one', label: 'One', value: 'one' }], allowFreeText: true },
    { id: 'contract-turn', type: 'turn', version: 1, text: 'Contract test follow-up.' },
    { id: 'contract-citations', type: 'citations', entries: [{ id: 'citation-one', claim: 'Contract test claim.', support: 'Contract test support.', source: 'Contract test source', date: '2026-09-17', fetched: false, url: 'https://example.org/contract-citation' }] },
    { id: 'contract-shelf', type: 'shelf', items: [{ id: 'shelf-one', title: 'Contract test item', reason: 'Exercises the shelf shape only.', url: 'https://example.org/contract-shelf' }] },
    { id: 'contract-samples', type: 'samples', model: 'growth-model', envelope: { axes: [{ name: 'gamma', min: 0, max: 1, count: 2 }], interpolation: 'linear', errorEvidence: 'Contract-test endpoints.', forbiddenRegions: [] }, samples: [{ at: { gamma: 0 }, values: { y: 0 } }, { at: { gamma: 1 }, values: { y: 0 } }] },
    { id: 'contract-solver', type: 'solver', path: 'solver/contract-test.ts', inputNames: ['gamma'], outputBlocks: ['growth-plot'] },
    { id: 'contract-media', type: 'media', kind: 'image', url: 'https://example.org/contract-image.png', alt: 'Contract test image.' },
  ];
  candidate.blocks.push(...contractOnlyBlocks);
  const result = validate(candidate);
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
  const types = new Set(candidate.blocks.map((block) => block.type));
  assert.deepEqual([...types].sort(), ['citations', 'classification', 'compare', 'derived', 'diagram', 'equation', 'media', 'model', 'plot', 'question', 'samples', 'shelf', 'solver', 'steps', 'table', 'text', 'turn']);
});

test('malicious expressions, generated code, raw HTML, path escapes and dangerous URLs are rejected with reasons', () => {
  const expression = cloneReply();
  const model = expression.blocks.find((block) => block.id === 'growth-model');
  assert.equal(model?.type, 'model');
  if (model?.type === 'model' && model.kind === 'ode') model.rhs.y = 'process.exit()';
  assert.match(validate(expression).errors.join('\n'), /Unsupported|function|expression/i);

  const code = cloneReply();
  code.blocks.push({ id: 'bad-code', type: 'text', md: '```js\nfetch("https://example.org")\n```' });
  assert.match(validate(code).errors.join('\n'), /code fences/i);

  const html = cloneReply();
  html.blocks.push({ id: 'bad-html', type: 'text', md: '<img src=x onerror=alert(1)>' });
  assert.match(validate(html).errors.join('\n'), /raw HTML/i);

  const path = cloneReply();
  path.requiredCapabilities = ['solver'];
  path.blocks.push({ id: 'bad-path', type: 'solver', path: '../outside.ts', inputNames: ['gamma'], outputBlocks: ['growth-plot'] });
  assert.match(validate(path).errors.join('\n'), /safe relative workspace path/i);

  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://127.0.0.1/private', 'https://localhost/private']) {
    const dangerous = cloneReply();
    dangerous.requiredCapabilities = ['media.image'];
    dangerous.blocks.push({ id: 'bad-media', type: 'media', kind: 'image', url, alt: 'Unsafe contract test.' });
    assert.match(validate(dangerous).errors.join('\n'), /HTTPS|local and private/i, url);
  }
});

test('resource caps reject oversized, deeply nested and overlong-array candidates', () => {
  const oversized = cloneReply();
  oversized.staticFallback = 'x'.repeat(300_000);
  const parsed = parseAndValidateReply(JSON.stringify(oversized), context);
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.join('\n'), /byte limit/i);

  const deep = cloneReply() as CandidateReply & Record<string, unknown>;
  let cursor: Record<string, unknown> = {};
  deep.unexpected = cursor;
  for (let i = 0; i < 20; i++) { cursor.next = {}; cursor = cursor.next as Record<string, unknown>; }
  assert.match(validate(deep).errors.join('\n'), /nesting exceeds/i);

  const arrays = cloneReply();
  arrays.blocks = Array.from({ length: 65 }, (_, index) => ({ id: `text-${index}`, type: 'text' as const, md: 'bounded' }));
  assert.match(validate(arrays).errors.join('\n'), /64-item limit/i);
});

test('selectors must exist in the captured source and all references must resolve', () => {
  const selector = cloneReply();
  selector.sourceBindings[0]!.selector.exact = 'words absent from source';
  assert.match(validate(selector).errors.join('\n'), /does not match the supplied source text/i);

  const reference = cloneReply();
  const plot = reference.blocks.find((block) => block.type === 'plot');
  if (plot?.type === 'plot') plot.from = 'missing-model';
  assert.match(validate(reference).errors.join('\n'), /unknown block reference/i);
});

test('candidate output cannot forge host success or smuggle conditional templates', () => {
  const forged = cloneReply() as CandidateReply & { checks: (CandidateReply['checks'][number] & { result?: string; kind?: string })[] };
  forged.checks[0]!.result = 'pass';
  forged.checks[0]!.kind = 'host';
  assert.match(validate(forged).errors.join('\n'), /unknown field/i);

  const template = cloneReply();
  const classification = template.blocks.find((block) => block.type === 'classification');
  if (classification?.type === 'classification') classification.labels.diverges = 'Diverges at ${time}';
  assert.match(validate(template).errors.join('\n'), /template/i);
});

test('altered models cannot masquerade as growth-v1 even when structurally valid', () => {
  const altered = cloneReply();
  const model = altered.blocks.find((block) => block.type === 'model');
  if (model?.type === 'model' && model.kind === 'ode') model.rhs.y = 'y^2 - gamma*y + f + 0.001';
  const validated = validate(altered);
  assert.equal(validated.ok, true, validated.ok ? '' : validated.errors.join('\n'));
  const report = runHostChecks(altered, growthDefaultParameters);
  assert.equal(report.results[0]?.status, 'fail');
  assert.equal(classificationViews(altered, growthDefaultParameters, report)[0]?.state, 'withheld');
});

test('host authority is bound to reply content, current parameters and check version', () => {
  const report = runHostChecks(growthReply, growthDefaultParameters);
  const changed = { gamma: 0.5, f: 0.2, y0: 0 };
  assert.equal(classificationViews(growthReply, changed, report)[0]?.state, 'withheld');
  const changedReport = runHostChecks(growthReply, changed);
  assert.equal(classificationViews(growthReply, changed, changedReport)[0]?.label, 'This model diverges at 5.8 s.');

  const staleVersion = structuredClone(report) as HostCheckReport;
  (staleVersion as { checkVersion: string }).checkVersion = 'host-checks.v0';
  assert.equal(classificationViews(growthReply, growthDefaultParameters, staleVersion)[0]?.state, 'withheld');

  const changedReply = cloneReply();
  changedReply.summary = 'Changed content invalidates a prior report.';
  assert.equal(classificationViews(changedReply, growthDefaultParameters, report)[0]?.state, 'withheld');
});

test('missing and unsupported headline checks validate structurally but are withheld', () => {
  const missing = cloneReply();
  const missingClassification = missing.blocks.find((block) => block.type === 'classification');
  if (missingClassification?.type === 'classification') delete missingClassification.check;
  missing.checks = [];
  assert.equal(validate(missing).ok, true);
  assert.equal(classificationViews(missing, growthDefaultParameters, runHostChecks(missing, growthDefaultParameters))[0]?.state, 'withheld');

  const unsupported = cloneReply();
  unsupported.checks[0]!.criterion = 'novel-science-v1';
  const report = runHostChecks(unsupported, growthDefaultParameters);
  assert.equal(report.results[0]?.status, 'unsupported');
  assert.equal(classificationViews(unsupported, growthDefaultParameters, report)[0]?.state, 'withheld');
});

test('capability-gated blocks require both a declaration and host availability', () => {
  const candidate = cloneReply();
  candidate.blocks.push({ id: 'gated-media', type: 'media', kind: 'image', url: 'https://example.org/contract.png', alt: 'Contract test.' });
  assert.match(validate(candidate).errors.join('\n'), /requires declared capability media\.image/i);
  candidate.requiredCapabilities = ['media.image'];
  assert.match(validate(candidate, []).errors.join('\n'), /capability media\.image is unavailable/i);
  assert.equal(validate(candidate, ['media.image']).ok, true);
});
