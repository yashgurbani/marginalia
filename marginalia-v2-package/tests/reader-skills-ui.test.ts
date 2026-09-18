import test from 'node:test';
import assert from 'node:assert/strict';
import { dom, replaceGlobals, settle, type TestElement } from './t05-dom.ts';
import { createAskingFlow } from '../ui/asking/flow.ts';
import { mountAskingCard, mountAskingDraft } from '../ui/asking/mount.ts';
import type { ReaderSkillsCatalog } from '../contracts/reader-skills.ts';
import type { PrepareJobInput } from '../contracts/jobs.ts';
import { HelperClient } from '../ui/helper.ts';

const HASH = 'a'.repeat(64);
const TIME = '2026-09-18T10:00:00.000Z';
const ready = (skills: ReaderSkillsCatalog['skills']): ReaderSkillsCatalog => ({
  schema: 'marginalia.reader-skills.v1', status: 'ready', revision: 'catalog-revision', skills,
});

function draft(t: import('node:test').TestContext, catalog: Promise<ReaderSkillsCatalog>,
  onChoose: (intent: import('../contracts/reply.ts').Intent, question: string, context: string, skill?: import('../contracts/reader-skills.ts').ReaderSkillSelection) => Promise<void> = async () => {}) {
  const d = dom(t);
  const mounted = mountAskingDraft(d.root as unknown as HTMLElement, {
    id: 'skill-draft', question: '', context: '', suggestions: [], readerSkills: catalog,
    onEdit() {}, onChoose, onMore() {}, async onIdeas() { return []; }, onClose() {}, onKeep() {}, onPark() {},
  });
  t.after(() => mounted.destroy());
  return d.root;
}

test('skill choice stays hidden for unavailable, empty, or failed catalogs', async t => {
  for (const catalog of [
    () => Promise.resolve({ schema: 'marginalia.reader-skills.v1', status: 'unavailable', revision: null, skills: [] } as ReaderSkillsCatalog),
    () => Promise.resolve(ready([])), () => Promise.reject<ReaderSkillsCatalog>(new Error('unavailable')),
  ]) {
    const root = draft(t, catalog()); await settle();
    assert.equal(root.querySelector('.m-asking-draft__use-skill')!.hidden, true);
  }
});

test('a longer suggestion names its wait as a few minutes', t => {
  const d = dom(t);
  const mounted = mountAskingDraft(d.root as unknown as HTMLElement, {
    id: 'wait-draft', question: '', context: '', suggestions: [{ id: 'derive', label: 'Show steps', intent: 'derive', question: 'Show steps', time: 'longer' }],
    onEdit() {}, async onChoose() {}, onMore() {}, async onIdeas() { return []; }, onClose() {}, onKeep() {}, onPark() {},
  });
  t.after(() => mounted.destroy());
  assert.equal(d.root.querySelector('.m-suggestion-time')!.textContent, 'a few minutes');
});

test('reader skills catalog uses the paired empty-body read call', async t => {
  let request: { url: string; init?: RequestInit } | undefined;
  replaceGlobals(t, { fetch: async (url: string, init?: RequestInit) => {
    request = { url, init }; return new Response(JSON.stringify(ready([{ name: 'Study', description: 'Read closely' }])),
      { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const client = new HelperClient('http://localhost:43120'); client.token = 'x'.repeat(43);
  assert.equal((await client.readerSkills()).status, 'ready');
  assert.equal(request?.url, 'http://localhost:43120/api/read/skills');
  assert.equal(request?.init?.method, 'POST'); assert.equal(request?.init?.body, '{}');
});

test('hostile skill metadata renders as text and selection preserves its exact identity', async t => {
  const hostile = '<img src=x onerror=1>';
  let chosen: { intent: string; question: string; skill?: { name: string; catalogRevision: string } } | undefined;
  const root = draft(t, Promise.resolve(ready([{ name: hostile, description: '<b>description</b>' }])), async (intent, question, _context, skill) => {
    chosen = { intent, question, skill };
  });
  await settle();
  const use = root.querySelector('.m-asking-draft__use-skill')!; assert.equal(use.hidden, false); use.click();
  const skill = root.querySelector('.m-asking-draft__skill button')!;
  assert.equal(skill.children[0].textContent, hostile); assert.equal(skill.children[1].textContent, '<b>description</b>');
  assert.equal(root.querySelector('img'), null); assert.equal(root.querySelector('b'), null);
  skill.click(); await settle();
  assert.deepEqual(chosen, { intent: 'unsure', question: 'Run this skill on this passage.',
    skill: { name: hostile, catalogRevision: 'catalog-revision' } });
});

test('skill Ask prepare input carries the exact name and revision with intent unsure', async t => {
  replaceGlobals(t, { crypto: { randomUUID: () => 'unused' } });
  const sourceText = 'Passage and context.';
  const binding = { threadId: 'thread', anchorId: 'anchor', captureId: 'capture', sourceVersionId: 'source', sourceHash: HASH,
    sourceUrl: 'https://example.test/read', sourceTitle: 'Reading', sourcePageType: 'article', sourceCapturedAt: TIME,
    sourceText, anchor: { exact: 'Passage', prefix: '', suffix: ' and context.', start: 0, end: 7 } };
  let preparedInput: PrepareJobInput | undefined, sequence = 0;
  const host: any = {
    async availability() { return { configured: true, available: true, unverified: [], disclosureVersion: null }; },
    async prepare(input: PrepareJobInput) {
      preparedInput = structuredClone(input);
      const packet = { schema: 'marginalia.job-packet.v1', intent: input.intent, question: input.question,
        source: { url: binding.sourceUrl, title: binding.sourceTitle, pageType: binding.sourcePageType, capturedAt: binding.sourceCapturedAt, sourceHash: HASH, sourceVersionId: binding.sourceVersionId },
        selection: { ...binding.anchor, originalEnd: 7, omittedCharacters: 0 }, adjacentContext: { before: '', after: ' and context.', basis: 'bounded-character-context' },
        availableCapabilities: [], omissions: [] };
      return { unverified: [], disclosureVersion: null,
        job: { ...input, provider: 'app-server', model: 'reader-model', mode: 'structured-final', policyKey: HASH, preparedPayloadDigest: HASH, capabilities: [] },
        preview: { id: 'preview', revision: 1, requestId: input.id, bindingDigest: HASH, payloadDigest: HASH, policyKey: HASH,
          provider: 'app-server', recipient: 'reader-model', recipientLabel: 'Reader model', scopeLabel: 'This request', site: 'https://example.test', scope: 'cloud-inference',
          state: 'ready', expiresAt: '2026-09-18T10:05:00.000Z', outgoing: [{ label: 'Bounded reading packet', text: JSON.stringify(packet), sha256: HASH }] } };
    },
  };
  const flow = createAskingFlow({ binding, host, validateReply: () => ({ ok: false, issues: [] }) as any,
    currentBinding: () => binding, currentAccess: () => ({ epoch: 'one', paired: true, canAuthorize: true, excluded: false, supported: true, helper: 'connected', surface: 'native-panel', login: 'unknown' }),
    ensureContextSaved: async () => {}, now: () => Date.parse(TIME), newId: () => `request-${++sequence}` });
  await flow.ask('unsure', 'Run this skill on this passage.', { name: 'My skill', catalogRevision: 'revision-7' });
  assert.deepEqual(preparedInput, { id: 'request-1', idempotencyKey: 'request-2', threadId: 'thread', intent: 'unsure',
    question: 'Run this skill on this passage.', readerSkill: { name: 'My skill', catalogRevision: 'revision-7' } });
  flow.close();
});

function card(t: import('node:test').TestContext, state: any, mountReply: (...args: any[]) => { getState(): { parameters: object; view: object }; destroy(): void } = () => ({ getState: () => ({ parameters: {}, view: {} }), destroy() {} })) {
  const d = dom(t); replaceGlobals(t, { crypto: { randomUUID: () => 'skill-card' } });
  const flow: any = { getBinding: () => ({ anchor: { exact: 'Passage' } }), getState: () => state,
    getAccess: () => ({ surface: 'native-panel', paired: true, canAuthorize: true, excluded: false }),
    subscribe(listener: (value: any) => void) { listener(state); return () => {}; }, reconcile() {}, openAsk() {}, ask: async () => {},
    cancel: async () => {}, refresh: async () => {}, retry: async () => {}, invalidate() {}, close() {}, dismissPreview() {}, choose: async () => {}, followup: async () => {} };
  const mounted = mountAskingCard(d.root as unknown as HTMLElement, { flow, reviewOnly: true,
    mountConsent: () => ({ update() {}, destroy() {} }), mountReply, replyOptions: () => ({ capabilities: [] }) } as any);
  t.after(() => mounted.destroy()); return d.root;
}

test('skill reply shows its disclosure line above rendered blocks', t => {
  const provenance = { name: '<img src=x onerror=1>', catalogRevision: 'revision-7', execution: 'requested' } as const;
  const result = { binding: {}, trace: {}, source: { text: 'Passage' }, view: undefined,
    reply: { id: 'reply', hash: HASH, answeredNote: null, readerSkill: provenance, validation: {}, reply: { blocks: [] } } };
  const root = card(t, { phase: 'committed', message: '', canAsk: false, canCancel: false, canRetry: false, canCheck: false, result },
    (host: HTMLElement) => { const blocks = host.ownerDocument.createElement('div'); blocks.className = 'rendered-blocks'; host.append(blocks); return { getState: () => ({ parameters: {}, view: {} }), destroy() {} }; });
  const saved = root.querySelector('.m-asking__saved')!;
  assert.equal(saved.children[0].className, 'm-asking__skill-source');
  assert.equal(saved.children[0].textContent, `From your skill: ${provenance.name}. Marginalia did not check these sources.`);
  assert.equal(root.querySelector('img'), null);
});

test('failed skill output is plain text with no reply or follow-up control', t => {
  const text = '<img src=x onerror=1>\n[link](javascript:bad)'; let rendered = false;
  const provenance = { name: 'My skill', catalogRevision: 'revision-7', execution: 'requested' } as const;
  const root = card(t, { phase: 'failed', message: 'Failed', canAsk: false, canCancel: false, canRetry: true, canCheck: false,
    job: { state: 'failed', context: { readerSkill: provenance }, unformatted: { schema: 'marginalia.skill-output.v1', text, sha256: HASH, readerSkill: provenance, reason: 'reply-validation-failed' } } },
    () => { rendered = true; return { getState: () => ({ parameters: {}, view: {} }), destroy() {} }; });
  const output = root.querySelector('.m-asking__unformatted pre')!;
  assert.equal(output.textContent, text); assert.equal(output.children.length, 0); assert.equal(root.querySelector('img'), null); assert.equal(root.querySelector('a'), null);
  assert.equal(root.textContent.includes('From your skill: My skill. Marginalia did not check these sources.'), true);
  assert.equal(root.querySelectorAll('button').some((button: TestElement) => /follow/i.test(button.textContent)), false);
  assert.equal(rendered, false);
});
