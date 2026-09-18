import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../daemon/server.ts';
import { createAuthorizedRuntime } from '../daemon/reader-authorized-runtime.ts';
import { createDedicatedHostEvidenceSource } from '../daemon/consent/evidence-host.ts';
import { fileIdentity, executableDigest, recordLaunch } from '../daemon/providers/launch-facts.ts';
import { AppServerRunner } from '../daemon/providers/app-server.ts';
import { providerEnvironment } from '../daemon/providers/preflight.ts';
import type { RpcTransport } from '../daemon/providers/stdio.ts';
import type { ProviderAudit, ProviderHooks, ProviderRequest } from '../contracts/job-runner.ts';
import type { StartJobInput } from '../contracts/jobs.ts';
import { keepMutation, scriptedReply } from './journey-harness.ts';

const oldVariables = ['MARGINALIA_AUTHORIZED_RUNTIME_MODULE', 'MARGINALIA_READER_AUTHORIZED_UNCONFINED'] as const;
const reply = { ...scriptedReply(), intent: 'define' };

class FakeTransport implements RpcTransport {
  calls: string[] = [];
  schemas: unknown[] = [];
  disconnects: (() => void)[] = [];
  turns: { id: string; status: string }[] = [];
  home: string;
  ordinary: boolean;
  constructor(home: string, ordinary = false) { this.home = home; this.ordinary = ordinary; }
  prepareRequest(method: string, params?: unknown) {
    let used = false;
    return { id: 1, generation: 'fake-d2', sha256: createHash('sha256').update((JSON.stringify({ id: 1, method, params }) + '\n')).digest('hex'),
      send: (finalize?: () => undefined) => {
        if (used) throw new Error('already sent'); used = true; finalize?.();
        return this.request(method, params);
      } };
  }
  async request(method: string, _params?: unknown): Promise<Record<string, unknown>> {
    this.calls.push(method);
    if (method === 'initialize') return { codexHome: this.home };
    if (method === 'account/read') return { account: { type: 'fixture' } };
    if (method === 'config/read') return { config: this.ordinary ? {
      mcp_servers: { readerTool: { enabled: true } }, skills: { config: [{ path: '/reader/skill', enabled: true }] },
      features: { plugins: true }, developer_instructions: 'Reader preferences',
    } : {}, layers: [] };
    if (method === 'configRequirements/read') return { requirements: null };
    if (method === 'thread/start' || method === 'thread/resume') {
      if (this.ordinary) {
        const params = _params as Record<string, unknown>;
        assert.deepEqual(params.config, {}); assert.equal(params.approvalPolicy, undefined); assert.equal(params.sandbox, undefined);
      }
      return { thread: { id: 'fake-thread' } };
    }
    if (method === 'turn/start') {
      this.schemas.push((_params as Record<string, unknown>).outputSchema);
      if (this.ordinary) {
        const params = _params as Record<string, unknown>;
        assert.equal(params.approvalPolicy, undefined); assert.equal(params.sandboxPolicy, undefined);
      }
      const turn = { id: `turn-${this.turns.length + 1}`, status: 'completed' };
      this.turns.unshift(turn); return { turn };
    }
    if (method === 'thread/turns/list') return { data: this.turns };
    if (method === 'thread/items/list') return { data: [{ turnId: this.turns[0].id,
      item: { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ replyJson: JSON.stringify(reply) }) } }] };
    return { data: [] };
  }
  notify() {}
  onNotification() { return () => {}; }
  onDisconnect(listener: () => void) { this.disconnects.push(listener); return () => {}; }
  close() { this.disconnects.forEach(listener => listener()); }
}

for (const scenario of ['stock', 'no-env', 'old-variables', 'invalid-executable', 'invalid-home', 'excluded', 'denied'] as const) {
  test(`D2 configured stock factory with fake transport: ${scenario}`, async t => {
    const keys = [...oldVariables, 'MARGINALIA_CODEX_EXECUTABLE', 'MARGINALIA_CODEX_HOME'];
    const saved = keys.map(key => process.env[key]);
    t.after(() => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }));
    const root = await mkdtemp(join(tmpdir(), 'readiness-d2-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const executable = join(root, process.platform === 'win32' ? 'codex.exe' : 'codex'), home = join(root, scenario === 'no-env' ? '.codex' : 'home');
    await writeFile(executable, 'Fixture bytes. This file is never executed.'); await mkdir(home);
    for (const key of oldVariables) delete process.env[key];
    if (scenario === 'old-variables') {
      process.env.MARGINALIA_AUTHORIZED_RUNTIME_MODULE = join(root, 'must-not-load.mjs');
      process.env.MARGINALIA_READER_AUTHORIZED_UNCONFINED = 'not-an-acknowledgement';
    }
    process.env.MARGINALIA_CODEX_EXECUTABLE = scenario === 'invalid-executable' ? join(root, 'missing.exe') : executable;
    process.env.MARGINALIA_CODEX_HOME = scenario === 'invalid-home' ? executable : home;
    const transports: FakeTransport[] = [];
    const server = await startServer({ database: ':memory:', port: 0, jobWorkspaceRoot: join(root, 'jobs'),
      runtimeFactoryBuilder: async input => createAuthorizedRuntime({ ...input, dataDir: root }, {
        ...(scenario === 'no-env' ? { discovery: { env: { PATH: root, CODEX_HOME: join(root, 'ignored-agent-home') }, userHome: root } } : {}),
        launch: async (provider, options) => {
          assert.equal(options.homeMode, scenario === 'no-env' ? 'ordinary' : undefined);
          if (scenario === 'no-env') {
            assert.deepEqual(options.configOverrides, {});
            const source = { PATH: root, CODEX_HOME: 'managed-home', OPENAI_API_KEY: 'synthetic-api-value',
              READER_TOOL_KEY: 'synthetic-tool-value', HTTPS_PROXY: 'http://proxy.example.test' };
            const inherited = providerEnvironment(options.codexHome, source, options.homeMode);
            assert.equal(inherited.READER_TOOL_KEY, source.READER_TOOL_KEY);
            assert.equal(inherited.OPENAI_API_KEY, source.OPENAI_API_KEY);
            assert.equal(inherited.HTTPS_PROXY, source.HTTPS_PROXY);
            assert.equal(inherited.CODEX_HOME, home);
          }
          const rpc = new FakeTransport(home, scenario === 'no-env'); transports.push(rpc);
          const file = fileIdentity(executable);
          recordLaunch(rpc, { provider, executable: file, executableSha256: await executableDigest(file),
            version: 'codex-cli 0.153.4', workspace: options.workspace, codexHome: home,
            inheritedEnvironmentKeys: [], environmentValueDigests: {}, windowsKeyCasingReviewed: true, observedAt: new Date().toISOString() });
          return rpc;
        },
      }) });
    t.after(() => server.close());
    const paired = await fetch(server.origin + '/pair', { method: 'POST', headers: { Origin: server.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: server.challenge }) });
    const { token } = await paired.json() as { token: string };
    const headers = { Origin: server.origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const availabilityResponse = await fetch(server.origin + '/api/jobs', { headers });
    const availability = await availabilityResponse.json() as { available: boolean; unavailableReason?: string; unverified: string[]; disclosureVersion: string };
    if (scenario.startsWith('invalid')) {
      assert.equal(availability.available, false); assert.match(availability.unavailableReason!, /valid Codex executable.*home directory/);
      const refused = await fetch(server.origin + '/api/jobs', { method: 'POST', headers, body: '{}' });
      assert.equal(refused.status, 503); assert.equal(transports.length, 0); return;
    }
    assert.equal(availability.available, true);
    assert.deepEqual(availability.unverified, [...createDedicatedHostEvidenceSource().readiness().reasons,
      ...(scenario === 'no-env' ? ['Marginalia uses your own Codex setup, including its settings and tools.'] : [])]);
    assert.match(availability.disclosureVersion, /^runtime-d2-v2:/);
    server.store.apply(keepMutation('thread-d2', 'keep-d2'));
    const preparedResponse = await fetch(server.origin + '/api/jobs/prepare', { method: 'POST', headers,
      body: JSON.stringify({ id: 'job-d2', idempotencyKey: 'key-d2', threadId: 'thread-d2', intent: 'define', question: 'Explain.' }) });
    assert.equal(preparedResponse.status, 200);
    const prepared = await preparedResponse.json() as { job: StartJobInput; unverified: string[]; disclosureVersion: string };
    assert.deepEqual(prepared.unverified, availability.unverified); assert.equal(prepared.disclosureVersion, availability.disclosureVersion);
    const review = await server.jobs.prepare({ id: 'job-d2', idempotencyKey: 'key-d2', threadId: 'thread-d2', intent: 'define', question: 'Explain.' });
    const preview = server.consent.prepare(review.consent);
    const grant = server.consent.decide({ previewId: preview.id, expectedRevision: preview.revision, choice: scenario === 'denied' ? 'never-site' : 'this-time' },
      { surface: 'localhost-settings', pairingId: token, origin: server.origin });
    if (scenario === 'excluded') server.consent.setExclusion('https://example.org', true);
    const created = await fetch(server.origin + '/api/jobs', { method: 'POST', headers, body: JSON.stringify({ ...prepared.job, grantId: grant.id }) });
    assert.equal(created.status, 202);
    const deadline = Date.now() + 5000;
    while (!['succeeded', 'failed', 'outcome_unknown'].includes(server.jobs.get('job-d2')!.state) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const job = server.jobs.get('job-d2')!;
    if (scenario === 'excluded' || scenario === 'denied') {
      assert.equal(job.state, 'failed'); assert.equal(transports.length, 0);
    } else {
      assert.equal(job.state, 'succeeded', job.reason); assert.ok(job.replyVersionId);
      assert.equal(server.store.reply(job.replyVersionId!)!.reply.title, reply.title);
      assert.equal(job.attempts[0]!.providerHandle!.output, JSON.stringify({ replyJson: JSON.stringify(reply) }));
      const schema = transports[0]!.schemas[0] as { properties: { replyJson: { type: string } }; additionalProperties: boolean };
      assert.equal(schema.properties.replyJson.type, 'string'); assert.equal(schema.additionalProperties, false);
      assert.equal(transports.flatMap(rpc => rpc.calls).filter(method => method === 'turn/start').length, 1);
    }
  });
}

test('D2 production entry uses the stock factory and keeps solver transport independent of old environment switches', async () => {
  const main = await readFile(new URL('../daemon/main.ts', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../daemon/reader-authorized-runtime.ts', import.meta.url), 'utf8');
  for (const variable of oldVariables) { assert.ok(!main.includes(variable)); assert.ok(!runtime.includes(variable)); }
  assert.match(main, /createAuthorizedRuntime\(\{ \.\.\.input/);
  assert.match(main, /const solverTransport = runtimeIdentity \? createLazySolverTransport/);
});

test('D2 resident continuation skips recovery veto, while restarted unknown state never replays', async () => {
  const rpc = new FakeTransport('/fixture-home'); let recoveries = 0;
  const hooks: ProviderHooks = {
    checkpoint: async handle => handle, validateOutput: async () => true,
    authorize: async request => ({ policyKey: request.policyKey, workspace: request.workspace,
      thread: { cwd: request.workspace, approvalPolicy: 'never' }, turn: { cwd: request.workspace, approvalPolicy: 'never' }, mcp: {} }),
    authorizeSend: async () => {}, finalizeSend: (_request, handle) => ({ ...handle, revision: 1 }),
    verifyThread: async () => {}, authorizeRecovery: async () => { recoveries++; throw new Error('recovery evidence unavailable'); },
  };
  const audit = { workspace: '/fixture-workspace', codexHome: '/fixture-home' } as ProviderAudit;
  const request: ProviderRequest = { jobId: 'first', workspace: audit.workspace, policyKey: 'fixture', model: 'fixture',
    mode: 'structured-final', outputSchema: {}, prompt: 'fixture' };
  const runner = new AppServerRunner(rpc, audit, hooks);
  const first = await runner.start(request); assert.equal(first.state, 'completed');
  const second = await runner.resume(first, { ...request, jobId: 'second' });
  assert.equal(second.state, 'completed'); assert.equal(recoveries, 0);
  const restart = new AppServerRunner(rpc, audit, hooks);
  await assert.rejects(restart.resume({ ...second, state: 'outcome_unknown' }, { ...request, jobId: 'third' }), /recovery evidence unavailable/);
  assert.equal(recoveries, 1); assert.equal(rpc.calls.filter(method => method === 'turn/start').length, 2);
  rpc.close();
  await assert.rejects(runner.resume(second, { ...request, jobId: 'fourth' }), /recovery evidence unavailable/);
  assert.equal(rpc.calls.filter(method => method === 'turn/start').length, 2);
});
