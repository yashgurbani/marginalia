import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptP13Reply, reopenP13Reply, saveP13View } from './p13-acceptance-harness.ts';
import { instantiateReply, instantiateSource } from './p13-instantiate-fixture.ts';
import { dom, until, type TestElement } from './t05-dom.ts';

registerHooks({
  resolve(specifier, context, next) { return specifier.endsWith('.css') ? { url: 'p13-instantiate:css', shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === 'p13-instantiate:css' ? { format: 'module', source: '', shortCircuit: true } : next(url, context); },
});
const { mountReply } = await import('../renderer/index.ts');

function numberInput(root: TestElement, label: string): TestElement {
  const field = root.querySelectorAll('input').find(node => node.type === 'number' && node.parentElement?.textContent.includes(label));
  if (!field) throw new Error(`Missing number input: ${label}`);
  return field;
}

test('worked arithmetic crosses jobs, renders finite and undefined values, and reopens without another request', async t => {
  const accepted = await acceptP13Reply(t, {
    name: 'instantiate', intent: 'instantiate', question: 'Show a worked example of this passage.',
    sourceText: instantiateSource, reply: instantiateReply(),
  });
  assert.deepEqual(accepted.saved.reply.blocks.map(block => block.type), ['text', 'steps', 'table', 'derived']);
  assert.deepEqual(accepted.saved.validation.results, []);

  const first = dom(t), root = first.root;
  const mounted = mountReply(root as unknown as HTMLElement, accepted.saved.reply, {
    sourceText: accepted.source.text,
    initialState: accepted.view,
    onStateChange: state => saveP13View(accepted, 'p13-instantiate-view-undefined', state),
  });
  assert.match(root.textContent, /Samples per tray: 4 samples/);
  assert.match(root.textContent, /TableQuantityValueUnitTotal24samples/);
  const trays = numberInput(root, 'trays');
  trays.value = '0'; Object.assign(trays, { valueAsNumber: 0 }); trays.fire('change');
  await until(() => accepted.view.revision === 2);
  assert.match(root.textContent, /Samples per tray: The expression is undefined for these inputs\./);
  mounted.destroy();

  const reopened = await reopenP13Reply(accepted);
  assert.equal(reopened.view.parameters.trays, 0);
  const second = dom(t);
  const reopenedMount = mountReply(second.root as unknown as HTMLElement, reopened.saved.reply, {
    sourceText: reopened.source.text, initialState: reopened.view,
  });
  t.after(() => reopenedMount.destroy());
  assert.match(second.root.textContent, /Samples per tray: The expression is undefined for these inputs\./);
  assert.equal((await reopened.trip.calls()).filter(call => call.kind === 'start').length, 1);
  assert.equal((await reopened.trip.calls()).filter(call => call.kind === 'resume').length, 0);
});
