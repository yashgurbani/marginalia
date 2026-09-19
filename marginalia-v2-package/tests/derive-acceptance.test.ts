import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptP13Reply, reopenP13Reply, saveP13View } from './p13-acceptance-harness.ts';
import { deriveReply, deriveSource } from './p13-derive-fixture.ts';
import { button, dom } from './t05-dom.ts';

registerHooks({
  resolve(specifier, context, next) { return specifier.endsWith('.css') ? { url: 'p13-derive:css', shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === 'p13-derive:css' ? { format: 'module', source: '', shortCircuit: true } : next(url, context); },
});
const { mountReply } = await import('../renderer/index.ts');

test('source-bound derivation keeps step boundaries and saved position through a request-free reopen', { timeout: 20_000 }, async t => {
  const accepted = await acceptP13Reply(t, {
    name: 'derive', intent: 'derive', question: 'Explain this passage step by step.',
    sourceText: deriveSource, reply: deriveReply(),
  });
  assert.deepEqual(accepted.saved.reply.checks, []);
  assert.equal(accepted.saved.reply.resultClaims, undefined);
  assert.deepEqual(accepted.saved.validation.results, []);

  const first = dom(t), root = first.root;
  let pendingSave: Promise<void> | undefined;
  const mounted = mountReply(root as unknown as HTMLElement, accepted.saved.reply, {
    sourceText: accepted.source.text,
    initialState: accepted.view,
    onStateChange: state => pendingSave = saveP13View(accepted, `p13-derive-view-${accepted.view.revision}`, state),
  });
  t.after(() => mounted.destroy());
  const clickAndSave = async (control: ReturnType<typeof button>, revision: number) => {
    const previousSave = pendingSave;
    control.click();
    const save = pendingSave;
    assert.ok(save && save !== previousSave, 'each step change starts a fresh save');
    await save; // Await the actual HTTP save, including rejection, under the test timeout.
    assert.equal(accepted.view.revision, revision);
  };
  const steps = root.querySelector('[data-block="derivation"]')!;
  assert.ok(root.querySelectorAll('blockquote').some(node => node.textContent === 'Subtract the same amount from both sides'));
  assert.ok(root.querySelectorAll('blockquote').some(node => node.textContent === 'divide both sides by two'));
  assert.match(root.textContent, /Could not be checked here\./);
  assert.equal(root.querySelectorAll('[data-assessment="checked"]').length, 0);

  const previous = button(steps, 'Previous step'), next = button(steps, 'Next step');
  assert.equal(previous.disabled, true); assert.equal(next.disabled, false);
  previous.click(); assert.match(steps.textContent, /1 of 3 steps revealed/);
  assert.equal(pendingSave, undefined, 'disabled previous step does not save');
  await clickAndSave(next, 2); assert.match(steps.textContent, /2 of 3 steps revealed/);
  await clickAndSave(next, 3); assert.match(steps.textContent, /3 of 3 steps revealed/);
  const finalStepSave = pendingSave;
  assert.equal(next.disabled, true); next.click(); assert.match(steps.textContent, /3 of 3 steps revealed/);
  assert.equal(pendingSave, finalStepSave, 'disabled next step does not save');
  await clickAndSave(previous, 4); assert.match(steps.textContent, /2 of 3 steps revealed/);
  mounted.destroy();

  const reopened = await reopenP13Reply(accepted);
  const second = dom(t);
  const reopenedMount = mountReply(second.root as unknown as HTMLElement, reopened.saved.reply, {
    sourceText: reopened.source.text, initialState: reopened.view,
  });
  t.after(() => reopenedMount.destroy());
  const reopenedSteps = second.root.querySelector('[data-block="derivation"]')!;
  assert.match(reopenedSteps.textContent, /2 of 3 steps revealed/);
  assert.equal(reopenedSteps.querySelectorAll('li').filter(item => !item.hidden).length, 2);
  assert.equal((await reopened.trip.calls()).filter(call => call.kind === 'start').length, 1);
  assert.equal((await reopened.trip.calls()).filter(call => call.kind === 'resume').length, 0);
});
