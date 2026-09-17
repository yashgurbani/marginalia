import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { ProviderNotSentError } from '../contracts/job-runner.ts';
import { formatMcpPrompt } from '../daemon/providers/prompt.ts';
import { AppServerRunner } from '../daemon/providers/app-server.ts';
import { McpServerRunner, initializeMcp } from '../daemon/providers/mcp-server.ts';
import { assertSeparateHome, assertVersion, pages, providerEnvironment } from '../daemon/providers/preflight.ts';
import { authorizePolicy, policyFingerprint } from '../daemon/providers/policy-gate.ts';
import { createCodexPolicy } from '../daemon/codex-policy.ts';
import type { ProviderAudit, ProviderHandle, ProviderHooks, ProviderRequest } from '../contracts/job-runner.ts';
import type { RpcTransport } from '../daemon/providers/stdio.ts';

class FakeRpc implements RpcTransport {
  calls: { method: string; params: any }[] = [];
  notifications: ((method: string, params: any) => void)[] = [];
  disconnects: (() => void)[] = [];
  closed = false;
  status = 'inProgress';
  messages: any[] = [{ type: 'agentMessage', phase: 'final_answer', text: '{"ok":true}' }];
  failTurn = false;
  mcpResolve?: (result: any) => void;
  async request(method: string, params?: any, options?: { onRequestId(id: number): void }): Promise<any> {
    this.calls.push({ method, params });
    options?.onRequestId(this.calls.length);
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') { if (this.failTurn) throw new Error('disconnect'); return { turn: { id: 'turn-1', status: this.status } }; }
    if (method === 'thread/turns/list') return { data: [{ id: 'turn-1', status: this.status }], nextCursor: null };
    if (method === 'thread/items/list') return { data: this.messages.map(item => ({ turnId: 'turn-1', item })), nextCursor: null };
    if (method === 'tools/call') return new Promise(resolve => { this.mcpResolve = resolve; });
    return {};
  }
  notify(method: string, params?: unknown): void { this.calls.push({ method, params }); }
  onNotification(fn: (method: string, params: any) => void) { this.notifications.push(fn); return () => {}; }
  onDisconnect(fn: () => void) { this.disconnects.push(fn); return () => {}; }
  close() { this.closed = true; this.disconnects.forEach(fn => fn()); }
  complete() { this.status = 'completed'; this.notifications.forEach(fn => fn('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } })); }
}
const audit: ProviderAudit = { workspace: 'D:\\jobs\\one', codexHome: 'D:\\private-codex', initialize: {}, account: { account: {} }, config: {}, requirements: {}, skills: {}, mcpServers: [], features: [], completeModelToolCatalog: false };
const request: ProviderRequest = { jobId: 'job-1', workspace: 'D:\\jobs\\one', policyKey: 'policy-1', model: 'test-model', prompt: 'synthetic', mode: 'structured-final', outputSchema: { type: 'object' } };
function fixture() {
  const rpc = new FakeRpc(), saved: ProviderHandle[] = [];
  const hooks: ProviderHooks = {
    checkpoint: async h => { saved.push({ ...h }); },
    authorize: async r => ({ policyKey: r.policyKey, workspace: r.workspace,
      thread: { cwd: r.workspace, approvalPolicy: 'never', sandbox: 'read-only' },
      turn: { cwd: r.workspace, approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } },
      mcp: { cwd: r.workspace, 'approval-policy': 'never', sandbox: 'read-only' } }),
    authorizeSend: async () => {},
    authorizeRecovery: async () => {}, verifyThread: async () => {}, validateOutput: async text => JSON.parse(text).ok === true,
  };
  return { rpc, saved, hooks };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('app start persists dispatch and identifiers; final output requires completed turn and validator', async () => {
  const { rpc, saved, hooks } = fixture(), runner = new AppServerRunner(rpc, audit, hooks);
  const h = await runner.start(request);
  assert.equal(h.state, 'running'); assert.equal(h.threadId, 'thread-1'); assert.equal(h.turnId, 'turn-1'); assert.equal(h.output, undefined);
  assert.ok(saved.some(s => s.state === 'starting' && s.reason === 'turn-dispatch-pending' && s.threadId && !s.turnId));
  const turn = rpc.calls.find(c => c.method === 'turn/start')!;
  assert.deepEqual(turn.params.outputSchema, request.outputSchema); assert.equal(turn.params.cwd, request.workspace);
  rpc.complete(); await tick();
  assert.equal(saved.at(-1)?.state, 'completed'); assert.equal(saved.at(-1)?.output, '{"ok":true}');
});
test('app interrupt acknowledgment is nonterminal; tombstone fences late completion and restart', async () => {
  const { rpc, saved, hooks } = fixture(), runner = new AppServerRunner(rpc, audit, hooks);
  const h = await runner.start(request), cancelled = await runner.cancel(h);
  assert.equal(cancelled.state, 'cancel_requested'); assert.equal(cancelled.tombstone, true);
  assert.ok(rpc.calls.some(c => c.method === 'turn/interrupt' && c.params.turnId === h.turnId));
  rpc.complete(); await tick(); assert.equal(saved.at(-1)?.state, 'cancelled'); assert.equal(saved.at(-1)?.output, undefined);
  const recovered = await new AppServerRunner(rpc, audit, hooks).resume(cancelled);
  assert.equal(recovered.state, 'cancelled'); assert.equal(recovered.output, undefined);
});
test('app restart reads actual recorded turn; followup starts only after known completion', async () => {
  const { rpc, hooks } = fixture(); const h = await new AppServerRunner(rpc, audit, hooks).start(request);
  const runner = new AppServerRunner(rpc, audit, hooks);
  assert.equal((await runner.resume(h)).state, 'running');
  await assert.rejects(runner.resume(h, { ...request, jobId: 'job-2' }), /confirmed-completion/);
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
  rpc.status = 'completed'; assert.equal((await runner.resume(h)).state, 'completed');
  await runner.resume(h, { ...request, jobId: 'job-2' });
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 2);
  assert.equal(rpc.calls.filter(c => c.method === 'thread/start').length, 1);
});
test('app lost start acknowledgment never blindly retries; duplicate attempt refused', async () => {
  const { rpc, hooks } = fixture(); rpc.failTurn = true;
  const runner = new AppServerRunner(rpc, audit, hooks), h = await runner.start(request);
  assert.equal(h.state, 'outcome_unknown');
  await runner.resume(h); await assert.rejects(runner.start(request), /already-dispatched/);
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
});
test('app refusal, ambiguous missing phases and host-invalid JSON are withheld', async () => {
  for (const messages of [
    [{ type: 'agentMessage', phase: 'final_answer', text: 'I cannot help' }],
    [{ type: 'agentMessage', phase: null, text: '{"ok":true}' }, { type: 'agentMessage', phase: null, text: '{"ok":true}' }],
    [{ type: 'agentMessage', phase: 'final_answer', text: '{"ok":false}' }],
  ]) {
    const { rpc, hooks } = fixture(); rpc.status = 'completed'; rpc.messages = messages;
    const h = await new AppServerRunner(rpc, audit, hooks).start(request);
    assert.equal(h.state, 'failed'); assert.equal(h.output, undefined);
  }
  const { rpc, hooks } = fixture(); rpc.status = 'completed'; rpc.messages[0].phase = null;
  assert.equal((await new AppServerRunner(rpc, audit, hooks).start(request)).state, 'completed');
});
test('denied grant, failed checkpoint or rejected returned policy prevents turn dispatch', async () => {
  for (const name of ['authorize', 'checkpoint', 'verifyThread'] as const) {
    const { rpc, hooks } = fixture(); hooks[name] = async () => { throw new Error('blocked'); };
    await new AppServerRunner(rpc, audit, hooks).start(request).catch(() => {});
    assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 0);
  }
});
test('mcp definition uses content with strict host validation, not provider schema enforcement', async () => {
  const { rpc, hooks, saved } = fixture(), runner = new McpServerRunner(rpc, audit, hooks);
  const h = await runner.start(request); assert.equal(h.state, 'running'); assert.equal(runner.capabilities.schemaEnforced, false);
  const args = rpc.calls[0].params.arguments; assert.equal(args.sandbox, 'read-only'); assert.equal(args.outputSchema, undefined);
  rpc.mcpResolve!({ structuredContent: { threadId: 'mcp-thread', content: '{"ok":true}' } }); await tick();
  assert.equal(saved.at(-1)?.output, '{"ok":true}');
  await runner.resume(saved.at(-1)!, { ...request, jobId: 'job-2' });
  assert.equal(rpc.calls.at(-1)?.params.name, 'codex-reply'); assert.equal(rpc.calls.at(-1)?.params.arguments.threadId, 'mcp-thread');
  rpc.mcpResolve!({ structuredContent: { threadId: 'mcp-thread', content: 'refused' } }); await tick(); assert.equal(saved.at(-1)?.state, 'failed');
});
test('mcp abandon is durably tombstoned before close and late output cannot revive it', async () => {
  const { rpc, hooks, saved } = fixture(), runner = new McpServerRunner(rpc, audit, hooks);
  const h = await runner.start(request), cancelled = await runner.cancel(h);
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.tombstone, true); assert.equal(rpc.closed, true);
  rpc.mcpResolve!({ structuredContent: { threadId: 'late', content: '{"ok":true}' } }); await tick();
  assert.equal(saved.at(-1)?.state, 'cancelled'); assert.equal(saved.at(-1)?.output, undefined);
});
test('mcp restart has explicit unknown outcome without invoking codex-reply', async () => {
  const { rpc, hooks } = fixture(), h = await new McpServerRunner(rpc, audit, hooks).start(request);
  const freshRpc = new FakeRpc(), runner = new McpServerRunner(freshRpc, audit, hooks);
  assert.equal((await runner.resume(h)).state, 'outcome_unknown'); assert.equal((await runner.inspect(h)).state, 'outcome_unknown');
  await assert.rejects(runner.resume(h, { ...request, jobId: 'job-2' }), /unsupported:mcp-continuation-after-process-restart/);
  assert.equal(freshRpc.calls.length, 0);
});
test('policy gate rejects missing evidence and separate-home/pin checks fail closed', () => {
  const policy = createCodexPolicy({ version: '0.153.4', platform: 'win32', adapter: 'app-server', operation: 'definition', model: request.model,
    workspace: request.workspace, codexHome: 'D:\\private-codex', auditId: 'test', outputSchema: { type: 'object' } });
  const policyKey = policyFingerprint(policy);
  const authorization: Parameters<typeof authorizePolicy>[4] = {
    id: 'authorization', jobId: 'durable-job', attemptId: request.jobId, grantId: 'grant', grantRevision: 1,
    sitePermissionEpoch: 0, site: 'https://example.test', scope: 'cloud-inference', recipient: 'openai-codex',
    provider: 'app-server', policyKey, bindingDigest: '0'.repeat(64), permissionFingerprint: '1'.repeat(64),
    egressEventId: 'egress', dispatchedAt: '2026-09-17T00:00:00.000Z',
  };
  assert.throws(() => authorizePolicy(policy, { ...request, policyKey }, audit, {}, authorization, 'dispatch'), /policy-evidence-rejected/);
  assert.throws(() => assertVersion('codex-cli 0.153.3'), /version/);
  const workspace = resolve('jobs', 'one');
  assert.throws(() => assertSeparateHome(join(workspace, 'home'), workspace), /separate/);
  const env = providerEnvironment('D:\\private', { PATH: 'safe', OPENAI_API_KEY: 'secret', CODEX_HOME: 'normal', HTTP_PROXY: 'unsafe' });
  assert.deepEqual(env, { CODEX_HOME: 'D:\\private', PATH: 'safe' });
});
test('inventory pagination is complete and repeated cursor rejects', async () => {
  const rpc = new FakeRpc(); let calls = 0;
  rpc.request = async () => ++calls === 1 ? { data: [1], nextCursor: 'next' } : { data: [2], nextCursor: null };
  assert.deepEqual(await pages(rpc, 'list'), [1, 2]);
  rpc.request = async () => ({ data: [], nextCursor: 'loop' });
  await assert.rejects(pages(rpc, 'list'), /pagination-loop/);
});
test('mcp initialize verifies pinned version and both distinct tools', async () => {
  const rpc = new FakeRpc(); rpc.request = async method => method === 'initialize'
    ? { serverInfo: { version: '0.153.4' } } : { tools: [{ name: 'codex' }, { name: 'codex-reply' }] };
  assert.equal((await initializeMcp(rpc)).length, 2);
});

test('cancel arriving during asynchronous output validation fences both adapters', async () => {
  for (const kind of ['app', 'mcp']) {
    const { rpc, hooks, saved } = fixture(); let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    hooks.validateOutput = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return true; };
    const runner = kind === 'app' ? new AppServerRunner(rpc, audit, hooks) : new McpServerRunner(rpc, audit, hooks);
    const h = await runner.start(request);
    if (kind === 'app') rpc.complete(); else rpc.mcpResolve!({ structuredContent: { threadId: 'thread-1', content: '{"ok":true}' } });
    await waiting; const cancel = runner.cancel(h); release(); await cancel; await tick();
    assert.equal(saved.at(-1)?.state, 'cancelled'); assert.equal(saved.at(-1)?.output, undefined);
    assert.equal(saved.some(x => x.state === 'completed'), false);
  }
});
test('cancel after terminal completion leaves completed result unchanged', async () => {
  const { rpc, hooks } = fixture(); rpc.status = 'completed';
  const runner = new AppServerRunner(rpc, audit, hooks), h = await runner.start(request);
  assert.deepEqual(await runner.cancel(h), h);
  assert.equal(rpc.calls.some(x => x.method === 'turn/interrupt'), false);
});
test('app followup rejects stale parent when another provider turn is active', async () => {
  const { rpc, hooks } = fixture(); rpc.status = 'completed';
  const runner = new AppServerRunner(rpc, audit, hooks), h = await runner.start(request);
  const original = rpc.request.bind(rpc);
  rpc.request = async (method, params) => method === 'thread/turns/list' ? { data: [{ id: 'newer', status: 'inProgress' }, { id: h.turnId, status: 'completed' }], nextCursor: null } : original(method, params);
  await assert.rejects(runner.resume(h, { ...request, jobId: 'next' }), /thread-advanced-or-active/);
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
});

/** Model the T06 seam: canonical revisions, then immutable terminal parent state. */
async function terminalParent(mode: ProviderRequest['mode'] = 'structured-final', restarted = false) {
  const f = fixture(), durable = new Map<string, ProviderHandle>();
  let sealed = false, parentWrites = 0;
  f.hooks.checkpoint = async h => {
    if (sealed && h.jobId === request.jobId) { parentWrites++; throw new Error('terminal-parent-checkpoint'); }
    const prior = durable.get(h.jobId);
    if (prior && h.revision !== prior.revision) throw new Error('stale-checkpoint');
    const next = { ...h, revision: (prior?.revision ?? 0) + 1 };
    durable.set(h.jobId, structuredClone(next)); f.saved.push(structuredClone(next));
    return structuredClone(next);
  };
  f.rpc.status = 'completed';
  let runner = new AppServerRunner(f.rpc, audit, f.hooks);
  const parent = await runner.start({ ...request, mode });
  assert.equal(parent.state, 'completed');
  sealed = true;
  const original = f.rpc.request.bind(f.rpc);
  f.rpc.request = async (method, params, options) => {
    if (method === 'turn/start') {
      f.rpc.calls.push({ method, params });
      return { turn: { id: 'turn-2', status: 'inProgress' } };
    }
    return original(method, params, options);
  };
  f.hooks.validateOutput = async () => { throw new Error('terminal-parent-output-must-not-be-revalidated'); };
  if (restarted) runner = new AppServerRunner(f.rpc, audit, f.hooks);
  return { ...f, runner, parent, durable, parentWrites: () => parentWrites };
}

test('F1 compatible followup never checkpoints a terminal parent, including after adapter restart', async t => {
  for (const mode of ['structured-final', 'workspace-files'] as const) for (const restarted of [false, true]) {
    await t.test(`${mode}, restarted=${restarted}`, async () => {
      const f = await terminalParent(mode, restarted), original = structuredClone(f.parent);
      const next = await f.runner.resume(f.parent, { ...request, mode, jobId: 'successor' });
      assert.equal(next.jobId, 'successor'); assert.equal(next.turnId, 'turn-2'); assert.equal(next.state, 'running');
      assert.equal(f.parentWrites(), 0); assert.deepEqual(f.durable.get(request.jobId), original);
      assert.equal(f.rpc.calls.filter(c => c.method === 'thread/start').length, 1);
      const calls = f.rpc.calls.map(c => c.method), load = calls.indexOf('thread/resume');
      assert.ok(calls.indexOf('thread/read') < load && calls.indexOf('thread/turns/list') < load);
      assert.ok(f.rpc.calls.some(c => c.method === 'thread/turns/list' && c.params.sortDirection === 'desc'));
      assert.equal(f.saved.filter(h => h.jobId === 'successor')[0].revision, 1);
      await assert.rejects(f.runner.resume(f.parent, { ...request, mode, jobId: 'other' }), /thread-advanced/);
      assert.equal(f.rpc.calls.filter(c => c.method === 'turn/start').length, 2);
      assert.equal(f.parentWrites(), 0);
    });
  }
});

test('F1 rejected predecessor verification leaves terminal history unchanged and sends no followup', async t => {
  for (const scenario of ['missing-turn', 'nonterminal-turn', 'read-failed', 'resume-failed', 'policy-rejected', 'newer-turn', 'active-turn'] as const) {
    await t.test(scenario, async () => {
      const f = await terminalParent(), original = f.rpc.request.bind(f.rpc);
      f.rpc.request = async (method, params, options) => {
        if (scenario === 'read-failed' && method === 'thread/read') throw new Error('read-failed');
        if (scenario === 'resume-failed' && method === 'thread/resume') throw new Error('resume-failed');
        if (method === 'thread/turns/list') {
          if (scenario === 'missing-turn') return { data: [], nextCursor: null };
          if (scenario === 'nonterminal-turn') return { data: [{ id: f.parent.turnId, status: 'inProgress' }], nextCursor: null };
          if (params.sortDirection === 'desc' && scenario === 'newer-turn') return { data: [{ id: 'newer', status: 'completed' }, { id: f.parent.turnId, status: 'completed' }], nextCursor: null };
          if (params.sortDirection === 'desc' && scenario === 'active-turn') return { data: [{ id: f.parent.turnId, status: 'completed' }, { id: 'active', status: 'inProgress' }], nextCursor: null };
        }
        return original(method, params, options);
      };
      if (scenario === 'policy-rejected') f.hooks.verifyThread = async () => { throw new Error('policy-rejected'); };
      await assert.rejects(f.runner.resume(f.parent, { ...request, jobId: 'successor' }),
        /recorded-turn-not-found|confirmed-completion|read-failed|resume-failed|policy-rejected|thread-advanced-or-active/);
      assert.equal(f.parentWrites(), 0); assert.deepEqual(f.durable.get(request.jobId), f.parent);
      assert.equal(f.rpc.calls.filter(c => c.method === 'turn/start').length, 1);
      assert.equal(f.durable.has('successor'), false);
    });
  }
});

test('F1 successor lease rejection and predecessor identity/tombstone fences still prevent dispatch', async () => {
  const f = await terminalParent();
  await assert.rejects(f.runner.resume({ ...f.parent, turnId: 'other-turn' }, { ...request, jobId: 'next' }), /handle-binding-mismatch/);
  f.hooks.checkpoint = async () => { throw new Error('successor-lease-rejected'); };
  await assert.rejects(f.runner.resume(f.parent, { ...request, jobId: 'next' }), /successor-lease-rejected/);
  await assert.rejects(f.runner.resume({ ...f.parent, revision: f.parent.revision! + 1, tombstone: true }, { ...request, jobId: 'next' }), /confirmed-completion/);
  assert.equal(f.parentWrites(), 0);
  assert.equal(f.rpc.calls.filter(c => c.method === 'turn/start').length, 1);
});

test('F6 initial authorization failures are typed not-sent errors without checkpoint or inference', async t => {
  for (const kind of ['app-server', 'mcp-server'] as const) for (const invalidPolicy of [false, true]) {
    await t.test(`${kind}, invalidPolicy=${invalidPolicy}`, async () => {
      const f = fixture(), authorize = f.hooks.authorize, denied = new Error('denied');
      f.hooks.authorize = async (...args) => {
        if (!invalidPolicy) throw denied;
        return { ...await authorize(...args), policyKey: 'wrong' };
      };
      const runner = kind === 'app-server' ? new AppServerRunner(f.rpc, audit, f.hooks) : new McpServerRunner(f.rpc, audit, f.hooks);
      await assert.rejects(runner.start(request), (error: unknown) => {
        assert.ok(error instanceof ProviderNotSentError);
        assert.equal(error.provider, kind); assert.equal(error.attemptId, request.jobId);
        assert.equal(error.code, 'provider-not-sent');
        if (!invalidPolicy) assert.equal(error.cause, denied);
        return true;
      });
      assert.equal(f.saved.length, 0); assert.equal(f.rpc.calls.length, 0);
    });
  }
});

test('F6 followup authorization rejection is bound to the fresh successor, not the completed parent', async t => {
  for (const kind of ['app-server', 'mcp-server'] as const) await t.test(kind, async () => {
    const f = fixture(); f.rpc.status = 'completed';
    const runner = kind === 'app-server' ? new AppServerRunner(f.rpc, audit, f.hooks) : new McpServerRunner(f.rpc, audit, f.hooks);
    let parent = await runner.start(request);
    if (kind === 'mcp-server') {
      f.rpc.mcpResolve!({ structuredContent: { threadId: 'mcp-thread', content: '{"ok":true}' } }); await tick();
      parent = f.saved.at(-1)!;
    }
    const count = f.saved.length;
    f.hooks.authorize = async () => { throw new Error('revoked'); };
    await assert.rejects(runner.resume(parent, { ...request, jobId: 'next' }), (error: unknown) => {
      assert.ok(error instanceof ProviderNotSentError); assert.equal(error.attemptId, 'next'); assert.equal(error.provider, kind); return true;
    });
    assert.equal(f.saved.length, count);
    assert.equal(f.rpc.calls.filter(c => c.method === 'turn/start' || c.method === 'tools/call').length, 1);
  });
});

test('F6 checkpoint conflicts and launched uncertainty are never relabelled not-sent', async () => {
  for (const kind of ['app-server', 'mcp-server'] as const) {
    const f = fixture(), conflict = new Error('duplicate-durable-attempt');
    f.hooks.checkpoint = async () => { throw conflict; };
    const runner = kind === 'app-server' ? new AppServerRunner(f.rpc, audit, f.hooks) : new McpServerRunner(f.rpc, audit, f.hooks);
    await assert.rejects(runner.start(request), error => error === conflict && !(error instanceof ProviderNotSentError));
    assert.equal(f.rpc.calls.length, 0);
  }
  const f = fixture(); f.rpc.failTurn = true;
  const runner = new AppServerRunner(f.rpc, audit, f.hooks), h = await runner.start(request);
  assert.equal(h.state, 'outcome_unknown');
  await assert.rejects(runner.start(request), error => error instanceof Error && !(error instanceof ProviderNotSentError));
  assert.equal(f.rpc.calls.filter(c => c.method === 'turn/start').length, 1);
});

test('final authorizeSend remains after checkpoint and blocks both adapters before inference', async () => {
  for (const kind of ['app-server', 'mcp-server'] as const) {
    const f = fixture(); let checked = false;
    f.hooks.authorizeSend = async (sent, handle) => {
      checked = true; assert.equal(sent.jobId, handle.jobId);
      assert.ok(f.saved.some(h => h.jobId === sent.jobId));
      assert.equal(f.rpc.calls.some(c => c.method === 'turn/start' || c.method === 'tools/call'), false);
      throw new Error('revoked-at-final-fence');
    };
    const runner = kind === 'app-server' ? new AppServerRunner(f.rpc, audit, f.hooks) : new McpServerRunner(f.rpc, audit, f.hooks);
    assert.equal((await runner.start(request)).state, 'failed'); assert.equal(checked, true);
    assert.equal(f.rpc.calls.some(c => c.method === 'turn/start' || c.method === 'tools/call'), false);
  }
});

test('MCP retains canonical formatter and request-id cancellation without claiming provider stop', async () => {
  for (const mode of ['structured-final', 'workspace-files'] as const) {
    const f = fixture(), runner = new McpServerRunner(f.rpc, audit, f.hooks);
    const sent = { ...request, mode }, h = await runner.start(sent);
    assert.equal(f.rpc.calls[0].params.arguments.prompt, formatMcpPrompt(sent));
    const cancelled = await runner.cancel(h);
    assert.equal(cancelled.reason, 'abandoned-process-stop-unconfirmed');
    assert.equal(f.rpc.calls.at(-1)?.method, 'notifications/cancelled');
    assert.equal(f.rpc.calls.at(-1)?.params.requestId, 1); assert.equal(f.rpc.closed, true);
  }
});

test('F1 verifies paginated recorded/latest turns without rewriting the parent', async () => {
  const f = await terminalParent(), original = f.rpc.request.bind(f.rpc), pagesSeen: string[] = [];
  f.rpc.request = async (method, params, options) => {
    if (method !== 'thread/turns/list') return original(method, params, options);
    const latest = params.sortDirection === 'desc'; pagesSeen.push(`${latest ? 'latest' : 'recorded'}:${params.cursor ?? 'first'}`);
    if (!params.cursor) return { data: latest ? [{ id: f.parent.turnId, status: 'completed' }] : [], nextCursor: 'second' };
    return { data: latest ? [] : [{ id: f.parent.turnId, status: 'completed' }], nextCursor: null };
  };
  assert.equal((await f.runner.resume(f.parent, { ...request, jobId: 'next' })).state, 'running');
  assert.deepEqual(pagesSeen, ['recorded:first', 'recorded:second', 'latest:first', 'latest:second']);
  assert.equal(f.parentWrites(), 0);
});

test('F1 a durable tombstone arriving during predecessor verification prevents continuation', async () => {
  const f = await terminalParent(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  f.hooks.verifyThread = async () => { enter(); await new Promise<void>(resolve => { release = resolve; }); };
  const pending = f.runner.resume(f.parent, { ...request, jobId: 'next' });
  await entered;
  const tombstone: ProviderHandle = { ...f.parent, revision: f.parent.revision! + 1, state: 'cancelled', tombstone: true, output: undefined };
  f.durable.set(tombstone.jobId, structuredClone(tombstone));
  const cancel = f.runner.cancel(tombstone); release();
  await assert.rejects(pending, /confirmed-completion/); assert.equal((await cancel).tombstone, true);
  assert.equal(f.parentWrites(), 0); assert.equal(f.durable.has('next'), false);
  assert.equal(f.rpc.calls.filter(c => c.method === 'turn/start').length, 1);
});

test('F2 a generic checkpoint rejection is not treated as proof of a durable cancellation fence', async () => {
  for (const kind of ['app-server', 'mcp-server'] as const) {
    const f = fixture(), runner = kind === 'app-server' ? new AppServerRunner(f.rpc, audit, f.hooks) : new McpServerRunner(f.rpc, audit, f.hooks);
    const h = await runner.start(request), rejected = new Error('checkpoint-unavailable');
    f.hooks.checkpoint = async () => { throw rejected; };
    await assert.rejects(runner.cancel(h), error => error === rejected);
    assert.equal(f.rpc.calls.some(c => c.method === 'turn/interrupt' || c.method === 'notifications/cancelled'), false);
    assert.equal(f.rpc.closed, false);
  }
});
