import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAutoAssistSettings } from '../contracts/auto-assist.ts';
import { AutoAssistClient } from '../ui/auto-assist/client.ts';
import { mountAutoAssistReadyHelp, type AutoAssistHelpItem } from '../ui/auto-assist/ready-help.ts';
import { mountAutoAssistSettings } from '../ui/auto-assist/settings.ts';
import { FakeAutoAssistTransport } from '../ui/auto-assist/transport.ts';
import { button, dom, until, type TestElement } from './t05-dom.ts';

const item = (index: number, state: AutoAssistHelpItem['state'] = 'ready'): AutoAssistHelpItem => ({
  candidateId: String(index).padStart(64, 'a'), term: `term ${index}`, state,
  definition: state === 'ready' ? `Definition ${index}.` : undefined,
  anchor: { exact: `term ${index}`, prefix: '', suffix: '', start: index * 100, end: index * 100 + 6 },
});

test('auto assist client uses the assigned GET and POST settings routes', async () => {
  const settings = defaultAutoAssistSettings(), calls: unknown[][] = [];
  const client = new AutoAssistClient({ async request(...args) { calls.push(args); return { autoAssist: settings }; } });
  assert.deepEqual(await client.getSettings(), settings);
  const { version: _version, revision, updatedAt: _updatedAt, ...values } = settings;
  const change = { ...values, expectedRevision: revision, enabled: true };
  assert.deepEqual(await client.saveSettings(change), settings);
  assert.deepEqual(calls.map(([method, path, body]) => [method, path, body]), [
    ['GET', '/api/settings/auto-assist', undefined],
    ['POST', '/api/settings/auto-assist', change],
  ]);
});

test('auto assist settings start off and save the shared posture through an injected transport', async t => {
  const d = dom(t), fake = new FakeAutoAssistTransport(defaultAutoAssistSettings());
  const mount = mountAutoAssistSettings(d.root as unknown as HTMLElement, fake); t.after(() => mount.destroy());
  await until(() => d.root.textContent.includes('Save auto assist'));
  const enabled = d.root.querySelector('input') as unknown as HTMLInputElement;
  const posture = d.root.querySelector('select')!;
  assert.equal(enabled.checked, false); assert.equal(posture.value, 'balanced');
  assert.match(d.root.textContent, /sends those terms to Codex/);
  enabled.checked = true; posture.value = 'learning'; d.root.querySelector('form')!.fire('submit');
  await until(() => d.root.textContent.includes('Auto assist settings saved.'));
  assert.equal(fake.saved.length, 1); assert.equal(fake.settings.enabled, true); assert.equal(fake.settings.posture, 'learning');
});

test('ready help applies posture counts, keeps one full item, and holds focused help while reading moves', t => {
  const d = dom(t), assumes = d.document.createElement('div'), ready = d.document.createElement('div'); d.root.append(assumes, ready);
  const items = [item(0), item(1), item(2), item(3), item(4)]; let held = '', opened = '';
  const mount = mountAutoAssistReadyHelp(assumes as unknown as HTMLElement, ready as unknown as HTMLElement, {
    sectionAt: position => Math.floor(position / 100), open: value => { opened = value.candidateId; }, ask() {}, dismiss: async () => {}, hold: value => { held = value.candidateId; },
  }); t.after(() => mount.destroy());
  for (const [posture, count] of [['flow', 3], ['balanced', 4], ['learning', 5]] as const) {
    mount.update({ posture, readingPosition: 0, assumes: items, items });
    assert.equal(assumes.querySelectorAll('button').length, count);
    assert.equal(ready.querySelectorAll('.m-auto-assist-ready__item--full').length, 1);
  }
  const second = ready.querySelectorAll('button').find(value => value.textContent === 'term 1')!; second.focus();
  assert.equal(held, items[1].candidateId);
  mount.update({ posture: 'balanced', readingPosition: 400, assumes: items, items });
  assert.equal(d.document.activeElement.dataset.autoAssistCandidate, items[1].candidateId);
  assert.equal(d.document.activeElement.textContent, 'term 1');
  button(assumes, 'term 0').click(); assert.equal(opened, items[0].candidateId);
});

test('ready help dismisses a term as familiar and leaves Ask available at the daily limit', async t => {
  const d = dom(t), assumes = d.document.createElement('div'), ready = d.document.createElement('div'); d.root.append(assumes, ready);
  const paused = item(0, 'paused-at-limit'), next = item(1); let asked = 0, dismissed = '';
  const mount = mountAutoAssistReadyHelp(assumes as unknown as HTMLElement, ready as unknown as HTMLElement, {
    sectionAt: position => Math.floor(position / 100), open() {}, ask: () => { asked++; }, dismiss: async value => { dismissed = value.candidateId; },
  }); t.after(() => mount.destroy());
  mount.update({ posture: 'balanced', readingPosition: 0, assumes: [paused, next], items: [paused, next] });
  assert.match(ready.textContent, /Prepared definitions are paused for today\. Ask still works\./);
  button(ready, 'Ask').click(); assert.equal(asked, 1);
  button(ready, 'Dismiss and mark familiar').click();
  await until(() => ready.textContent.includes('Underline dismissed. This term is now in Vocabulary as familiar.'));
  assert.equal(dismissed, paused.candidateId); assert.doesNotMatch(ready.textContent, /term 0/); assert.match(ready.textContent, /term 1/);
});

test('dismissal confirmation remains live when the final ready-help item is removed', async t => {
  const d = dom(t), assumes = d.document.createElement('div'), ready = d.document.createElement('div'); d.root.append(assumes, ready);
  const only = item(0);
  const mount = mountAutoAssistReadyHelp(assumes as unknown as HTMLElement, ready as unknown as HTMLElement, {
    sectionAt: () => 0, open() {}, ask() {}, dismiss: async () => {},
  }); t.after(() => mount.destroy());
  mount.update({ posture: 'flow', readingPosition: 0, assumes: [only], items: [only] });
  button(ready, 'Dismiss and mark familiar').click();
  await until(() => ready.textContent.includes('Underline dismissed. This term is now in Vocabulary as familiar.'));
  assert.equal(ready.hidden, false); assert.equal(ready.querySelectorAll('[role="status"]').length, 1);
});

test('new auto assist reader copy contains no prohibited vocabulary', async t => {
  const d = dom(t), fake = new FakeAutoAssistTransport(defaultAutoAssistSettings());
  const settings = mountAutoAssistSettings(d.root as unknown as HTMLElement, fake); t.after(() => settings.destroy());
  await until(() => d.root.textContent.includes('Save auto assist'));
  const prohibited = /\b(artifact|provenance|ledger|transform|tier|job|schema|sandbox|MCP|AI|confidence)\b/i;
  assert.doesNotMatch(d.root.textContent, prohibited);
});
