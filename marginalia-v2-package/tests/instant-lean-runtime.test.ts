import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTANT_RUNTIME_OVERRIDES, instantRuntimeOptions, instantThreadConfig, verifyInstantThread } from '../daemon/instant/runtime.ts';
import type { RpcTransport } from '../daemon/providers/stdio.ts';

const config = () => ({ skills: { include_instructions: false }, orchestrator: { skills: { enabled: false }, mcp: { enabled: false } }, features: { plugins: false, apps: false } });
const wire = (request: RpcTransport['request']) => ({ request }) as RpcTransport;

test('instant overrides preserve ordinary home, executable, workspace and unrelated preferences without mutating caller', () => {
  const original = { executable: 'C:/codex.exe', workspace: 'C:/reader', codexHome: 'C:/user/.codex', homeMode: 'ordinary' as const,
    configOverrides: { 'model_verbosity': 'low', 'features.plugins': true }, timeoutMs: 12345 };
  const before = structuredClone(original);
  const lean = instantRuntimeOptions(original);
  assert.deepEqual(original, before);
  assert.equal(lean.codexHome, original.codexHome);
  assert.equal(lean.homeMode, 'ordinary');
  assert.equal(lean.executable, original.executable);
  assert.equal(lean.workspace, original.workspace);
  assert.equal(lean.timeoutMs, 12345);
  assert.equal(lean.configOverrides!.model_verbosity, 'low');
  for (const [key, value] of Object.entries(INSTANT_RUNTIME_OVERRIDES)) assert.equal(lean.configOverrides![key], value);
  assert.equal(lean.configOverrides!.cli_auth_credentials_store, undefined);
});

test('thread overrides disable every exact local server name, including dots and quoted characters', async () => {
  const calls: unknown[] = [];
  const result = await instantThreadConfig(wire(async (method, params) => {
    calls.push([method, params]);
    return { config: { ...config(), mcp_servers: { normal: { enabled: true }, 'a.b': {}, 'quoted"server': { enabled: false } } } };
  }), 'C:/reader');
  assert.deepEqual(calls, [['config/read', { cwd: 'C:/reader', includeLayers: false }]]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { mcp_servers: { normal: { enabled: false }, 'a.b': { enabled: false }, 'quoted"server': { enabled: false } } });
});

test('missing or ineffective lean flags stop setup rather than falling back to ordinary catalogs', async () => {
  for (const value of [{}, { config: {} }, { config: { ...config(), features: { plugins: true, apps: false } } }, { config: { ...config(), mcp_servers: [] } }]) {
    await assert.rejects(instantThreadConfig(wire(async () => value), 'C:/reader'));
  }
});

test('thread-specific verification accepts disabled configured rows but rejects live capabilities', async () => {
  const calls: unknown[] = [];
  const disabled = { runtimeStatus: 'disabled', pluginId: null, tools: {}, resources: [], resourceTemplates: [] };
  await verifyInstantThread(wire(async (method, params) => { calls.push([method, params]); return { data: [disabled], nextCursor: null }; }), 'owned-thread');
  assert.deepEqual(calls, [['mcpServerStatus/list', { threadId: 'owned-thread', limit: 100 }]]);
  for (const result of [{}, { data: [{}] }, { data: [{ ...disabled, runtimeStatus: 'connected' }] },
    { data: [{ ...disabled, tools: { tool: {} } }] }, { data: [{ ...disabled, resources: [{}] }] },
    { data: [{ ...disabled, pluginId: 'unexpected-plugin' }] }, { data: [], nextCursor: 'more' }]) {
    await assert.rejects(verifyInstantThread(wire(async () => result), 'owned-thread'));
  }
});

test('thread verification checks later pages and rejects cursor loops', async () => {
  let count = 0;
  await assert.rejects(verifyInstantThread(wire(async () => ++count === 1 ? { data: [], nextCursor: 'page2' } : { data: [{ runtimeStatus: 'starting' }], nextCursor: null }), 'owned-thread'));
  assert.equal(count, 2);
});

test('malformed server names and excessively large inventories are rejected without exposing config', async () => {
  for (const servers of [{ 'bad\nname': { command: 'private-command' } }, Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [String(i), {}]))]) {
    await assert.rejects(instantThreadConfig(wire(async () => ({ config: { ...config(), mcp_servers: servers } })), 'C:/reader'), error => {
      assert(error instanceof Error); assert(!error.message.includes('private-command')); return true;
    });
  }
});
