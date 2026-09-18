import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ReaderStore } from '../daemon/store.ts';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import { LibrarySettingsService } from '../daemon/library.ts';
import { createInstantService, type InstantEvent } from '../daemon/instant/index.ts';
import type { RpcTransport, PreparedRpcRequest } from '../daemon/providers/stdio.ts';
import type { RuntimeOptions } from '../daemon/providers/runtime.ts';

class FakeRpc implements RpcTransport {
  notifications = new Set<(method: string, params: unknown) => void>();
  disconnects = new Set<() => void>();
  calls: { method: string; params: Record<string, unknown> }[] = [];
  turns = new Map<string, string>();
  batchText = JSON.stringify({ items: [{ candidateId: 'term1', text: 'The original material being explained.' }] });
  deleteFailures = 0; count = 0; threads = 0; auto = true; uncertain = false; beforeSend?: () => void; maxActive = 0;
  inputTokens = 40; cachedInputTokens = 10; outputTokens = 10;
  usageUpdates?: { inputTokens: number; cachedInputTokens: number | null; outputTokens: number; totalTokens: number | null }[];
  leanConfig = { skills: { include_instructions: false }, orchestrator: { skills: { enabled: false }, mcp: { enabled: false } }, features: { plugins: false, apps: false }, mcp_servers: { 'local.reader': { enabled: true } } };
  mcpRows = [{ name: 'local.reader', runtimeStatus: 'disabled', pluginId: null, tools: {}, resources: [], resourceTemplates: [] }];
  notify() {}
  onNotification(fn: (method: string, params: unknown) => void) { this.notifications.add(fn); return () => { this.notifications.delete(fn); }; }
  onDisconnect(fn: () => void) { this.disconnects.add(fn); return () => { this.disconnects.delete(fn); }; }
  close() { for (const fn of [...this.disconnects]) fn(); }
  emit(method: string, params: unknown) { for (const fn of this.notifications) fn(method, params); }
  async request(method: string, value: unknown = {}) {
    const params = value as Record<string, unknown>; this.calls.push({ method, params });
    if (method === 'config/read') return { config: this.leanConfig };
    if (method === 'mcpServerStatus/list') return { data: this.mcpRows, nextCursor: null };
    if (method === 'thread/start') return { thread: { id: `thread-${++this.threads}` } };
    if (method === 'thread/archive') return {};
    if (method === 'thread/delete') { if (this.deleteFailures-- > 0) throw new Error('Delete failed'); return {}; }
    if (method === 'turn/interrupt') { this.complete(params.turnId as string, 'ignored', 'interrupted'); return {}; }
    throw new Error(`Unexpected RPC ${method}`);
  }
  prepareRequest(method: string, value: unknown): PreparedRpcRequest {
    const params = value as Record<string, unknown>, id = ++this.count;
    return { id, generation: 'fake', sha256: 'a'.repeat(64), send: async finalize => {
      this.beforeSend?.(); finalize?.(); this.calls.push({ method, params });
      if (this.uncertain) throw new Error('Unknown write');
      const turnId = `turn-${id}`; assert(![...this.turns.values()].includes(params.threadId as string), 'one active turn per page');
      this.turns.set(turnId, params.threadId as string); this.maxActive = Math.max(this.maxActive, this.turns.size);
      if (this.auto) queueMicrotask(() => this.complete(turnId, params.outputSchema ? this.batchText : undefined));
      return { turn: { id: turnId, status: 'inProgress' } };
    } };
  }
  complete(turnId: string, text = 'A short contextual explanation.', status = 'completed') {
    const threadId = this.turns.get(turnId); if (!threadId) return;
    this.turns.delete(turnId);
    this.emit('item/agentMessage/delta', { threadId, turnId, itemId: 'message', delta: text });
    const updates = this.usageUpdates ?? [{ inputTokens: this.inputTokens, cachedInputTokens: this.cachedInputTokens, outputTokens: this.outputTokens, totalTokens: this.inputTokens + this.outputTokens }];
    for (const usage of updates) this.emit('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { last: usage, total: { totalTokens: 999 } } });
    this.emit('item/completed', { threadId, turnId, item: { type: 'agentMessage', id: 'message', text, phase: 'final_answer' } });
    this.emit('turn/completed', { threadId, turn: { id: turnId, status } });
  }
}
const input = (tabId = '1', text = 'The source page has a distinctive full context.') => ({ browserInstanceId: 'browser', tabId, documentId: 'document', url: 'https://example.com/page', sourceHash: createHash('sha256').update(text).digest('hex'), text });
function setup(t: test.TestContext, extra: { now?: () => number; turnTimeoutMs?: number; runtime?: RuntimeOptions } = {}) {
  const store = new ReaderStore(':memory:'); new ConsentSessionService(store);
  const rpc = new FakeRpc(); let launches = 0;
  const service = createInstantService({ store, connect: async () => { launches++; return rpc; }, ...extra });
  t.after(() => { service.close(); store.close(); });
  return { store, rpc, service, launches: () => launches };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('one resident process serves preparation and five streamed selections without resending page', async t => {
  const { service, rpc, store, launches } = setup(t);
  const page = await service.prepare('owner', input(), () => true); assert.equal(page.state, 'ready');
  for (let i = 0; i < 5; i++) {
    const events: InstantEvent[] = [];
    assert.equal(await service.select('owner', { pageId: page.pageId, selectionId: String(i), text: 'source' }, () => true, e => events.push(e)), 'ready');
    assert.deepEqual(events.map(e => e.type), ['draft', 'completed']);
  }
  assert.equal(launches(), 1); assert.equal(rpc.threads, 1);
  const turns = rpc.calls.filter(c => c.method === 'turn/start'); assert.equal(turns.length, 6);
  assert.match(JSON.stringify(turns[0]), /distinctive full context/);
  for (const turn of turns.slice(1)) assert.doesNotMatch(JSON.stringify(turn), /distinctive full context/);
  assert.equal(store.db.prepare('SELECT SUM(totalTokens) FROM instant_usage').pluck().get(), 300);
});

test('exclusion or settings change between reservation and transport write stops dispatch', async t => {
  for (const change of ['exclude', 'settings']) {
    const { service, rpc, store } = setup(t);
    rpc.beforeSend = () => { if (change === 'exclude') new ConsentSessionService(store).setExclusion('https://example.com', true);
      else { const settings = new LibrarySettingsService(store); settings.saveInstantHelp({ ...settings.instantHelp(), expectedRevision: 0, enabled: false }); } };
    const result = await service.prepare('owner', input(), () => true);
    assert(['off', 'excluded'].includes(result.state));
    assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 0);
  }
});

test('unknown dispatch is reserved and never automatically replayed', async t => {
  const { service, rpc, store } = setup(t); rpc.uncertain = true;
  assert.equal((await service.prepare('owner', input(), () => true)).state, 'outcome_unknown');
  assert.equal((await service.prepare('owner', input(), () => true)).state, 'outcome_unknown');
  assert.equal(store.db.prepare("SELECT COUNT(*) FROM instant_usage WHERE state='reserved'").pluck().get(), 1);
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
});

test('two turns globally, one per page, and newest pending selection wins', async t => {
  const { service, rpc } = setup(t);
  const pages = await Promise.all(['1', '2', '3'].map(id => service.prepare('owner', input(id), () => true)));
  rpc.auto = false;
  const output: InstantEvent[] = [];
  const first = service.select('owner', { pageId: pages[0].pageId, selectionId: 'old', text: 'old' }, () => true, e => output.push(e));
  const second = service.select('owner', { pageId: pages[1].pageId, selectionId: 'other', text: 'other' }, () => true, () => {});
  const third = service.select('owner', { pageId: pages[2].pageId, selectionId: 'third', text: 'third' }, () => true, () => {});
  await tick(); assert.equal(rpc.turns.size, 2);
  const superseded = service.select('owner', { pageId: pages[0].pageId, selectionId: 'pending', text: 'pending' }, () => true, e => output.push(e));
  const newest = service.select('owner', { pageId: pages[0].pageId, selectionId: 'latest', text: 'latest' }, () => true, e => output.push(e));
  assert.equal(await superseded, 'cancelled');
  for (let i = 0; i < 5; i++) { await tick(); for (const turn of [...rpc.turns.keys()]) rpc.complete(turn); }
  await Promise.all([first, second, third, newest]);
  assert(rpc.maxActive <= 2); assert(output.every(e => e.selectionId === 'latest'));
});

test('source generations, owner separation, idle expiry and capacity fence old pages', async t => {
  let clock = 0; const { service, rpc } = setup(t, { now: () => clock });
  const first = await service.prepare('owner', input(), () => true);
  const changed = await service.prepare('owner', input('1', 'Changed source.'), () => true);
  assert.notEqual(first.pageId, changed.pageId);
  const select = (owner: string, pageId: string) => service.select(owner, { pageId, selectionId: 'x', text: 'source' }, () => true, () => {});
  assert.equal(await select('owner', first.pageId), 'cancelled'); assert.equal(await select('other', changed.pageId), 'cancelled');
  clock = 15 * 60_000; service.sweep(); assert.equal(await select('owner', changed.pageId), 'cancelled');
  for (let i = 0; i < 9; i++) { clock++; await service.prepare('owner', input(String(i)), () => true); }
  assert.equal(rpc.threads, 11);
});

test('invalid prose fails without crashing and a legacy low limit does not pause preparation', async t => {
  const { service, rpc, store } = setup(t);
  const page = await service.prepare('owner', input(), () => true); rpc.auto = false;
  const events: InstantEvent[] = [];
  const selected = service.select('owner', { pageId: page.pageId, selectionId: 'x', text: 'source' }, () => true, e => events.push(e));
  await tick(); rpc.complete([...rpc.turns.keys()][0], '<script>bad</script>'); assert.equal(await selected, 'failed'); assert(!events.some(e => e.type === 'completed'));
  const settings = new LibrarySettingsService(store); settings.saveInstantHelp({ ...settings.instantHelp(), expectedRevision: 0, tokenBudget: { period: 'day', timezone: 'UTC', limit: 1 } });
  rpc.auto = true;
  assert.equal((await service.prepare('owner', input('2'), () => true)).state, 'ready');
});

test('pairing revoked just before selection write prevents inference', async t => {
  const { service, rpc } = setup(t); const page = await service.prepare('owner', input(), () => true);
  let current = true; rpc.beforeSend = () => { current = false; };
  assert.equal(await service.select('owner', { pageId: page.pageId, selectionId: 'x', text: 'source' }, () => current, () => {}), 'cancelled');
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
});



test('closing while connection is pending never touches a closed database', async () => {
  const store = new ReaderStore(':memory:'); new ConsentSessionService(store);
  const rpc = new FakeRpc(); let connect!: (rpc: RpcTransport) => void;
  const service = createInstantService({ store, connect: () => new Promise(resolve => { connect = resolve; }) });
  const pending = service.prepare('owner', input(), () => true);
  await tick(); service.close(); store.close(); connect(rpc);
  assert.equal((await pending).state, 'failed'); service.sweep();
  assert.equal(rpc.calls.length, 0);
});

test('unknown dispatch remains fenced after service restart', async t => {
  const { service, rpc, store } = setup(t); rpc.uncertain = true;
  await service.prepare('owner', input(), () => true); service.close();
  let launches = 0;
  const restarted = createInstantService({ store, connect: async () => { launches++; return new FakeRpc(); } });
  t.after(() => restarted.close());
  assert.equal((await restarted.prepare('owner', input(), () => true)).state, 'outcome_unknown'); assert.equal(launches, 0);
});

test('selection runs only after preparation acknowledgement', async t => {
  const { service, rpc } = setup(t); rpc.auto = false;
  const preparing = service.prepare('owner', input(), () => true);
  await tick(); const prepareTurn = [...rpc.turns.keys()][0];
  rpc.complete(prepareTurn, 'Ready'); const page = await preparing;
  const pending = service.select('owner', { pageId: page.pageId, selectionId: 'new', text: 'source' }, () => true, () => {});
  await tick(); rpc.complete([...rpc.turns.keys()][0]); assert.equal(await pending, 'ready');
  assert.equal(rpc.maxActive, 1);
});

test('ordinary provider configuration is preserved while model and prose instructions are explicit', async t => {
  const { service, rpc } = setup(t); await service.prepare('owner', input(), () => true);
  const thread = rpc.calls.find(c => c.method === 'thread/start')!.params;
  const turn = rpc.calls.find(c => c.method === 'turn/start')!.params;
  assert.equal(thread.model, 'gpt-5.6-luna'); assert.equal(turn.effort, 'medium');
  for (const key of ['config', 'sandbox', 'approvalPolicy', 'baseInstructions']) assert.equal(thread[key], undefined);
  assert.match(String(thread.developerInstructions), /60 words/);
  assert.equal(turn.sandboxPolicy, undefined); assert.equal(turn.approvalPolicy, undefined);
});

test('compact prompts preserve the entire captured source and exact selection on the warm thread', async t => {
  const { service, rpc } = setup(t);
  const selection = 'viscosity — μ';
  const source = `Opening paragraph.\n${'Middle context. '.repeat(800)}\n${selection}\nClosing context.`;
  const prepared = await service.prepare('owner', input('compact', source), () => true);
  assert.equal(prepared.state, 'ready');
  for (const action of ['define', 'explain-simply'] as const) {
    assert.equal(await service.select('owner', { pageId: prepared.pageId, selectionId: action, text: selection, action }, () => true, () => {}), 'ready');
  }
  const turns = rpc.calls.filter(call => call.method === 'turn/start');
  const prompt = (i: number) => (turns[i].params.input as { text: string }[])[0].text;
  assert.equal(prompt(0).slice(prompt(0).indexOf('\n') + 1), source);
  for (const i of [1, 2]) {
    assert.equal(prompt(i).slice(prompt(i).indexOf('\n') + 1), selection);
    assert(!prompt(i).includes('Middle context.'));
    assert.equal(turns[i].params.threadId, turns[0].params.threadId);
    assert.equal(turns[i].params.effort, 'medium');
  }
  assert.match(prompt(1), /^Define in context:/);
  assert.match(prompt(2), /^Explain simply:/);
  const instructions = String(rpc.calls.find(call => call.method === 'thread/start')!.params.developerInstructions);
  assert.match(instructions, /untrusted data/);
  assert.match(instructions, /Use no tools, files, links or commands/);
  assert.match(instructions, /60 words/);
  assert.match(instructions, /never reconstruct omissions/);
});

const leanRuntime = { executable: 'C:/codex.exe', workspace: 'C:/reader', codexHome: 'C:/user/.codex', homeMode: 'ordinary' as const };
test('lean instant verifies effective settings and disabled thread tools before the first inference', async t => {
  const { service, rpc } = setup(t, { runtime: leanRuntime });
  const prepared = await service.prepare('owner', input(), () => true);
  assert.equal(prepared.state, 'ready');
  assert.deepEqual(rpc.calls.slice(0, 4).map(call => call.method), ['config/read', 'thread/start', 'mcpServerStatus/list', 'turn/start']);
  const thread = rpc.calls[1].params;
  assert.deepEqual(JSON.parse(JSON.stringify(thread.config)), { mcp_servers: { 'local.reader': { enabled: false } } });
  assert.equal(thread.cwd, leanRuntime.workspace);
  assert.equal(rpc.calls[2].params.threadId, rpc.calls[3].params.threadId);
  for (let i = 0; i < 5; i++) assert.equal(await service.select('owner', { pageId: prepared.pageId, selectionId: String(i), text: 'source' }, () => true, () => {}), 'ready');
  assert.equal(rpc.threads, 1);
  assert.equal(rpc.calls.filter(call => call.method === 'mcpServerStatus/list').length, 1);
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 6);
});

test('ineffective lean settings or a starting MCP server prevent reservation and model dispatch', async t => {
  for (const failure of ['skills', 'server']) {
    const { service, rpc, store } = setup(t, { runtime: leanRuntime });
    if (failure === 'skills') rpc.leanConfig.skills.include_instructions = true;
    else rpc.mcpRows[0].runtimeStatus = 'starting';
    assert.equal((await service.prepare('owner', input(), () => true)).state, 'failed');
    assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) FROM instant_usage').pluck().get(), 0);
  }
});

test('idle capacity evicts the least recently used page', async t => {
  let now = 0; const { service } = setup(t, { now: () => now });
  const first = await service.prepare('owner', input('0'), () => true);
  for (let i = 1; i <= 8; i++) { now++; await service.prepare('owner', input(String(i)), () => true); }
  assert.equal(await service.select('owner', { pageId: first.pageId, selectionId: 'old', text: 'source' }, () => true, () => {}), 'cancelled');
});


test('repeated selection identity does not dispatch another inference', async t => {
  const { service, rpc } = setup(t); const page = await service.prepare('owner', input(), () => true);
  const selected = { pageId: page.pageId, selectionId: 'same', text: 'source' };
  const first = service.select('owner', selected, () => true, () => {});
  const duplicate = service.select('owner', selected, () => true, () => {});
  assert.equal(first, duplicate); assert.equal(await first, 'ready');
  assert.equal(await service.select('owner', selected, () => true, () => {}), 'ready');
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 2);
});

test('changed exclusion revision requires a fresh preparation even when re-enabled', async t => {
  const { service, store } = setup(t); const page = await service.prepare('owner', input(), () => true);
  const consent = new ConsentSessionService(store); consent.setExclusion('https://example.com', true); consent.setExclusion('https://example.com', false, 1);
  assert.equal(await service.select('owner', { pageId: page.pageId, selectionId: 'x', text: 'source' }, () => true, () => {}), 'cancelled');
  const next = await service.prepare('owner', input(), () => true); assert.equal(next.state, 'ready'); assert.notEqual(next.pageId, page.pageId);
});


test('usage reports known spend and conservatively pending reservations separately', async t => {
  const { service, rpc } = setup(t); await service.prepare('owner', input(), () => true);
  assert.equal(service.usage().usedTokens, 50); assert.equal(service.usage().pendingTokens, 0);
  rpc.uncertain = true; await service.prepare('owner', input('2'), () => true);
  assert.equal(service.usage().usedTokens, 50); assert(service.usage().pendingTokens >= 4096); assert.equal(service.usage().limitTokens, 100_000);
});

test('observed provider context remains accounted while a later selection still dispatches', async t => {
  const { service, rpc, store } = setup(t);
  const settings = new LibrarySettingsService(store);
  settings.saveInstantHelp({ ...settings.instantHelp(), expectedRevision: 0, tokenBudget: { period: 'day', timezone: 'UTC', limit: 20_000 } });
  rpc.inputTokens = 18_000; rpc.cachedInputTokens = 17_000;
  const page = await service.prepare('owner', input(), () => true);
  assert.equal(page.state, 'ready');
  rpc.inputTokens = 40; rpc.cachedInputTokens = 10;
  const turnStarts = () => rpc.calls.filter(call => call.method === 'turn/start').length;
  assert.equal(await service.select('owner', { pageId: page.pageId, selectionId: 'over-budget', text: 'source' }, () => true, () => {}), 'ready');
  assert.equal(turnStarts(), 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) FROM instant_usage').pluck().get(), 2);
  assert.equal(store.db.prepare("SELECT COUNT(*) FROM instant_usage WHERE state='reserved'").pluck().get(), 0);
  assert.equal(service.usage().usedTokens, 18_060);
  assert.equal(service.usage().pendingTokens, 0);
  assert.equal(await service.select('owner', { pageId: page.pageId, selectionId: 'over-budget', text: 'source' }, () => true, () => {}), 'ready');
  assert.equal(turnStarts(), 2);
});

test('larger valid usage updates raise the observation even when settlement rejects a conflicting total', async t => {
  const { service, rpc, store } = setup(t);
  const settings = new LibrarySettingsService(store);
  settings.saveInstantHelp({ ...settings.instantHelp(), expectedRevision: 0, tokenBudget: { period: 'day', timezone: 'UTC', limit: 30_000 } });
  rpc.usageUpdates = [
    { inputTokens: 8_000, cachedInputTokens: 7_000, outputTokens: 10, totalTokens: 8_010 },
    { inputTokens: 18_000, cachedInputTokens: 17_000, outputTokens: 10, totalTokens: 18_010 },
  ];
  const page = await service.prepare('owner', input(), () => true);
  assert.equal(page.state, 'ready');
  rpc.usageUpdates = undefined; rpc.inputTokens = 40; rpc.cachedInputTokens = 10;
  assert.equal(store.db.prepare('SELECT inputTokens FROM instant_usage').pluck().get(), 8_000);
  assert.equal(service.usage().usedTokens, 8_010);
  assert.equal(await service.select('owner', { pageId: page.pageId, selectionId: 'high-water', text: 'source' }, () => true, () => {}), 'ready');
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 2);
  assert.equal(store.db.prepare("SELECT COUNT(*) FROM instant_usage WHERE state='reserved'").pluck().get(), 0);
});

test('partial provider usage remains pending and does not raise the later-turn observation floor', async t => {
  const { service, rpc, store } = setup(t);
  const settings = new LibrarySettingsService(store);
  settings.saveInstantHelp({ ...settings.instantHelp(), expectedRevision: 0, tokenBudget: { period: 'day', timezone: 'UTC', limit: 26_000 } });
  rpc.usageUpdates = [{ inputTokens: 18_000, cachedInputTokens: 17_000, outputTokens: 10, totalTokens: null }];
  const page = await service.prepare('owner', input(), () => true);
  assert.equal(page.state, 'ready');
  assert.equal(service.usage().usedTokens, 0);
  assert(service.usage().pendingTokens >= 18_010);
  rpc.usageUpdates = undefined; rpc.inputTokens = 40; rpc.cachedInputTokens = 10;
  assert.equal(await service.select('owner', { pageId: page.pageId, selectionId: 'partial-usage', text: 'source' }, () => true, () => {}), 'ready');
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 2);
  assert(service.usage().pendingTokens >= 18_010);
});

test('overflowing provider usage is rejected before it can raise the observation floor', async t => {
  const { service, rpc, store } = setup(t);
  const settings = new LibrarySettingsService(store);
  settings.saveInstantHelp({ ...settings.instantHelp(), expectedRevision: 0, tokenBudget: { period: 'day', timezone: 'UTC', limit: 30_000 } });
  rpc.usageUpdates = [{ inputTokens: Number.MAX_SAFE_INTEGER, cachedInputTokens: 0, outputTokens: 1, totalTokens: Number.MAX_SAFE_INTEGER }];
  const page = await service.prepare('owner', input(), () => true);
  assert.equal(page.state, 'ready');
  assert.equal(service.usage().usedTokens, 0);
  rpc.usageUpdates = undefined; rpc.inputTokens = 40; rpc.cachedInputTokens = 10;
  assert.equal(await service.select('owner', { pageId: page.pageId, selectionId: 'overflow', text: 'source' }, () => true, () => {}), 'ready');
});

test('cached input is a subset and observed context resets for a new prepared page', async t => {
  const { service, rpc, store } = setup(t);
  const settings = new LibrarySettingsService(store);
  settings.saveInstantHelp({ ...settings.instantHelp(), expectedRevision: 0, tokenBudget: { period: 'day', timezone: 'UTC', limit: 50_000 } });
  rpc.inputTokens = 18_000; rpc.cachedInputTokens = 17_000;
  const first = await service.prepare('owner', input('1'), () => true);
  assert.equal(first.state, 'ready');
  assert.equal(await service.select('owner', { pageId: first.pageId, selectionId: 'first-selection', text: 'source' }, () => true, () => {}), 'ready');
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 2);
  rpc.inputTokens = 40; rpc.cachedInputTokens = 10;
  const second = await service.prepare('owner', input('2'), () => true);
  assert.equal(second.state, 'ready');
  assert.equal(await service.select('owner', { pageId: second.pageId, selectionId: 'second-selection', text: 'source' }, () => true, () => {}), 'ready');
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 4);
  assert.equal(store.db.prepare("SELECT COUNT(*) FROM instant_usage WHERE state='reserved'").pluck().get(), 0);
});

test('observed provider context does not block automatic definition admission before batch dispatch', async t => {
  const { service, rpc, store } = setup(t);
  rpc.inputTokens = 18_000; rpc.cachedInputTokens = 17_000;
  const page = await service.prepare('owner', input(), () => true);
  assert.equal(page.state, 'ready');
  const settings = new LibrarySettingsService(store);
  settings.saveAutoAssist({ ...settings.autoAssist(), expectedRevision: 0, enabled: true });
  const prepared = service.preparedPage('owner', page.pageId)!;
  const adapter = service.createPreparedDefinitionAdapter('owner', () => true);
  const admitted = await adapter.admit(prepared, 1);
  assert.equal(admitted.state, 'admitted');
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) FROM instant_usage WHERE kind='auto-definition'").pluck().get(), 1);
  assert(service.usage().pendingTokens >= 10_240);
});

test('browser policy sync merges denials and never removes existing exclusions', t => {
  const { service } = setup(t);
  assert.deepEqual(service.syncPolicy(['EXAMPLE.com']).excludedHosts, ['example.com']);
  assert.deepEqual(service.syncPolicy([]).excludedHosts, ['example.com']);
  assert.deepEqual(service.syncPolicy(['second.test']).excludedHosts, ['example.com', 'second.test']);
  assert.throws(() => service.syncPolicy(['example.com/path']));
  assert.throws(() => service.syncPolicy(['user:secret@example.com']));
});

test('SSE terminal events include sequence and completed replies have no duplicate terminal event', async t => {
  const { createInstantRoutes } = await import('../daemon/routes/instant.ts');
  const { service } = setup(t), owner = JSON.stringify(['pair', 'https://reader.test']);
  const page = await service.prepare(owner, input(), () => true);
  for (const pageId of ['missing', page.pageId]) {
    let output = '', headersSent = false;
    const response = { get headersSent() { return headersSent; }, on() {}, writeHead() { headersSent = true; }, write(chunk: string) { output += chunk; return true; }, end(chunk = '') { output += chunk; } };
    const context = { request: { method: 'POST' }, response, url: new URL('http://localhost/api/instant/select'), principal: { pairingId: 'pair', origin: 'https://reader.test', surface: 'browser-owned-margin' },
      requireCurrentPairing: () => true, body: async () => ({ pageId, selectionId: 'selection', text: 'source' }), send: () => assert.fail('Expected SSE') } as unknown as import('../daemon/routes/types.ts').ApiRouteContext;
    await createInstantRoutes(service)(context);
    const events = output.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as InstantEvent);
    assert(events.every(event => Number.isSafeInteger(event.sequence)));
    assert.equal(events.filter(event => event.type !== 'draft').length, 1);
    assert.equal(events.at(-1)?.type, pageId === 'missing' ? 'state' : 'completed');
  }
});


test('explicit forget deletes only the owned prepared thread and fences late work', async t => {
  const { service, rpc } = setup(t); const page = await service.prepare('owner', input(), () => true);
  await assert.rejects(service.forget('other', page.pageId), /unavailable/);
  assert.equal(rpc.calls.filter(call => call.method === 'thread/delete').length, 0);
  rpc.auto = false; const events: InstantEvent[] = [];
  const selection = service.select('owner', { pageId: page.pageId, selectionId: 'late', text: 'source' }, () => true, event => events.push(event));
  await tick(); const turnId = [...rpc.turns.keys()][0];
  const result = await service.forget('owner', page.pageId);
  rpc.complete(turnId, 'Late explanation');
  assert.equal(await selection, 'cancelled'); assert.equal(events.length, 0);
  assert.deepEqual(result, { forgotten: true, providerHistory: 'deleted' });
  assert.deepEqual(rpc.calls.filter(call => call.method === 'thread/delete').map(call => call.params), [{ threadId: 'thread-1' }]);
  assert.deepEqual(await service.forget('owner', page.pageId), result);
  assert.equal(rpc.calls.filter(call => call.method === 'thread/delete').length, 1);
});

test('failed explicit deletion retains an evicted owner mapping for retry', async t => {
  const { service, rpc } = setup(t); const page = await service.prepare('owner', input(), () => true);
  service.release('owner', page.pageId); rpc.deleteFailures = 1;
  await assert.rejects(service.forget('owner', page.pageId), /Delete failed/);
  await assert.rejects(service.forget('other', page.pageId), /unavailable/);
  assert.deepEqual(await service.forget('owner', page.pageId), { forgotten: true, providerHistory: 'deleted' });
  assert.equal(rpc.calls.filter(call => call.method === 'thread/archive').length, 1);
  assert.equal(rpc.calls.filter(call => call.method === 'thread/delete').length, 2);
});


test('A8 adapter batches on the prepared thread, settles usage and serves cache without another send', async t => {
  const { createPreparedDefinitions } = await import('../daemon/instant/prepared-definitions.ts');
  const { service, rpc, store, launches } = setup(t);
  const settings = new LibrarySettingsService(store); settings.saveAutoAssist({ ...settings.autoAssist(), expectedRevision: 0, enabled: true });
  const prepared = await service.prepare('owner', input(), () => true), page = service.preparedPage('owner', prepared.pageId)!;
  assert.equal(service.preparedPage('other', prepared.pageId), undefined);
  const engine = createPreparedDefinitions(service.createPreparedDefinitionAdapter('owner', () => true)); t.after(() => engine.close());
  const term = { candidateId: 'term1', term: 'source', normalizedTerm: 'source', start: 4, end: 10, contextHash: 'a'.repeat(64) };
  const result = await engine.prepare(page, [term]); assert.equal(result.state, 'ready'); assert.equal(result.definitions.length, 1);
  assert.equal((await engine.prepare(page, [term])).definitions.length, 1);
  assert.equal(launches(), 1); assert.equal(rpc.threads, 1);
  const sends = rpc.calls.filter(call => call.method === 'turn/start'); assert.equal(sends.length, 2);
  assert.doesNotMatch(JSON.stringify(sends[1]), /distinctive full context/); assert(sends[1].params.outputSchema);
  assert.equal(store.db.prepare("SELECT totalTokens FROM instant_usage WHERE kind='auto-definition'").pluck().get(), 50);
});

test('A8 adapter retains automatic admission after the old 20 percent budget', async t => {
  const { InstantStore } = await import('../daemon/instant-store.ts');
  const { service, rpc, store } = setup(t);
  const settings = new LibrarySettingsService(store); settings.saveAutoAssist({ ...settings.autoAssist(), expectedRevision: 0, enabled: true });
  const prepared = await service.prepare('owner', input(), () => true), page = service.preparedPage('owner', prepared.pageId)!;
  const usage = new InstantStore(store); usage.reserve({ requestId: 'earlier-auto', pageKeyHash: 'a'.repeat(64), kind: 'auto-definition', reservedTokens: 17000 }, false); usage.settle('earlier-auto', { totalTokens: 17000 });
  const adapter = service.createPreparedDefinitionAdapter('owner', () => true);
  const admitted = await adapter.admit(page, 1);
  assert.equal(admitted.state, 'admitted');
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 1);
  assert(service.usage().pendingTokens >= 10_240);
  assert(service.usage().usedTokens < 100000);
});

test('A8 batch rechecks opt-in before write and rejects replay of the lease', async t => {
  const { service, rpc, store } = setup(t);
  const settings = new LibrarySettingsService(store); settings.saveAutoAssist({ ...settings.autoAssist(), expectedRevision: 0, enabled: true });
  const prepared = await service.prepare('owner', input(), () => true), page = service.preparedPage('owner', prepared.pageId)!;
  const adapter = service.createPreparedDefinitionAdapter('owner', () => true), admitted = await adapter.admit(page, 1);
  assert.equal(admitted.state, 'admitted'); if (admitted.state !== 'admitted') return;
  rpc.beforeSend = () => settings.saveAutoAssist({ ...settings.autoAssist(), expectedRevision: 1, enabled: false });
  const request = { pageId: page.pageId, generation: page.generation, items: [{ candidateId: 'term1', term: 'source', start: 4, end: 10 }] };
  await assert.rejects(adapter.transport(request, new AbortController().signal));
  await admitted.lease.settle({ inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null });
  await assert.rejects(adapter.transport(request, new AbortController().signal));
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 1);
});

test('A8 batch abort drains before explicit forget deletes its thread', async t => {
  const { service, rpc, store } = setup(t);
  const settings = new LibrarySettingsService(store); settings.saveAutoAssist({ ...settings.autoAssist(), expectedRevision: 0, enabled: true });
  const prepared = await service.prepare('owner', input(), () => true), page = service.preparedPage('owner', prepared.pageId)!;
  const adapter = service.createPreparedDefinitionAdapter('owner', () => true), admitted = await adapter.admit(page, 1);
  if (admitted.state !== 'admitted') assert.fail('Expected reservation');
  rpc.auto = false;
  const pending = adapter.transport({ pageId: page.pageId, generation: page.generation, items: [{ candidateId: 'term1', term: 'source', start: 4, end: 10 }] }, new AbortController().signal);
  const rejected = assert.rejects(pending); await tick();
  const result = await service.forget('owner', page.pageId); await rejected;
  assert.equal(result.providerHistory, 'deleted'); assert.equal(rpc.turns.size, 0);
});

test('explicit unexclude uses policy CAS and subsequent union does not resurrect the removed host', t => {
  const { service, store } = setup(t); const first = service.syncPolicy(['example.com', 'other.test']);
  const consent = new ConsentSessionService(store); consent.setExclusion('http://example.com', true);
  assert.throws(() => service.unexcludePolicy({ host: 'example.com', expectedRevision: first.revision }), /changed/);
  const current = service.syncPolicy([]), next = service.unexcludePolicy({ host: 'EXAMPLE.com', expectedRevision: current.revision });
  assert.deepEqual(next.excludedHosts, ['other.test']); assert.deepEqual(service.syncPolicy(next.excludedHosts).excludedHosts, ['other.test']);
  assert(consent.exclusions().filter(row => new URL(row.site).hostname === 'example.com').every(row => !row.excluded));
});

test('unexclude does not clear ancestor exclusions or explicit never-send grants', t => {
  const { service, store } = setup(t); service.syncPolicy(['example.com', 'child.example.com']);
  store.db.prepare('INSERT INTO grants(id,site,scope,recipient,decision,createdAt,revokedAt) VALUES(?,?,?,?,?,?,NULL)')
    .run('denial', 'https://child.example.com', 'cloud-inference', 'openai-codex', 'deny-site', new Date().toISOString());
  const current = service.syncPolicy([]), result = service.unexcludePolicy({ host: 'child.example.com', expectedRevision: current.revision });
  assert.deepEqual(result.excludedHosts, ['child.example.com', 'example.com']);
  assert.equal(store.db.prepare("SELECT revokedAt FROM grants WHERE id='denial'").pluck().get(), null);
});

test('usage status rolls over at the stored-timezone day boundary without pausing preparation', async t => {
  let clock = Date.parse('2026-09-18T23:59:00Z'); const { service, store, rpc } = setup(t, { now: () => clock });
  const settings = new LibrarySettingsService(store); settings.saveInstantHelp({ ...settings.instantHelp(), expectedRevision: 0, tokenBudget: { period: 'day', timezone: 'UTC', limit: 10000 } });
  const { InstantStore } = await import('../daemon/instant-store.ts'); const usage = new InstantStore(store);
  usage.reserve({ requestId: 'today-spend', pageKeyHash: 'b'.repeat(64), kind: 'selection', reservedTokens: 10000 }, false, new Date(clock)); usage.settle('today-spend', { totalTokens: 10000 }, new Date(clock));
  const oldEpoch = service.syncPolicy([]).budgetEpoch;
  assert.equal(service.usage().usedTokens, 10000);
  assert.equal((await service.prepare('owner', input(), () => true)).state, 'ready');
  clock += 120000; assert.notEqual(service.syncPolicy([]).budgetEpoch, oldEpoch);
  assert.equal(service.usage().usedTokens, 0);
  assert.equal((await service.prepare('owner', input('2'), () => true)).state, 'ready');
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 2);
});

test('the same selection remains identity-fenced without waiting for a budget epoch change', async t => {
  let clock = Date.parse('2026-09-18T23:59:00Z'); const { service, store, rpc } = setup(t, { now: () => clock });
  const page = await service.prepare('owner', input(), () => true);
  const { InstantStore } = await import('../daemon/instant-store.ts'); const usage = new InstantStore(store);
  usage.reserve({ requestId: 'remaining-spend', pageKeyHash: 'c'.repeat(64), kind: 'selection', reservedTokens: 99950 }, false, new Date(clock)); usage.settle('remaining-spend', { totalTokens: 99950 }, new Date(clock));
  const selection = { pageId: page.pageId, selectionId: 'paused', text: 'source' };
  assert.equal(await service.select('owner', selection, () => true, () => {}), 'ready');
  assert.equal(await service.select('owner', selection, () => true, () => {}), 'ready');
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 2);
  clock += 120000;
  assert.equal(await service.select('owner', { ...selection, selectionId: 'next' }, () => true, () => {}), 'ready');
  assert.equal(rpc.calls.filter(call => call.method === 'turn/start').length, 3);
});
