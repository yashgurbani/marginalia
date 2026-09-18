import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { storage, asHost } from './t05-harness.ts';
import { dom, until } from './t05-dom.ts';
import { growthReply, growthSourceText } from '../fixtures/growth-reply.ts';
import { validateReply } from '../contracts/reply.ts';

// Keep storage emulation, but exercise the actual saved-loader validation and rendering.
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes('/ui/') && (specifier.endsWith('/contracts/reply.ts') || specifier.endsWith('/renderer/index.ts')))
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { mountMargin } = await import('../ui/margin.ts');
const { localPersistence, documentJournal } = await import('../ui/persistence.ts');

test('historical model survives saved loading and rendering without invented metadata', async t => {
  const { document, root } = dom(t); storage(t);
  Object.assign(document, { createElementNS(_ns: string, tag: string) { return document.createElement(tag); } });
  const namespace = crypto.randomUUID(), persistence = localPersistence(namespace);
  const journal = documentJournal(namespace, persistence.journal);
  const capture = { url: 'https://example.org/legacy', title: 'Legacy', pageType: 'article', text: growthSourceText, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'test' };
  await journal.change({ id: 'keep', kind: 'keep', threadId: 'thread', capture, anchor: { exact: growthSourceText, prefix: '', suffix: '', start: 0, end: growthSourceText.length } });
  const reply = structuredClone(growthReply); delete reply.origins; delete reply.illustration;
  const before = JSON.stringify(reply);
  const source = { id: 'source', sourceId: 'page', hash: 'source-hash', text: growthSourceText, title: capture.title, capturedAt: capture.capturedAt, extractionVersion: 'test', pageType: 'article', metadataStatus: 'provided' as const };
  const version = { id: 'legacy', threadId: 'thread', parentId: null, supersedes: null, hash: 'saved-hash', reply, validation: {} as never, answeredNote: null, revision: 1, createdAt: capture.capturedAt, deletedAt: null };
  const view = { replyVersionId: version.id, parameters: Object.fromEntries(reply.parameters.map(parameter => [parameter.name, parameter.default])), view: {}, revision: 1, updatedAt: capture.capturedAt };
  await persistence.replies.cache(document.location.origin, 'thread', source, [version], [view]);
  const api = await mountMargin(asHost(root), { capture, storageName: namespace, allowHelper: false });
  await until(() => !!root.querySelector('[data-block="growth-model"]'));
  const rendered = root.querySelector('.mr-reply')!;
  assert.equal(rendered.querySelector('h3')!.textContent, reply.title);
  assert.equal(rendered.querySelector('h3')!.dataset.assessment, 'unassessed');
  assert.match(root.textContent, /Illustration purpose is unavailable for this saved model/);
  assert.equal(root.querySelectorAll('[data-assessment="checked"]').length, 0);
  const saved = (await persistence.replies.list('thread'))[0];
  assert.equal(JSON.stringify(saved.version.reply), before);
  assert.equal(validateReply(reply, { sourceText: growthSourceText, requireOrigins: true }).ok, false);
  api.destroy(); await api.drain();
});
