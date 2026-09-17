import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PINNED_CODEX_VERSION, createCodexPolicy, auditCodexPolicy, cancellationFor,
  type CodexPolicy, type PolicyInput, type PolicyEvidence, type Observation,
} from '../daemon/codex-policy.ts';

const common = {
  version: PINNED_CODEX_VERSION, platform: 'win32' as const,
  workspace: 'C:\\Marginalia\\jobs\\one', codexHome: 'C:\\Marginalia\\codex-home',
  auditId: 'worker-1/attempt-1/config-1',
};
const schema = { type: 'object', additionalProperties: false, properties: { definition: { type: 'string' } }, required: ['definition'] };
const definitionInput: PolicyInput = { ...common, operation: 'definition', model: 'selected-model', outputSchema: schema };
const generationInput: PolicyInput = { ...common, operation: 'generation', model: 'selected-model' };
const solverInput: PolicyInput = {
  ...common, operation: 'saved-solver', executable: 'C:\\Runtime\\node.exe',
  solverPath: common.workspace + '\\solver.js', inputPath: common.workspace + '\\input.json',
  writesWorkspace: false, timeoutMs: 30_000,
};
const sources: Record<keyof PolicyEvidence, string> = {
  config: 'config/read', requirements: 'configRequirements/read', threadState: 'host-thread-state-audit', mcp: 'mcpServerStatus/list', skills: 'skills/list',
  capabilities: 'host-capability-audit', instructions: 'thread-instruction-audit', toolCatalog: 'instrumented-tool-catalog',
  environment: 'host-environment-audit', runtime: 'controlled-sandbox-probe',
};
function observation<T>(policy: CodexPolicy, key: keyof PolicyEvidence, value: T): Observation<T> {
  return { scope: policy.evidenceScope, source: sources[key], reference: `synthetic-fixture:${key}`, complete: true, value };
}
/** Synthetic ONLY: these values do not establish that any actual Codex gate has passed. */
function evidenceFor(policy: CodexPolicy): PolicyEvidence {
  const values: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(policy.configOverrides)) {
    const keys = path.split('.');
    let target = values;
    for (const key of keys.slice(0, -1)) {
      target[key] ??= {};
      target = target[key] as Record<string, unknown>;
    }
    target[keys[keys.length - 1]] = structuredClone(value);
  }
  return {
    config: observation(policy, 'config', { values, layersReviewed: true }),
    requirements: observation(policy, 'requirements', { compatible: true, unresolved: [] }),
    ...(policy.modelTurn ? { threadState: observation(policy, 'threadState', { cwd: policy.workspace, approvalPolicy: 'never',
      sandboxPolicy: structuredClone(policy.sandboxPolicy) }) } : {}),
    mcp: observation(policy, 'mcp', []), skills: observation(policy, 'skills', []),
    capabilities: observation(policy, 'capabilities', []), instructions: observation(policy, 'instructions', []),
    toolCatalog: observation(policy, 'toolCatalog', policy.operation === 'generation'
      ? [{ name: 'exec_command', enabled: true, origin: 'builtin' }] : []),
    environment: observation(policy, 'environment', {
      serverCwd: policy.workspace, codexHome: policy.codexHome, dedicatedHome: true, credentialsCopied: false,
      normalSettingsChanged: false, inheritedEnvironmentKeys: [], environmentReviewed: true,
    }),
    runtime: observation(policy, 'runtime', {
      version: PINNED_CODEX_VERSION, backend: 'windows-native', sandboxPolicy: structuredClone(policy.sandboxPolicy),
      filesystemWriteProbe: 'passed', toolEgressProbe: 'passed', modelTrafficDistinguished: true,
    }),
  };
}
function rejected(policy: CodexPolicy, evidence: PolicyEvidence, code?: string) {
  const result = auditCodexPolicy(policy, evidence);
  assert.equal(result.decision, 'reject');
  assert.equal(result.runtimeVerifiedHere, false);
  if (code) assert.ok(result.issues.some((issue) => issue.code === code), JSON.stringify(result.issues));
}

test('definition uses transport outputSchema and a read-only closed turn, not output files', () => {
  const policy = createCodexPolicy(definitionInput);
  assert.equal(policy.operation, 'definition');
  if (policy.operation !== 'definition') throw new Error('Expected definition.');
  assert.deepEqual(policy.threadStart, { method: 'thread/start', params: {
    model: 'selected-model', cwd: common.workspace, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: false,
  } });
  assert.deepEqual(policy.turnPolicy, { cwd: common.workspace, approvalPolicy: 'never',
    sandboxPolicy: { type: 'readOnly', networkAccess: false }, outputSchema: schema });
  assert.equal(policy.result, 'transport-final-json');
  assert.equal(policy.modelTurn, true);
  assert.equal('commandExec' in policy, false);
  assert.equal('tools' in policy.threadStart.params, false);
  assert.equal('response_format' in policy.turnPolicy, false);
});

test('generation selects exact pinned workspace-write fields and never confuses writes with reads', () => {
  const policy = createCodexPolicy(generationInput);
  assert.equal(policy.operation, 'generation');
  if (policy.operation !== 'generation') throw new Error('Expected generation.');
  assert.deepEqual(policy.sandboxPolicy, { type: 'workspaceWrite', writableRoots: [common.workspace],
    networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true });
  assert.equal(policy.threadStart.params.sandbox, 'workspace-write');
  assert.equal('outputSchema' in policy.turnPolicy, false);
  assert.equal(policy.result, 'workspace-json');
  assert.equal(policy.configOverrides['features.shell_tool'], true);
  assert.equal(policy.readAccess, 'not-job-confined');
  assert.equal(policy.requiresRuntimeVerification, true);
  assert.equal('mcp_servers' in policy.configOverrides, false);
});

test('saved solver constructs argv and bounded buffered command/exec without a thread or model turn', () => {
  const policy = createCodexPolicy(solverInput);
  if (policy.operation !== 'saved-solver') throw new Error('Expected solver.');
  assert.deepEqual(policy.commandExec, { method: 'command/exec', params: {
    command: ['C:\\Runtime\\node.exe', common.workspace + '\\solver.js', '--input', common.workspace + '\\input.json'],
    cwd: common.workspace, timeoutMs: 30_000, sandboxPolicy: { type: 'readOnly', networkAccess: false },
  } });
  assert.equal(policy.modelTurn, false);
  assert.equal('threadStart' in policy, false);
  assert.equal('turnPolicy' in policy, false);
  for (const field of ['threadId', 'model', 'env', 'processId', 'tty', 'streamStdin', 'streamStdoutStderr', 'outputBytesCap', 'disableOutputCap', 'disableTimeout']) {
    assert.equal(field in policy.commandExec.params, false, field);
  }
  assert.equal(createCodexPolicy({ ...solverInput, writesWorkspace: true }).sandboxPolicy.type, 'workspaceWrite');
});

test('pin, model, schema, operation, timeout and Windows paths are validated without IO', () => {
  assert.throws(() => createCodexPolicy({ ...definitionInput, version: '0.153.5' }), /version/);
  assert.throws(() => createCodexPolicy({ ...definitionInput, model: '' }), /model/);
  assert.throws(() => createCodexPolicy({ ...definitionInput, outputSchema: { type: 'string' } }), /outputSchema/);
  assert.throws(() => createCodexPolicy({ ...definitionInput, operation: 'other' } as unknown as PolicyInput), /operation/);
  for (const timeoutMs of [0, -1, 0.5, 600_001, Infinity, NaN]) assert.throws(() => createCodexPolicy({ ...solverInput, timeoutMs }), /timeout/);
  for (const workspace of ['relative', 'C:\\', '\\\\host\\share', 'C:\\jobs\\..\\outside', 'C:\\jobs:stream']) {
    assert.throws(() => createCodexPolicy({ ...generationInput, workspace }), /path|root|traversal/i);
  }
  for (const codexHome of [common.workspace, common.workspace + '\\auth', 'C:\\Marginalia']) {
    assert.throws(() => createCodexPolicy({ ...generationInput, codexHome }), /disjoint/);
  }
  for (const solverPath of ['C:\\elsewhere\\solver.js', common.workspace.toLowerCase()]) {
    assert.throws(() => createCodexPolicy({ ...solverInput, solverPath }), /descendants/);
  }
});

test('policy snapshots are immutable without freezing or modifying the caller schema', () => {
  const localSchema = structuredClone(schema);
  const policy = createCodexPolicy({ ...definitionInput, outputSchema: localSchema });
  localSchema.required.push('another');
  if (policy.operation !== 'definition') throw new Error('Expected definition.');
  assert.deepEqual(policy.turnPolicy.outputSchema?.required, ['definition']);
  assert.match(policy.evidenceScope, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.configOverrides));
  assert.ok(Object.isFrozen(policy.turnPolicy.sandboxPolicy));
  assert.equal(Object.isFrozen(localSchema), false);
});

test('complete synthetic evidence is consistent but never reported as verification performed here', () => {
  for (const input of [definitionInput, generationInput, solverInput]) {
    const policy = createCodexPolicy(input);
    const evidence = evidenceFor(policy);
    const before = structuredClone(evidence);
    assert.deepEqual(auditCodexPolicy(policy, evidence), { decision: 'evidence-consistent', issues: [], runtimeVerifiedHere: false });
    assert.deepEqual(evidence, before);
  }
});

test('missing, partial, source-unresolved and stale evidence fail closed for every evidence class', () => {
  const policy = createCodexPolicy(generationInput);
  rejected(policy, {}, 'evidence-missing');
  for (const key of Object.keys(sources) as (keyof PolicyEvidence)[]) {
    const missing = evidenceFor(policy); delete missing[key]; rejected(policy, missing, 'evidence-missing');
    const partial = evidenceFor(policy); partial[key]!.complete = false; rejected(policy, partial, 'evidence-incomplete');
    const stale = evidenceFor(policy); stale[key]!.scope = 'old-worker'; rejected(policy, stale, 'evidence-stale-or-mismatched');
    const noReference = evidenceFor(policy); noReference[key]!.reference = ''; rejected(policy, noReference, 'evidence-source-unresolved');
  }
  const newer = createCodexPolicy({ ...generationInput, auditId: 'worker-2/attempt-1/config-1' });
  rejected(newer, evidenceFor(policy), 'evidence-stale-or-mismatched');
  rejected(createCodexPolicy(definitionInput), evidenceFor(policy), 'evidence-stale-or-mismatched');
});

test('MCP inventory cannot stand in for the complete model-visible tool catalog', () => {
  const policy = createCodexPolicy(generationInput);
  const missing = evidenceFor(policy); delete missing.toolCatalog; rejected(policy, missing, 'evidence-missing');
  const fabricated = evidenceFor(policy); fabricated.toolCatalog!.source = 'mcpServerStatus/list';
  rejected(policy, fabricated, 'evidence-source-unresolved');
  const unknownTool = evidenceFor(policy);
  unknownTool.toolCatalog!.value.push({ name: 'web_search', enabled: true, origin: 'builtin' });
  rejected(policy, unknownTool, 'capability-not-allowed');
});

test('inherited/unknown enabled capabilities are rejected across all inventories', () => {
  const policy = createCodexPolicy(generationInput);
  for (const key of ['mcp', 'skills', 'capabilities', 'instructions', 'toolCatalog'] as const) {
    for (const origin of ['inherited', 'unknown'] as const) {
      const evidence = evidenceFor(policy);
      evidence[key]!.value.push({ name: 'exec_command', origin, enabled: true });
      rejected(policy, evidence, 'inherited-capability');
    }
  }
  const disabled = evidenceFor(policy);
  disabled.mcp!.value.push({ name: 'canary', origin: 'inherited', enabled: false });
  assert.equal(auditCodexPolicy(policy, disabled).decision, 'evidence-consistent');
});

test('read-only definition catalog has no implicit builtin tool allowance', () => {
  const policy = createCodexPolicy(definitionInput);
  const evidence = evidenceFor(policy);
  evidence.toolCatalog!.value.push({ name: 'exec_command', origin: 'builtin', enabled: true });
  rejected(policy, evidence, 'capability-not-allowed');
});

test('effective config contradictions and unreviewed features cannot be hidden by empty inventories', () => {
  const policy = createCodexPolicy(generationInput);
  for (const [key, value] of [['approval_policy', 'on-request'], ['web_search', 'live'], ['sandbox_mode', 'danger-full-access']] as const) {
    const evidence = evidenceFor(policy); evidence.config!.value.values[key] = value;
    rejected(policy, evidence, 'config-mismatch');
  }
  for (const value of [true, 'false']) {
    const evidence = evidenceFor(policy);
    (evidence.config!.value.values.features as Record<string, unknown>).new_unknown_capability = value;
    rejected(policy, evidence, 'unreviewed-feature');
  }
  for (const table of ['mcp_servers', 'plugins']) {
    const evidence = evidenceFor(policy); evidence.config!.value.values[table] = { canary: {} };
    rejected(policy, evidence, 'inherited-capability');
  }
  const skills = evidenceFor(policy);
  (skills.config!.value.values.skills as Record<string, unknown>).config = [{ path: 'C:\\canary\\SKILL.md', enabled: true }];
  rejected(policy, skills, 'inherited-capability');
});

test('unreviewed layers or administrative constraints block acceptance', () => {
  const policy = createCodexPolicy(generationInput);
  const layers = evidenceFor(policy); layers.config!.value.layersReviewed = false; rejected(policy, layers, 'config-unresolved');
  const constraints = evidenceFor(policy); constraints.requirements!.value.compatible = false; rejected(policy, constraints, 'requirements-unresolved');
  const unresolved = evidenceFor(policy); unresolved.requirements!.value.unresolved.push('managed policy'); rejected(policy, unresolved, 'requirements-unresolved');
});

test('credential copying, normal-settings changes, inherited env and server/job cwd mismatch are refused', () => {
  const policy = createCodexPolicy(solverInput);
  const changes = [
    { credentialsCopied: true }, { normalSettingsChanged: true }, { dedicatedHome: false }, { environmentReviewed: false },
    { inheritedEnvironmentKeys: ['UNRELATED_TOKEN'] }, { serverCwd: 'C:\\different' }, { codexHome: common.workspace },
  ];
  for (const change of changes) {
    const evidence = evidenceFor(policy); Object.assign(evidence.environment!.value, change);
    rejected(policy, evidence, 'environment-unresolved');
  }
});

test('network policy is not proof: missing probes, widened policies or conflated model traffic fail', () => {
  const policy = createCodexPolicy(generationInput);
  const changes = [
    { toolEgressProbe: 'not-run' }, { toolEgressProbe: 'failed' }, { filesystemWriteProbe: 'failed' },
    { modelTrafficDistinguished: false }, { version: '0.153.5' }, { backend: 'none' },
    { sandboxPolicy: { ...policy.sandboxPolicy, networkAccess: true } },
  ];
  for (const change of changes) {
    const evidence = evidenceFor(policy); Object.assign(evidence.runtime!.value, change);
    rejected(policy, evidence, 'runtime-evidence-unresolved');
  }
});

test('malformed host observations fail closed rather than throwing or exposing raw values', () => {
  const policy = createCodexPolicy(generationInput);
  for (const key of Object.keys(sources) as (keyof PolicyEvidence)[]) {
    const evidence = evidenceFor(policy); (evidence[key] as Observation<unknown>).value = null;
    rejected(policy, evidence);
  }
  const evidence = evidenceFor(policy);
  evidence.config!.value.values.web_search = 'DO-NOT-ECHO-SECRET';
  assert.equal(JSON.stringify(auditCodexPolicy(policy, evidence)).includes('DO-NOT-ECHO-SECRET'), false);
});

test('Windows solver cancellation fences output; no terminate, confirmed kill or automatic retry', () => {
  const policy = createCodexPolicy(solverInput);
  assert.deepEqual(cancellationFor(policy), {
    strategy: 'fence-and-timeout', request: null, state: 'cancel_requested', discardLateOutput: true,
    processStopConfirmed: false, automaticRetry: false,
  });
  assert.equal(policy.disconnectOutcome, 'outcome_unknown');
  assert.equal(policy.automaticRetry, false);
});

test('model cancellation requests interrupt but does not turn its acknowledgement into completion', () => {
  const policy = createCodexPolicy(generationInput);
  const cancel = cancellationFor(policy, { threadId: 'thread-1', turnId: 'turn-1' });
  assert.deepEqual(cancel.request, { method: 'turn/interrupt', params: { threadId: 'thread-1', turnId: 'turn-1' } });
  assert.equal(cancel.state, 'cancel_requested');
  assert.equal(cancel.processStopConfirmed, false);
  assert.equal(cancel.discardLateOutput, true);
  assert.equal(cancellationFor(policy).strategy, 'fence-unverified');
});

test('non-Windows construction is not mistaken for verified platform support', () => {
  const policy = createCodexPolicy({ ...solverInput, platform: 'linux', workspace: '/jobs/one', codexHome: '/codex-home',
    executable: '/runtime/node', solverPath: '/jobs/one/solver.js', inputPath: '/jobs/one/input.json' });
  rejected(policy, evidenceFor(policy), 'platform-unverified');
  assert.equal(cancellationFor(policy).strategy, 'fence-unverified');
});


test('inherited writable roots must not survive the effective config projection', () => {
  const policy = createCodexPolicy(generationInput);
  const evidence = evidenceFor(policy);
  (evidence.config!.value.values.sandbox_workspace_write as Record<string, unknown>).writable_roots = [policy.workspace, 'C:\\outside'];
  rejected(policy, evidence, 'config-mismatch');
});

test('returned model-thread policy is audited independently; solver execution requires no thread', () => {
  const policy = createCodexPolicy(generationInput);
  for (const change of [{ cwd: 'C:\\outside' }, { approvalPolicy: 'on-request' }, { sandboxPolicy: { type: 'dangerFullAccess' } }]) {
    const evidence = evidenceFor(policy); Object.assign(evidence.threadState!.value, change);
    rejected(policy, evidence, 'thread-policy-unresolved');
  }
  const solver = createCodexPolicy(solverInput);
  const evidence = evidenceFor(solver);
  assert.equal(evidence.threadState, undefined);
  assert.equal(auditCodexPolicy(solver, evidence).decision, 'evidence-consistent');
});
