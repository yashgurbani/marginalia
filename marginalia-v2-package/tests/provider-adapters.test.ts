import test from 'node:test';
import assert from 'node:assert/strict';
import { AppServerRunner } from '../daemon/providers/app-server.ts';
import { McpServerRunner, initializeMcp } from '../daemon/providers/mcp-server.ts';
import { assertSeparateHome, assertVersion, pages, providerEnvironment } from '../daemon/providers/preflight.ts';
import { authorizePolicy } from '../daemon/providers/policy-gate.ts';
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
  async request(method: string, params?: any): Promise<any> {
    this.calls.push({ method, params });
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
    authorizeRecovery: async () => {}, verifyThread: async () => {}, validateOutput: async text => JSON.parse(text).ok === true,
  };
  return { rpc, saved, hooks };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('app start persists dispatch and identifiers; final output requires completed turn and validator', async () => {
  const { rpc, saved, hooks } = fixture(), runner = new AppServerRunner(rpc, audit, hooks);
  const h = await runner.start(request);
  assert.equal(h.state, 'running'); assert.equal(h.threadId, 'thread-1'); assert.equal(h.turnId, 'turn-1'); assert.equal(h.output, undefined);
  assert.ok(saved.some(s => s.state === 'outcome_unknown' && s.threadId && !s.turnId));
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
  await assert.rejects(runner.resume(h, { ...request, jobId: 'job-2' }), /confirmed-completion/);
  assert.equal(freshRpc.calls.length, 0);
});
test('policy gate rejects missing evidence and separate-home/pin checks fail closed', () => {
  const policy = createCodexPolicy({ version: '0.153.4', platform: 'win32', operation: 'definition', model: request.model,
    workspace: request.workspace, codexHome: 'D:\\private-codex', auditId: 'test', outputSchema: { type: 'object' } });
  assert.throws(() => authorizePolicy(policy, { ...request, policyKey: policy.evidenceScope }, audit, {}, true), /policy-evidence-rejected/);
  assert.throws(() => assertVersion('codex-cli 0.153.3'), /version/);
  assert.throws(() => assertSeparateHome('D:\\jobs\\one\\home', request.workspace), /separate/);
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
