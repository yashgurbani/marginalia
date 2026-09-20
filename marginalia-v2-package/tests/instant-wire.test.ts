import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultInstantHelpSettings, instantTextToReply } from '../contracts/instant.ts';
import type { SourceCapture } from '../contracts/reader.ts';
import { FakeInstantTransport, type InstantDefinitionEvent } from '../ui/instant/transport.ts';
import { asHost, storage } from './t05-harness.ts';
import { deferred, dom, until } from './t05-dom.ts';

const { mountMargin } = await import('../ui/margin.ts');

const capture: SourceCapture = {
  url: 'https://example.org/instant', title: 'Instant source', pageType: 'article',
  text: 'Entropy measures uncertainty in this passage. Another sentence.',
  capturedAt: '2026-09-18T10:00:00.000Z', extractionVersion: 'instant-test-v1',
  sections: [{ title: 'Page', start: 0, end: 63 }],
};
const anchor = { exact: 'Entropy', prefix: '', suffix: ' measures uncertainty in this passage.', start: 0, end: 7 };

function environment(t: import('node:test').TestContext) {
  return { ...dom(t), ...storage(t), namespace: crypto.randomUUID() };
}

test('selection streams instant help above Keep and Ask through the injected transport', async t => {
  const e = environment(t), fake = new FakeInstantTransport(defaultInstantHelpSettings()), finish = deferred<void>();
  fake.definition = async function* (): AsyncIterable<InstantDefinitionEvent> {
    yield { type: 'text-delta', text: 'Entropy describes ' };
    await finish.promise;
    yield { type: 'reply', reply: instantTextToReply('Entropy describes uncertainty in the possible state.') };
  };
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, instantHelp: fake });

  await until(() => e.root.querySelectorAll('.m-instant-onboarding').length === 1);
  api.select(anchor);
  await until(() => e.root.querySelector('.m-instant-definition')?.textContent === 'Entropy describes ');

  const card = e.root.querySelector('.m-selection')!, definition = card.querySelector('.m-instant-definition')!, actions = card.querySelector('.m-selection-actions')!;
  assert.ok(card.children.indexOf(definition.parentElement!) < card.children.indexOf(actions));
  assert.deepEqual(fake.selections, [{
    requestId: fake.selections[0].requestId,
    pageKey: capture.url,
    sourceUrl: capture.url,
    sourceGeneration: `${capture.capturedAt}:${capture.extractionVersion}`,
    text: anchor.exact,
    action: 'define',
  }]);

  finish.resolve();
  await until(() => definition.textContent === 'Entropy describes uncertainty in the possible state.');
  api.select({ ...anchor, exact: 'uncertainty', start: 17, end: 28 });
  assert.equal(e.root.querySelectorAll('.m-instant-onboarding').length, 1);
  api.destroy(); await api.drain();
});

test('instant policy states and transport failure show quiet plain states in the wired selection card', async t => {
  const e = environment(t), fake = new FakeInstantTransport(defaultInstantHelpSettings());
  fake.definition = async function* (): AsyncIterable<InstantDefinitionEvent> {
    yield { type: 'text-delta', text: 'partial text' };
    throw new Error('backend unavailable');
  };
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, instantHelp: fake });

  api.select(anchor); await api.drain();
  const definition = e.root.querySelector('.m-instant-definition')!;
  assert.equal(definition.textContent, 'Instant help is unavailable.');
  assert.doesNotMatch(e.root.textContent, /backend/i);

  fake.settings = { ...fake.settings, enabled: false };
  api.select({ ...anchor, exact: 'uncertainty', start: 17, end: 28 }); await api.drain();
  assert.equal(fake.selections.length, 1, 'disabled settings do not request a definition');
  assert.equal(definition.textContent, '');

  fake.settings = { ...fake.settings, enabled: true, defaultAction: 'explain-simply' };
  fake.definition = [{ type: 'state', state: 'paused-at-limit' }];
  api.select({ ...anchor, exact: 'passage', start: 37, end: 44 }); await api.drain();
  assert.equal(definition.textContent, 'Instant help is unavailable right now. Usage is shown in Settings.');
  assert.equal(fake.selections.at(-1)?.action, 'explain-simply');

  for (const state of ['off', 'excluded'] as const) {
    fake.definition = [{ type: 'text-delta', text: 'stale' }, { type: 'state', state }];
    api.select({ ...anchor, exact: state, start: 0, end: state.length }); await api.drain();
    assert.equal(definition.textContent, 'Instant help is unavailable.');
  }
  api.destroy(); await api.drain();
});

test('without an injected backend the resting margin and selection behave exactly as before', async t => {
  const e = environment(t);
  const api = await mountMargin(asHost(e.root), { capture, storageName: e.namespace, allowHelper: false, onLibrary() {} });
  await api.drain();
  const panel = e.root.querySelector('.m-panel')!;
  const visible = panel.querySelectorAll('button,input,textarea,select,summary').filter(node => {
    for (let at = node; at; at = at.parentElement!) {
      if (at.hidden) return false;
      if (at.tagName === 'DETAILS' && !at.open && node !== at.children[0]) return false;
    }
    return true;
  });
  assert.deepEqual(visible.map(node => node.textContent), ['Collapse', 'Save page', '', 'Ask', 'Connections', 'Skills', 'Library', 'Settings']);
  api.select(anchor);
  assert.equal(e.root.querySelector('.m-instant-definition'), null);
  assert.doesNotMatch(e.root.textContent, /Instant help.*unavailable/i);
  assert.deepEqual(e.root.querySelector('.m-selection-actions')!.children.map(node => node.textContent), ['Keep', 'Note', 'Ask', 'Simulate it']);
  api.destroy(); await api.drain();
});
