import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createStdioTransport } from '../daemon/providers/stdio.ts';
import { providerTimeoutPolicy } from '../daemon/providers/runtime.ts';
import { pages, inspectAppServer, mcpStartupAllowanceSeconds, type StartupStage } from '../daemon/providers/preflight.ts';

const child = `
  const rl = (await import('node:readline')).createInterface({ input: process.stdin });
  let pending;
  const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
  rl.on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'release') send({ id: pending.id, result: { data: [pending.params?.cursor ?? 'first'], nextCursor: pending.params?.cursor ? null : 'second' } });
    else { pending = message; send({ method: 'received' }); }
  });
`;
function fixture(t: TestContext, policy = providerTimeoutPolicy('app-server', { homeMode: 'ordinary' })) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rpc = createStdioTransport({ executable: process.execPath, args: ['--input-type=module', '--eval', child],
    cwd: process.cwd(), env: process.env, protocol: 'app-server', ...policy });
  t.after(() => rpc.close());
  const received = () => new Promise<void>(resolve => {
    const off = rpc.onNotification(method => { if (method === 'received') { off(); resolve(); } });
  });
  return { rpc, received };
}

test('ordinary MCP discovery survives 42 seconds per page and retains the full paginated inventory', async t => {
  const { rpc, received } = fixture(t);
  let settled = false;
  let seen = received();
  const result = pages(rpc, 'mcpServerStatus/list').finally(() => { settled = true; });
  await seen;
  t.mock.timers.tick(42_004);
  await Promise.resolve();
  assert.equal(settled, false);
  seen = received();
  rpc.notify('release');
  await seen;
  t.mock.timers.tick(42_004);
  await Promise.resolve();
  assert.equal(settled, false);
  rpc.notify('release');
  assert.deepEqual(await result, ['first', 'second']);
});

test('ordinary discovery still times out at its bounded operation deadline', async t => {
  const { rpc } = fixture(t);
  const result = assert.rejects(rpc.request('mcpServerStatus/list'), /mcpServerStatus\/list request timed out after 90000 ms/);
  t.mock.timers.tick(90_000);
  await result;
});

test('closing transport cancels pending slow discovery immediately', async t => {
  const { rpc } = fixture(t);
  const result = assert.rejects(rpc.request('mcpServerStatus/list'), /transport was closed/);
  t.mock.timers.tick(42_004);
  rpc.close();
  await result;
  t.mock.timers.tick(90_000);
});

test('ordinary non-discovery requests retain their 30 second deadline', async t => {
  const { rpc } = fixture(t);
  const result = assert.rejects(rpc.request('thread/start'), /thread\/start request timed out after 30000 ms/);
  t.mock.timers.tick(30_000);
  await result;
});

test('explicit timeout overrides ordinary discovery; dedicated and MCP defaults stay unchanged', async t => {
  assert.deepEqual(providerTimeoutPolicy('app-server', { homeMode: 'dedicated' }), { timeoutMs: 30_000, methodTimeoutMs: {} });
  assert.deepEqual(providerTimeoutPolicy('app-server', {}), { timeoutMs: 30_000, methodTimeoutMs: {} });
  assert.deepEqual(providerTimeoutPolicy('mcp-server', { homeMode: 'ordinary' }), { timeoutMs: 600_000, methodTimeoutMs: {} });
  const policy = providerTimeoutPolicy('app-server', { homeMode: 'ordinary', timeoutMs: 5000 });
  assert.deepEqual(policy, { timeoutMs: 5000, methodTimeoutMs: {} });
  const { rpc } = fixture(t, policy);
  const result = assert.rejects(rpc.request('mcpServerStatus/list'), /timed out after 5000 ms/);
  t.mock.timers.tick(5000);
  await result;
});


test('effective enabled startup allowance alone controls the numeric hint', () => {
  const extract = (entries: unknown) => mcpStartupAllowanceSeconds({ config: { mcp_servers: entries } });
  assert.equal(extract({ a: { enabled: true, startup_timeout_sec: 120 }, b: { enabled: false, startup_timeout_sec: 500 } }), 120);
  assert.equal(extract({ a: { startup_timeout_sec: 120.001 } }), 120.001);
  for (const value of [NaN, Infinity, -1, 0, '120', null]) assert.equal(extract({ a: { startup_timeout_sec: value } }), undefined);
  assert.equal(mcpStartupAllowanceSeconds({ mcp_servers: { a: { startup_timeout_sec: 120 } } }), undefined);
  assert.equal(extract([]), undefined);
  assert.equal(extract({ a: { enabled: 'true', startup_timeout_sec: 120 } }), undefined);
});

test('preflight derives the hint from its workspace-scoped response before discovery', async () => {
  const order: string[] = [];
  const workspace = process.platform === 'win32' ? 'D:/fixture-workspace' : '/fixture-workspace';
  const home = process.platform === 'win32' ? 'C:/fixture-home' : '/fixture-home';
  const rpc = {
    async request(method: string, params?: any) {
      order.push(method);
      if (method === 'initialize') return { codexHome: home };
      if (method === 'config/read') { assert.equal(params.cwd, workspace); return { config: { mcp_servers: { synthetic: { enabled: true, startup_timeout_sec: 120 } } } }; }
      return { data: [] };
    },
    setMcpDiscoveryStartupAllowance(seconds: number) { assert.equal(seconds, 120); order.push('hint'); },
    notify() {}, onNotification() { return () => {}; }, onDisconnect() { return () => {}; }, close() {},
  };
  await inspectAppServer(rpc, workspace, home, () => {});
  assert.ok(order.indexOf('config/read') < order.indexOf('hint'));
  assert.ok(order.indexOf('hint') < order.indexOf('mcpServerStatus/list'));
});

test('120 second effective startup survives the former boundary on every discovery page', async t => {
  const { rpc, received } = fixture(t);
  rpc.setMcpDiscoveryStartupAllowance!(mcpStartupAllowanceSeconds({ config: { mcp_servers: { synthetic: { enabled: true, startup_timeout_sec: 120 } } } })!);
  let seen = received();
  const result = pages(rpc, 'mcpServerStatus/list');
  await seen;
  t.mock.timers.tick(120_001);
  seen = received(); rpc.notify('release'); await seen;
  t.mock.timers.tick(120_001);
  rpc.notify('release');
  assert.deepEqual(await result, ['first', 'second']);
});

test('configured deadline expires at150s and closing still cancels it', async t => {
  const { rpc } = fixture(t);
  rpc.setMcpDiscoveryStartupAllowance!(120);
  const expired = assert.rejects(rpc.request('mcpServerStatus/list'), /after 150000 ms/);
  t.mock.timers.tick(150_000); await expired;
  const cancelled = assert.rejects(rpc.request('mcpServerStatus/list'), /transport was closed/);
  rpc.close(); await cancelled;
});

test('oversized finite allowance waits for the ceiling and reports the limit truthfully', async t => {
  const { rpc } = fixture(t);
  rpc.setMcpDiscoveryStartupAllowance!(Number.MAX_VALUE);
  let done = false;
  const pending = rpc.request('mcpServerStatus/list').finally(() => { done = true; });
  const expired = assert.rejects(pending, /Your Codex tools took too long to start.*after 150000 ms.*host ceiling reached.*plus 30 s overhead exceeds 150 s/);
  t.mock.timers.tick(149_999); await Promise.resolve(); assert.equal(done, false);
  t.mock.timers.tick(1); await expired;
});

test('prepared deadline is snapshotted and ordinary unrelated requests stay30s', async t => {
  const { rpc } = fixture(t);
  rpc.setMcpDiscoveryStartupAllowance!(119.0001);
  const prepared = rpc.prepareRequest!('mcpServerStatus/list');
  rpc.setMcpDiscoveryStartupAllowance!(500);
  const expired = assert.rejects(prepared.send(), error => {
    assert.match(String(error), /after 149001 ms/); assert.doesNotMatch(String(error), /ceiling/); return true;
  });
  const ordinary = assert.rejects(rpc.request('thread/start'), /after 30000 ms/);
  t.mock.timers.tick(30_000); await ordinary;
  t.mock.timers.tick(119_001); await expired;
});

test('dedicated and explicit override transports do not expose deadline adjustment', t => {
  for (const options of [{ homeMode: 'dedicated' as const }, { homeMode: 'ordinary' as const, timeoutMs: 5000 }]) {
    const { rpc } = fixture(t, providerTimeoutPolicy('app-server', options));
    assert.equal(rpc.setMcpDiscoveryStartupAllowance, undefined);
    rpc.close(); t.mock.timers.reset();
  }
});


test('preflight requests tools/auth on every page without changing server inventory or transport', async () => {
  const workspace = process.platform === 'win32' ? 'D:/fixture-workspace' : '/fixture-workspace';
  const home = process.platform === 'win32' ? 'C:/fixture-home' : '/fixture-home';
  const stages: StartupStage[] = [], calls: any[] = [];
  const servers = [{ name: 'synthetic-a', tools: { lookup: {} }, authStatus: 'notLoggedIn', resources: [], resourceTemplates: [] },
    { name: 'synthetic-b', tools: {}, authStatus: 'unsupported', resources: [], resourceTemplates: [] }];
  const rpc = {
    async request(this: unknown, method: string, params?: any) {
      assert.equal(this, rpc);
      if (method === 'initialize') return { codexHome: home };
      if (method === 'config/read') return { config: {} };
      if (method === 'mcpServerStatus/list') {
        // Full inventory would enter the slow resource/template fixture branch.
        assert.equal(params.detail, 'toolsAndAuthOnly'); calls.push(params);
        return params.cursor ? { data: [servers[1]], nextCursor: null } : { data: [servers[0]], nextCursor: 'private-cursor' };
      }
      return { data: [] };
    }, notify() {}, onNotification() { return () => {}; }, onDisconnect() { return () => {}; }, close() {},
  };
  const audit = await inspectAppServer(rpc, workspace, home, stage => stages.push(stage));
  assert.deepEqual(calls, [{ detail: 'toolsAndAuthOnly' }, { detail: 'toolsAndAuthOnly', cursor: 'private-cursor' }]);
  assert.deepEqual(audit.mcpServers, servers);
  assert.equal(audit.completeModelToolCatalog, false);
  const discovery = stages.filter(s => s.method === 'mcpServerStatus/list');
  assert.deepEqual(discovery.map(s => [s.pageOrdinal, s.outcome]), [[1, 'started'], [1, 'succeeded'], [2, 'started'], [2, 'succeeded']]);
  for (const stage of stages) {
    assert.deepEqual(Object.keys(stage).sort(), ['at', 'elapsedMs', 'method', 'outcome', 'pageOrdinal']);
    assert.ok(Number.isFinite(Date.parse(stage.at))); assert.ok(stage.elapsedMs >= 0); assert.ok(Object.isFrozen(stage));
  }
  assert.doesNotMatch(JSON.stringify(stages), /synthetic-|lookup|private-cursor|fixture-workspace|notLoggedIn/);
});

test('startup tracing preserves exact failure and excludes raw error/cursor details', async () => {
  const secretError = new Error('private-config-and-server-name');
  const stages: StartupStage[] = [];
  const rpc = { request: async () => { throw secretError; } } as any;
  await assert.rejects(pages(rpc, 'mcpServerStatus/list', { detail: 'toolsAndAuthOnly' }, 'data', s => stages.push(s)), e => e === secretError);
  assert.deepEqual(stages.map(s => s.outcome), ['started', 'failed']);
  assert.doesNotMatch(JSON.stringify(stages), /private-config/);
  await assert.rejects(pages(rpc, 'mcpServerStatus/list', {}, 'data', () => { throw new Error('observer'); }), e => e === secretError);
  const unlisted: StartupStage[] = [];
  await assert.rejects(pages(rpc, 'private-method', {}, 'data', s => unlisted.push(s)));
  assert.deepEqual(unlisted, []);
});

test('tools-only inventory still rejects malformed pages and repeated cursors', async () => {
  const malformed = { request: async () => ({}) } as any;
  await assert.rejects(pages(malformed, 'mcpServerStatus/list', { detail: 'toolsAndAuthOnly' }), /invalid-page/);
  const repeating = { request: async () => ({ data: [], nextCursor: 'same' }) } as any;
  await assert.rejects(pages(repeating, 'mcpServerStatus/list', { detail: 'toolsAndAuthOnly' }), /provider-pagination-loop/);
  const unsupported = new Error('unsupported-detail');
  await assert.rejects(pages({ request: async () => { throw unsupported; } } as any, 'mcpServerStatus/list', { detail: 'toolsAndAuthOnly' }), e => e === unsupported);
});
