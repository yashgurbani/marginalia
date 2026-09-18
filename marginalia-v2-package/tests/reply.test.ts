import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  capabilitiesForIntent,
  canonicalReplyData,
  computeIndependentChecks,
  parseAndValidateReply,
  validateReply,
  type CandidateReply,
  type ReplyBlock,
  type ReplyCapability,
} from '../contracts/reply.ts';
import { classificationViews, runHostChecks, type HostCheckReport } from '../contracts/host-checks.ts';
import { deriveSamplesBinding } from '../contracts/sample-provenance.ts';
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

test('evidence intent capabilities admit citations without broadening define replies', () => {
  const evidenceReply: CandidateReply = {
    schema: 'marginalia.reply.v1', intent: 'evidence', status: 'complete',
    title: 'Fixture evidence reply', summary: 'Contract fixture only.', sourceBindings: [], parameters: [], assumptions: [], limitations: [],
    requiredCapabilities: ['network.citations'], checks: [], staticFallback: 'Fixture evidence reply.',
    blocks: [{
      id: 'evidence-citations', type: 'citations', entries: [{
        id: 'evidence-entry', claim: 'A fixture claim.', support: 'Authored support is not verified evidence.',
        source: 'Fixture source', date: '2026-09-18', fetched: false, url: 'https://example.org/evidence',
      }],
    }],
  };

  const admitted = validateReply(evidenceReply, { sourceText: growthSourceText, capabilities: capabilitiesForIntent('evidence') });
  assert.equal(admitted.ok, true, admitted.ok ? '' : admitted.errors.join('\n'));
  const unavailable = validateReply(evidenceReply, { sourceText: growthSourceText, capabilities: capabilitiesForIntent('define') });
  assert.equal(unavailable.ok, false);
  assert.ok(unavailable.errors.includes('$.blocks[0]: capability network.citations is unavailable.'));
});

test('explore intent capabilities admit a shelf without broadening define replies', () => {
  const exploreReply: CandidateReply = {
    schema: 'marginalia.reply.v1', intent: 'explore', status: 'complete',
    title: 'Fixture explore reply', summary: 'Contract fixture only.', sourceBindings: [], parameters: [], assumptions: [], limitations: [],
    requiredCapabilities: ['network.shelf'], checks: [], staticFallback: 'Fixture explore reply.',
    blocks: [{
      id: 'explore-shelf', type: 'shelf',
      items: [{ id: 'reading-one', title: 'Fixture reading', reason: 'A parked suggestion for contract testing.', url: 'https://example.org/reading' }],
    }],
  };

  const admitted = validateReply(exploreReply, { sourceText: growthSourceText, capabilities: capabilitiesForIntent('explore') });
  assert.equal(admitted.ok, true, admitted.ok ? '' : admitted.errors.join('\n'));
  const unavailable = validateReply(exploreReply, { sourceText: growthSourceText, capabilities: capabilitiesForIntent('define') });
  assert.equal(unavailable.ok, false);
  assert.ok(unavailable.errors.includes('$.blocks[0]: capability network.shelf is unavailable.'));
});

// These are contract regressions, not live provider, browser or retrieval evidence.
function setField(candidate: CandidateReply, path: readonly (string | number)[], value: unknown) {
  let target: unknown = candidate;
  for (const key of path.slice(0, -1)) target = (target as Record<string | number, unknown>)[key];
  (target as Record<string | number, unknown>)[path.at(-1)!] = value;
}

function withBlock(block: ReplyBlock): CandidateReply {
  const candidate = cloneReply();
  candidate.requiredCapabilities = allCapabilities;
  candidate.blocks.push(structuredClone(block));
  return candidate;
}

test('T03 F1 empty selectors terminate in an externally time-bounded process', () => {
  // A node:test timeout cannot interrupt a synchronous infinite loop.
  const child = spawnSync(process.execPath, [
    ...process.execArgv.filter(arg => arg === '--experimental-strip-types'),
    '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { validateReply, parseAndValidateReply } from ${JSON.stringify(new URL('../contracts/reply.ts', import.meta.url).href)};
      import { growthReply } from ${JSON.stringify(new URL('../fixtures/growth-reply.ts', import.meta.url).href)};
      const candidate = structuredClone(growthReply);
      candidate.sourceBindings = [{ ...candidate.sourceBindings[0], selector: { exact: '', prefix: 'z' } }];
      for (const result of [validateReply(candidate, { sourceText: 'abc' }), parseAndValidateReply(JSON.stringify(candidate), { sourceText: 'abc' })]) {
        assert.equal(result.ok, false);
        assert.match(result.errors.join(' '), /selector.exact/);
      }
    `,
  ], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
});

test('T03 F1 invalid selector text fails safely and repeated matches retain progress', () => {
  for (const exact of [null, 42, {}, 'x'.repeat(4_001)]) {
    const candidate = cloneReply();
    setField(candidate, ['sourceBindings', 0, 'selector', 'exact'], exact);
    assert.equal(validate(candidate).ok, false);
  }
  const candidate = cloneReply();
  candidate.sourceBindings = [{ ...candidate.sourceBindings[0]!, selector: { exact: 'aa', prefix: 'b' } }];
  assert.equal(validateReply(candidate, { sourceText: 'aaa baa' }).ok, true);
  assert.equal(validateReply(candidate, { sourceText: 'aaaa' }).ok, false);
  setField(candidate, ['sourceBindings', 0, 'selector', 'prefix'], {});
  assert.match(validateReply(candidate, { sourceText: 'aaa baa' }).errors.join(' '), /selector.prefix/);
});

test('T03 F2 malformed nested data returns field errors through both validation entry points', () => {
  const compare: ReplyBlock = { id: 'nested-compare', type: 'compare', variants: [{ id: 'a', label: 'A', blocks: ['explanation'] }, { id: 'b', label: 'B', blocks: ['growth-equation'] }] };
  const solver: ReplyBlock = { id: 'nested-solver', type: 'solver', path: 'solver/main.ts', inputNames: ['gamma'], outputBlocks: ['growth-plot'] };
  const modelIndex = growthReply.blocks.findIndex(block => block.type === 'model');
  const extraIndex = growthReply.blocks.length;
  const cases: { candidate: CandidateReply; path: (string | number)[]; value: unknown }[] = [
    ...[null, [], 3, { gamma: null }].map(value => ({ candidate: cloneReply(), path: ['checks', 0, 'inputs'], value })),
    ...[null, {}, 3, [null]].map(value => ({ candidate: withBlock(compare), path: ['blocks', extraIndex, 'variants'], value })),
    { candidate: withBlock(compare), path: ['blocks', extraIndex, 'variants', 0, 'blocks'], value: null },
    ...[null, {}, 3, [null]].map(value => ({ candidate: withBlock(solver), path: ['blocks', extraIndex, 'outputBlocks'], value })),
    { candidate: cloneReply(), path: ['checks', 0], value: null },
    { candidate: cloneReply(), path: ['blocks', modelIndex, 'rhs'], value: null },
    { candidate: cloneReply(), path: ['blocks', modelIndex, 'state'], value: [null] },
    { candidate: cloneReply(), path: ['blocks', modelIndex, 'events'], value: [{ id: 'stop', when: 'y', direction: { toString: null, valueOf: null }, terminal: true }] },
    { candidate: withBlock({ id: 'bad-kind', type: 'media', kind: 'image', url: 'https://example.org/image', alt: 'Test' }), path: ['blocks', extraIndex, 'kind'], value: { toString: null, valueOf: null } },
  ];
  for (const { candidate, path, value } of cases) {
    setField(candidate, path, value);
    for (const run of [() => validate(candidate), () => parseAndValidateReply(JSON.stringify(candidate), context)]) {
      let result: ReturnType<typeof validate> | undefined;
      assert.doesNotThrow(() => { result = run(); }, path.join('.'));
      assert.equal(result?.ok, false, path.join('.'));
      assert.ok(result!.errors.length > 0, path.join('.'));
      assert.ok(!result!.errors.some(error => error.includes('could not be read')), 'JSON data should receive a specific field error');
    }
  }
});

test('T03 F2 unreadable objects, cycles and sparse arrays fail closed', () => {
  const cycle = cloneReply();
  setField(cycle, ['unexpected'], cycle);
  const sparse = cloneReply();
  setField(sparse, ['blocks'], new Array(1));
  sparse.checks = []; // Reject the hole itself, not a consequent missing check reference.
  const unreadable = new Proxy({}, { getPrototypeOf() { throw new Error('not JSON'); } });
  for (const candidate of [cycle, sparse, unreadable]) {
    assert.doesNotThrow(() => assert.equal(validate(candidate).ok, false));
  }
});

test('T03 F3 validator enforces every published array minimum without a schema dependency', () => {
  const schema = JSON.parse(readFileSync(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8'));
  const extraIndex = growthReply.blocks.length;
  const modelIndex = growthReply.blocks.findIndex(block => block.type === 'model');
  const plotIndex = growthReply.blocks.findIndex(block => block.type === 'plot');
  const single = cloneReply(); single.blocks = [single.blocks[0]!]; single.checks = [];
  const cases: { candidate: CandidateReply; path: (string | number)[]; schema: { minItems: number }; size: number }[] = [
    { candidate: single, path: ['blocks'], schema: schema.properties.blocks, size: 1 },
    { candidate: cloneReply(), path: ['blocks', modelIndex, 'state'], schema: schema.$defs.stateNames, size: 1 },
    { candidate: withBlock({ id: 'min-map', type: 'model', kind: 'map', state: ['x'], next: { x: 'x+1' }, initial: { x: 'y0' }, iterations: 1 }), path: ['blocks', extraIndex, 'state'], schema: schema.$defs.stateNames, size: 1 },
    { candidate: cloneReply(), path: ['blocks', plotIndex, 'y'], schema: schema.$defs.plotBlock.properties.y, size: 1 },
    { candidate: cloneReply(), path: ['blocks', plotIndex, 'yRange'], schema: schema.$defs.range, size: 2 },
    { candidate: withBlock({ id: 'min-table', type: 'table', columns: [{ key: 'x', label: 'X' }], rows: [] }), path: ['blocks', extraIndex, 'columns'], schema: schema.$defs.tableBlock.properties.columns, size: 1 },
    { candidate: withBlock({ id: 'min-steps', type: 'steps', steps: [{ id: 'first', text: 'First' }] }), path: ['blocks', extraIndex, 'steps'], schema: schema.$defs.stepsBlock.properties.steps, size: 1 },
    { candidate: withBlock({ id: 'min-compare', type: 'compare', variants: [{ id: 'a', label: 'A', blocks: ['explanation'] }, { id: 'b', label: 'B', blocks: ['growth-equation'] }] }), path: ['blocks', extraIndex, 'variants'], schema: schema.$defs.compareBlock.properties.variants, size: 2 },
    { candidate: withBlock({ id: 'min-samples', type: 'samples', model: 'growth-model', envelope: { axes: [{ name: 'gamma', min: 0, max: 1, count: 2 }], interpolation: 'linear', errorEvidence: 'Contract only', forbiddenRegions: [] }, samples: [] }), path: ['blocks', extraIndex, 'envelope', 'axes'], schema: schema.$defs.samplesBlock.properties.envelope.properties.axes, size: 1 },
  ];
  for (const { candidate, path, schema: fragment, size } of cases) {
    assert.equal(fragment.minItems, size, path.join('.'));
    assert.equal(validate(candidate).ok, true, path.join('.'));
    let items: unknown = candidate;
    for (const key of path) items = (items as Record<string | number, unknown>)[key];
    assert.equal((items as unknown[]).length, size);
    setField(candidate, path, (items as unknown[]).slice(0, size - 1));
    const result = validate(candidate);
    assert.equal(result.ok, false, path.join('.'));
    assert.match(result.errors.join(' '), new RegExp(`at least ${size} item`), path.join('.'));
  }
});

test('T03 F3 under-minimum arrays still validate present items', () => {
  const candidate = withBlock({ id: 'small-compare', type: 'compare', variants: [{ id: 'a', label: 'A', blocks: [] }] });
  const index = candidate.blocks.length - 1;
  setField(candidate, ['blocks', index, 'variants', 0, 'label'], 42);
  setField(candidate, ['blocks', index, 'variants', 0, 'blocks'], null);
  const errors = validate(candidate).errors.join(' ');
  assert.match(errors, /at least 2 item/);
  assert.match(errors, /variants\[0\].label: expected a string/);
  assert.match(errors, /variants\[0\].blocks: expected an array/);
  const range = cloneReply();
  setField(range, ['blocks', growthReply.blocks.findIndex(block => block.type === 'plot'), 'yRange'], ['bad']);
  assert.match(validate(range).errors.join(' '), /yRange\[0\]: expected a finite number/);
});

test('T03 F4 shared headline admission preserves analytic pole guards without authorizing restricted models', () => {
  const event = cloneReply();
  const model = event.blocks.find(block => block.type === 'model');
  assert.ok(model?.type === 'model' && model.kind === 'ode');
  model.events = [{ id: 'stop', when: 'y-1', direction: 'rising', terminal: true }];
  const wrongUnits = ['gamma', 'f', 'y0'].map(name => {
    const candidate = cloneReply(); candidate.parameters.find(p => p.name === name)!.unit = 'arbitrary'; return candidate;
  });
  const partial = cloneReply(); partial.status = 'partial';
  for (const candidate of [event, ...wrongUnits, partial]) {
    assert.equal(validate(candidate).ok, true);
    const check = computeIndependentChecks(candidate, growthDefaultParameters)[0]!;
    assert.equal(check.status, 'pass', 'The unmodified renderer consumes the numerical pass to stop before a pole');
    assert.deepEqual(check.outcome, computeIndependentChecks(growthReply, growthDefaultParameters)[0]!.outcome);
    assert.equal(check.headline, undefined);
    const report = runHostChecks(candidate, growthDefaultParameters);
    assert.equal(report.results[0]?.headline, undefined);
    assert.equal(classificationViews(candidate, growthDefaultParameters, report)[0]?.state, 'withheld');
  }
  const alternateUnits = cloneReply(); alternateUnits.parameters.find(p => p.name === 'f')!.unit = '1/s^2';
  assert.equal(computeIndependentChecks(alternateUnits, growthDefaultParameters)[0]?.headline, computeIndependentChecks(growthReply, growthDefaultParameters)[0]?.headline);
  const outOfRange = computeIndependentChecks(growthReply, { gamma: 1e-200, f: 0, y0: 0 })[0]!;
  assert.notEqual(outOfRange.status, 'pass');
  assert.equal(outOfRange.headline, undefined);
});

test('T03 F7 DNS prefixes are not IPv6 ranges; private literals including mapped IPv4 are rejected', () => {
  const allowed = [
    ...['fc', 'fd', 'fe8', 'fe9', 'fea', 'feb', '10', '100.64'].map(prefix => `https://${prefix}.example/paper`),
    'https://8.8.8.8/paper', 'https://[2001:4860:4860::8888]/paper',
    'https://[::ffff:8.8.8.8]/paper', 'https://[::ffff:808:808]/paper',
    'https://172.15.1.1/paper', 'https://172.32.1.1/paper', 'https://100.63.1.1/paper', 'https://100.128.1.1/paper',
  ];
  const denied = [
    'https://localhost/paper', 'https://localhost./paper', 'https://x.localhost/paper', 'https://x.local/paper', 'https://x.internal/paper',
    ...['0.0.0.0', '127.0.0.1', '10.1.2.3', '192.168.1.2', '169.254.1.2', '172.16.1.1', '172.31.1.1', '100.64.1.1', '100.127.1.1', '2130706433', '0x7f000001'].map(ip => `https://${ip}/paper`),
    ...['::', '::1', 'fc00::1', 'fdff::1', 'fe80::1', 'febf::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:10.1.2.3', '::ffff:c0a8:102', '::ffff:a9fe:102', '::ffff:ac10:101', '::ffff:6440:101'].map(ip => `https://[${ip}]/paper`),
  ];
  for (const [urls, expected] of [[allowed, true], [denied, false]] as const) {
    for (const url of urls) {
      const candidate = withBlock({ id: 'address', type: 'media', kind: 'image', url, alt: 'Contract only; no request is sent.' });
      const result = validate(candidate);
      assert.equal(result.ok, expected, `${url}: ${result.errors.join(' ')}`);
      if (!expected) assert.match(result.errors.join(' '), /local and private/);
    }
  }
});

test('T03 docs generic canonical serialization and the stricter sample hash boundary remain distinct', async () => {
  assert.equal(canonicalReplyData({ text: '\ud800' }), '{"text":"\\ud800"}');
  const candidate = withBlock({ id: 'unicode-grid', type: 'samples', model: 'growth-model', envelope: { axes: [{ name: 'gamma', min: 0, max: 1, count: 2 }], fixedInputs: { f: 0.07, y0: 0 }, interpolation: 'linear', errorEvidence: 'Contract only', forbiddenRegions: [] }, samples: [] });
  const block = candidate.blocks.at(-1)!;
  assert.ok(block.type === 'samples');
  candidate.title = '\ud800';
  await assert.rejects(deriveSamplesBinding(candidate, block), /unpaired Unicode surrogate/);
});
