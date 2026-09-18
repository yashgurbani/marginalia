import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultInstantHelpSettings } from '../contracts/instant.ts';
import { defaultAutoAssistSettings } from '../contracts/auto-assist.ts';
import { FakeInstantTransport } from '../ui/instant/transport.ts';
import { FakeAutoAssistTransport } from '../ui/auto-assist/transport.ts';
import { INSTANT_ONBOARDING_RECEIPT_KEY } from '../ui/persistence.ts';
import { mountOnboarding, ONBOARDING_RECEIPT_KEY } from '../ui/onboarding/index.ts';
import { button, dom, until, type TestElement } from './t05-dom.ts';

function deps() {
  const values = new Map<string, unknown>();
  return { values, instantHelp: new FakeInstantTransport(defaultInstantHelpSettings()), autoAssist: new FakeAutoAssistTransport(defaultAutoAssistSettings()),
    store: { async read<T>(key: string) { return values.get(key) as T | undefined; }, async write(key: string, value: unknown) { values.set(key, value); } } };
}
const input = (root: TestElement, label: string) => root.querySelector(`[aria-label="${label}"]`) as unknown as HTMLInputElement;
const ready = (root: TestElement) => until(() => !button(root, 'Save choices').disabled);

test('first use shows D5/D11 defaults and exact D15 disclosure without writing settings', async t => {
  const d = dom(t), options = deps(); const mount = mountOnboarding(d.root as unknown as HTMLElement, options); t.after(() => mount.destroy());
  await ready(d.root);
  assert.equal(input(d.root, 'Instant help').checked, true); assert.equal(input(d.root, 'Auto assist').checked, false);
  assert.match(d.root.textContent, /Marginalia uses your own Codex setup, including its settings and tools\./);
  assert.match(d.root.textContent, /Excluded sites never send/);
  assert.match(d.root.textContent, /today's approximate Codex usage is shown/);
  assert.doesNotMatch(d.root.textContent, /daily token limit/);
  assert.equal(options.instantHelp.saved.length + options.autoAssist.saved.length, 0);
  button(d.root, 'Save choices').click(); await until(() => d.root.children.length === 0);
  assert.equal(options.instantHelp.saved.length + options.autoAssist.saved.length, 0);
  assert.ok(options.values.has(ONBOARDING_RECEIPT_KEY)); assert.ok(options.values.has(INSTANT_ONBOARDING_RECEIPT_KEY));
  mountOnboarding(d.root as unknown as HTMLElement, options); await until(() => d.root.children.length === 0);
});

test('explicit opt-in and turn-off preserve budgets, posture and exact revisions', async t => {
  const d = dom(t), options = deps();
  options.instantHelp.settings.revision = 7; options.instantHelp.settings.tokenBudget.limit = 45000;
  options.autoAssist.settings.revision = 9; options.autoAssist.settings.posture = 'learning';
  const mount = mountOnboarding(d.root as unknown as HTMLElement, options); t.after(() => mount.destroy()); await ready(d.root);
  input(d.root, 'Instant help').checked = false; input(d.root, 'Auto assist').checked = true;
  button(d.root, 'Save choices').click(); button(d.root, 'Save choices').click();
  await until(() => d.root.children.length === 0);
  assert.equal(options.instantHelp.saved.length, 1); assert.equal(options.autoAssist.saved.length, 1);
  assert.equal(options.instantHelp.saved[0].expectedRevision, 7); assert.equal(options.instantHelp.saved[0].tokenBudget.limit, 45000);
  assert.equal(options.autoAssist.saved[0].expectedRevision, 9); assert.equal(options.autoAssist.saved[0].posture, 'learning');
  assert.equal(options.instantHelp.settings.enabled, false); assert.equal(options.autoAssist.settings.enabled, true);
});

test('existing nondefault choices survive opening and dismissal even with edited checkboxes', async t => {
  const d = dom(t), options = deps(); options.instantHelp.settings.enabled = false; options.autoAssist.settings.enabled = true;
  const mount = mountOnboarding(d.root as unknown as HTMLElement, options); t.after(() => mount.destroy()); await ready(d.root);
  assert.equal(input(d.root, 'Instant help').checked, false); assert.equal(input(d.root, 'Auto assist').checked, true);
  input(d.root, 'Instant help').checked = true; input(d.root, 'Auto assist').checked = false;
  button(d.root, 'Keep current settings').click(); await until(() => d.root.children.length === 0);
  assert.equal(options.instantHelp.saved.length + options.autoAssist.saved.length, 0);
});

test('conflict after partial save requires reload, retains current values and no completion receipt', async t => {
  const d = dom(t), options = deps(); let attempts = 0;
  options.autoAssist.saveSettings = async () => { attempts++; throw new Error('Conflict'); };
  const mount = mountOnboarding(d.root as unknown as HTMLElement, options); t.after(() => mount.destroy()); await ready(d.root);
  input(d.root, 'Instant help').checked = false; input(d.root, 'Auto assist').checked = true;
  button(d.root, 'Save choices').click(); await until(() => d.root.textContent.includes('Some choices may have saved'));
  assert.equal(options.instantHelp.settings.enabled, false); assert.equal(attempts, 1); assert.equal(options.values.has(ONBOARDING_RECEIPT_KEY), false);
  assert.equal(button(d.root, 'Save choices').disabled, true);
  button(d.root, 'Reload settings').click(); await ready(d.root);
  assert.equal(input(d.root, 'Instant help').checked, false); assert.equal(input(d.root, 'Auto assist').checked, false);
});

test('destroy during first save fences subsequent opt-in and local completion', async t => {
  const d = dom(t), options = deps(); let settle!: () => void;
  options.instantHelp.saveSettings = async () => { await new Promise<void>(resolve => { settle = resolve; }); return options.instantHelp.settings; };
  const mount = mountOnboarding(d.root as unknown as HTMLElement, options); await ready(d.root);
  input(d.root, 'Instant help').checked = false; input(d.root, 'Auto assist').checked = true;
  button(d.root, 'Save choices').click(); mount.destroy(); settle(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(options.autoAssist.saved.length, 0); assert.equal(options.values.size, 0); assert.equal(d.root.children.length, 0);
});

test('failed receipt storage stays visible and can retry without resending saved settings', async t => {
  const d = dom(t), options = deps(); const write = options.store.write; let fail = true;
  options.store.write = async (key, value) => { if (fail) throw new Error('Storage unavailable'); await write(key, value); };
  const mount = mountOnboarding(d.root as unknown as HTMLElement, options); t.after(() => mount.destroy()); await ready(d.root);
  input(d.root, 'Auto assist').checked = true; button(d.root, 'Save choices').click();
  await until(() => d.root.textContent.includes('Some choices may have saved')); assert.equal(options.autoAssist.saved.length, 1);
  fail = false; button(d.root, 'Keep current settings').click(); await until(() => d.root.children.length === 0);
  assert.equal(options.autoAssist.saved.length, 1);
});

test('remount fences a delayed first load from overwriting the current mount', async t => {
  const d = dom(t), old = deps(), next = deps(); let settle!: (value: ReturnType<typeof defaultInstantHelpSettings>) => void;
  old.instantHelp.getSettings = () => new Promise(resolve => { settle = resolve; });
  mountOnboarding(d.root as unknown as HTMLElement, old); await until(() => !!settle);
  next.instantHelp.settings.enabled = false;
  const mount = mountOnboarding(d.root as unknown as HTMLElement, next); t.after(() => mount.destroy()); await ready(d.root);
  settle(defaultInstantHelpSettings()); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(input(d.root, 'Instant help').checked, false); assert.equal(d.root.children.length, 1);
});
