import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { structuredReplySchema, structuredReplyText } from '../daemon/jobs/structured-reply.ts';
import { canonicalReplyData, parseAndValidateReply, REPLY_LIMITS } from '../contracts/reply.ts';
import { growthReply, growthSourceText } from '../fixtures/growth-reply.ts';
import { buildProviderPrompt, prepareEnvelope } from '../daemon/jobs/envelope.ts';
import type { FrozenJobContext } from '../contracts/jobs.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../daemon/store.ts';
import { JobService } from '../daemon/jobs/service.ts';
import type { AuthorizedRuntimeFactory } from '../daemon/jobs/runtime.ts';
import type { ProviderHandle, ProviderRequest } from '../contracts/job-runner.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

const contract = JSON.parse(readFileSync(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8'));

test('app-server transport uses only a closed required object and string; contract is not compiled or modified', () => {
  const before = canonicalReplyData(contract);
  const schema = structuredReplySchema('app-server', contract) as any;
  assert.deepEqual(Object.keys(schema).sort(), ['additionalProperties', 'properties', 'required', 'type']);
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, Object.keys(schema.properties));
  assert.deepEqual(Object.keys(schema.properties.replyJson).sort(), ['description', 'type']);
  assert.equal(schema.properties.replyJson.type, 'string');
  assert.ok(schema.properties.replyJson.description.includes('authoring contract in the prompt'));
  assert.equal(canonicalReplyData(contract), before);
  assert.strictEqual(structuredReplySchema('mcp-server', contract), contract);
});

test('transport round-trips candidate bytes and preserves strict semantic rejection', () => {
  const text = JSON.stringify(growthReply, null, 2);
  const decoded = structuredReplyText(JSON.stringify({ replyJson: text }), 'app-server');
  assert.equal(decoded, text);
  assert.equal(parseAndValidateReply(decoded!, { sourceText: growthSourceText, requireOrigins: true }).ok, true);
  const invalid = structuredClone(growthReply);
  invalid.parameters[0]!.max = invalid.parameters[0]!.min;
  const rejected = structuredReplyText(JSON.stringify({ replyJson: JSON.stringify(invalid) }), 'app-server');
  assert.match(parseAndValidateReply(rejected!, { sourceText: growthSourceText, requireOrigins: true }).errors.join(' '), /min must be below max/);
  assert.deepEqual(JSON.parse(rejected!), invalid);
});

test('malformed envelopes, excess fields, nested encoding and size abuse cannot become accepted replies', () => {
  for (const value of [null, [], { replyJson: null }, { replyJson: {} }, { replyJson: '{}', extra: true }, { wrong: '{}' }]) {
    assert.equal(structuredReplyText(JSON.stringify(value), 'app-server'), undefined);
  }
  assert.equal(structuredReplyText('{', 'app-server'), undefined);
  assert.equal(structuredReplyText(JSON.stringify({ replyJson: 'x'.repeat(REPLY_LIMITS.bytes + 1) }), 'app-server'), undefined);
  assert.equal(structuredReplyText(' '.repeat(REPLY_LIMITS.bytes * 6 + 65), 'app-server'), undefined);
  const nested = structuredReplyText(JSON.stringify({ replyJson: JSON.stringify({ replyJson: JSON.stringify(growthReply) }) }), 'app-server');
  assert.equal(parseAndValidateReply(nested!, { sourceText: growthSourceText, requireOrigins: true }).ok, false);
});

test('completed native v1 outputs and MCP keep existing admission semantics', () => {
  const text = JSON.stringify(growthReply);
  assert.equal(structuredReplyText(text, 'app-server'), text);
  assert.equal(structuredReplyText(text, 'mcp-server'), text);
  const extra = JSON.stringify({ ...growthReply, invalidExtra: true });
  assert.equal(parseAndValidateReply(structuredReplyText(extra, 'app-server')!, { sourceText: growthSourceText }).ok, false);
});

test('reviewed schema and delivery prompt match app-server format; workspace/MCP stay native', () => {
  const context = { intent: 'define', sourceVersionId: 'source-1', outgoing: {} } as FrozenJobContext;
  const schema = structuredReplySchema('app-server', contract);
  const input = { sourceUrl: 'https://example.org/page', scope: 'cloud-inference' as const,
    recipient: 'openai-codex', provider: 'app-server' as const, model: 'test-model', mode: 'structured-final' as const,
    policyKey: 'test-policy', context, outputSchema: schema, replySchemaText: JSON.stringify(contract) };
  const prepared = prepareEnvelope(input);
  assert.equal(prepared.outgoing.find(p => p.label === 'Structured output schema')!.text, canonicalReplyData(schema));
  assert.equal(prepared.outgoing.find(p => p.label === 'Adapter prompt')!.text, buildProviderPrompt(context, 'structured-final', 'app-server', contract));
  assert.match(buildProviderPrompt(context, 'structured-final', 'app-server', contract), /replyJson/);
  assert.ok(buildProviderPrompt(context, 'structured-final', 'app-server', contract).endsWith(canonicalReplyData(contract)));
  assert.equal(buildProviderPrompt(context, 'structured-final', 'app-server', contract).split(canonicalReplyData(contract)).length, 2);
  assert.doesNotMatch(buildProviderPrompt(context, 'workspace-files', 'app-server'), /replyJson/);
  assert.doesNotMatch(buildProviderPrompt(context, 'structured-final', 'mcp-server'), /replyJson/);
  assert.notEqual(prepared.digest, prepareEnvelope({ ...input, outputSchema: contract }).digest);
});

test('Define dispatch and followup use the reviewed wrapper, preserve raw evidence and stay within 60 KiB', async () => {
  const root = await mkdtemp(join(tmpdir(), 'a18-structured-'));
  const reader = new ReaderStore(':memory:');
  const source = 'The development of a singularity would have to happen despite the presence of viscosity, which tends to smooth out motion.';
  reader.apply({ id: 'keep', kind: 'keep', threadId: 'thread', capture: {
    url: 'https://www.claymath.org/millennium/navier-stokes-equation/', title: 'Navier-Stokes', pageType: 'article',
    text: source, capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'text-v1',
  }, anchor: { exact: source, prefix: '', suffix: '', start: 0, end: source.length } });
  // Synthetic fixture only: this test performs no provider inference.
  const candidate = withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'define', status: 'complete',
    title: 'Fixture definition', summary: 'Fixture summary.', blocks: [{ id: 'meaning', type: 'text', md: 'Fixture explanation.' }],
    sourceBindings: [], parameters: [], assumptions: [], limitations: [], checks: [], staticFallback: 'Fixture explanation.' });
  const output = JSON.stringify({ replyJson: JSON.stringify(candidate) });
  const policyKey = 'a'.repeat(64);
  let reviewedSchema: unknown, reviewedPrompt: string | undefined, dispatches = 0;
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
        assert.deepEqual(request.outputSchema, reviewedSchema);
        assert.equal(request.prompt, reviewedPrompt);
        const handle: ProviderHandle = { jobId: request.jobId, provider: 'app-server', workspace: request.workspace,
          policyKey, model: request.model, mode: request.mode, state: 'starting', tombstone: false,
          providerInstanceId: 'fixture-provider', threadId: 'fixture-thread' };
        const sent = host.finalizeSend(request, handle);
        assert.equal(await host.validateOutput(output, sent, request), true);
        assert.equal(await host.validateOutput(JSON.stringify({ replyJson: '{' }), sent, request), false);
        return (await host.checkpoint({ ...sent, state: 'completed', turnId: 'fixture-turn-' + dispatches, output }))!;
      };
      return { close() {}, runner: {
        capabilities: { interrupt: 'turn-interrupt', recovery: 'thread-state', structuredFinal: true, schemaEnforced: true, liveEvents: true },
        start: send, resume: async (_previous, request) => send(request!),
        inspect: async handle => handle, cancel: async handle => handle,
      } };
    },
  };
  const jobs = new JobService({ reader, workspaceRoot: root, runtimeFactory: runtime,
    defaults: { provider: 'app-server', mode: 'structured-final', policyKey, capabilities: [] },
    library: { modelFor: () => ({ model: 'gpt-5.6-luna', settingsRevision: 1, compatibilityKey: 'fixture' }), continuationIdentity: () => 'b'.repeat(64) } });
  const review = (prepared: Awaited<ReturnType<JobService['prepare']>>) => {
    reviewedSchema = JSON.parse(prepared.consent.outgoing.find(p => p.label === 'Structured output schema')!.text);
    reviewedPrompt = prepared.consent.outgoing.find(p => p.label === 'Adapter prompt')!.text;
    const bytes = prepared.consent.outgoing.reduce((n, part) => n + Buffer.byteLength(part.text), 0);
    assert.ok(bytes < 61440, String(bytes));
    const packet = JSON.parse(prepared.consent.outgoing.find(p => p.label === 'Bounded reading packet')!.text);
    assert.equal(packet.selection.exact, source);
    assert.equal(packet.selection.omittedCharacters, 0);
    console.log('A18 Define', prepared.job.id, bytes, 'bytes; source omitted=0');
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
    const first = await jobs.prepare({ id: 'initial', idempotencyKey: 'initial-key', threadId: 'thread', intent: 'define',
      question: 'In this passage, what does viscosity mean and why does it matter to the claim about a singularity?' });
    review(first);
    await jobs.create({ ...first.job, grantId: 'grant' });
    const done = await wait('initial');
    assert.equal(done.attempts[0]!.providerHandle!.output, output);
    assert.equal(structuredReplyText(done.attempts[0]!.providerHandle!.output!, 'app-server'), JSON.stringify(candidate));
    const nextInput = { id: 'followup', idempotencyKey: 'followup-key', question: 'Explain the role of viscosity more simply.' };
    const next = await jobs.prepareFollowup('initial', nextInput);
    review(next);
    await jobs.followup('initial', { ...nextInput, grantId: 'grant', preparedPayloadDigest: next.job.preparedPayloadDigest });
    await wait('followup');
    assert.equal(dispatches, 2);
  } finally { await jobs.close(); reader.close(); await rm(root, { recursive: true, force: true }); }
});
