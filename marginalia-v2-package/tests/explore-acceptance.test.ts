import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CandidateReply, ShelfBlock } from '../contracts/reply.ts';
import type { ConsentGrant, ConsentPreview } from '../contracts/consent.ts';
import type { PreparedJobPlan } from '../contracts/jobs.ts';
import type { ReplyVersion, SourceVersion } from '../contracts/reader.ts';
import type { OpenShelfItemRequest } from '../contracts/explore.ts';
import { ReaderStore } from '../daemon/store.ts';
import { shelfFromHost } from '../renderer/host-authority.ts';
import { withFixtureOrigins } from './origins-fixture.ts';
import { journey, keepMutation, pollJob } from './journey-harness.ts';
import { dom, until, button, deferred, settle } from './t05-dom.ts';
registerHooks({
  resolve(specifier, context, next) { return specifier.endsWith('.css') ? { url: 'p11:css', shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === 'p11:css' ? { format: 'module', source: '', shortCircuit: true } : next(url, context); },
});
const { mountReply } = await import('../renderer/index.ts');
const sourceText = 'Start with this passage.';
function shelfReply(): CandidateReply {
  return withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'explore', status: 'complete', requiredCapabilities: ['network.shelf'],
    title: 'Reading shelf fixture', summary: 'Suggested reading with reasons.', sourceBindings: [], parameters: [], assumptions: [], limitations: [], checks: [],
    staticFallback: 'Suggested reading remains unverified.', blocks: [{ type: 'shelf', id: 'shelf', items: [
      { id: 'first', title: 'First reading', reason: 'Expands this topic.', url: 'https://example.org/first' },
      { id: 'duplicate', title: 'Repeated reading', reason: 'Same destination.', url: 'https://example.org/first' },
      { id: 'second', title: 'Second reading', reason: 'Shows a worked example.', url: 'https://example.org/second' },
    ] }],
  });
}
function storedShelf() {
  const store = new ReaderStore(':memory:'); store.apply(keepMutation('thread', 'keep', sourceText));
  const saved = store.commitReply({ id: 'reply', threadId: 'thread', reply: shelfReply() }, ['network.shelf']);
  return { store, saved };
}

test('completed shelf opens only explicitly, saves the original return anchor, and reopens without another dispatch', { timeout: 20_000 }, async t => {
  const trip = await journey('p11-explore', ['network.shelf']); t.after(() => trip.dispose());
  let daemon = await trip.start('initial');
  assert.equal((await daemon.request('POST', '/api/change', keepMutation('p11-thread', 'p11-keep', sourceText))).status, 200);
  await trip.script({ 'p11-job': { behaviour: 'reply', reply: shelfReply() } });
  const prepared = await daemon.request('POST', '/api/jobs/prepare', { id: 'p11-job', idempotencyKey: 'p11-key', threadId: 'p11-thread', intent: 'explore', question: 'Where can I read further?' });
  assert.equal(prepared.status, 200);
  const submission = prepared.body as unknown as { preview: ConsentPreview; job: PreparedJobPlan };
  assert.deepEqual(await trip.calls(), []);
  const decision = await daemon.request('POST', '/api/consent/decision', { previewId: submission.preview.id, expectedRevision: submission.preview.revision, choice: 'this-time' });
  assert.equal(decision.status, 200);
  assert.deepEqual(await trip.calls(), []);
  const grant = decision.body.grant as ConsentGrant;
  assert.equal((await daemon.request('POST', '/api/jobs', { ...submission.job, grantId: grant.id })).status, 202);
  const job = await pollJob(daemon, 'p11-job', value => value.state === 'succeeded' || value.state === 'failed');
  assert.equal(job.state, 'succeeded', job.reason);
  const response = await daemon.request('GET', '/api/replies?threadId=p11-thread');
  const bundle = response.body as unknown as { replies: ReplyVersion[]; source: SourceVersion };
  const saved = bundle.replies[0];
  assert.equal(saved.validation.explore?.items.length, 2);
  let opens = 0, returned: unknown;
  let pendingOpen: Promise<OpenShelfItemRequest> | undefined;
  const { root } = dom(t);
  const mounted = mountReply(root as unknown as HTMLElement, saved.reply, { sourceText, hostReport: saved.validation, capabilities: ['network.shelf'],
    onShelfOpen: item => {
      ++opens;
      return pendingOpen = (async () => {
        const result = await daemon.request('POST', '/api/shelf-open', { id: 'p11-open', threadId: 'p11-thread', replyVersionId: saved.id, ...item });
        assert.equal(result.status, 200); return result.body.open as OpenShelfItemRequest;
      })();
    }, onShelfReturn: origin => { returned = origin; },
  });
  await until(() => !button(root, 'First reading').disabled);
  assert.equal(opens, 0);
  assert.equal(root.querySelectorAll('a').length, 0, 'rendering exposes no bypass navigation link');
  assert.equal(button(root, 'Repeated reading').disabled, true);
  const before = await daemon.request('GET', '/api/export?thread=p11-thread');
  assert.deepEqual(before.body.shelfReturns, []);
  const duplicate = await daemon.request('POST', '/api/shelf-open', { id: 'p11-duplicate', threadId: 'p11-thread', replyVersionId: saved.id, blockId: 'shelf', itemId: 'duplicate' });
  assert.equal(duplicate.status, 409);
  button(root, 'First reading').fire('click');
  // The renderer invokes the callback in a microtask; await its real HTTP work before DOM polling.
  await settle();
  assert.ok(pendingOpen, 'the explicit click starts a shelf-open request');
  await pendingOpen;
  await until(() => root.querySelectorAll('a').length === 1);
  const link = root.querySelectorAll('a')[0];
  assert.equal((link as unknown as HTMLAnchorElement).href, 'https://example.org/first');
  assert.equal((link as unknown as HTMLAnchorElement).rel, 'noopener noreferrer');
  assert.equal(opens, 1);
  await until(() => !button(root, 'First reading').disabled);
  pendingOpen = undefined;
  button(root, 'First reading').fire('click');
  await settle();
  assert.ok(pendingOpen, 'the second click starts its own shelf-open request');
  await pendingOpen;
  await until(() => opens === 2 && !button(root, 'First reading').disabled);
  assert.equal(root.querySelectorAll('a').length, 1, 'popup fallback keeps one approved link');
  mounted.destroy();
  await daemon.stop(); daemon = await trip.start('reopened');
  const exported = await daemon.request('GET', '/api/export?thread=p11-thread');
  const returns = exported.body.shelfReturns as { open: OpenShelfItemRequest }[];
  assert.equal(returns.length, 1);
  assert.equal(returns[0].open.returnTo.threadId, 'p11-thread');
  assert.equal(returns[0].open.returnTo.sourceVersionId, bundle.source.id);
  assert.equal(returns[0].open.returnTo.anchor.exact, 'Start');
  const after = await daemon.request('GET', '/api/replies?threadId=p11-thread');
  const reopened = (after.body.replies as ReplyVersion[])[0];
  assert.deepEqual(reopened.validation, saved.validation);
  const next = dom(t);
  const reopenMount = mountReply(next.root as unknown as HTMLElement, reopened.reply, { sourceText, hostReport: reopened.validation, capabilities: ['network.shelf'], onShelfReturn: origin => { returned = origin; } });
  await until(() => !button(next.root, 'Return to original passage').disabled);
  button(next.root, 'Return to original passage').fire('click');
  await until(() => returned !== undefined);
  assert.deepEqual(returned, returns[0].open.returnTo);
  assert.equal((await trip.calls()).filter(call => call.kind === 'start').length, 1);
  reopenMount.destroy();
});

test('shelf record replay is idempotent and removed work cannot reopen or resurrect a return', () => {
  const { store, saved } = storedShelf();
  try {
    const change = { id: 'open', threadId: 'thread', replyVersionId: saved.id, blockId: 'shelf', itemId: 'first' };
    const open = store.openShelfItem(change);
    assert.deepEqual(store.openShelfItem(change), open);
    assert.equal(store.shelfReturns('thread').length, 1);
    assert.throws(() => store.openShelfItem({ ...change, id: 'duplicate', itemId: 'duplicate' }));
    assert.throws(() => store.openShelfItem({ ...change, id: 'wrong-block', blockId: 'other' }));
    store.setReplyRemoved({ id: 'remove', replyVersionId: saved.id, removed: true, expectedRevision: 1 });
    assert.deepEqual(store.shelfReturns('thread'), []);
    assert.throws(() => store.openShelfItem(change), /unavailable/);
  } finally { store.close(); }
});

test('private navigation and stale or altered shelf receipts fail closed', async () => {
  const { store, saved } = storedShelf();
  try {
    assert.equal(await shelfFromHost(saved.reply, 'Changed page', saved.validation), undefined);
    assert.equal(await shelfFromHost(saved.reply, sourceText), undefined);
    const changed = structuredClone(saved.validation); changed.explore!.items[0].url = 'https://127.0.0.1/private';
    assert.equal(await shelfFromHost(saved.reply, sourceText, changed), undefined);
    const partialReply = shelfReply(); partialReply.status = 'partial';
    store.commitReply({ id: 'partial', threadId: 'thread', reply: partialReply }, ['network.shelf']);
    assert.throws(() => store.openShelfItem({ id: 'partial-open', threadId: 'thread', replyVersionId: 'partial', blockId: 'shelf', itemId: 'first' }), /unavailable/);
    const privateReply = shelfReply(); (privateReply.blocks[0] as ShelfBlock).items[0].url = 'https://127.0.0.1/private';
    assert.throws(() => store.commitReply({ id: 'private', threadId: 'thread', reply: privateReply }, ['network.shelf']), /URL|public|private|address/i);
    assert.equal(store.reply('private'), undefined);
  } finally { store.close(); }
});

test('reserved window navigates only after durability; disposal and failure close the blank window', async t => {
  const { store, saved } = storedShelf(); t.after(() => store.close());
  const request = store.openShelfItem({ id: 'expected', threadId: 'thread', replyVersionId: saved.id, blockId: 'shelf', itemId: 'first' });
  for (const outcome of ['success', 'failure', 'disposed', 'throw'] as const) {
    const { root, document } = dom(t); const pending = deferred<OpenShelfItemRequest>();
    const navigated: string[] = []; let opened = 0, closed = 0;
    const popup = { opener: {}, closed: false, document: { createElement: (tag: string) => tag === 'a' ? {
        href: '', rel: '', referrerPolicy: '', target: '', textContent: '', click() {
          assert.equal(this.rel, 'noopener noreferrer'); assert.equal(this.referrerPolicy, 'no-referrer'); assert.equal(this.target, '_self'); navigated.push(this.href);
        },
      } : {}, head: { append() {} }, body: { textContent: '', replaceChildren(..._nodes: unknown[]) {} } },
      close() { this.closed = true; ++closed; } };
    Object.assign(document, { defaultView: { open(url: string) { assert.equal(url, 'about:blank'); ++opened; return popup; } } });
    const mounted = mountReply(root as unknown as HTMLElement, saved.reply, { sourceText, hostReport: saved.validation, capabilities: ['network.shelf'], onShelfOpen: () => { if (outcome === 'throw') throw new Error('Synchronous storage error.'); return pending.promise; } });
    await until(() => !button(root, 'First reading').disabled);
    assert.equal(opened, 0); button(root, 'First reading').fire('click');
    assert.equal(opened, 1); assert.equal(popup.opener, null); assert.deepEqual(navigated, []);
    if (outcome === 'disposed') mounted.destroy();
    if (outcome === 'failure') pending.reject(new Error('Storage unavailable.')); else pending.resolve(request);
    await until(() => outcome === 'success' ? navigated.length === 1 : closed > 0);
    await settle();
    assert.deepEqual(navigated, outcome === 'success' ? ['https://example.org/first'] : []);
    if (outcome !== 'disposed') mounted.destroy();
  }
});
