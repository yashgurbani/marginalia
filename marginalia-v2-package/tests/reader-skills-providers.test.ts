import test from 'node:test';
import { authoredSkillText } from '../daemon/reader-skills.ts';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ProviderNotSentError } from '../contracts/job-runner.ts';
import { formatMcpPrompt } from '../daemon/providers/prompt.ts';
import { AppServerRunner } from '../daemon/providers/app-server.ts';
import { McpServerRunner, initializeMcp } from '../daemon/providers/mcp-server.ts';
import { assertSeparateHome, assertVersion, pages, providerEnvironment } from '../daemon/providers/preflight.ts';
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
  private nextPreparedId = 1;
  prepareRequest(method: string, input?: unknown, options?: { onRequestId(id: number): void }) {
    const params = structuredClone(input), id = this.nextPreparedId++;
    let used = false;
    return { id, generation: 'synthetic-peer', sha256: createHash('sha256').update(JSON.stringify({ method, params })).digest('hex'),
      send: (finalize?: () => undefined) => {
        if (used) throw new Error('prepared-request-already-used'); used = true;
        options?.onRequestId(id); finalize?.();
        return this.request(method, params);
      } };
  }
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
    finalizeSend: (_r, h) => { const canonical = { ...h, revision: 1 }; saved.push(canonical); return canonical; },
    authorizeRecovery: async () => {}, verifyThread: async () => {}, validateOutput: async text => JSON.parse(text).ok === true,
  };
  return { rpc, saved, hooks };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('captured invalid final text never changes adapter completion classification or validated output', async () => {
  const { rpc, hooks } = fixture();
  hooks.captureFinalOutput = text => authoredSkillText(text, 'app-server');
  hooks.validateOutput = async () => false;
  rpc.messages = [{ type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ replyJson: 'Original raw answer' }) }];
  const runner = new AppServerRunner(rpc, audit, hooks), h = await runner.start(request);
  rpc.complete(); await tick();
  const final = await runner.inspect(h);
  assert.equal(final.state, 'failed'); assert.equal(final.reason, 'invalid-or-missing-final-output');
  assert.equal(final.output, undefined); assert.equal(final.rawFinalOutput, 'Original raw answer');
});
test('observer throw, thenable, transformed or oversized return cannot break an otherwise valid reply', async () => {
  for (const capture of [() => { throw Error('observer'); }, () => Promise.resolve('x'), () => Promise.reject(Error('observer rejection')),
    () => ({ then: (_resolve: unknown, reject: (error: Error) => void) => reject(Error('thenable rejection')) }),
    () => 'transformed', () => 'x'.repeat(300_000)]) {
    const { rpc, hooks } = fixture();
    hooks.captureFinalOutput = capture as unknown as NonNullable<ProviderHooks['captureFinalOutput']>;
    const runner = new AppServerRunner(rpc, audit, hooks), h = await runner.start(request);
    rpc.complete(); await tick(); const final = await runner.inspect(h);
    assert.equal(final.state, 'completed'); assert.equal(final.output, '{"ok":true}'); assert.equal(final.rawFinalOutput, undefined);
  }
});
test('valid capture leaves exactly the validator input and admitted output intact', async () => {
  const { rpc, hooks } = fixture(); let validated = '';
  hooks.validateOutput = async text => { validated = text; return true; };
  hooks.captureFinalOutput = text => authoredSkillText(text, 'app-server');
  const wire = JSON.stringify({ replyJson: ' { "authored": "spacing" } ' });
  rpc.messages = [{ type: 'agentMessage', phase: 'final_answer', text: wire }];
  const runner = new AppServerRunner(rpc, audit, hooks), h = await runner.start(request);
  rpc.complete(); await tick(); const final = await runner.inspect(h);
  assert.equal(validated, wire); assert.equal(final.output, wire); assert.equal(final.rawFinalOutput, ' { "authored": "spacing" } ');
});
test('commentary, ambiguous final and provider error cannot supply a raw fallback', async () => {
  for (const messages of [
    [{ type: 'agentMessage', phase: 'commentary', text: 'not final' }],
    [{ type: 'agentMessage', phase: 'final_answer', text: 'a' }, { type: 'agentMessage', phase: 'final_answer', text: 'b' }],
  ]) {
    const { rpc, hooks } = fixture(); hooks.captureFinalOutput = text => text; rpc.messages = messages;
    const runner = new AppServerRunner(rpc, audit, hooks), h = await runner.start(request);
    rpc.complete(); await tick(); assert.equal((await runner.inspect(h)).rawFinalOutput, undefined);
  }
});
test('cancel while output validation awaits removes captured raw and accepted output', async () => {
  const { rpc, hooks } = fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { entered = r; });
  hooks.validateOutput = async () => { entered(); await gate; return false; };
  hooks.captureFinalOutput = text => text;
  const runner = new AppServerRunner(rpc, audit, hooks), h = await runner.start(request);
  rpc.complete(); await ready; const cancelling = runner.cancel(h); release(); await cancelling; await tick();
  const final = await runner.inspect(h); assert.equal(final.rawFinalOutput, undefined); assert.equal(final.output, undefined); assert.equal(final.tombstone, true);
});
test('new app attempt never inherits the previous captured final', async () => {
  const { rpc, hooks } = fixture(); hooks.captureFinalOutput = text => text;
  const runner = new AppServerRunner(rpc, audit, hooks), h = await runner.start(request);
  rpc.complete(); await tick(); const final = await runner.inspect(h); assert.equal(final.rawFinalOutput, '{"ok":true}');
  const originalRequest = rpc.request.bind(rpc);
  rpc.request = async (method, params, options) => { if (method === 'turn/start') rpc.status = 'inProgress'; return originalRequest(method, params, options); };
  const next = await runner.resume(final, { ...request, jobId: 'job-2' });
  assert.equal(next.rawFinalOutput, undefined); assert.equal(next.output, undefined);
});
test('MCP invalid final is retained separately but remains failed; tool error never captured', async () => {
  for (const isError of [false, true]) {
    const { rpc, hooks } = fixture(); hooks.validateOutput = async () => false; hooks.captureFinalOutput = text => text;
    const runner = new McpServerRunner(rpc, audit, hooks), h = await runner.start(request);
    rpc.mcpResolve!({ isError, structuredContent: { threadId: 'thread-1', content: 'Original raw' } }); await tick();
    const final = await runner.inspect(h); assert.equal(final.state, 'failed'); assert.equal(final.output, undefined);
    assert.equal(final.rawFinalOutput, isError ? undefined : 'Original raw');
  }
});

