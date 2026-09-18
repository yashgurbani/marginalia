import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadHostInstructions, hostInstructionText } from '../daemon/jobs/host-instructions.ts';
import type { AutoAssistPosture } from '../contracts/auto-assist.ts';
import { growthReply, growthSourceText } from '../fixtures/growth-reply.ts';
import { dom } from './t05-dom.ts';
import { ReaderStore } from '../daemon/store.ts';
import { LibrarySettingsService } from '../daemon/library.ts';
import { JobService } from '../daemon/jobs/service.ts';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import { fitOutgoingPacket, OUTGOING_PREVIEW_BYTES } from '../daemon/jobs/outgoing-budget.ts';
import type { ProviderJobPacket } from '../contracts/jobs.ts';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.css')) return { url: 'posture-assumptions:css', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'posture-assumptions:css') return { format: 'module', source: '', shortCircuit: true };
    return next(url, context);
  },
});
const { mountReply } = await import('../renderer/index.ts');

test('budget fitting keeps short reader context when an omission notice would cost more bytes', () => {
  const packet: ProviderJobPacket = {
    schema: 'marginalia.job-packet.v1', intent: 'define', question: 'Explain.',
    source: { url: 'https://example.org', title: 'Article', pageType: 'article', capturedAt: null, sourceHash: 'hash', sourceVersionId: 'source' },
    selection: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5, originalEnd: 5, omittedCharacters: 0 },
    adjacentContext: { before: '', after: ' here.', basis: 'bounded-character-context' },
    parentReply: { replyVersionId: 'reply', attribution: 'Prior generated work, not source evidence.', excerpt: 'x'.repeat(1024), omittedBytes: 0 },
    availableCapabilities: [], omissions: [],
  };
  const padding = ' '.repeat(OUTGOING_PREVIEW_BYTES - Buffer.byteLength(JSON.stringify(packet)) + 80);
  const fitted = fitOutgoingPacket(packet, value => ({ outgoing: [{ text: padding + JSON.stringify(value) }] }));
  assert.equal(fitted.packet.adjacentContext.after, ' here.');
  assert.deepEqual(fitted.packet.selection, packet.selection);
  assert.equal(fitted.packet.omissions.length, 1);
  assert.match(fitted.packet.omissions[0], /previous generated reply/);
  assert.equal(fitted.packet.parentReply!.omittedBytes, 1024 - fitted.packet.parentReply!.excerpt.length);
  assert.ok(Buffer.byteLength(fitted.prepared.outgoing[0].text) <= OUTGOING_PREVIEW_BYTES);
  assert.equal(packet.parentReply!.excerpt.length, 1024, 'the source packet remains unchanged');
});

test('job preparation uses saved posture even with ambient help off and changes the reviewed digest', async t => {
  const reader = new ReaderStore(':memory:');
  const library = new LibrarySettingsService(reader);
  reader.apply({ id: 'keep-posture', kind: 'keep', threadId: 'thread-posture',
    capture: { url: 'https://example.org/article', title: 'Article', pageType: 'article', text: 'Start here.', capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1' },
    anchor: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5 } });
  const jobs = new JobService({ reader, library, workspaceRoot: process.cwd(),
    defaults: { provider: 'app-server', mode: 'structured-final', policyKey: 'a'.repeat(64), capabilities: [] },
    runtimeFactory: { dispatchReady: true, consent: new ConsentSessionService(reader), create: async () => { throw new Error('Preparation must not send.'); } } });
  t.after(async () => { await jobs.close(); reader.close(); });
  const draft = { id: 'posture-job', idempotencyKey: 'posture-key', threadId: 'thread-posture', intent: 'define' as const, question: 'Explain.' };
  const first = await jobs.prepare(draft);
  assert.ok(first.consent.outgoing.some(part => part.text.includes('Reader-selected posture: balanced.')));
  const current = library.autoAssist();
  library.saveAutoAssist({ enabled: false, method: current.method, posture: 'learning', autoDefinitions: current.autoDefinitions, expectedRevision: current.revision });
  const second = await jobs.prepare(draft);
  assert.equal(library.autoAssist().enabled, false);
  assert.ok(second.consent.outgoing.some(part => part.text.includes('Reader-selected posture: learning.')));
  assert.notEqual(first.job.preparedPayloadDigest, second.job.preparedPayloadDigest);
  assert.ok(first.consent.outgoing.some(part => part.text.includes('Reader-selected posture: balanced.')), 'the earlier review retains its pinned voice');
});

test('reader posture is frozen into reviewed instructions for every kind of help', async () => {
  for (const intent of ['define', 'simulate', 'evidence', 'explore', 'instantiate', 'derive', 'diagram', 'unsure'] as const) {
    const digests = new Set<string>();
    for (const posture of ['flow', 'balanced', 'learning'] as const) {
      const bundle = await loadHostInstructions(intent, undefined, posture);
      assert.ok(bundle);
      assert.match(hostInstructionText(bundle, intent), new RegExp(`Reader-selected posture: ${posture}\\.`));
      assert.equal(bundle.documents.filter(document => document.path === 'skills/posture/SKILL.md').length, 1);
      assert.match(bundle.text, /Answer the request first in every posture/);
      assert.match(bundle.text, /assumptions: \[\]/);
      digests.add(bundle.sha256);
      assert.throws(() => hostInstructionText({ ...bundle, text: bundle.text.replace(`posture: ${posture}`, 'posture: forged') }, intent), /binding/);
    }
    assert.equal(digests.size, 3, 'changing the stated preference changes the reviewed prompt');
  }
  assert.deepEqual(await loadHostInstructions('define'), await loadHostInstructions('define', undefined, 'balanced'));
  await assert.rejects(loadHostInstructions('define', undefined, 'expert' as AutoAssistPosture), /Unsupported reading posture/);
});

test('Assumes header follows the answer and preserves editable assumptions', t => {
  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_namespace: string, tag: string) { return document.createElement(tag); } });
  const reply = structuredClone(growthReply);
  reply.assumptions[0].editable = true;
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText: growthSourceText, capabilities: ['samples'] });
  t.after(() => mounted.destroy());
  const headings = root.querySelectorAll('summary').filter(node => node.textContent === 'Assumes:');
  assert.equal(headings.length, 1);
  assert.ok(root.textContent.indexOf(reply.summary) < root.textContent.indexOf('Assumes:'));
  assert.ok(root.querySelectorAll('textarea').some(node => node.getAttribute('aria-label')?.includes(reply.assumptions[0].text)));
  assert.ok(root.querySelectorAll('button').some(node => node.textContent === 'Ask again with this assumption'));
});

test('a reply without assumptions shows no header or empty disclosure', t => {
  const { document, root } = dom(t);
  Object.assign(document, { createElementNS(_namespace: string, tag: string) { return document.createElement(tag); } });
  const reply = structuredClone(growthReply);
  reply.assumptions = [];
  if (reply.origins) for (const path of Object.keys(reply.origins.parts)) if (path.startsWith('/assumptions/')) delete reply.origins.parts[path];
  const mounted = mountReply(root as unknown as HTMLElement, reply, { sourceText: growthSourceText, capabilities: ['samples'] });
  t.after(() => mounted.destroy());
  assert.ok(root.textContent.includes(reply.summary), 'the reply was rendered');
  assert.equal(root.querySelectorAll('summary').some(node => /Assumes:|What this example assumes/.test(node.textContent)), false);
});
