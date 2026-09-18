import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRuntimePolicy } from '../daemon/runtime-policy.ts';
import { structuredReplySchema } from '../daemon/jobs/structured-reply.ts';
import { policyFingerprint } from '../daemon/providers/policy-gate.ts';

const contract = JSON.parse(readFileSync(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8'));
const home = resolve('fixture-codex-home'), workspace = resolve('fixture-reply-workspace');
for (const homeMode of ['ordinary', 'dedicated'] as const) {
  test(`stock ${homeMode} policy fingerprints the same app-server transport schema as dispatch`, () => {
    const runtime = createRuntimePolicy(home, homeMode);
    const policy = runtime.policyFor(workspace, 'structured-final', 'test-model', 'app-server');
    if (policy.operation !== 'definition') throw new Error('Expected definition policy.');
    assert.deepEqual(policy.turnPolicy.outputSchema, structuredReplySchema('app-server', contract));
    assert.equal(runtime.jobDefaults.policyFor(workspace, 'structured-final', 'test-model', 'app-server'), policyFingerprint(policy));
    const oldSchemaPolicy = { ...policy, turnPolicy: { ...policy.turnPolicy, outputSchema: contract } };
    assert.notEqual(policyFingerprint(oldSchemaPolicy), policyFingerprint(policy));
  });
}
test('stock MCP schema and workspace policy preserve their original modes', () => {
  const runtime = createRuntimePolicy(home, 'ordinary');
  const mcp = runtime.policyFor(workspace, 'structured-final', 'test-model', 'mcp-server');
  if (mcp.operation !== 'definition') throw new Error('Expected definition policy.');
  assert.deepEqual(mcp.turnPolicy.outputSchema, contract);
  const files = runtime.policyFor(workspace, 'workspace-files', 'test-model', 'app-server');
  assert.equal(files.operation, 'generation');
  if (!('turnPolicy' in files)) throw new Error('Expected generation turn policy.');
  assert.equal(Object.hasOwn(files.turnPolicy, 'outputSchema'), false);
});
