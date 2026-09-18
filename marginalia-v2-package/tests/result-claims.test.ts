import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReply, computeIndependentChecks } from '../contracts/reply.ts';
import { classificationViews, runHostChecks } from '../contracts/host-checks.ts';
import { resultClaimsReply, unsupportedConclusion } from '../fixtures/result-claims-reply.ts';
import { growthSourceText, growthDefaultParameters } from '../fixtures/growth-reply.ts';
import { secondPassageReply, secondPassageSourceText, secondPassageDefaultParameters } from '../fixtures/second-passage-reply.ts';
import { ReaderStore } from '../daemon/store.ts';
import { wholePageAnchor } from '../contracts/reader.ts';
import { dom, until } from './t05-dom.ts';

registerHooks({
  resolve(specifier, context, next) { return specifier.endsWith('.css') ? { url: 'result-claims:css', shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === 'result-claims:css' ? { format: 'module', source: '', shortCircuit: true } : next(url, context); },
});
const { mountReply } = await import('../renderer/index.ts');

test('legacy copy stays readable and unassessed even with a valid host report', async t => {
  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_namespace: string, tag: string) { return document.createElement(tag); } });
  const reply = resultClaimsReply(); const before = JSON.stringify(reply);
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText: growthSourceText, hostReport: runHostChecks(reply, growthDefaultParameters) });
  t.after(() => mounted.destroy());
  await until(() => root.querySelector('[data-block="growth-classification"]')!.textContent.includes('diverges at 32.4'));
  assert.equal(root.querySelector('h3')!.textContent, unsupportedConclusion);
  assert.equal(root.querySelector('h3')!.dataset.assessment, 'unassessed');
  assert.match(root.querySelector('[data-block="unsupported-text"]')!.textContent, /Unassessed authored explanation/);
  assert.equal(JSON.stringify(reply), before);
  assert.equal(root.querySelectorAll('[data-assessment="checked"]').length, 0);
});

test('typed slots withhold authored numerical claims, admit only matched sentences, and revoke on changed inputs', async t => {
  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_namespace: string, tag: string) { return document.createElement(tag); } });
  const reply = resultClaimsReply(true);
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText: growthSourceText, hostReport: runHostChecks(reply, growthDefaultParameters) });
  t.after(() => mounted.destroy());
  assert.match(root.querySelector('h3')!.textContent, /withheld/);
  await until(() => root.querySelector('h3')!.dataset.assessment === 'checked');
  for (const node of root.querySelectorAll('[data-assessment="checked"]')) {
    assert.match(node.textContent, /diverges at 32.4/); assert.doesNotMatch(node.textContent, /999/);
  }
  assert.equal(root.querySelectorAll('[data-assessment="checked"]').length, 3);
  const input = root.querySelectorAll('input').find(node => node.type === 'number')!;
  input.value = '0.8'; Object.assign(input, { valueAsNumber: 0.8 }); input.fire('input');
  assert.match(root.querySelector('h3')!.textContent, /withheld/);
  assert.equal(root.querySelectorAll('[data-assessment="checked"]').length, 0);
});

test('strict origins persist without granting typed slots stale or failed authority', async t => {
  const reply = resultClaimsReply(true);
  const admitted = validateReply(reply, { sourceText: growthSourceText, requireOrigins: true });
  assert.equal(admitted.ok, true);
  const store = new ReaderStore(':memory:');
  t.after(() => store.close());
  store.apply({ id: 'keep-combined', kind: 'keep', threadId: 'thread-combined', capture: { url: 'https://example.org/combined', title: 'Fixture', pageType: 'article', text: growthSourceText, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' }, anchor: wholePageAnchor() });
  const saved = store.commitReply({ id: 'combined', threadId: 'thread-combined', reply });
  assert.deepEqual(saved.reply.origins, reply.origins);
  assert.deepEqual(saved.reply.resultClaims, reply.resultClaims);

  const stale = runHostChecks(reply, growthDefaultParameters); stale.parameterDigest = '0'.repeat(64);
  const failed = runHostChecks(reply, growthDefaultParameters); failed.results[0].status = 'fail'; delete failed.results[0].headline; delete failed.results[0].outcome;
  assert.equal(classificationViews(reply, growthDefaultParameters, stale)[0].state, 'withheld');
  assert.equal(classificationViews(reply, growthDefaultParameters, failed)[0].state, 'withheld');

  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_namespace: string, tag: string) { return document.createElement(tag); } });
  const mounted = mountReply(root as unknown as HTMLElement, saved.reply, { sourceText: growthSourceText, hostReport: stale });
  t.after(() => mounted.destroy());
  await until(() => root.querySelector('h3')!.textContent.includes('withheld'));
  assert.equal(root.querySelectorAll('[data-assessment="checked"]').length, 0);
  assert.match(root.textContent, /Authored explanation; not evidence by itself/);
});

test('malformed claims and undeclared illustrations fail validation and daemon commit', () => {
  const reply = resultClaimsReply(true);
  reply.resultClaims![0].classification = 'unsupported-text';
  assert.equal(validateReply(reply, { sourceText: growthSourceText }).ok, false);
  const missing = resultClaimsReply(); delete missing.illustration;
  assert.match(validateReply(missing, { sourceText: growthSourceText }).errors.join(' '), /needs an illustration statement/);
  const store = new ReaderStore(':memory:');
  try {
    store.apply({ id: 'keep', kind: 'keep', threadId: 'thread', capture: { url: 'https://example.org/e13', title: 'Fixture', pageType: 'article', text: growthSourceText, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' }, anchor: wholePageAnchor() });
    assert.throws(() => store.commitReply({ id: 'bad', threadId: 'thread', reply }), /headline classification/);
    assert.throws(() => store.commitReply({ id: 'missing', threadId: 'thread', reply: missing }), /illustration statement/);
    const legacy = resultClaimsReply();
    const saved = store.commitReply({ id: 'legacy', threadId: 'thread', reply: legacy });
    assert.equal(saved.reply.title, unsupportedConclusion); assert.equal(saved.reply.resultClaims, undefined);
  } finally { store.close(); }
});

test('missing illustration has a plain renderer refusal', t => {
  const { root } = dom(t); const reply = resultClaimsReply(); delete reply.illustration;
  mountReply(root as unknown as HTMLElement, reply, { sourceText: growthSourceText });
  assert.equal(root.textContent, 'This model needs an illustration statement explaining what it represents.');
});

test('historical illustration exception cannot admit new replies or declared result slots', () => {
  const legacy = resultClaimsReply(); delete legacy.origins; delete legacy.illustration;
  assert.equal(validateReply(legacy, { sourceText: growthSourceText }).ok, true);
  assert.match(validateReply(legacy, { sourceText: growthSourceText, requireOrigins: true }).errors.join(' '), /illustration statement/);
  legacy.resultClaims = [{ target: 'title', classification: 'growth-classification' }];
  assert.match(validateReply(legacy, { sourceText: growthSourceText }).errors.join(' '), /illustration statement/);
});

test('generic, forged, partial and unsupported checks cannot certify authored prose', () => {
  const reply = resultClaimsReply(true); const report = runHostChecks(reply, growthDefaultParameters);
  report.results[0].headline = unsupportedConclusion;
  assert.equal(classificationViews(reply, growthDefaultParameters, report)[0].state, 'withheld');
  reply.checks[0].criterion = 'generic-check';
  assert.equal(classificationViews(reply, growthDefaultParameters, runHostChecks(reply, growthDefaultParameters))[0].state, 'withheld');
  reply.status = 'partial';
  assert.equal(classificationViews(reply, growthDefaultParameters, runHostChecks(reply, growthDefaultParameters))[0].state, 'withheld');
});

test('cooling renders a matched closed-form result and rejects changed semantics, units and events', async t => {
  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_namespace: string, tag: string) { return document.createElement(tag); } });
  const reply = structuredClone(secondPassageReply);
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText: secondPassageSourceText, hostReport: runHostChecks(reply, secondPassageDefaultParameters) });
  t.after(() => mounted.destroy());
  await until(() => root.querySelector('[data-block="cooling-classification"]')!.textContent.includes('22.9872 °C'));
  for (const mutation of ['equation', 'unit', 'event']) {
    const altered = structuredClone(reply);
    const model = altered.blocks.find(block => block.type === 'model');
    if (model?.type !== 'model' || model.kind !== 'ode') assert.fail();
    if (mutation === 'equation') model.rhs.temp = 'k*(temp-ambient)';
    if (mutation === 'unit') altered.parameters[0].unit = '1/s';
    if (mutation === 'event') model.events = [{ id: 'stop', when: 'temp-30', direction: 'falling', terminal: true }];
    assert.equal(computeIndependentChecks(altered, secondPassageDefaultParameters)[0].status, 'fail');
  }
});
