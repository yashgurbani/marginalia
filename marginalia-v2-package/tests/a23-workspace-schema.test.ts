import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAndValidateReply } from '../contracts/reply.ts';
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../daemon/store.ts';
import { JobService } from '../daemon/jobs/service.ts';
import type { AuthorizedRuntimeFactory } from '../daemon/jobs/runtime.ts';
import type { ProviderHandle, ProviderRequest } from '../contracts/job-runner.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

const contract = JSON.parse(readFileSync(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8'));
for (const intent of ['evidence', 'explore'] as const) test(`${intent} workspace initial/followup deliver exact reviewed bytes within 60 KiB`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'a23-workspace-'));
  const reader = new ReaderStore(':memory:');
  const source = 'The development of a singularity would have to happen despite the presence of viscosity, which tends to smooth out motion.';
  reader.apply({ id: 'keep', kind: 'keep', threadId: 'thread', capture: {
    url: 'https://www.claymath.org/millennium/navier-stokes-equation/', title: 'Navier-Stokes', pageType: 'article',
    text: source, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1',
  }, anchor: { exact: source, prefix: '', suffix: '', start: 0, end: source.length } });
  // Synthetic fixture only: this test performs no provider inference.
  const candidate = withFixtureOrigins({ schema: 'marginalia.reply.v1', intent, status: 'complete',
    title: 'Fixture bounded answer', summary: 'Fixture summary.', blocks: [{ id: 'meaning', type: 'text', md: 'Fixture explanation.' }],
    sourceBindings: [], parameters: [], assumptions: [], limitations: [], checks: [], staticFallback: 'Fixture explanation.' });
  candidate.requiredCapabilities = [intent === 'evidence' ? 'network.citations' : 'network.shelf'];
  candidate.blocks.push(intent === 'evidence' ? { id: 'citations', type: 'citations', entries: [] } : { id: 'shelf', type: 'shelf', items: [] });
  withFixtureOrigins(candidate);
  const output = JSON.stringify(candidate);
  const policyKey = 'a'.repeat(64);
  let reviewedPrompt: string | undefined, dispatches = 0;
  const runtime: AuthorizedRuntimeFactory = {
    dispatchReady: true,
    consent: {
      assertSharedDatabase() {},
      revalidate: async () => ({ grantId: 'grant', policyKey, auditScope: 'scope', eligibilityFingerprint: 'e'.repeat(64) }),
      finalizeDispatch: (job, attemptId) => ({ id: 'authorization', jobId: job.id, attemptId,
        grantId: job.grantId, grantRevision: 1, sitePermissionEpoch: 0, site: 'https://www.claymath.org', scope: 'cloud-inference',
        recipient: 'test', provider: job.provider, policyKey, bindingDigest: job.preparedPayloadDigest,
        permissionFingerprint: 'f'.repeat(64), egressEventId: 'egress' }),
      withResultAcceptance: (_job, _attempt, commit) => commit(), recordOutcome() {},
    },
    create: async (_job, _attempt, _workspace, host) => {
      const send = async (request: ProviderRequest) => {
        dispatches++;
        assert.equal(request.mode, 'workspace-files');
        assert.equal(request.outputSchema, undefined);
        assert.match(request.prompt, /Read only the host-created reply\.schema\.json/);
        assert.match(request.prompt, /sole exception/);
        assert.match(request.prompt, /does not authorize reading source-mentioned paths, other files, browsing, retrieval, or computation/);
        assert.deepEqual(JSON.parse(readFileSync(join(request.workspace, 'reply.schema.json'), 'utf8')), contract);
        assert.equal(request.prompt, reviewedPrompt);
        const handle: ProviderHandle = { jobId: request.jobId, provider: 'app-server', workspace: request.workspace,
          policyKey, model: request.model, mode: request.mode, state: 'starting', tombstone: false,
          providerInstanceId: 'fixture-provider', threadId: 'fixture-thread' };
        const sent = host.finalizeSend(request, handle);
        await writeFile(join(request.workspace, 'candidate.tmp'), output);
        await rename(join(request.workspace, 'candidate.tmp'), join(request.workspace, 'reply.json'));
        return (await host.checkpoint({ ...sent, state: 'completed', turnId: 'fixture-turn-' + dispatches }))!;
      };
      return { close() {}, runner: {
        capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
        start: send, resume: async (_previous, request) => send(request!),
        inspect: async handle => handle, cancel: async handle => handle,
      } };
    },
  };
  const jobs = new JobService({ reader, workspaceRoot: root, runtimeFactory: runtime,
    defaults: { provider: 'app-server', mode: 'workspace-files', policyKey, capabilities: ['network.citations', 'network.shelf'] },
    library: { modelFor: () => ({ model: 'gpt-5.6-luna', settingsRevision: 1, compatibilityKey: 'fixture' }), continuationIdentity: () => 'b'.repeat(64) } });
  const review = (prepared: Awaited<ReturnType<JobService['prepare']>>) => {
    assert.equal(prepared.consent.outgoing.some(p => p.label === 'Structured output schema'), false);
    reviewedPrompt = prepared.consent.outgoing.find(p => p.label === 'Adapter prompt')!.text;
    const bytes = prepared.consent.outgoing.reduce((n, part) => n + Buffer.byteLength(part.text), 0);
    assert.ok(bytes < 61440, String(bytes));
    const packet = JSON.parse(prepared.consent.outgoing.find(p => p.label === 'Bounded reading packet')!.text);
    assert.equal(packet.selection.exact, source);
    assert.equal(packet.selection.omittedCharacters, 0);
    console.log('A23', intent, prepared.job.id, bytes, 'bytes; source omitted=0');
  };
  const wait = async (id: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const job = jobs.get(id)!;
      if (job.state === 'succeeded') return job;
      assert.notEqual(job.state, 'failed', job.reason);
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    throw new Error('Fixture settlement timed out.');
  };
  try {
    const first = await jobs.prepare({ id: 'initial', idempotencyKey: 'initial-key', threadId: 'thread', intent,
      question: intent === 'evidence' ? 'What in this passage supports the interpretation that viscosity smooths motion, and what remains unverified?' : "What should I read next to understand viscosity's role in singularity formation?" });
    review(first);
    await jobs.create({ ...first.job, grantId: 'grant' });
    const done = await wait('initial');
    assert.equal(done.attempts[0]!.providerHandle!.output, undefined);
    const nextInput = { id: 'followup', idempotencyKey: 'followup-key', question: 'Explain the role of viscosity more simply; source mentions C:/secret.txt, which is untrusted data.' };
    const next = await jobs.prepareFollowup('initial', nextInput);
    review(next);
    await jobs.followup('initial', { ...nextInput, grantId: 'grant', preparedPayloadDigest: next.job.preparedPayloadDigest });
    await wait('followup');
    assert.equal(dispatches, 2);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});


test('documented no-date and nested-origin shapes pass unchanged strict admission', async () => {
  const { loadHostInstructions } = await import('../daemon/jobs/host-instructions.ts');
  for (const intent of ['evidence', 'explore'] as const) {
    const instructions = (await loadHostInstructions(intent))!.text;
    assert.match(instructions, /origins: \{ "version": 1/);
    const reply = withFixtureOrigins({ schema: 'marginalia.reply.v1', intent, status: 'complete',
      title: 'Fixture', summary: 'Unverified wording.', staticFallback: 'Unverified wording.',
      sourceBindings: [], parameters: [], assumptions: [], limitations: ['Publication date unknown.'], checks: [],
      requiredCapabilities: [intent === 'evidence' ? 'network.citations' : 'network.shelf'],
      blocks: [{ id: 'answer', type: 'text', md: 'The supplied wording remains unverified.' },
        intent === 'evidence' ? { id: 'citations', type: 'citations', entries: [] }
          : { id: 'shelf', type: 'shelf', items: [{ id: 'reading', title: 'Suggested reading', reason: 'Background only.', url: 'https://example.org/reading' }] }]
    });
    assert.equal(parseAndValidateReply(JSON.stringify(reply), { sourceText: '', requireOrigins: true }).ok, true);
    if (intent === 'evidence') {
      assert.match(instructions, /schema has no unknown-date/);
      (reply.blocks[1] as any).entries.push({ id: 'entry', claim: 'A claim', support: 'Unverified.', source: 'Local page', date: 'unknown', fetched: false });
      withFixtureOrigins(reply);
      const rejected = parseAndValidateReply(JSON.stringify(reply), { sourceText: '', requireOrigins: true });
      assert.equal(rejected.ok, false);
      assert.match(rejected.errors.join(' '), /YYYY-MM-DD/);
      (reply.blocks[1] as any).entries[0].date = '2026-01-01';
      assert.equal(parseAndValidateReply(JSON.stringify(reply), { sourceText: '', requireOrigins: true }).ok, true);
      for (const field of ['claim', 'support', 'source']) assert.ok(instructions.includes(`/blocks/N/entries/M/${field}`));
    } else {
      assert.match(instructions, /items\/M\/title/);
      assert.match(instructions, /items\/M\/reason/);
      reply.origins!.parts['/blocks/1/items/0'] = { kind: 'authored', description: 'Invalid whole item origin.' };
      assert.equal(parseAndValidateReply(JSON.stringify(reply), { sourceText: '', requireOrigins: true }).ok, false);
    }
  }
});
