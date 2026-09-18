import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { setImmediate as tick } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { AppServerRunner } from '../daemon/providers/app-server.ts';
import { McpServerRunner } from '../daemon/providers/mcp-server.ts';
import { createStdioTransport, RpcNotSentError, RpcRequestUsedError } from '../daemon/providers/stdio.ts';
import { validateProviderSend } from '../daemon/providers/send-binding.ts';
import { sendProviderRequest } from '../daemon/providers/send.ts';
import { formatMcpPrompt } from '../daemon/providers/prompt.ts';
import { ProviderNotSentError, type AuditedPolicy, type ProviderHandle, type ProviderHooks, type ProviderKind, type ProviderSendBinding } from '../contracts/job-runner.ts';

// A synthetic JSON-line protocol peer, not Codex and not runtime/confinement acceptance.
// Real child-process pipes and the actual production transport are exercised below.
const peer = String.raw`
const rl=require('node:readline').createInterface({input:process.stdin});
let count=0,complete=false,pending,last;
const respond=(r,result)=>process.stdout.write(JSON.stringify({...('jsonrpc' in r?{jsonrpc:'2.0'}:{}),id:r.id,result})+'\n');
rl.on('line',line=>{
 const r=JSON.parse(line);if(!('id' in r))return;
 if(r.method==='test/count')return respond(r,{count});
 if(r.method==='test/last')return respond(r,last);
 if(r.method==='test/complete'){complete=true;if(pending){respond(pending,{structuredContent:{threadId:'thread',content:'{"ok":true}'}});pending=undefined;}return respond(r,{});}
 if(r.method==='thread/start'||r.method==='thread/resume')return respond(r,{thread:{id:'thread'}});
 if(r.method==='thread/turns/list')return respond(r,{data:[{id:'turn-'+count,status:complete?'completed':'inProgress'}],nextCursor:null});
 if(r.method==='thread/items/list')return respond(r,{data:[{turnId:'turn-'+count,item:{type:'agentMessage',phase:'final_answer',text:'{"ok":true}'}}],nextCursor:null});
 if(r.method==='turn/start'||r.method==='tools/call'){
  count++;complete=false;last=r.params;
  if(JSON.stringify(r).includes('EXIT_ON_SEND'))return process.exit(9);
  if(r.method==='tools/call'){pending=r;return;}
  return respond(r,{turn:{id:'turn-'+count,status:'inProgress'},echo:r.params});
 }
 respond(r,{echo:r.params});
});`;
function transport(protocol: 'app-server' | 'jsonrpc' = 'app-server') {
  return createStdioTransport({ executable: process.execPath, args: ['-e', peer], cwd: process.cwd(), env: {}, protocol, timeoutMs: 2_000 });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

for (const protocol of ['app-server', 'jsonrpc'] as const) {
  test(`${protocol}: immutable bytes and one synchronous finalize/write pair precede every microtask`, { timeout: 5_000 }, async t => {
    const trace: string[] = [], write = Socket.prototype.write;
    t.mock.method(Socket.prototype, 'write', function(this: Socket, ...args: any[]) {
      if (Buffer.isBuffer(args[0]) && args[0].includes('T06_EXACT_BYTES')) trace.push('write');
      return Reflect.apply(write, this, args);
    });
    const rpc = transport(protocol);
    try {
      const params = { prompt: 'T06_EXACT_BYTES', nested: { n: 7 } }, prepared = rpc.prepareRequest('turn/start', params);
      params.prompt = 'changed'; params.nested.n = 99;
      let finalized = 0;
      const response = prepared.send(() => { finalized++; trace.push('finalize'); queueMicrotask(() => trace.push('microtask')); });
      assert.deepEqual(trace, ['finalize', 'write']);
      assert.throws(() => prepared.send(() => { finalized++; }), RpcRequestUsedError);
      assert.equal(finalized, 1);
      assert.deepEqual((await response).echo, { prompt: 'T06_EXACT_BYTES', nested: { n: 7 } });
      assert.equal((await rpc.request('test/count')).count, 1);
      assert.match(prepared.sha256, /^[a-f0-9]{64}$/); assert.ok(prepared.generation);
    } finally { rpc.close(); }
  });
}

test('pre-write rejection consumes the prepared object without finalizing or transmitting again', { timeout: 5_000 }, async () => {
  const rpc = transport();
  try {
    for (const scenario of ['callback', 'finalize', 'missing', 'thenable']) {
      let finalized = 0;
      const prepared = rpc.prepareRequest('turn/start', { scenario }, { onRequestId: () => { if (scenario === 'callback') throw new Error('callback-refused'); } });
      assert.throws(() => prepared.send(scenario === 'missing' ? undefined : () => {
        finalized++; if (scenario === 'thenable') return Promise.resolve() as never; throw new Error('finalizer-refused');
      }), RpcNotSentError);
      assert.throws(() => prepared.send(() => {}), RpcRequestUsedError);
      assert.equal(finalized, ['callback', 'missing'].includes(scenario) ? 0 : 1);
    }
    await assert.rejects(rpc.request('turn/start', {}), RpcNotSentError);
    assert.throws(() => rpc.notify('turn/start', {}), RpcNotSentError);
    assert.throws(() => rpc.notify('tools/call', {}), RpcNotSentError);
    assert.equal((await rpc.request('test/count')).count, 0);
    assert.throws(() => rpc.prepareRequest('turn/start', { text: 'x'.repeat(1024 * 1024) }), RpcNotSentError);
    const prepared = rpc.prepareRequest('turn/start', {}); rpc.close(); let calls = 0;
    assert.throws(() => prepared.send(() => { calls++; }), RpcNotSentError); assert.equal(calls, 0);
  } finally { rpc.close(); }
});

for (const partial of [false, true]) {
  test(`entered stream write then threw (partial=${partial}) is unknown, never a no-send refund`, { timeout: 5_000 }, async t => {
    const write = Socket.prototype.write; let writes = 0;
    t.mock.method(Socket.prototype, 'write', function(this: Socket, ...args: any[]) {
      if (Buffer.isBuffer(args[0]) && args[0].includes('T06_THROWING_WRITE')) {
        writes++; if (partial) Reflect.apply(write, this, [args[0].subarray(0, 10)]); throw new Error('stream-write-throw');
      }
      return Reflect.apply(write, this, args);
    });
    const rpc = transport();
    try {
      let finalized = 0; const prepared = rpc.prepareRequest('turn/start', { prompt: 'T06_THROWING_WRITE' });
      await assert.rejects(prepared.send(() => { finalized++; }), e => e instanceof Error && !(e instanceof RpcNotSentError) && /unknown/.test(e.message));
      assert.equal(writes, 1); assert.equal(finalized, 1);
      assert.throws(() => prepared.send(() => { finalized++; }), RpcRequestUsedError); assert.equal(finalized, 1);
    } finally { rpc.close(); }
  });
}

function adapter(kind: ProviderKind) {
  const rpc = transport(kind === 'app-server' ? 'app-server' : 'jsonrpc');
  const audit = { workspace: process.cwd(), codexHome: '/synthetic-private-home', initialize: {}, account: {}, config: {}, requirements: {}, skills: {}, mcpServers: [], features: [], completeModelToolCatalog: false as const };
  const request = { jobId: 'attempt', workspace: audit.workspace, policyKey: 'policy', model: 'synthetic', mode: 'structured-final' as const,
    prompt: 'a reviewed synthetic question', outputSchema: { type: 'object' } };
  const saved = new Map<string, ProviderHandle>(); let finalizations = 0;
  const stateListeners = new Set<(handle: ProviderHandle) => void>();
  const publish = (handle: ProviderHandle) => {
    saved.set(handle.jobId, handle);
    for (const listener of [...stateListeners]) listener(handle);
    return handle;
  };
  const hooks: ProviderHooks = {
    authorize: async r => ({ policyKey: r.policyKey, workspace: r.workspace, thread: { cwd: r.workspace, approvalPolicy: 'never' },
      turn: { cwd: r.workspace, approvalPolicy: 'never' }, mcp: { cwd: r.workspace, 'approval-policy': 'never' } }),
    authorizeSend: async () => {},
    finalizeSend: (r, h) => {
      assert.equal(r.jobId, h.jobId); assert.equal(h.state, 'starting');
      assert.equal(saved.has(h.jobId), false, 'no canonical checkpoint before actual send');
      finalizations++; return publish({ ...h, revision: 1 });
    },
    checkpoint: async h => {
      const before = saved.get(h.jobId); assert.ok(before, 'a dispatched attempt must have been finalized');
      assert.equal(h.revision, before.revision); return publish({ ...h, revision: before.revision! + 1 });
    },
    authorizeRecovery: async () => {}, verifyThread: async () => {}, validateOutput: async text => JSON.parse(text).ok === true,
  };
  const runner = kind === 'app-server' ? new AppServerRunner(rpc, audit, hooks) : new McpServerRunner(rpc, audit, hooks);
  const waitForState = (jobId: string, state: ProviderHandle['state']) => {
    const current = saved.get(jobId);
    if (current?.state === state) return Promise.resolve(current);
    return new Promise<ProviderHandle>((resolve, reject) => {
      const timer = setTimeout(() => {
        stateListeners.delete(listener);
        reject(new Error(`Timed out waiting for ${jobId} to reach ${state}; last state: ${saved.get(jobId)?.state ?? 'missing'}.`));
      }, 2_000);
      timer.unref();
      const listener = (handle: ProviderHandle) => {
        if (handle.jobId !== jobId || handle.state !== state) return;
        clearTimeout(timer); stateListeners.delete(listener); resolve(handle);
      };
      stateListeners.add(listener);
    });
  };
  return { rpc, hooks, runner, request, audit, saved, waitForState, finalizations: () => finalizations };
}

for (const kind of ['app-server', 'mcp-server'] as const) {
  test(`${kind}: permission changed across awaited preparation is rejected at synchronous finalization`, { timeout: 5_000 }, async () => {
    const f = adapter(kind), entered = deferred(), release = deferred(); let current = true;
    try {
      f.hooks.authorizeSend = async () => { entered.resolve(); await release.promise; };
      const finalize = f.hooks.finalizeSend;
      f.hooks.finalizeSend = (...args) => { if (!current) throw new Error('permission-or-pairing-revoked'); return finalize(...args); };
      const starting = f.runner.start(f.request); void starting.catch(() => {}); await entered.promise;
      assert.equal(f.saved.size, 0); assert.equal((await f.rpc.request('test/count')).count, 0);
      current = false; release.resolve(); await assert.rejects(starting, /permission-or-pairing-revoked/);
      assert.equal(f.finalizations(), 0); assert.equal((await f.rpc.request('test/count')).count, 0);
    } finally { release.resolve(); f.rpc.close(); }
  });

  test(`${kind}: cancellation and asynchronous denial before finalization are known non-send`, { timeout: 5_000 }, async () => {
    for (const cancel of [false, true]) {
      const f = adapter(kind), entered = deferred(), release = deferred(); let staged!: ProviderHandle;
      try {
        f.hooks.authorizeSend = async (_r, h) => { staged = h; entered.resolve(); await release.promise; if (!cancel) throw new Error('denied'); };
        const starting = f.runner.start(f.request); void starting.catch(() => {}); await entered.promise;
        const cancelling = cancel ? f.runner.cancel(staged) : undefined;
        release.resolve(); await assert.rejects(starting, ProviderNotSentError); await cancelling;
        assert.equal(f.saved.size, 0); assert.equal((await f.rpc.request('test/count')).count, 0);
      } finally { release.resolve(); f.rpc.close(); }
    }
  });

  test(`${kind}: successful continuation has one dispatch per attempt and immutable completed predecessor`, { timeout: 5_000 }, async () => {
    const f = adapter(kind);
    try {
      const first = await f.runner.start(f.request); assert.equal(first.state, 'running'); assert.equal(f.finalizations(), 1);
      await assert.rejects(f.runner.start(f.request), /already-dispatched/);
      await f.rpc.request('test/complete'); await tick();
      const completed = await f.runner.inspect(first); assert.equal(completed.state, 'completed');
      const before = structuredClone(f.saved.get(first.jobId));
      if (f.runner instanceof McpServerRunner) assert.equal(f.runner.canResume(completed), true);
      const next = await f.runner.resume(completed, { ...f.request, jobId: 'next' });
      assert.equal(next.state, 'running'); assert.equal(f.finalizations(), 2); assert.deepEqual(f.saved.get(first.jobId), before);
      assert.equal((await f.rpc.request('test/count')).count, 2);
      if (kind === 'app-server') assert.ok(next.turnId); else assert.equal(next.turnId, undefined);
      await f.runner.cancel(next);
      if (f.runner instanceof McpServerRunner) assert.equal(f.runner.canResume(completed), false);
    } finally { f.rpc.close(); }
  });

  test(`${kind}: mutating caller or asynchronous authorization copies cannot change outgoing bytes`, { timeout: 5_000 }, async () => {
    const f = adapter(kind);
    try {
      f.hooks.authorizeSend = async r => { r.prompt = 'altered'; r.outputSchema!.type = 'string'; await tick(); };
      const original = f.request.prompt, starting = f.runner.start(f.request); f.request.prompt = 'caller-change'; await starting;
      assert.equal(f.finalizations(), 1); const wire = await f.rpc.request('test/last');
      assert.equal(kind === 'app-server' ? wire.input[0].text : wire.arguments.prompt.split('\nReturn only JSON')[0], original);
      if (kind === 'app-server') assert.deepEqual(wire.outputSchema, { type: 'object' }); else assert.match(wire.arguments.prompt, /\{"type":"object"\}$/);
    } finally { f.rpc.close(); }
  });

  test(`${kind}: lost response remains unknown; no implicit replay`, { timeout: 5_000 }, async () => {
    const f = adapter(kind);
    try {
      await f.runner.start({ ...f.request, prompt: 'EXIT_ON_SEND' });
      await f.waitForState('attempt', 'outcome_unknown');
      assert.equal(f.saved.get('attempt')?.state, 'outcome_unknown'); assert.equal(f.finalizations(), 1);
      await assert.rejects(f.runner.start(f.request), /already-dispatched/);
    } finally { f.rpc.close(); }
  });

  test(`${kind}: injected asynchronous or malformed finalizer never releases bytes`, { timeout: 5_000 }, async () => {
    for (const result of ['thenable', 'rejected-thenable', 'wrong-identity']) {
      const f = adapter(kind);
      try {
        f.hooks.finalizeSend = (_r, h) => result === 'thenable' ? Promise.resolve({ ...h, revision: 1 }) as never : result === 'rejected-thenable' ? Promise.reject(new Error('invalid-async-finalizer')) as never : { ...h, jobId: 'wrong', revision: 1 };
        await assert.rejects(f.runner.start(f.request), /synchronous-canonical-handle/);
        assert.equal((await f.rpc.request('test/count')).count, 0);
      } finally { f.rpc.close(); }
    }
  });

  test(`${kind}: the actual serialized params, policy, request ID and digest are independently bound`, { timeout: 5_000 }, async () => {
    const f = adapter(kind);
    try {
      const policy: AuditedPolicy = { policyKey: f.request.policyKey, workspace: f.request.workspace,
        thread: { cwd: f.request.workspace, approvalPolicy: 'never' }, turn: { cwd: f.request.workspace, approvalPolicy: 'never' }, mcp: { cwd: f.request.workspace, 'approval-policy': 'never' } };
      for (const followup of [false, true]) {
        const handle: ProviderHandle = { jobId: f.request.jobId, provider: kind, workspace: f.request.workspace, policyKey: f.request.policyKey,
          model: f.request.model, mode: f.request.mode, state: 'starting', tombstone: false, providerInstanceId: 'instance',
          ...(kind === 'app-server' || followup ? { threadId: 'thread' } : {}) };
        const params = kind === 'app-server' ? { ...policy.turn, threadId: handle.threadId, model: f.request.model,
          input: [{ type: 'text', text: f.request.prompt, text_elements: [] }], outputSchema: f.request.outputSchema }
          : { name: followup ? 'codex-reply' : 'codex', arguments: { ...(followup ? { threadId: 'thread' } : { ...policy.mcp, model: f.request.model }), prompt: formatMcpPrompt(f.request) } };
        const method = kind === 'app-server' ? 'turn/start' : 'tools/call', prepared = f.rpc.prepareRequest(method, params);
        const wire: ProviderSendBinding = { method, params, requestId: prepared.id, transportGeneration: prepared.generation, wireSha256: prepared.sha256 };
        assert.doesNotThrow(() => validateProviderSend(f.request, handle, policy, wire));
        assert.throws(() => validateProviderSend({ ...f.request, prompt: 'changed' }, handle, policy, wire), /payload/);
        assert.throws(() => validateProviderSend(f.request, handle, policy, { ...wire, requestId: wire.requestId + 1 }), /digest/);
        assert.throws(() => validateProviderSend(f.request, handle, policy, { ...wire, wireSha256: '0'.repeat(64) }), /digest/);
        assert.throws(() => validateProviderSend(f.request, handle, policy, { ...wire, transportGeneration: '' }), /payload/);
        const altered = { ...wire, params: { altered: true } };
        altered.wireSha256 = createHash('sha256').update(JSON.stringify({ id: wire.requestId, method, ...(kind === 'mcp-server' ? { jsonrpc: '2.0' } : {}), params: altered.params }) + '\n').digest('hex');
        assert.throws(() => validateProviderSend(f.request, handle, policy, altered), /payload/);
      }
      assert.equal((await f.rpc.request('test/count')).count, 0);
    } finally { f.rpc.close(); }
  });
}

test('observation-only transport never falls back to raw inference request', async () => {
  const f = adapter('app-server'); let raw = 0;
  try {
    const observer = { request: async () => { raw++; return {}; }, notify() {}, onNotification: () => () => {}, onDisconnect: () => () => {}, close() {} };
    const h: ProviderHandle = { jobId: f.request.jobId, provider: 'app-server', workspace: f.request.workspace, policyKey: f.request.policyKey,
      model: f.request.model, mode: f.request.mode, state: 'starting', tombstone: false };
    await assert.rejects(sendProviderRequest(observer, f.hooks, f.audit, f.request, h, 'turn/start', {}, () => h), ProviderNotSentError);
    assert.equal(raw, 0); assert.equal(f.finalizations(), 0);
  } finally { f.rpc.close(); }
});

for (const kind of ['app-server', 'mcp-server'] as const) for (const partial of [false, true]) {
  test(`${kind}: immediate synchronous stream failure after finalization preserves unknown (partial=${partial})`, { timeout: 5_000 }, async t => {
    const write = Socket.prototype.write; let writes = 0;
    t.mock.method(Socket.prototype, 'write', function(this: Socket, ...args: any[]) {
      if (Buffer.isBuffer(args[0]) && args[0].includes('ADAPTER_SYNC_FAILURE')) {
        writes++; if (partial) Reflect.apply(write, this, [args[0].subarray(0, 10)]); throw new Error('stream-write-throw');
      }
      return Reflect.apply(write, this, args);
    });
    const f = adapter(kind);
    try {
      await f.runner.start({ ...f.request, prompt: 'ADAPTER_SYNC_FAILURE' });
      for (let i = 0; i < 20 && f.saved.get('attempt')?.state !== 'outcome_unknown'; i++) await tick();
      assert.equal(f.finalizations(), 1); assert.equal(writes, 1); assert.equal(f.saved.get('attempt')?.state, 'outcome_unknown');
      await assert.rejects(f.runner.start(f.request), /already-dispatched/);
      assert.equal(writes, 1);
    } finally { f.rpc.close(); }
  });
}


test('MCP reuse requires the live exact completed attempt, not a stale handle or retained map entry', { timeout: 5_000 }, async () => {
  const f = adapter('mcp-server');
  try {
    const running = await f.runner.start(f.request);
    assert.ok(f.runner instanceof McpServerRunner);
    assert.equal(f.runner.canResume(running), false);
    await f.rpc.request('test/complete'); await tick();
    const completed = await f.runner.inspect(running);
    assert.equal(completed.state, 'completed'); assert.equal(f.runner.canResume(completed), true);
    assert.equal(f.runner.canResume({ ...completed, tombstone: true }), false);
    assert.equal(f.runner.canResume({ ...completed, revision: completed.revision! - 1 }), false);
    assert.equal(f.runner.canResume({ ...completed, providerInstanceId: 'other-process' }), false);
    f.rpc.close(); assert.equal(f.runner.canResume(completed), false);
  } finally { f.rpc.close(); }
});
