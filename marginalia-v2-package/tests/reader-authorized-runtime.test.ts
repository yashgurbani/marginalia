import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ReaderStore } from '../daemon/store.ts';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import { createConsentProviderAuthorization, type PolicyEvidenceCollector } from '../daemon/consent/provider-authorization.ts';
import { createCodexPolicy, PINNED_CODEX_VERSION, type PolicyEvidence } from '../daemon/codex-policy.ts';
import { authorizePolicy, policyFingerprint } from '../daemon/providers/policy-gate.ts';
import { createAuthorizedRuntime } from '../daemon/reader-authorized-runtime.ts';
import { createDedicatedHostEvidenceSource } from '../daemon/consent/evidence-host.ts';
import type { ConsentAuthorization, ConsentGrant, PrepareConsentInput } from '../contracts/consent.ts';
import type { JobSnapshot } from '../contracts/jobs.ts';
import type { ProviderAudit, ProviderRequest } from '../contracts/job-runner.ts';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function job(prepared: PrepareConsentInput, grant: ConsentGrant, attempt = prepared.requestId + '-attempt'): JobSnapshot {
  return { id: prepared.requestId, threadId: 'thread', idempotencyKey: 'key-' + prepared.requestId,
    packetDigest: hash('packet:' + prepared.requestId), latestAttemptId: attempt, grantId: grant.id,
    provider: prepared.provider, model: 'model', mode: 'workspace-files', state: 'queued', cancelRequested: false,
    createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z', attempts: [],
    policyKey: prepared.policyKey, preparedPayloadDigest: prepared.bindingDigest, context: {
      threadId: 'thread', sourceVersionId: 'source-version', sourceUrl: prepared.sourceUrl,
      sourceTitle: 'Paper', sourcePageType: 'article', sourceCapturedAt: null, sourceHash: hash('source'),
      sourceText: 'passage', passage: { exact: 'passage', prefix: '', suffix: '', start: 0, end: 7 },
      question: prepared.requestId, intent: 'define', preparedPayloadDigest: prepared.bindingDigest,
      modelSettingsRevision: 1, modelCompatibilityKey: 'model-key', outgoing: {
        schema: 'marginalia.job-packet.v1', intent: 'define', question: prepared.requestId,
        source: { url: prepared.sourceUrl, title: 'Paper', pageType: 'article', capturedAt: null,
          sourceHash: hash('source'), sourceVersionId: 'source-version' },
        selection: { exact: 'passage', prefix: '', suffix: '', start: 0, end: 7, originalEnd: 7, omittedCharacters: 0 },
        adjacentContext: { before: '', after: '', basis: 'bounded-character-context' },
        availableCapabilities: [], omissions: [],
      },
    } };
}

const policy = createCodexPolicy({ version: PINNED_CODEX_VERSION, platform: 'win32', adapter: 'app-server',
  operation: 'generation', model: 'model', workspace: 'C:\\fixture-workspace', codexHome: 'C:\\fixture-home', auditId: 'test' });
const policyKey = policyFingerprint(policy);
const request: ProviderRequest = { jobId: 'attempt', workspace: policy.workspace, model: 'model', mode: 'workspace-files', policyKey, prompt: 'private-page-text' };
const audit = { workspace: policy.workspace, codexHome: policy.codexHome } as ProviderAudit;
const authorization: ConsentAuthorization = {
  id: 'authorization', jobId: 'job', attemptId: 'attempt', grantId: 'grant', grantRevision: 1,
  sitePermissionEpoch: 0, site: 'https://example.test', scope: 'cloud-inference', recipient: 'openai-codex',
  provider: 'app-server', policyKey, bindingDigest: '0'.repeat(64), permissionFingerprint: '1'.repeat(64),
  egressEventId: 'egress', dispatchedAt: '2026-09-17T00:00:00.000Z',
};
const optIn = { unobservedConfinement: 'reader-authorized' } as const;
const veto: PolicyEvidence = { catalog: { status: 'incomplete', scope: policy.evidenceScope, source: 'fixture', reference: 'fixture',
  reason: 'partial', entries: [{ name: 'unsupported-tool', enabled: true, origin: 'unknown' }] } };

test('reader-authorized gate preserves defaults, requested policy, binding checks and catalog veto', t => {
  const log = t.mock.method(console, 'error', () => {});
  assert.throws(() => authorizePolicy(policy, request, audit, {}, authorization, 'dispatch'), /policy-evidence-rejected/);
  const admitted = authorizePolicy(policy, request, audit, {}, authorization, 'bootstrap', optIn);
  authorizePolicy(policy, request, audit, {}, authorization, 'dispatch', optIn);
  assert.equal(log.mock.callCount(), 1);
  assert.match(String(log.mock.calls[0].arguments[0]), /evidence-missing/);
  assert.ok(!String(log.mock.calls[0].arguments[0]).includes(request.prompt));
  assert.ok(policy.modelTurn);
  assert.deepEqual(admitted.thread, { ...policy.threadStart.params, config: policy.configOverrides });
  assert.deepEqual(admitted.turn, policy.turnPolicy);
  assert.throws(() => authorizePolicy(policy, request, audit, {}, { ...authorization, attemptId: 'wrong' }, 'dispatch', optIn), /current-attempt/);
  assert.throws(() => authorizePolicy(policy, { ...request, policyKey: 'wrong' }, audit, {}, { ...authorization, policyKey: 'wrong' }, 'dispatch', optIn), /policy-request-mismatch/);
  assert.throws(() => authorizePolicy(policy, request, audit, {}, { ...authorization, dispatchedAt: undefined }, 'dispatch', optIn), /current-attempt/);
  assert.throws(() => authorizePolicy(policy, request, { ...audit, codexHome: 'wrong' }, {}, authorization, 'dispatch', optIn), /binding-mismatch/);
  assert.throws(() => authorizePolicy(policy, { ...request, model: 'wrong' }, audit, {}, authorization, 'dispatch', optIn), /policy-request-mismatch/);
  assert.throws(() => authorizePolicy(policy, { ...request, mode: 'structured-final' }, audit, {}, authorization, 'dispatch', optIn), /policy-mode-mismatch/);
  assert.throws(() => authorizePolicy(policy, request, audit, veto, authorization, 'dispatch', optIn), /policy-catalog-veto/);
});

test('consent bridge collects evidence and keeps current dispatch authorization mandatory', async t => {
  const store = new ReaderStore(':memory:'); t.after(() => store.close());
  const consent = new ConsentSessionService(store);
  const prepared: PrepareConsentInput = { requestId: 'job', sourceUrl: 'https://example.test', scope: 'cloud-inference', recipient: 'openai-codex',
    recipientLabel: 'Codex', provider: 'app-server', policyKey, bindingDigest: hash('packet'), outgoing: [{ label: 'text', text: 'text', sha256: hash('text') }] };
  const preview = consent.prepare(prepared);
  const grant = consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: 'this-time' },
    { surface: 'localhost-settings', pairingId: 'pair', origin: 'http://127.0.0.1:43120' });
  const current = job(prepared, grant, 'attempt');
  let observations: PolicyEvidence = {}, collections = 0;
  const evidence: PolicyEvidenceCollector = { auditId: () => 'test', collect: async () => { collections++; return observations; },
    observeThread: async () => {}, authorizeRecovery: async () => {}, inspectMcp: async () => audit };
  const stock = createConsentProviderAuthorization({ consent, platform: 'win32', evidence });
  const enabled = createConsentProviderAuthorization({ consent, platform: 'win32', evidence, ...optIn });
  await assert.rejects(enabled.authorize(current, request, audit, 'dispatch'));
  const currentAuth = t.mock.method(consent, 'currentAuthorization', (_job: JobSnapshot, attempt: string, dispatch?: boolean) => {
    assert.equal(attempt, 'attempt'); assert.equal(dispatch, true); return authorization;
  });
  await assert.rejects(stock.authorize(current, request, audit, 'dispatch'), /policy-evidence-rejected/);
  await enabled.authorize(current, request, audit, 'dispatch');
  assert.ok(collections >= 3); assert.equal(currentAuth.mock.callCount(), 2);
  await assert.rejects(enabled.authorize({ ...current, latestAttemptId: 'wrong' }, request, audit, 'dispatch'), /current-provider-attempt/);
  await assert.rejects(enabled.authorize(current, { ...request, policyKey: 'wrong' }, audit, 'dispatch'), /policy-request-mismatch/);
  currentAuth.mock.mockImplementation(() => ({ ...authorization, dispatchedAt: undefined }));
  await assert.rejects(enabled.authorize(current, request, audit, 'dispatch'), /current-attempt/);
  currentAuth.mock.mockImplementation(() => authorization); observations = veto;
  await assert.rejects(enabled.authorize(current, request, audit, 'dispatch'), /policy-catalog-veto/);
});

test('runtime factory refuses missing or invalid dedicated identity independently of old acknowledgement', t => {
  const keys = ['MARGINALIA_READER_AUTHORIZED_UNCONFINED', 'MARGINALIA_CODEX_EXECUTABLE', 'MARGINALIA_CODEX_HOME', 'PATH', 'Path'] as const;
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }));
  const store = new ReaderStore(':memory:'); t.after(() => store.close());
  const input = { dataDir: process.cwd(), store, consent: new ConsentSessionService(store) };
  process.env.PATH = ''; process.env.Path = '';
  delete process.env.MARGINALIA_READER_AUTHORIZED_UNCONFINED;
  delete process.env.MARGINALIA_CODEX_EXECUTABLE; delete process.env.MARGINALIA_CODEX_HOME;
  assert.throws(() => createAuthorizedRuntime(input), /valid Codex executable/);
  process.env.MARGINALIA_READER_AUTHORIZED_UNCONFINED = 'I-UNDERSTAND';
  delete process.env.MARGINALIA_CODEX_EXECUTABLE; delete process.env.MARGINALIA_CODEX_HOME;
  assert.throws(() => createAuthorizedRuntime(input), /valid Codex executable/);
  process.env.MARGINALIA_CODEX_EXECUTABLE = 'relative.exe'; process.env.MARGINALIA_CODEX_HOME = 'relative-home';
  assert.throws(() => createAuthorizedRuntime(input), /valid Codex executable/);
});

test('dedicated evidence readiness remains false with all seven gaps', () => {
  const state = createDedicatedHostEvidenceSource().readiness();
  assert.equal(state.ready, false); assert.equal(state.reasons.length, 7);
});

test('D15 ordinary policy inherits settings and permits configured tools without certifying confinement', t => {
  t.mock.method(console, 'error', () => {});
  const ordinary = createCodexPolicy({ version: PINNED_CODEX_VERSION, platform: 'win32', adapter: 'app-server',
    operation: 'generation', model: 'model', workspace: policy.workspace, codexHome: policy.codexHome, auditId: 'ordinary', homeMode: 'ordinary' });
  const ordinaryKey = policyFingerprint(ordinary);
  assert.notEqual(ordinaryKey, policyKey);
  assert.deepEqual(ordinary.configOverrides, {});
  const inherited: PolicyEvidence = { catalog: { ...veto.catalog!, scope: ordinary.evidenceScope } };
  const admitted = authorizePolicy(ordinary, { ...request, policyKey: ordinaryKey }, audit, inherited,
    { ...authorization, policyKey: ordinaryKey }, 'dispatch', optIn);
  assert.equal(admitted.thread.approvalPolicy, undefined); assert.equal(admitted.thread.sandbox, undefined);
  assert.equal(admitted.turn.sandboxPolicy, undefined); assert.deepEqual(admitted.thread.config, {});
  assert.throws(() => authorizePolicy(ordinary, { ...request, policyKey: ordinaryKey }, audit, inherited,
    { ...authorization, policyKey: ordinaryKey, dispatchedAt: undefined }, 'dispatch', optIn), /current-attempt/);
  assert.throws(() => authorizePolicy(ordinary, { ...request, policyKey: ordinaryKey }, audit, inherited,
    { ...authorization, policyKey: ordinaryKey }, 'dispatch'), /policy-evidence-rejected/);
});
