import { registerHooks } from 'node:module';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { growthReply, growthSourceText } from '../fixtures/growth-reply.ts';
import { validateReply, type CandidateReply } from '../contracts/reply.ts';
import { runHostChecks } from '../contracts/host-checks.ts';
import { dom, until } from './t05-dom.ts';
registerHooks({
  resolve(s, c, next) { return s.endsWith('.css') ? { url: 'answer-first:css', shortCircuit: true } : next(s, c); },
  load(u, c, next) { return u === 'answer-first:css' ? { format: 'module', source: '', shortCircuit: true } : next(u, c); },
});
const { mountReply } = await import('../renderer/index.ts');
function mount(t: TestContext, reply: CandidateReply) {
  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_namespace: string, tag: string) { return document.createElement(tag); } });
  const valid = validateReply(reply, { sourceText: growthSourceText }); assert.equal(valid.ok, true, JSON.stringify(valid));
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText: growthSourceText, capabilities: ['network.citations', 'network.shelf'], resolveHostReport: async p => runHostChecks(reply, p), onFollowup: () => {} });
  t.after(() => mounted.destroy());
  const article = root.querySelector('article')!;
  const made = root.querySelectorAll('details').find(n => n.firstElementChild?.textContent === 'How this was made')!;
  return { root, article, made, mounted };
}
function prose(intent: CandidateReply['intent'] = 'define'): CandidateReply {
  return { schema: 'marginalia.reply.v1', intent, status: 'complete', title: 'Answer', summary: 'Summary answer.', blocks: [], parameters: [], assumptions: [], limitations: [], checks: [], sourceBindings: [], requiredCapabilities: [], staticFallback: 'Saved answer.' };
}
test('simulation answer precedes summary while controls, plot, checks and assumptions work', async t => {
  const reply = structuredClone(growthReply); reply.assumptions[0].binding = { parameter: 'gamma', min: 0, max: 2 };
  const { root, article, mounted } = mount(t, reply), children = article.children;
  const summary = children.find(n => n.textContent === reply.summary)!; assert.ok(summary);
  assert.equal(children[0].tagName, 'H3'); assert.equal(children[1].textContent, reply.illustration!.statement);
  assert.ok(children.indexOf(root.querySelector('.mr-parameters')!) < children.indexOf(summary));
  assert.ok(children.indexOf(root.querySelector('.mr-blocks')!) < children.indexOf(summary));
  assert.deepEqual(root.querySelectorAll('section').map(n => n.dataset.block), reply.blocks.map(b => b.id));
  assert.ok(root.querySelector('svg')); assert.ok(root.querySelectorAll('summary').some(n => n.textContent === 'Source passage'));
  const assumption = root.querySelector('input[data-assumption-id]')!; assert.ok(assumption);
  Object.assign(assumption, { value: '0.8', valueAsNumber: 0.8 }); assumption.fire('change');
  assert.equal(mounted.getState().parameters.gamma, 0.8);
  await until(() => root.querySelector('.mr-classification')?.textContent.includes('Checked on this device') === true);
  assert.doesNotMatch(root.textContent, /could not be displayed/);
});
test('evidence leads with claim and keeps unverified support in closed disclosure', t => {
  const reply = prose('evidence'); reply.requiredCapabilities = ['network.citations'];
  reply.blocks = [{ id: 'citations', type: 'citations', entries: [{ id: 'claim', claim: 'Damping opposes growth.', support: 'The page compares damping and forcing in a toy amplitude model.', source: 'Source page', date: '2026-09-18', fetched: false, url: 'https://example.org/source' }] }];
  const { root, made } = mount(t, reply), entry = root.querySelector('.mr-citation')!;
  assert.equal(entry.children[0].textContent, 'Damping opposes growth.'); assert.ok(entry.querySelector('a'));
  assert.doesNotMatch(entry.textContent, /Unverified|awaits assessment|fetching alone/);
  assert.equal(made.open, false); assert.match(made.textContent, /Unverified. Claim support awaits assessment/);
  assert.match(made.textContent, /Damping opposes growth/); assert.doesNotMatch(made.textContent, /Quoted from this page/);
  assert.ok(root.textContent.indexOf('Damping opposes growth.') < root.textContent.indexOf(reply.summary));
});
test('explore leads with reading item and retains actual link unavailability', async t => {
  const reply = prose('explore'); reply.requiredCapabilities = ['network.shelf'];
  reply.blocks = [{ id: 'reading', type: 'shelf', items: [{ id: 'first', title: 'Read about damping', reason: 'Builds on this passage.', url: 'https://example.org/reading' }] }];
  const { root, made } = mount(t, reply), shelf = root.querySelector('.mr-shelf')!;
  assert.equal(shelf.children[0].children[0].textContent, 'Read about damping');
  assert.ok(root.textContent.indexOf('Read about damping') < root.textContent.indexOf(reply.summary));
  assert.doesNotMatch(shelf.textContent, /Source contents and claim support remain unverified/);
  assert.match(made.textContent, /Source contents and claim support remain unverified/); assert.equal(made.open, false);
  await until(() => shelf.textContent.includes('unavailable')); assert.equal(shelf.querySelector('button')!.disabled, true);
});
test('direct text answer precedes summary', t => {
  const reply = prose(); reply.blocks = [{ id: 'answer', type: 'text', md: 'Direct explanation.' }];
  const { root } = mount(t, reply); assert.ok(root.textContent.indexOf('Direct explanation.') < root.textContent.indexOf(reply.summary));
});
test('text fallback partial reply keeps summary and provisional marker', t => {
  const reply = prose(); reply.status = 'partial'; reply.blocks = [{ id: 'fallback', type: 'text', md: 'Saved textual answer.' }]; const { article } = mount(t, reply);
  assert.match(article.textContent, /Provisional reply/); assert.ok(article.textContent.indexOf(reply.summary) < article.textContent.indexOf('How this was made'));
});

test('empty-block reply retains the real validation failure', t => {
  const { root } = dom(t); const mounted = mountReply(root as unknown as HTMLElement, prose(), { sourceText: growthSourceText });
  t.after(() => mounted.destroy()); assert.match(root.textContent, /could not be safely displayed/);
});
