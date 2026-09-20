import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultInstantHelpSettings, instantTextToReply } from '../contracts/instant.ts';
import { mountInstantDefinition } from '../ui/instant/definition.ts';
import { mountInstantOnboarding } from '../ui/instant/onboarding.ts';
import { mountInstantSettings } from '../ui/instant/settings.ts';
import { FakeInstantTransport, type InstantDefinitionEvent, type InstantSelection } from '../ui/instant/transport.ts';
import { button, deferred, dom, settle, until, type TestElement } from './t05-dom.ts';

const selection = (): InstantSelection => ({ requestId: crypto.randomUUID(), pageKey: 'page-one', sourceUrl: 'https://example.com/read',
  sourceGeneration: 'generation-one', text: 'entropy', action: 'define' });
const inputFor = (root: TestElement, label: string) => {
  const row = root.querySelectorAll('label').find(node => node.textContent.includes(label));
  assert.ok(row, `Missing field: ${label}`); const input = row.querySelector('input'); assert.ok(input); return input;
};

test('instant settings show owner defaults and save a full revision round trip', async t => {
  const d = dom(t), settings = defaultInstantHelpSettings();
  const fake = new FakeInstantTransport(settings, { periodStart: '2026-09-20', timezone: 'Europe/Berlin', usedTokens: 12_000, pendingTokens: 480, reservedTokens: 480, measuredRequests: 1, unreportedRequests: 2 });
  const mount = mountInstantSettings(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  await until(() => d.root.textContent.includes("Today's measured usage"));
  assert.ok(d.root.textContent.includes('20 September 2026 · Europe/Berlin'));
  assert.ok(d.root.textContent.includes('Instant help: 12,000 measured tokens'));
  assert.ok(d.root.textContent.includes('480 tokens reserved for work that has not settled yet. Reserved tokens are not measured use.'));
  assert.ok(d.root.textContent.includes('2 requests have not reported token totals.'));
  assert.ok(d.root.textContent.includes('Daily limit: not enforced by Marginalia'));
  assert.ok(d.root.textContent.includes('Money spent: unknown'));
  assert.ok(d.root.textContent.includes('Instant help uses your Codex subscription.'));
  assert.equal((inputFor(d.root, 'Instant help') as unknown as HTMLInputElement).checked, true);
  assert.equal(d.root.querySelector('input[aria-label="Daily limit in tokens"]'), null);
  assert.equal(inputFor(d.root, 'Warm pages').value, '8');
  assert.equal(inputFor(d.root, 'Idle minutes').value, '15');
  assert.equal((d.root.textContent.match(/Excluded sites never send\./g) ?? []).length, 1);
  (inputFor(d.root, 'Instant help') as unknown as HTMLInputElement).checked = false;
  inputFor(d.root, 'Warm pages').value = '10'; inputFor(d.root, 'Idle minutes').value = '20';
  d.root.querySelector('form')!.fire('submit');
  await until(() => d.root.textContent.includes('Instant help settings saved.'));
  assert.equal(fake.saved.length, 1);
  assert.deepEqual({ enabled: fake.settings.enabled, limit: fake.settings.tokenBudget.limit, warm: fake.settings.warmPages, idle: fake.settings.idleMinutes, revision: fake.settings.revision },
    { enabled: false, limit: 100000, warm: 10, idle: 20, revision: 1 });
});

test('instant settings keep unreported totals unknown instead of showing zero measured tokens', async t => {
  const d = dom(t), settings = defaultInstantHelpSettings();
  const fake = new FakeInstantTransport(settings, { periodStart: '2026-09-20', timezone: 'Europe/Berlin', pendingTokens: 900, reservedTokens: 900, unreportedRequests: 2 });
  const mount = mountInstantSettings(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  await until(() => d.root.textContent.includes('Usage unavailable for this period.'));
  assert.ok(d.root.textContent.includes('900 tokens reserved for work that has not settled yet. Reserved tokens are not measured use.'));
  assert.ok(d.root.textContent.includes('2 requests have not reported token totals.'));
  assert.equal(d.root.textContent.includes('Instant help: 0 measured tokens'), false);
});

test('instant settings show a measured zero separately from unreported work', async t => {
  const d = dom(t), settings = defaultInstantHelpSettings();
  const fake = new FakeInstantTransport(settings, { periodStart: '2026-09-20', timezone: 'Europe/Berlin', measuredRequests: 1, unreportedRequests: 1, reservedTokens: 900 });
  const mount = mountInstantSettings(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  await until(() => d.root.textContent.includes('Instant help: 0 measured tokens'));
  assert.equal(d.root.textContent.includes('Usage unavailable for this period.'), false);
  assert.ok(d.root.textContent.includes('1 request has not reported token totals.'));
});

test('definition paints streamed text before completion and then shows the final reply', async t => {
  const d = dom(t), fake = new FakeInstantTransport(defaultInstantHelpSettings()), finish = deferred<void>();
  fake.definition = async function* (): AsyncIterable<InstantDefinitionEvent> {
    yield { type: 'text-delta', text: 'Entropy describes ' };
    await finish.promise;
    yield { type: 'reply', reply: instantTextToReply('Entropy describes the number of microscopic arrangements compatible with the observed state.') };
  };
  const mount = mountInstantDefinition(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  const complete = mount.show(selection());
  await until(() => d.root.textContent === 'Entropy describes ');
  assert.equal(fake.selections.length, 1);
  finish.resolve(); await complete;
  assert.equal(d.root.textContent, 'Entropy describes the number of microscopic arrangements compatible with the observed state.');
});

test('definition shows a quiet working line before the first event', async t => {
  const d = dom(t), fake = new FakeInstantTransport(defaultInstantHelpSettings()), finish = deferred<void>();
  fake.definition = async function* (): AsyncIterable<InstantDefinitionEvent> {
    await finish.promise;
    yield { type: 'reply', reply: instantTextToReply('Entropy is a measure of uncertainty.') };
  };
  const mount = mountInstantDefinition(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  const complete = mount.show(selection());
  assert.equal(d.root.textContent, 'Instant help is working.');
  assert.ok(d.root.querySelector('.m-instant-definition--working'));
  finish.resolve(); await complete;
});

test('definition keeps stale limit status honest and shows a plain unavailable state otherwise', async t => {
  const d = dom(t), fake = new FakeInstantTransport(defaultInstantHelpSettings());
  const mount = mountInstantDefinition(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  fake.definition = [{ type: 'state', state: 'paused-at-limit' }]; await mount.show(selection());
  assert.equal(d.root.textContent, 'Instant help is unavailable right now. Usage is shown in Settings.');
  assert.ok(d.root.querySelector('.m-instant-definition--unavailable'));
  for (const state of ['off', 'excluded'] as const) {
    fake.definition = [{ type: 'text-delta', text: 'stale' }, { type: 'state', state }]; await mount.show(selection());
    assert.equal(d.root.textContent, 'Instant help is unavailable.');
    assert.ok(d.root.querySelector('.m-instant-definition--unavailable'));
  }
  fake.definition = []; await mount.show(selection());
  assert.equal(d.root.textContent, 'Instant help is unavailable.');
});

test('onboarding line is dismissed once through reader persistence and offers Turn off', async t => {
  const d = dom(t), fake = new FakeInstantTransport(defaultInstantHelpSettings()), saved = new Map<string, unknown>();
  const store = { async read<T>(key: string) { return saved.get(key) as T | undefined; }, async write(key: string, value: unknown) { saved.set(key, structuredClone(value)); } };
  let mount = mountInstantOnboarding(d.root as unknown as HTMLElement, fake, store);
  await until(() => d.root.textContent.includes('Instant help is on'));
  assert.ok(d.root.textContent.includes('uses your Codex subscription'));
  assert.equal(button(d.root, 'Turn off').textContent, 'Turn off');
  button(d.root, 'Keep on').click(); await until(() => d.root.textContent === ''); mount.destroy();
  mount = mountInstantOnboarding(d.root as unknown as HTMLElement, fake, store); t.after(() => mount.destroy());
  await settle(); await settle();
  assert.equal(d.root.textContent, '');
  assert.equal(fake.saved.length, 0);
});
