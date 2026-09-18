import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ReaderStore } from '../daemon/store.ts';
import { JobStore } from '../daemon/jobs/store.ts';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import { prepareSendCheckpoint } from '../daemon/jobs/send-checkpoint.ts';
import type { FrozenJobContext, StartJobInput } from '../contracts/jobs.ts';
import type { ProviderHandle, ProviderRequest } from '../contracts/job-runner.ts';

const policyKey = 'a'.repeat(64), digest = 'd'.repeat(64);
const keep = { id: 'keep-send', kind: 'keep' as const, threadId: 'thread-send',
  capture: { url: 'https://example.org/article', title: 'Article', pageType: 'article', text: 'Start here.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' },
  anchor: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5 } };
function fixture(url: string) {
  const reader = new ReaderStore(':memory:'); reader.apply({ ...keep, capture: { ...keep.capture, url } });
  const store = new JobStore(reader), consent = new ConsentSessionService(reader);
  const thread = reader.get(keep.threadId)!, source = reader.sourceVersion(thread.sourceVersionId)!;
  const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: source.id, sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle,
    sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt, sourceHash: source.hash, sourceText: source.text,
    passage: thread.anchor, question: 'Explain', intent: 'define', preparedPayloadDigest: digest, modelSettingsRevision: 1, modelCompatibilityKey: 'test',
    outgoing: { schema: 'marginalia.job-packet.v1', intent: 'define', question: 'Explain',
      source: { url: thread.sourceUrl, title: thread.sourceTitle, pageType: source.pageType, capturedAt: source.capturedAt, sourceHash: source.hash, sourceVersionId: source.id },
      selection: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5, originalEnd: 5, omittedCharacters: 0 },
      adjacentContext: { before: '', after: '', basis: 'bounded-character-context' }, availableCapabilities: [], omissions: [] } };
  const preview = consent.prepare({ requestId: 'send-job', bindingDigest: digest, sourceUrl: thread.sourceUrl, scope: 'cloud-inference',
    recipient: 'openai-codex', recipientLabel: 'OpenAI Codex', provider: 'app-server', policyKey,
    outgoing: [{ label: 'Reviewed packet', text: 'Start here.', sha256: createHash('sha256').update('Start here.').digest('hex') }] });
  const grant = consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'this-time' },
    { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' });
  const input: StartJobInput = { id: 'send-job', idempotencyKey: 'send-key', threadId: thread.id, intent: 'define', question: 'Explain',
    provider: 'app-server', model: 'test-model', mode: 'structured-final', policyKey, grantId: grant.id, preparedPayloadDigest: digest };
  store.create(input, context, 'packet-digest', 'request-digest'); const attempt = store.createAttempt(input.id);
  store.setDeadline(input.id, attempt.id, new Date(Date.now() + 60_000).toISOString()); store.markPreparing(input.id, attempt.id); store.markWorkspacePrepared(input.id, attempt.id);
  const request: ProviderRequest = { jobId: attempt.id, workspace: process.cwd(), policyKey, model: input.model, mode: input.mode,
    prompt: 'Explain the saved passage', outputSchema: { type: 'object' } };
  const handle: ProviderHandle = { jobId: attempt.id, provider: 'app-server', workspace: request.workspace, policyKey, model: input.model,
    mode: input.mode, state: 'starting', tombstone: false, providerInstanceId: 'instance', threadId: 'provider-thread' };
  return { reader, store, consent, grant, request, handle, current: () => store.get(input.id)! };
}
function effects(f: ReturnType<typeof fixture>) {
  const db = f.reader.db, attempt = f.current().attempts.find(a => a.id === f.request.jobId)!;
  return {
    consumed: (db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(f.grant.id) as { consumedAttemptId: string | null }).consumedAttemptId,
    authorizations: (db.prepare('SELECT count(*) n FROM consent_attempt_authorizations').get() as { n: number }).n,
    egress: (db.prepare('SELECT count(*) n FROM egress_events').get() as { n: number }).n,
    handoff: attempt.handoffMarked, checkpoint: attempt.dispatchClaimed,
    outbox: (db.prepare("SELECT count(*) n FROM events WHERE kind IN ('egress-approved','egress-dispatched')").get() as { n: number }).n,
  };
}
const none = { consumed: null, authorizations: 0, egress: 0, handoff: false, checkpoint: false, outbox: 0 };
async function prepare(f: ReturnType<typeof fixture>, admit?: () => boolean) {
  const expected = f.current(), eligibility = await f.consent.revalidate(expected, 'dispatch');
  return prepareSendCheckpoint(f.store, expected, f.request, f.consent, eligibility.eligibilityFingerprint!, admit);
}


for (const url of ['http://example.org/article', 'https://sub.example.org/article', 'https://example.org/article', 'https://deep.sub.example.org:8443/article']) {
  for (const restore of [false, true]) test(`host exclusion fences final dispatch${restore ? ' after unexclude' : ''}: ${url}`, async () => {
    const f = fixture(url);
    const { createInstantService } = await import('../daemon/instant/index.ts');
    const instant = createInstantService({ store: f.reader, connect: async () => { throw new Error('No provider allowed'); } });
    try {
      const checkpoint = await prepare(f);
      instant.syncPolicy(['example.org']);
      if (restore) { const row = f.consent.exclusions()[0]; f.consent.setExclusion(row.site, false, row.revision); }
      assert.throws(() => checkpoint.finalize(f.request, f.handle), /excluded|eligibility changed/);
      assert.deepEqual(effects(f), none);
    } finally { instant.close(); f.reader.close(); }
  });
}

for (const url of ['https://unrelatedexample.org/a', 'https://example.org.evil.test/a', 'https://other.test/a']) {
  test(`parent host exclusion preserves unrelated dispatch: ${url}`, async () => {
    const f = fixture(url);
    try {
      const checkpoint = await prepare(f);
      f.consent.setExclusion('https://example.org', true);
      checkpoint.finalize(f.request, f.handle);
      assert.equal(effects(f).handoff, true);
      assert.equal(effects(f).egress, 1);
    } finally { f.reader.close(); }
  });
}

test('parent exclusion fences an already finalized authorization, including after unexclude', async () => {
  const f = fixture('http://sub.example.org/a');
  try {
    (await prepare(f)).finalize(f.request, f.handle);
    const before = effects(f);
    const row = f.consent.setExclusion('https://example.org', true);
    await assert.rejects(f.consent.revalidate(f.current(), 'dispatch'), /excluded|permission changed/);
    f.consent.setExclusion(row.site, false, row.revision);
    await assert.rejects(f.consent.revalidate(f.current(), 'dispatch'), /excluded|permission changed/);
    assert.deepEqual(effects(f), before);
  } finally { f.reader.close(); }
});

test('parent exclusion reaches preview and decision without widening grant scope', () => {
  const reader = new ReaderStore(':memory:'), consent = new ConsentSessionService(reader);
  try {
    consent.setExclusion('https://example.org', true);
    const preview = consent.prepare({ requestId: 'blocked', sourceUrl: 'http://sub.example.org/a', scope: 'cloud-inference',
      recipient: 'openai-codex', recipientLabel: 'OpenAI Codex', provider: 'app-server', policyKey, bindingDigest: digest,
      outgoing: [{ label: 'Passage', text: 'passage', sha256: createHash('sha256').update('passage').digest('hex') }] });
    assert.equal(preview.state, 'excluded');
    assert.throws(() => consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'this-time' },
      { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' }), /excluded/);
    assert.equal(consent.grants().length, 0);
    assert.equal(consent.egress().length, 0);
  } finally { reader.close(); }
});
