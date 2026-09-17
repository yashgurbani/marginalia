import test from 'node:test';
import assert from 'node:assert/strict';
import { createAskingFlow } from '../ui/asking/flow.ts';
import { bindAskingThread, definitionFromPage, hostCopy } from '../ui/asking/binding.ts';
import { createAskingHost } from '../ui/asking/helper-adapter.ts';
import { connectAskingSurfaces, followupQuestion, mountProvisionalText } from '../ui/asking/surfaces.ts';
import { mountAskingCard } from '../ui/asking/mount.ts';
import type { AskingAccess, AskingBinding, AskingHost, AskingPreparation, AskingValidator, SavedAskingReply } from '../ui/asking/types.ts';
import type { ConsentChoice, ConsentGrant, ConsentPreview } from '../contracts/consent.ts';
import type { JobSnapshot, PrepareJobInput } from '../contracts/jobs.ts';
import type { CandidateReply } from '../contracts/reply.ts';
import type { Thread } from '../contracts/reader.ts';
import type { ConsentSheetOptions } from '../ui/consent.ts';
import type { ReplyOptions } from '../renderer/index.ts';

const HASH = 'a'.repeat(64), POLICY = 'b'.repeat(64), DIGEST = 'c'.repeat(64), TIME = '2026-09-17T10:00:00.000Z';
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function bound(withNote = true): AskingBinding {
  const sourceText = 'Viscosity means resistance to flow. Viscosity also varies with temperature.';
  return { threadId: 'thread', anchorId: 'anchor', captureId: 'tab-capture', sourceVersionId: 'source-v1', sourceHash: HASH,
    sourceUrl: 'https://example.org/page', sourceTitle: 'A page', sourcePageType: 'article', sourceCapturedAt: TIME, sourceText,
    anchor: { exact: 'Viscosity', prefix: '', suffix: ' means resistance', start: 0, end: 9 },
    ...(withNote ? { answeredNote: { noteId: 'note', revision: 2, text: 'Does this depend on temperature?' } } : {}) };
}
function candidate(status: 'complete' | 'partial' = 'complete'): CandidateReply {
  return { schema: 'marginalia.reply.v1', intent: 'define', status, title: 'Contextual meaning', summary: 'Meaning in this passage',
    blocks: [{ id: 'meaning', type: 'text', md: 'A contextual explanation.' }], sourceBindings: [], parameters: [], assumptions: [], checks: [], limitations: [], staticFallback: 'A contextual explanation.' };
}
// Explicit controlled boundary for the shared validator injection. This suite tests T08, not the upstream schema engine or scientific seal.
const validate: AskingValidator = value => {
  const v = value as CandidateReply;
  return v && v.schema === 'marginalia.reply.v1' && ['complete', 'partial'].includes(v.status) && Array.isArray(v.blocks) &&
    v.blocks.length > 0 && v.blocks.every(b => b.type === 'text' && typeof b.md === 'string') && v.staticFallback !== 'malformed'
    ? { ok: true, value: structuredClone(v), errors: [] } : { ok: false, errors: ['Controlled invalid candidate'] };
};
function preparation(input: PrepareJobInput, b: AskingBinding): AskingPreparation {
  const packet = { schema: 'marginalia.job-packet.v1', intent: input.intent, question: input.question,
    source: { url: b.sourceUrl, title: b.sourceTitle, pageType: b.sourcePageType, capturedAt: b.sourceCapturedAt, sourceHash: b.sourceHash, sourceVersionId: b.sourceVersionId },
    selection: { ...b.anchor, originalEnd: b.anchor.end, omittedCharacters: 0 }, adjacentContext: { before: '', after: '', basis: 'bounded-character-context' },
    ...(b.answeredNote ? { answeredNote: { ...b.answeredNote, originalCharacters: b.answeredNote.text.length, omittedCharacters: 0 } } : {}),
    ...(input.parentReplyId ? { parentReplyId: input.parentReplyId, parentReply: { replyVersionId: input.parentReplyId,
      attribution: 'Prior generated work, not source evidence.', excerpt: '{"title":"Prior reply"}', omittedBytes: 0 } } : {}),
    availableCapabilities: [], omissions: [] };
  return { job: { ...input, provider: 'app-server', model: 'host-selected', mode: 'structured-final', policyKey: POLICY, preparedPayloadDigest: DIGEST, capabilities: [] },
    preview: { id: 'preview-' + input.id, revision: 1, requestId: input.id, site: 'https://example.org',
      scope: input.intent === 'evidence' || input.intent === 'explore' ? 'open-session' : 'cloud-inference', scopeLabel: 'Host scope',
      recipient: 'openai-codex', recipientLabel: 'OpenAI Codex', provider: 'app-server', policyKey: POLICY,
      outgoing: [{ label: 'Bounded reading packet', text: JSON.stringify(packet), sha256: HASH }, { label: 'Adapter prompt', text: 'Exact host prompt', sha256: POLICY }],
      payloadDigest: HASH, bindingDigest: DIGEST, expiresAt: '2026-09-17T10:10:00.000Z', state: 'ready' } };
}
function grant(v: ConsentPreview, choice: ConsentChoice): ConsentGrant {
  return { id: 'grant-' + v.requestId, site: v.site, recipient: v.recipient, scope: v.scope, revision: 1, createdAt: TIME,
    decision: choice === 'this-time' ? 'allow-once' : choice === 'always-site' ? 'allow-site' : 'deny-site',
    ...(choice === 'this-time' ? { requestId: v.requestId, bindingDigest: v.bindingDigest } : {}) };
}
function job(p: AskingPreparation, b: AskingBinding, state: JobSnapshot['state'] = 'running', revision = 1,
  lineage: Partial<JobSnapshot['context']> = {}): JobSnapshot {
  return { id: p.job.id, idempotencyKey: p.job.idempotencyKey, threadId: b.threadId, preparedPayloadDigest: DIGEST,
    provider: p.job.provider, model: p.job.model, mode: p.job.mode, policyKey: p.job.policyKey,
    packetDigest: HASH, grantId: 'grant-' + p.job.id, state, cancelRequested: state === 'cancel_requested' || state === 'cancelled',
    createdAt: TIME, updatedAt: new Date(Date.parse(TIME) + revision * 1000).toISOString(), latestAttemptId: 'attempt-' + p.job.id,
    context: { threadId: b.threadId, sourceVersionId: b.sourceVersionId, sourceUrl: b.sourceUrl, sourceTitle: b.sourceTitle,
      sourcePageType: b.sourcePageType, sourceCapturedAt: b.sourceCapturedAt, sourceHash: b.sourceHash, sourceText: b.sourceText, passage: { ...b.anchor },
      answeredNote: b.answeredNote ? { ...b.answeredNote, ...{ createdAt: TIME } } : undefined,
      question: p.job.question, intent: p.job.intent, parentReplyId: p.job.parentReplyId, preparedPayloadDigest: DIGEST,
      modelSettingsRevision: 1, modelCompatibilityKey: HASH, outgoing: JSON.parse(p.preview.outgoing[0].text), ...lineage },
    ...(state === 'succeeded' ? { replyVersionId: 'reply-' + p.job.id } : {}),
    attempts: [{ id: 'attempt-' + p.job.id, jobId: p.job.id, number: 1, state, revision,
      dispatchClaimed: state !== 'queued', handoffMarked: state !== 'queued', workspacePrepared: true, startedAt: TIME,
      ...(state === 'succeeded' ? { endedAt: new Date(Date.parse(TIME) + revision * 1000).toISOString() } : {}) }] };
}
function saved(j: JobSnapshot, b: AskingBinding): SavedAskingReply {
  return { source: { id: b.sourceVersionId, sourceId: 'source', hash: b.sourceHash, text: b.sourceText, capturedAt: b.sourceCapturedAt,
    extractionVersion: '1', title: b.sourceTitle, pageType: b.sourcePageType, metadataStatus: 'provided' },
    reply: { id: j.replyVersionId!, threadId: b.threadId, parentId: j.context.parentReplyId ?? null, supersedes: null, hash: HASH,
      reply: { ...candidate(), intent: j.context.intent },
      validation: { schema: 'marginalia.host-report.v1', checkVersion: 'host-checks.v1', replyDigest: HASH, parameterDigest: POLICY, results: [] },
      answeredNote: b.answeredNote ? { ...b.answeredNote, createdAt: TIME } : null, createdAt: j.updatedAt, deletedAt: null, revision: 1 },
    view: { replyVersionId: j.replyVersionId!, parameters: {}, view: {}, revision: 0, updatedAt: j.updatedAt } };
}
function harness(withNote = true) {
  const binding = bound(withNote), rows = new Map<string, JobSnapshot>();
  let currentBinding: AskingBinding | undefined = structuredClone(binding);
  let access: AskingAccess = { epoch: 'session-1', paired: true, canAuthorize: true, excluded: false, supported: true, helper: 'connected', surface: 'native-panel' };
  let clock = Date.parse(TIME), sequence = 0, prepared!: AskingPreparation, observed!: JobSnapshot;
  let lineage: Partial<JobSnapshot['context']> = {};
  const calls: Array<{ name: string; input?: unknown }> = [];
  const setObserved = (value: JobSnapshot) => { observed = hostCopy(value); rows.set(value.id, observed); };
  const host: AskingHost = {
    availability: async () => { calls.push({ name: 'availability' }); return { configured: true, available: true }; },
    prepare: async input => { calls.push({ name: 'prepare', input }); lineage = {}; return prepared = preparation(input, binding); },
    prepareRetry: async (id, input) => {
      calls.push({ name: 'prepareRetry', input: { previous: id, ...input } }); const old = rows.get(id)!;
      lineage = { retryOfJobId: id };
      return prepared = preparation({ ...input, threadId: binding.threadId, intent: old.context.intent, question: old.context.question,
        parentReplyId: old.context.parentReplyId }, binding);
    },
    prepareFollowup: async (id, input) => {
      calls.push({ name: 'prepareFollowup', input: { previous: id, ...input } }); const old = rows.get(id)!;
      lineage = { parentJobId: id, parentAttemptId: old.latestAttemptId };
      return prepared = preparation({ ...input, threadId: binding.threadId, intent: old.context.intent, parentReplyId: old.replyVersionId }, binding);
    },
    decide: async input => { calls.push({ name: 'decide', input }); return grant(prepared.preview, input.choice); },
    start: async input => { calls.push({ name: 'start', input }); setObserved(job(prepared, binding)); return observed; },
    retry: async (id, input) => { calls.push({ name: 'retry', input: { previous: id, ...input } }); setObserved(job(prepared, binding, 'running', 1, lineage)); return observed; },
    followup: async (id, input) => { calls.push({ name: 'followup', input: { previous: id, ...input } }); setObserved(job(prepared, binding, 'running', 1, lineage)); return observed; },
    inspect: async id => { calls.push({ name: 'inspect', input: id }); const value = rows.get(id); if (!value) throw new Error('Not found'); return value; },
    listJobs: async threadId => { calls.push({ name: 'listJobs', input: threadId }); return [...rows.values()]; },
    cancel: async id => { calls.push({ name: 'cancel', input: id }); setObserved(job(prepared, binding, 'cancelled', 3, lineage)); return observed; },
    readReply: async (threadId, id) => {
      calls.push({ name: 'readReply', input: { threadId, id } }); const owner = [...rows.values()].find(j => j.replyVersionId === id);
      if (!owner) throw new Error('Reply not found'); return saved(owner, binding);
    },
  };
  const options = { binding, host, validateReply: validate, currentBinding: () => currentBinding, currentAccess: () => access,
    ensureContextSaved: async (value: AskingBinding) => { calls.push({ name: 'ensureSaved', input: value }); }, now: () => clock, newId: () => 'request-' + ++sequence };
  const flow = createAskingFlow(options);
  return { binding, host, calls, flow, options, rows, get prepared() { return prepared; }, get observed() { return observed; },
    setObserved, setClock(value: number) { clock = value; },
    changeBinding(change: (b: AskingBinding) => void) { change(currentBinding!); },
    setAccess(value: Partial<AskingAccess>) { access = { ...access, ...value }; },
    count: (name: string) => calls.filter(c => c.name === name).length,
    approve: () => flow.choose('this-time', flow.getState().preparation!.preview),
    async complete() { setObserved(job(prepared, binding, 'succeeded', 3, lineage)); await flow.refresh(); },
  };
}

test('document definitions are exact slices; ambiguous, generic claims and missing terms abstain', () => {
  const b = bound(), quote = definitionFromPage('Viscosity', b.sourceText)!;
  assert.equal(quote.label, 'from this page'); assert.equal(quote.text, b.sourceText.slice(quote.start, quote.end));
  assert.equal(definitionFromPage('Viscosity', 'Viscosity is high.'), undefined);
  assert.equal(definitionFromPage('Viscosity', 'Viscosity means resistance to flow. Viscosity means something else.'), undefined);
  assert.equal(definitionFromPage('Viscosity', 'SuperViscosity means resistance to flow.'), undefined);
  assert.equal(definitionFromPage('missing', b.sourceText), undefined);
  assert.equal(definitionFromPage('x+', 'x+ means a positive value.')?.text, 'x+ means a positive value.');
});

test('binding construction uses actual source/thread IDs and chosen historical note, without editing source', () => {
  const b = bound(), j = job(preparation({ id: 'request', idempotencyKey: 'key', threadId: b.threadId, intent: 'define', question: 'Explain' }, b), b, 'succeeded');
  const record = saved(j, b);
  const thread = { id: b.threadId, anchorId: b.anchorId, sourceVersionId: b.sourceVersionId, sourceUrl: b.sourceUrl, sourceTitle: b.sourceTitle,
    anchor: b.anchor, notes: [{ id: 'note' }], deletedAt: null } as Thread;
  assert.deepEqual(bindAskingThread(thread, record.source, b.captureId, record.reply.answeredNote!), b);
  assert.throws(() => bindAskingThread(thread, { ...record.source, id: 'wrong' }, b.captureId));
  assert.throws(() => bindAskingThread({ ...thread, deletedAt: TIME }, record.source, b.captureId));
});

test('selection, question-mark note, local definition, opening suggestions and dismissal cause no host calls', () => {
  const h = harness(); assert.equal(h.flow.getState().definition?.label, 'from this page');
  assert.match(h.binding.answeredNote!.text, /\?$/);
  h.flow.openAsk(); h.flow.openAsk(); h.flow.dismissPreview(); h.flow.close(); assert.equal(h.calls.length, 0);
});

test('explicit Ask confirms saved context and observed runtime readiness then prepares once, without dispatch', async () => {
  const h = harness(), one = h.flow.ask('define', ' Explain '), two = h.flow.ask('define', 'Explain');
  assert.strictEqual(one, two); await one;
  assert.deepEqual(h.calls.map(c => c.name), ['ensureSaved', 'availability', 'prepare']);
  assert.equal(h.count('start'), 0); assert.equal(h.flow.getState().phase, 'consent');
  assert.deepEqual(Object.keys(h.calls[2].input as object).sort(), ['answeredNote', 'id', 'idempotencyKey', 'intent', 'question', 'threadId']);
});

test('paired is not provider-ready; unavailable runtime never reaches preparation or dispatch', async () => {
  const h = harness(); h.host.availability = async () => ({ configured: true, available: false });
  await h.flow.ask('define', 'Explain'); assert.equal(h.flow.getState().blocker, 'runtime-unavailable'); assert.equal(h.count('prepare'), 0);
  assert.equal(h.count('start'), 0);
});

test('unsupported, excluded, floating, helper-off, disconnected, signed-out and unpaired facts are distinct no-send paths', async () => {
  const cases: Array<[Partial<AskingAccess>, string]> = [[{ supported: false }, 'unsupported'], [{ excluded: true }, 'excluded'],
    [{ surface: 'floating' }, 'browser-owned-required'], [{ helper: 'off' }, 'helper-off'], [{ helper: 'disconnected' }, 'disconnected'],
    [{ login: 'signed-out' }, 'signed-out'], [{ paired: false }, 'unpaired']];
  for (const [facts, expected] of cases) {
    const h = harness(); h.setAccess(facts); await h.flow.ask('define', 'Explain');
    assert.equal(h.flow.getState().blocker, expected); assert.equal(h.calls.length, 0);
  }
});

test('failure to acknowledge durable context and thrown synchronous adapters never prepare or send', async () => {
  const h = harness(); const flow = createAskingFlow({ ...h.options, ensureContextSaved: async () => { throw new Error('Save failed'); } });
  await flow.ask('define', 'Explain'); assert.equal(flow.getState().blocker, 'unsaved-context'); assert.equal(h.count('prepare'), 0);
  const bad = harness(); bad.host.availability = () => { throw new Error('sync'); };
  await bad.flow.ask('define', 'Explain'); assert.equal(bad.count('start'), 0); assert.equal(bad.flow.getState().phase, 'unavailable');
});

test('valid approval is latched before callbacks; duplicate identical decisions share one permission write and one send', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); const gate = deferred<ConsentGrant>();
  h.host.decide = async input => { h.calls.push({ name: 'decide', input }); return gate.promise; };
  const p = h.prepared.preview, a = h.flow.choose('this-time', p), b = h.flow.choose('this-time', hostCopy(p));
  assert.strictEqual(a, b); await assert.rejects(h.flow.choose('always-site', p)); await settle(); assert.equal(h.count('start'), 0);
  gate.resolve(grant(p, 'this-time')); await a;
  assert.equal(h.count('decide'), 1); assert.equal(h.count('start'), 1);
  assert.deepEqual(h.calls.find(c => c.name === 'start')!.input, { ...h.prepared.job, grantId: 'grant-' + h.prepared.job.id });
  await h.flow.choose('this-time', p); assert.equal(h.count('start'), 1);
});

test('Never saves the exact durable denial and never dispatches, even when an allow grant is forged', async () => {
  for (const forged of [false, true]) {
    const h = harness(); await h.flow.ask('define', 'Explain');
    if (forged) h.host.decide = async () => grant(h.prepared.preview, 'always-site');
    const p = h.flow.choose('never-site', h.prepared.preview);
    if (forged) await assert.rejects(p); else { await p; assert.equal(h.flow.getState().phase, 'denied'); }
    assert.equal(h.count('start'), 0);
  }
});

test('open-session web permission is separate from cloud permission; explicit Always uses actual host scope', async () => {
  const h = harness(); await h.flow.ask('evidence', 'Check this'); assert.equal(h.prepared.preview.scope, 'open-session');
  h.host.decide = async () => ({ ...grant(h.prepared.preview, 'always-site'), scope: 'cloud-inference' });
  await assert.rejects(h.flow.choose('always-site', h.prepared.preview)); assert.equal(h.count('start'), 0);
  const ok = harness(); await ok.flow.ask('explore', 'Go further'); await ok.flow.choose('always-site', ok.prepared.preview); assert.equal(ok.count('start'), 1);
});

test('host denial/exclusion does not reach permission controls or dispatch', async () => {
  for (const state of ['denied', 'excluded'] as const) {
    const h = harness(); h.host.prepare = async input => { const p = preparation(input, h.binding); p.preview.state = state; return p; };
    await h.flow.ask('define', 'Explain'); assert.equal(h.flow.getState().phase, state);
    await assert.rejects(h.flow.choose('this-time', h.flow.getState().preparation!.preview)); assert.equal(h.count('start'), 0);
  }
});

test('mismatched source, capture metadata, note, anchor, question, scope, digest and unknown plan fields cannot reach consent', async () => {
  const mutatePacket = (p: AskingPreparation, f: (packet: any) => void) => { const packet = JSON.parse(p.preview.outgoing[0].text); f(packet); p.preview.outgoing[0].text = JSON.stringify(packet); };
  const corruptions: Array<(p: AskingPreparation) => void> = [p => { p.preview.bindingDigest = POLICY; }, p => { p.preview.scope = 'open-session'; },
    p => mutatePacket(p, x => { x.source.sourceVersionId = 'other'; }), p => mutatePacket(p, x => { x.source.capturedAt = null; }),
    p => mutatePacket(p, x => { x.answeredNote.revision++; }), p => mutatePacket(p, x => { x.selection.exact = 'invented'; }),
    p => mutatePacket(p, x => { x.adjacentContext.after = 'not on this page'; }), p => { p.job.question = 'changed'; },
    p => { Object.assign(p.job, { outgoingPreview: 'client authority' }); }, p => { p.preview.outgoing.push(p.preview.outgoing[0]); }];
  for (const corrupt of corruptions) {
    const h = harness(); h.host.prepare = async input => { const p = preparation(input, h.binding); corrupt(p); return p; };
    await h.flow.ask('define', 'Explain'); assert.equal(h.flow.getState().phase, 'unavailable'); assert.equal(h.count('start'), 0);
  }
});

test('declared host truncation is accepted without modifying the exact outgoing text', async () => {
  const h = harness(); h.host.prepare = async input => {
    const p = preparation(input, h.binding), packet = JSON.parse(p.preview.outgoing[0].text);
    packet.selection.exact = 'Visc'; packet.selection.end = 4; packet.selection.omittedCharacters = 5;
    packet.answeredNote.text = ''; packet.answeredNote.omittedCharacters = h.binding.answeredNote!.text.length;
    p.preview.outgoing[0].text = JSON.stringify(packet); return p;
  };
  await h.flow.ask('define', 'Explain'); assert.equal(h.flow.getState().phase, 'consent');
  assert.equal(JSON.parse(h.flow.getState().preparation!.preview.outgoing[0].text).selection.exact, 'Visc');
});

test('preview tampering and expiry before or during decision never dispatch', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); const tampered = hostCopy(h.prepared.preview); tampered.outgoing[1].text = 'edited';
  await assert.rejects(h.flow.choose('this-time', tampered)); assert.equal(h.count('decide'), 0);
  h.setClock(Date.parse('2026-09-17T10:11:00Z')); await assert.rejects(h.approve()); assert.equal(h.count('start'), 0);
  const late = harness(); await late.flow.ask('define', 'Explain'); const gate = deferred<ConsentGrant>(); late.host.decide = async () => gate.promise;
  const pending = late.approve(); await settle(); late.setClock(Date.parse('2026-09-17T10:11:00Z')); gate.resolve(grant(late.prepared.preview, 'this-time'));
  await assert.rejects(pending); assert.equal(late.count('start'), 0);
});

test('readiness is checked again before approval, not inferred from an earlier pairing or preparation', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); h.host.availability = async () => ({ configured: true, available: false });
  await assert.rejects(h.approve()); assert.equal(h.count('decide'), 0); assert.equal(h.count('start'), 0);
});

test('note revision, unsaved text, source version and capture changes fence a preparation that ignores abort', async () => {
  for (const change of [(b: AskingBinding) => { b.answeredNote!.revision++; }, (b: AskingBinding) => { b.answeredNote!.text = 'unsaved'; },
    (b: AskingBinding) => { b.sourceVersionId = 'new'; }, (b: AskingBinding) => { b.captureId = 'new-capture'; }]) {
    const h = harness(), gate = deferred<AskingPreparation>(); let input!: PrepareJobInput;
    h.host.prepare = async value => { input = value; return gate.promise; };
    const pending = h.flow.ask('define', 'Explain'); await settle(); h.changeBinding(change); gate.resolve(preparation(input, h.binding)); await pending;
    assert.equal(h.flow.getState().phase, 'stale'); assert.equal(h.count('start'), 0);
  }
});

test('dismissal, consent-signal abort, explicit Change, revocation and close fence late grants', async () => {
  for (const stop of ['dismiss', 'signal', 'change', 'revoke', 'close']) {
    const h = harness(); await h.flow.ask('define', 'Explain'); const gate = deferred<ConsentGrant>(), sheet = new AbortController();
    h.host.decide = async () => gate.promise; const pending = h.flow.choose('this-time', h.prepared.preview, sheet.signal); await settle();
    if (stop === 'dismiss') h.flow.dismissPreview(); if (stop === 'signal') sheet.abort(); if (stop === 'change') h.flow.invalidate();
    if (stop === 'revoke') h.setAccess({ epoch: 'revoked', paired: false }); if (stop === 'close') h.flow.close();
    gate.resolve(grant(h.prepared.preview, 'this-time')); await assert.rejects(pending); assert.equal(h.count('start'), 0);
  }
});

test('source and pairing changes during awaited readiness checks prevent later authorization', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); const gate = deferred<{ configured: boolean; available: boolean }>();
  h.host.availability = async () => gate.promise; const pending = h.approve(); await settle();
  h.setAccess({ epoch: 'replaced' }); gate.resolve({ configured: true, available: true }); await assert.rejects(pending);
  assert.equal(h.count('decide'), 0); assert.equal(h.count('start'), 0);
});

test('permission errors and revoked returned grants do not send or replay decisions', async () => {
  for (const failure of ['throw', 'revoked', 'once-binding']) {
    const h = harness(); await h.flow.ask('define', 'Explain'); h.host.decide = async () => {
      if (failure === 'throw') throw new Error('Lost response');
      return { ...grant(h.prepared.preview, 'this-time'), ...(failure === 'revoked' ? { revokedAt: TIME } : { bindingDigest: POLICY }) };
    };
    await assert.rejects(h.approve()); assert.equal(h.count('start'), 0);
  }
});

test('synchronous cancellation from the submitting observer precedes transport and sends nothing', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain');
  h.flow.subscribe(s => { if (s.phase === 'submitting') void h.flow.cancel(); }); await h.approve();
  assert.equal(h.count('start'), 0); assert.equal(h.count('cancel'), 0); assert.equal(h.flow.getState().phase, 'cancelled');
});

test('submitting is not sending; host states and elapsed time are observations, never manufactured progress', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); const gate = deferred<JobSnapshot>(); h.host.start = async () => gate.promise;
  const pending = h.approve(); await settle(); assert.equal(h.flow.getState().phase, 'submitting'); assert.equal(h.flow.getState().sending, false);
  gate.resolve(job(h.prepared, h.binding, 'sending')); await pending; assert.equal(h.flow.getState().sending, true);
  h.setObserved({ ...job(h.prepared, h.binding, 'running', 2), provisional: candidate('partial') });
  h.setClock(Date.parse(TIME) + 31_000); await h.flow.refresh(); assert.equal(h.flow.getState().phase, 'provisional');
  assert.equal(h.flow.getState().elapsedSeconds, 31); assert.equal(h.flow.getState().result, undefined); assert.equal(h.count('readReply'), 0);
});

test('invalid provisional updates are withheld and the previous valid partial is retained', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve();
  h.setObserved({ ...job(h.prepared, h.binding, 'running', 2), provisional: candidate('partial') }); await h.flow.refresh();
  h.setObserved({ ...job(h.prepared, h.binding, 'running', 3), provisional: { ...candidate('partial'), staticFallback: 'malformed' } }); await h.flow.refresh();
  assert.equal(h.flow.getState().provisional!.staticFallback, 'A contextual explanation.'); assert.match(h.flow.getState().message, /withheld/);
  assert.equal(h.flow.getState().result, undefined);
});

test('lost submission stays unknown; refresh never resends; only an observed terminal permits an explicit new retry', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); h.host.start = async input => { h.calls.push({ name: 'start', input }); throw new Error('response lost'); };
  await h.approve(); assert.equal(h.flow.getState().phase, 'unknown'); assert.equal(h.flow.getState().canRetry, false);
  assert.equal(h.flow.getState().requestId, h.prepared.job.id);
  await h.flow.retry(); assert.equal(h.count('prepareRetry'), 0);
  h.setObserved(job(h.prepared, h.binding, 'outcome_unknown', 2)); await h.flow.refresh(); assert.equal(h.flow.getState().canRetry, true);
  const oldId = h.prepared.job.id; await h.flow.retry(); assert.notEqual(h.prepared.job.id, oldId); assert.equal(h.count('retry'), 0);
  assert.equal(h.prepared.job.answeredNote, undefined); await h.approve(); assert.equal(h.count('retry'), 1);
  assert.deepEqual(h.observed.context.answeredNote, { ...h.binding.answeredNote, createdAt: TIME }); assert.equal(h.count('start'), 1);
});

test('cancelling before submission makes no host cancellation; in-flight cancellation is once-only and fences late success', async () => {
  const early = harness(); await early.flow.ask('define', 'Explain'); await early.flow.cancel(); assert.equal(early.count('start'), 0); assert.equal(early.count('cancel'), 0);
  const h = harness(); await h.flow.ask('define', 'Explain'); const gate = deferred<JobSnapshot>(); h.host.start = async () => gate.promise;
  const pending = h.approve(); await settle(); const a = h.flow.cancel(), b = h.flow.cancel(); assert.strictEqual(a, b); await a;
  gate.resolve(job(h.prepared, h.binding, 'succeeded', 4)); await pending;
  assert.equal(h.count('cancel'), 1); assert.equal(h.flow.getState().phase, 'cancelled'); assert.equal(h.count('readReply'), 0);
});

test('unconfirmed cancellation remains unknown and can be explicitly reissued only after an active status read', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve();
  h.host.cancel = async id => { h.calls.push({ name: 'cancel', input: id }); throw new Error('response lost'); };
  await h.flow.cancel(); await h.flow.cancel(); assert.equal(h.count('cancel'), 1); assert.equal(h.flow.getState().phase, 'unknown');
  await h.flow.refresh(); assert.equal(h.flow.getState().canCancel, true); await h.flow.cancel(); assert.equal(h.count('cancel'), 2);
});

test('cancel racing an already committed host response preserves the saved reply; cancelling after completion is a no-op', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve();
  h.host.cancel = async () => { h.setObserved(job(h.prepared, h.binding, 'succeeded', 3)); return h.observed; };
  await h.flow.cancel(); assert.equal(h.flow.getState().phase, 'committed');
  h.host.cancel = async () => { throw new Error('Must not be called'); }; await h.flow.cancel(); assert.equal(h.flow.getState().phase, 'committed');
});

test('cancel_requested, timeout and unknown stay distinct and terminal state does not regress after a late read or disconnect', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); h.host.cancel = async () => job(h.prepared, h.binding, 'cancel_requested', 3);
  await h.flow.cancel(); assert.equal(h.flow.getState().phase, 'cancel_requested');
  h.setObserved({ ...job(h.prepared, h.binding, 'timed_out', 4), cancelRequested: true }); await h.flow.refresh();
  assert.equal(h.flow.getState().phase, 'timed_out'); assert.equal(h.flow.getState().canRetry, true);
  h.setObserved(job(h.prepared, h.binding, 'running', 5)); await h.flow.refresh(); assert.equal(h.flow.getState().phase, 'timed_out');
  h.host.inspect = async () => { throw new Error('disconnected'); }; await h.flow.refresh(); assert.equal(h.flow.getState().phase, 'timed_out');
});

test('concurrent read requests coalesce; cancellation fences an older read', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); const gate = deferred<JobSnapshot>(); h.host.inspect = async () => gate.promise;
  const a = h.flow.refresh(), b = h.flow.refresh(); assert.strictEqual(a, b); await settle(); await h.flow.cancel();
  gate.resolve(job(h.prepared, h.binding, 'succeeded', 5)); await a; assert.equal(h.flow.getState().phase, 'cancelled'); assert.equal(h.count('readReply'), 0);
});

test('committed result carries the exact saved note, source, view and completion identifiers once', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); await h.complete();
  const result = h.flow.getState().result!; assert.equal(h.flow.getState().phase, 'committed');
  assert.equal(result.trace.attemptId, h.observed.latestAttemptId); assert.equal(result.trace.savedAt, result.reply.createdAt);
  assert.deepEqual(result.reply.answeredNote, { ...h.binding.answeredNote, createdAt: TIME }); assert.equal(result.view!.replyVersionId, result.reply.id);
  await h.flow.refresh(); assert.equal(h.count('readReply'), 1);
});

test('wrong source, note, reply association, parent, removed or invalid returned content never becomes Ready', async () => {
  for (const corrupt of [(s: SavedAskingReply) => { s.reply.answeredNote!.revision++; }, (s: SavedAskingReply) => { s.source.id = 'other'; },
    (s: SavedAskingReply) => { s.reply.id = 'other'; }, (s: SavedAskingReply) => { s.reply.parentId = 'other'; },
    (s: SavedAskingReply) => { s.reply.deletedAt = TIME; }, (s: SavedAskingReply) => { s.reply.reply.status = 'partial'; },
    (s: SavedAskingReply) => { s.reply.reply.staticFallback = 'malformed'; }, (s: SavedAskingReply) => { s.reply.validation.schema = 'wrong' as any; },
    (s: SavedAskingReply) => { s.view!.replyVersionId = 'other'; }]) {
    const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); h.setObserved(job(h.prepared, h.binding, 'succeeded', 3));
    h.host.readReply = async () => { const value = saved(h.observed, h.binding); corrupt(value); return value; };
    await h.flow.refresh(); assert.equal(h.flow.getState().phase, 'reply-unavailable'); assert.equal(h.flow.getState().result, undefined);
    h.host.readReply = async () => saved(h.observed, h.binding); await h.flow.refresh(); assert.equal(h.flow.getState().phase, 'committed'); assert.equal(h.count('start'), 1);
  }
});

test('another job, changed source, grant, attempt or frozen question cannot supply this result', async () => {
  for (const corrupt of [(j: JobSnapshot) => { j.id = 'other'; }, (j: JobSnapshot) => { j.context.sourceText = 'other'; },
    (j: JobSnapshot) => { j.grantId = 'other'; }, (j: JobSnapshot) => { j.latestAttemptId = 'other'; },
    (j: JobSnapshot) => { j.context.question = 'other'; }]) {
    const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); const j = job(h.prepared, h.binding, 'succeeded', 3); corrupt(j); h.setObserved(j);
    h.host.inspect = async () => j; await h.flow.refresh(); assert.equal(h.flow.getState().result, undefined); assert.equal(h.count('readReply'), 0);
  }
});

test('source changes, pairing revocation and close fence delayed saved-reply callbacks and observers', async () => {
  for (const stop of ['source', 'revoke', 'close']) {
    const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); h.setObserved(job(h.prepared, h.binding, 'succeeded', 3));
    const gate = deferred<SavedAskingReply>(); h.host.readReply = async () => gate.promise; let notifications = 0; h.flow.subscribe(() => { notifications++; });
    const pending = h.flow.refresh(); await settle();
    if (stop === 'source') h.changeBinding(b => { b.sourceHash = POLICY; }); if (stop === 'revoke') h.setAccess({ paired: false, epoch: 'revoked' });
    if (stop === 'close') h.flow.close(); const before = notifications; gate.resolve(saved(h.observed, h.binding)); await pending;
    assert.equal(h.flow.getState().result, undefined); if (stop === 'close') assert.equal(notifications, before); else assert.equal(h.flow.getState().phase, 'stale');
  }
});

test('reopening a chosen saved reply uses real lineage and read-only APIs, not a fabricated new request', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); await h.complete();
  const expected = h.observed.replyVersionId!, existing = h.count('start'); h.flow.close();
  const fresh = createAskingFlow(h.options); await fresh.reopen({ replyVersionId: expected });
  assert.equal(fresh.getState().phase, 'committed'); assert.equal(fresh.getState().result!.reply.id, expected);
  assert.equal(h.count('listJobs'), 1); assert.equal(h.count('start'), existing); assert.equal(h.count('prepare'), 1);
});

test('ambiguous, wrong-note or missing reopened requests are withheld, including a failed list response', async () => {
  const h = harness(); const p = preparation({ id: 'old', idempotencyKey: 'key', threadId: h.binding.threadId, intent: 'define', question: 'Explain' }, h.binding);
  const j = job(p, h.binding, 'succeeded'); h.setObserved(j);
  h.host.listJobs = async () => [j, { ...j, id: 'other' }]; await h.flow.reopen({ replyVersionId: j.replyVersionId! });
  assert.equal(h.flow.getState().phase, 'reply-unavailable'); assert.equal(h.count('start'), 0);
  const different = createAskingFlow(h.options); h.host.inspect = async () => ({ ...j, context: { ...j.context, answeredNote: undefined } });
  await different.reopen({ jobId: j.id }); assert.equal(different.getState().result, undefined);
});

test('reopening completed work remains read-only even while provider is signed out or unavailable', async () => {
  const h = harness(false); await h.flow.ask('define', 'Explain'); await h.approve(); await h.complete(); h.flow.close(); h.setAccess({ login: 'signed-out' });
  h.host.availability = async () => { throw new Error('Do not ask runtime availability to read saved work'); };
  const fresh = createAskingFlow(h.options); await fresh.reopen({ jobId: h.observed.id });
  assert.equal(fresh.getState().phase, 'committed'); assert.equal(fresh.getState().canFollowup, false); assert.equal(h.count('start'), 1);
});

test('ordinary follow-up verifies the exact completed parent and uses prepare-followup then explicit followups', async () => {
  const h = harness(false); await h.flow.ask('define', 'Explain'); await h.approve(); await h.complete(); const parent = h.observed;
  const one = h.flow.followup('Why?'), two = h.flow.followup('Why?'); assert.strictEqual(one, two); await one;
  assert.equal(h.count('prepareFollowup'), 1); assert.equal(h.count('followup'), 0);
  assert.equal(h.flow.getState().previousResult!.reply.id, parent.replyVersionId); assert.equal(h.prepared.job.parentReplyId, parent.replyVersionId);
  await h.approve(); assert.equal(h.count('followup'), 1); assert.equal(h.observed.context.parentJobId, parent.id);
});

test('note-bound follow-up explicitly forks through supported prepare/start, preserving both note version and parent reply', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); await h.complete(); const parent = h.observed;
  await h.flow.followup('What about temperature?'); assert.equal(h.count('prepareFollowup'), 0); assert.match(h.flow.getState().message, /does not resume/);
  assert.deepEqual(h.prepared.job.answeredNote, { noteId: 'note', revision: 2 }); assert.equal(h.prepared.job.parentReplyId, parent.replyVersionId);
  assert.equal(h.count('start'), 1); await h.approve(); assert.equal(h.count('start'), 2); assert.equal(h.count('followup'), 0);
  await h.complete(); assert.equal(h.flow.getState().result!.reply.parentId, parent.replyVersionId);
  assert.deepEqual(h.flow.getState().result!.reply.answeredNote, { ...h.binding.answeredNote, createdAt: TIME });
});

test('changed or removed parent prevents follow-up preparation; no latest-sibling substitution', async () => {
  const h = harness(false); await h.flow.ask('define', 'Explain'); await h.approve(); await h.complete();
  h.host.inspect = async () => ({ ...h.observed, replyVersionId: 'different-sibling' });
  await h.flow.followup('Why?'); assert.equal(h.count('prepareFollowup'), 0); assert.equal(h.count('followup'), 0);
  assert.equal(h.flow.getState().previousResult!.reply.id, h.observed.replyVersionId);
});

test('host snapshots are detached, cyclic/oversized/invalid data is rejected, and observer failure cannot duplicate work', async () => {
  const cyclic: any = {}; cyclic.self = cyclic; assert.throws(() => hostCopy(cyclic)); assert.throws(() => hostCopy({ value: Infinity }));
  assert.throws(() => hostCopy({ value: 'x'.repeat(4_000_001) }));
  const h = harness(false); h.flow.subscribe(() => { throw new Error('observer'); }); await h.flow.ask('define', 'Explain');
  const copy = h.flow.getState(); copy.preparation!.job.model = 'attacker'; copy.preparation!.preview.outgoing[1].text = 'edited';
  await h.approve(); assert.equal(h.count('start'), 1); assert.equal((h.calls.find(c => c.name === 'start')!.input as any).model, 'host-selected');
});

// A minimal DOM double exercises public factory/card behavior, not browser layout, CSS, selection or accessibility-engine conformance.
class ElementDouble extends EventTarget {
  children: ElementDouble[] = []; parent?: ElementDouble; value = ''; disabled = false; hidden = false; readOnly = false;
  textContent = ''; dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; id = ''; className = ''; type = ''; tabIndex = 0;
  readonly tagName: string; readonly ownerDocument: DocumentDouble;
  constructor(tagName: string, ownerDocument: DocumentDouble) { super(); this.tagName = tagName; this.ownerDocument = ownerDocument; }
  append(...nodes: ElementDouble[]) { for (const n of nodes) { n.remove(); n.parent = this; this.children.push(n); } }
  replaceChildren(...nodes: ElementDouble[]) { for (const n of this.children) n.parent = undefined; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = undefined; }
  contains(value: unknown): boolean { return value === this || this.children.some(n => n.contains(value)); }
  get isConnected(): boolean { return this === this.ownerDocument.body || !!this.parent?.isConnected; }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  focus(_options?: unknown) { this.ownerDocument.activeElement = this; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  all(): ElementDouble[] { return [this, ...this.children.flatMap(n => n.all())]; }
}
class DocumentDouble { body = new ElementDouble('body', this); activeElement: ElementDouble | null = null; createElement(tag: string) { return new ElementDouble(tag, this); } }
function dom() { const doc = new DocumentDouble(), host = doc.createElement('div'); doc.body.append(host); return { doc, host: host as unknown as HTMLElement, node: host }; }
const mountedStub = () => ({ getState: () => ({ parameters: {}, view: {} }), destroy() {} });

test('helper adapter preserves exact route/body protocol and does not invent a jobs POST-read bridge', async () => {
  const b = bound(), p = preparation({ id: 'request', idempotencyKey: 'key', threadId: b.threadId, intent: 'define', question: 'Explain' }, b), j = job(p, b, 'succeeded'), result = saved(j, b);
  const posts: Array<[string, unknown]> = [], gets: string[] = [];
  const host = createAskingHost({ request: async (path, input) => { posts.push([path, input]); return path.includes('prepare') ? p : path.includes('decision') ? { grant: grant(p.preview, 'this-time') } : j; },
    get: async path => { gets.push(path); return path.startsWith('/api/jobs?') ? { jobs: [j] } : path === '/api/jobs' ? { configured: true, available: true } : j; },
    replies: async () => ({ source: result.source, replies: [{ ...result.reply, id: 'sibling' }, result.reply], views: [result.view!] }) });
  const signal = new AbortController().signal;
  await host.availability(signal); assert.deepEqual(await host.prepare(p.job, signal), p);
  await host.decide({ previewId: p.preview.id, expectedRevision: 1, choice: 'this-time' }, signal); await host.start({ ...p.job, grantId: 'grant' }, signal);
  await host.inspect('request', signal); await host.cancel('request', signal); await host.listJobs('thread', signal);
  await host.prepareRetry('request', { id: 'next', idempotencyKey: 'next-key' }, signal);
  await host.retry('request', { id: 'next', idempotencyKey: 'next-key', grantId: 'grant', preparedPayloadDigest: DIGEST }, signal);
  await host.prepareFollowup('request', { id: 'next', idempotencyKey: 'next-key', question: 'Why?' }, signal);
  await host.followup('request', { id: 'next', idempotencyKey: 'next-key', question: 'Why?', grantId: 'grant', preparedPayloadDigest: DIGEST }, signal);
  assert.deepEqual(await host.readReply('thread', result.reply.id, signal), result);
  assert.deepEqual(posts.map(p => p[0]), ['/api/jobs/prepare', '/api/consent/decision', '/api/jobs', '/api/jobs/request/cancel', '/api/jobs/request/prepare-retry',
    '/api/jobs/request/retry', '/api/jobs/request/prepare-followup', '/api/jobs/request/followups']);
  assert.deepEqual(gets, ['/api/jobs', '/api/jobs/request', '/api/jobs?thread=thread']); assert.deepEqual(posts[3][1], {});
});

test('helper adapter aborts before calls, fences lost responses after calls, rejects unsafe paths and wrong prepare shape', async () => {
  let calls = 0; const gate = deferred<unknown>();
  const host = createAskingHost({ request: async () => { calls++; return gate.promise; }, get: async () => ({}), replies: async () => { throw new Error('not used'); } });
  const signal = new AbortController(); signal.abort(); const b = bound(), p = preparation({ id: 'x', idempotencyKey: 'key', threadId: 'thread', intent: 'define', question: 'Explain' }, b);
  await assert.rejects(host.start({ ...p.job, grantId: 'grant' }, signal.signal)); assert.equal(calls, 0);
  const active = new AbortController(), pending = host.prepare(p.job, active.signal); active.abort(); gate.resolve({ job: p.job, consent: {} });
  await assert.rejects(pending); assert.equal(calls, 1);
  await assert.rejects(host.inspect('../escape', new AbortController().signal));
  await assert.rejects(host.prepare(p.job, new AbortController().signal));
});

test('existing consent surface is not rebuilt mid-decision; its destruction cannot abort an already valid handoff', async () => {
  const h = harness(), d = dom(); let sheet!: ConsentSheetOptions, creates = 0, destroys = 0, renders = 0, completions = 0;
  const sheetSignal = new AbortController(); let rendered!: ReplyOptions;
  const surfaces = connectAskingSurfaces(h.flow, { consentRoot: d.host, replyRoot: d.host, provisionalRoot: d.host,
    mountConsent: (_root, options) => { sheet = options; creates++; return { update() { throw new Error('No redraw'); }, destroy() { destroys++; sheetSignal.abort(); } }; },
    mountReply: (_root, _reply, options) => { renders++; rendered = options; return mountedStub(); }, replyOptions: () => ({}), onCommitted: () => { completions++; } });
  await h.flow.ask('define', 'Explain'); assert.equal(sheet.onGranted, undefined); const gate = deferred<ConsentGrant>(); h.host.decide = async () => gate.promise;
  const pending = sheet.decide('this-time', sheet.preview, sheetSignal.signal); await settle(); assert.equal(creates, 1); assert.equal(destroys, 0);
  gate.resolve(grant(h.prepared.preview, 'this-time')); await pending; assert.equal(h.count('start'), 1); assert.equal(destroys, 1);
  await h.complete(); await h.flow.refresh(); assert.equal(renders, 1); assert.equal(completions, 1);
  assert.equal(rendered.sourceText, h.binding.sourceText); assert.deepEqual(rendered.hostReport, saved(h.observed, h.binding).reply.validation);
  surfaces.destroy(); surfaces.destroy(); assert.equal(destroys, 1);
});

test('provisional first content never uses the committed renderer; parent stays mounted through follow-up review', async () => {
  const h = harness(false), d = dom(); let commits = 0, partials = 0, destroyed = 0;
  const surfaces = connectAskingSurfaces(h.flow, { consentRoot: d.host, replyRoot: d.host, provisionalRoot: d.host,
    mountConsent: () => ({ update() {}, destroy() {} }), replyOptions: () => ({}),
    mountReply: () => { commits++; return { ...mountedStub(), destroy() { destroyed++; } }; },
    mountProvisional: (_root, value) => { assert.equal(value.status, 'partial'); partials++; return { destroy() {} }; } });
  await h.flow.ask('define', 'Explain'); await h.approve(); h.setObserved({ ...job(h.prepared, h.binding, 'running', 2), provisional: candidate('partial') });
  await h.flow.refresh(); assert.equal(partials, 1); assert.equal(commits, 0);
  await h.complete(); await h.flow.followup('Why?'); assert.equal(commits, 1); assert.equal(destroyed, 0);
  await h.approve(); await h.complete(); assert.equal(commits, 2); assert.equal(destroyed, 0);
  surfaces.destroy(); assert.equal(destroyed, 2);
});

test('surface cleanup fences delayed saved reads and throwing consent/render factories cannot send work', async () => {
  const h = harness(), d = dom(); let renders = 0;
  const surface = connectAskingSurfaces(h.flow, { consentRoot: d.host, replyRoot: d.host, provisionalRoot: d.host,
    mountConsent: () => ({ update() {}, destroy() {} }), replyOptions: () => ({}), mountReply: () => { renders++; return mountedStub(); } });
  await h.flow.ask('define', 'Explain'); await h.approve(); h.setObserved(job(h.prepared, h.binding, 'succeeded', 3));
  const gate = deferred<SavedAskingReply>(); h.host.readReply = async () => gate.promise; const pending = h.flow.refresh(); await settle();
  surface.destroy(); gate.resolve(saved(h.observed, h.binding)); await pending; assert.equal(renders, 0); assert.equal(h.flow.getState().phase, 'closed');
  const bad = harness(); const messages: string[] = [];
  const failed = connectAskingSurfaces(bad.flow, { consentRoot: d.host, replyRoot: d.host, provisionalRoot: d.host,
    mountConsent: () => { throw new Error('Cannot mount'); }, mountReply: mountedStub, replyOptions: () => ({}), onError: value => messages.push(value) });
  await bad.flow.ask('define', 'Explain'); assert.equal(bad.count('start'), 0); assert.ok(messages.length > 0); failed.destroy();
});

test('literal provisional text is inert and follow-up inputs become explicit reviewed question text', () => {
  const d = dom(), mounted = mountProvisionalText(d.host, { ...candidate('partial'), staticFallback: '<script>not executable</script>' });
  assert.equal(d.node.children[0].children[1].textContent, '<script>not executable</script>'); mounted.destroy(); assert.equal(d.node.children.length, 0);
  assert.equal(followupQuestion({ text: 'Explain the change', parameters: { damping: 0.5 }, view: {} }), 'Explain the change\n\nCurrent reader-selected inputs:\ndamping = 0.5');
  assert.throws(() => followupQuestion({ text: 'Why?', parameters: { x: Infinity }, view: {} }));
});

test('inline and narrow-sheet cards preserve the editor, keep actions local, invalidate Change, and clean timers/focus', async () => {
  for (const presentation of ['inline', 'sheet'] as const) {
    const h = harness(), d = dom(); let keeps = 0, parks = 0, changed = 0, held = 0;
    const original = d.doc.createElement('button'); d.doc.body.append(original); original.focus();
    const exposure: string[] = [];
    const mount = mountAskingCard(d.host, { flow: h.flow, presentation, returnFocus: original as unknown as HTMLElement,
      mountConsent: () => ({ update() {}, destroy() {} }), mountReply: mountedStub, replyOptions: () => ({}),
      onKeep: () => { keeps++; }, onPark: () => { parks++; }, onChange: () => { changed++; }, onHoldReading: () => { held++; },
      onExposure: e => exposure.push(e.kind), moreSuggestions: [{ id: 'derive', label: 'Show steps', intent: 'derive', question: 'Show steps', time: 'longer' }] });
    try {
      const find = (text: string) => d.node.all().find(n => n.tagName === 'button' && n.textContent === text)!;
      find('Keep').click(); find('Park').click(); await settle(); assert.equal(keeps, 1); assert.equal(parks, 1); assert.equal(h.calls.length, 0);
      find('Ask').click(); await settle(); const editor = d.node.all().find(n => n.tagName === 'textarea')!;
      editor.value = 'A preserved draft?'; editor.focus(); const identity = editor;
      h.flow.openAsk(); assert.strictEqual(d.node.all().find(n => n.tagName === 'textarea'), identity); assert.equal(editor.value, 'A preserved draft?');
      d.node.children[0].dispatchEvent(new Event('focusin')); assert.equal(held, 1);
      find('Change').click(); await settle(); assert.equal(changed, 1); assert.equal(h.flow.getState().phase, 'stale'); assert.equal(h.count('start'), 0);
      assert.equal(d.node.children[0].getAttribute('aria-modal'), presentation === 'sheet' ? 'false' : null);
      mount.destroy(); mount.destroy(); assert.equal(d.node.children.length, 0); assert.strictEqual(d.doc.activeElement, original);
      assert.deepEqual(exposure, ['shown', 'no-choice']);
    } finally { mount.destroy(); }
  }
});

test('an earlier synchronous observer changing source or revoking pairing fences later result observers', async () => {
  for (const kind of ['source', 'pairing']) {
    const h = harness(), d = dom(); let renders = 0;
    h.flow.subscribe(state => { if (state.phase === 'committed') {
      if (kind === 'source') h.changeBinding(b => { b.captureId = 'different'; }); else h.setAccess({ epoch: 'revoked', paired: false });
    } });
    const surfaces = connectAskingSurfaces(h.flow, { consentRoot: d.host, replyRoot: d.host, provisionalRoot: d.host,
      mountConsent: () => ({ update() {}, destroy() {} }), replyOptions: () => ({}), mountReply: () => { renders++; return mountedStub(); } });
    await h.flow.ask('define', 'Explain'); await h.approve(); await h.complete();
    assert.equal(renders, 0); assert.equal(h.flow.getState().result, undefined); surfaces.destroy();
  }
});

test('reopened request metadata cannot silently change provider or permission policy between observations', async () => {
  const h = harness(false); await h.flow.ask('define', 'Explain'); await h.approve(); const id = h.observed.id;
  const reopened = createAskingFlow(h.options); await reopened.reopen({ jobId: id });
  h.setObserved({ ...job(h.prepared, h.binding, 'succeeded', 3), provider: 'mcp-server', policyKey: DIGEST });
  await reopened.refresh(); assert.equal(reopened.getState().result, undefined);
});

test('a host report for a different immutable reply hash is not a matching saved response', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); h.setObserved(job(h.prepared, h.binding, 'succeeded', 3));
  h.host.readReply = async () => { const value = saved(h.observed, h.binding); value.reply.validation.replyDigest = POLICY; return value; };
  await h.flow.refresh(); assert.equal(h.flow.getState().phase, 'reply-unavailable'); assert.equal(h.flow.getState().result, undefined);
});

test('a late submission error cannot replace a completion already observed through replay', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); const response = deferred<JobSnapshot>();
  h.host.start = async input => { h.calls.push({ name: 'start', input }); return response.promise; };
  const approval = h.approve(); await settle(); await h.complete();
  assert.equal(h.flow.getState().phase, 'committed');
  response.reject(new Error('The original HTTP response was lost')); await approval;
  assert.equal(h.flow.getState().phase, 'committed'); assert.equal(h.flow.getState().canFollowup, true); assert.equal(h.count('start'), 1);
});

test('expiry during a synchronous submitting observer is fenced before the host call', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain');
  h.flow.subscribe(state => { if (state.phase === 'submitting') h.setClock(Date.parse('2026-09-17T10:11:00Z')); });
  await h.approve(); assert.equal(h.count('start'), 0);
  assert.equal(h.flow.getState().blocker, 'expired-preview'); assert.equal(h.flow.getState().submitted, false);
});

test('malformed host-report result entries are withheld rather than sent to the saved renderer', async () => {
  const h = harness(); await h.flow.ask('define', 'Explain'); await h.approve(); h.setObserved(job(h.prepared, h.binding, 'succeeded', 3));
  h.host.readReply = async () => { const value = saved(h.observed, h.binding); value.reply.validation.results = [null as any]; return value; };
  await h.flow.refresh(); assert.equal(h.flow.getState().phase, 'reply-unavailable'); assert.equal(h.flow.getState().result, undefined);
});

test('a reply-options callback changing the source cannot mount or announce that stale result', async () => {
  const h = harness(), d = dom(); let renders = 0, announces = 0;
  const surface = connectAskingSurfaces(h.flow, { consentRoot: d.host, replyRoot: d.host, provisionalRoot: d.host,
    mountConsent: () => ({ update() {}, destroy() {} }),
    replyOptions: () => { h.changeBinding(b => { b.captureId = 'replaced'; }); return {}; },
    mountReply: () => { renders++; return mountedStub(); }, onCommitted: () => { announces++; } });
  await h.flow.ask('define', 'Explain'); await h.approve(); await h.complete();
  assert.equal(renders, 0); assert.equal(announces, 0); surface.destroy();
});
