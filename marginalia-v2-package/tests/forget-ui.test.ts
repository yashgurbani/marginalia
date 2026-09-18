import test from 'node:test';
import assert from 'node:assert/strict';
import { ForgetClient } from '../ui/forget/client.ts';
import { mountForget } from '../ui/forget/forget.ts';
import { FakeForgetTransport } from '../ui/forget/transport.ts';
import { button, dom, until } from './t05-dom.ts';

test('forget page explains what changes and asks once before acting', async t => {
  const d = dom(t), fake = new FakeForgetTransport();
  const mount = mountForget(d.root as unknown as HTMLElement, fake, async () => 'page-one'); t.after(() => mount.destroy());
  assert.ok(d.root.textContent.includes('warm thread and prepared definitions'));
  assert.ok(d.root.textContent.includes('notes, highlights, and threads stay'));
  button(d.root, 'Forget this page').click();
  assert.deepEqual(fake.forgotten, []);
  assert.ok(d.root.textContent.includes('Forget the prepared help for this page?'));
  button(d.root, 'Forget this page').click();
  await until(() => fake.forgotten.length === 1);
  assert.deepEqual(fake.forgotten, ['page-one']);
  assert.equal(d.root.querySelectorAll('button').length, 0);
  assert.equal(d.root.textContent, 'The warm thread and prepared definitions for this page were forgotten; no provider history was created.');
});

test('forget client sends the opaque pageId to the instant forget route', async () => {
  const calls: Array<{ path: string; body: object }> = [];
  const client = new ForgetClient({ async request(path, body) { calls.push({ path, body }); return { forgotten: true, alreadyForgotten: false, providerHistory: 'deleted' }; } });
  assert.deepEqual(await client.forgetPage('page-two'), { forgotten: true, alreadyForgotten: false, providerHistory: 'deleted' });
  assert.deepEqual(calls, [{ path: '/api/instant/forget', body: { pageId: 'page-two' } }]);
});

test('forget reports each provider-history outcome without claiming more than the route returned', async t => {
  for (const providerHistory of ['deleted', 'not-created', 'retained', 'unknown'] as const) {
    const d = dom(t), fake = new FakeForgetTransport(); fake.result = { forgotten: true, alreadyForgotten: false, providerHistory };
    const mount = mountForget(d.root as unknown as HTMLElement, fake, async () => 'page-outcome'); t.after(() => mount.destroy());
    button(d.root, 'Forget this page').click(); button(d.root, 'Forget this page').click();
    await until(() => d.root.querySelectorAll('button').length === 0);
    assert.match(d.root.textContent, providerHistory === 'deleted' ? /provider history was deleted/ : providerHistory === 'not-created' ? /no provider history was created/ : providerHistory === 'retained' ? /provider history was retained/ : /provider history could not be verified/);
  }
});

test('forget does not call the route when prepare has not returned a pageId', async t => {
  const d = dom(t), fake = new FakeForgetTransport();
  const mount = mountForget(d.root as unknown as HTMLElement, fake, async () => undefined); t.after(() => mount.destroy());
  button(d.root, 'Forget this page').click(); button(d.root, 'Forget this page').click();
  await until(() => d.root.textContent.includes('has not been created'));
  assert.deepEqual(fake.forgotten, []);
});

test('forget reports an already-forgotten page without claiming a new deletion', async t => {
  const d = dom(t), fake = new FakeForgetTransport();
  fake.result = { forgotten: true, alreadyForgotten: true, providerHistory: 'not-created' };
  const mount = mountForget(d.root as unknown as HTMLElement, fake, async () => 'page-already-forgotten'); t.after(() => mount.destroy());
  button(d.root, 'Forget this page').click(); button(d.root, 'Forget this page').click();
  await until(() => d.root.querySelectorAll('button').length === 0);
  assert.match(d.root.textContent, /were already forgotten; no provider history was created/);
});
