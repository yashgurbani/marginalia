import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PINNED_CODEX_VERSION, createCodexPolicy, auditCodexPolicy, cancellationFor,
  type CodexPolicy, type PolicyInput, type PolicyEvidence, type Platform, type PolicyAdapter,
  type Observation,
} from '../daemon/codex-policy.ts';

const schema = { type: 'object', additionalProperties: false, properties: { definition: { type: 'string' } }, required: ['definition'] };
const paths = {
  win32: { workspace: 'C:\\Marginalia\\jobs\\one', codexHome: 'C:\\Marginalia\\codex-home', executable: 'C:\\Runtime\\node.exe', separator: '\\' },
  linux: { workspace: '/jobs/one', codexHome: '/codex-home', executable: '/runtime/node', separator: '/' },
  darwin: { workspace: '/jobs/one', codexHome: '/codex-home', executable: '/runtime/node', separator: '/' },
};
const backends = { win32: 'windows-native', linux: 'linux-landlock-seccomp', darwin: 'macos-seatbelt' } as const;
function input(platform: Platform, operation: PolicyInput['operation'], adapter: PolicyAdapter = 'app-server'): PolicyInput {
  const p = paths[platform];
  const common = { version: PINNED_CODEX_VERSION, platform, adapter, workspace: p.workspace, codexHome: p.codexHome, auditId: 'worker-1/attempt-1/config-1' };
  return operation === 'saved-solver'
    ? { ...common, operation, executable: p.executable, solverPath: p.workspace + p.separator + 'solver.js', inputPath: p.workspace + p.separator + 'input.json', writesWorkspace: false, timeoutMs: 30_000 }
    : operation === 'definition' ? { ...common, operation, model: 'selected-model', outputSchema: schema }
    : { ...common, operation, model: 'selected-model' };
}
function observation<T>(policy: CodexPolicy, source: string, value: T): Observation<T> {
  return { scope: policy.evidenceScope, source, reference: `synthetic-fixture:${source}`, complete: true, value };
}
/** Synthetic fixtures exercise the evaluator, never attest to an installed platform or provider. */
function evidenceFor(policy: CodexPolicy): PolicyEvidence {
  const values: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(policy.configOverrides)) {
    const keys = path.split('.'); let target = values;
    for (const key of keys.slice(0, -1)) { target[key] ??= {}; target = target[key] as Record<string, unknown>; }
    target[keys.at(-1)!] = structuredClone(value);
  }
  const app = policy.adapter === 'app-server';
  return {
    authentication: observation(policy, app ? 'account/read' : 'host-dedicated-auth-audit', { available: true, dedicatedHome: true, accountReference: 'synthetic-account' }),
    config: observation(policy, app ? 'config/read' : 'host-effective-config-audit', { values, layersReviewed: true }),
    requirements: observation(policy, app ? 'configRequirements/read' : 'host-config-requirements-audit', { compatible: true, unresolved: [] }),
    ...(app && policy.modelTurn ? { threadState: observation(policy, 'host-thread-state-audit', { cwd: policy.workspace, approvalPolicy: 'never', sandboxPolicy: structuredClone(policy.sandboxPolicy) }) } : {}),
    mcp: observation(policy, app ? 'mcpServerStatus/list' : 'host-mcp-config-audit', []),
    skills: observation(policy, app ? 'skills/list' : 'host-skill-config-audit', []),
    capabilities: observation(policy, app ? 'host-capability-audit' : 'mcp-tools/list', []),
    instructions: observation(policy, app ? 'thread-instruction-audit' : 'host-instruction-config-audit', []),
    environment: observation(policy, 'host-environment-audit', {
      serverCwd: policy.workspace, codexHome: policy.codexHome, dedicatedHome: true, credentialsCopied: false,
      normalSettingsChanged: false, inheritedEnvironmentKeys: [], inheritedEnvironmentValueDigests: {}, environmentReviewed: true,
      executableResolutionReviewed: true, ...(policy.platform === 'win32' ? { windowsKeyCasingReviewed: true } : {}),
    }),
    runtime: observation(policy, 'controlled-sandbox-probe', {
      version: PINNED_CODEX_VERSION, adapter: policy.adapter, platform: policy.platform, backend: backends[policy.platform],
      providerInstanceId: 'synthetic-worker', profileManifestSha256: policy.reviewedProfile.manifestSha256,
      sandboxPolicy: structuredClone(policy.sandboxPolicy), modelReachableReadProbe: 'passed',
      filesystemWriteProbe: 'passed', closedToolNetworkProbe: 'passed', modelTrafficDistinguished: true,
    }),
  };
}
function rejected(policy: CodexPolicy, evidence: PolicyEvidence, code?: string) {
  const result = auditCodexPolicy(policy, evidence);
  assert.equal(result.decision, 'reject'); assert.equal(result.runtimeVerifiedHere, false);
  if (code) assert.ok(result.issues.some(issue => issue.code === code), JSON.stringify(result.issues));
}

for (const platform of ['win32', 'linux', 'darwin'] as const) {
  test(`${platform}: construct every operation, but require its own complete runtime evidence`, () => {
    for (const operation of ['definition', 'generation', 'saved-solver'] as const) {
      const policy = createCodexPolicy(input(platform, operation));
      assert.equal(policy.platform, platform);
      assert.equal(policy.reviewedProfile.platform, platform);
      assert.equal(policy.reviewedProfile.runtimeBackend, backends[platform]);
      assert.ok(policy.reviewedProfile.id.includes(`:${platform}:`));
      assert.equal(policy.configOverrides['windows.sandbox'], platform === 'win32' ? 'elevated' : undefined);
      assert.equal(policy.sandboxPolicy.networkAccess, false);
      assert.equal(policy.readAccess, 'not-job-confined'); assert.equal(policy.requiresRuntimeVerification, true);
      rejected(policy, {}, 'evidence-missing');
      const evidence = evidenceFor(policy), before = structuredClone(evidence);
      const result = auditCodexPolicy(policy, evidence);
      assert.equal(result.decision, 'evidence-consistent'); assert.equal(result.dispatchPolicySatisfied, true);
      assert.equal(result.runtimeVerifiedHere, false); assert.deepEqual(evidence, before);
      for (const change of [
        { platform: platform === 'linux' ? 'win32' : 'linux' },
        { backend: platform === 'win32' ? 'macos-seatbelt' : 'windows-native' },
        { profileManifestSha256: '0'.repeat(64) }, { providerInstanceId: '' }, { adapter: 'mcp-server' },
        { version: '0.153.5' }, { modelReachableReadProbe: 'not-run' }, { filesystemWriteProbe: 'failed' },
        { closedToolNetworkProbe: 'failed' }, { modelTrafficDistinguished: false },
        { sandboxPolicy: { ...policy.sandboxPolicy, networkAccess: true } },
      ]) {
        const changed = evidenceFor(policy); Object.assign(changed.runtime!.value, change);
        rejected(policy, changed, 'runtime-evidence-unresolved');
      }
      const missing = evidenceFor(policy); delete (missing.runtime!.value as Partial<NonNullable<PolicyEvidence['runtime']>['value']>).platform;
      rejected(policy, missing, 'runtime-evidence-unresolved');
    }
  });

  test(`${platform}: platform-specific environment keys still require value and executable review`, () => {
    const policy = createCodexPolicy(input(platform, 'definition'));
    const key = platform === 'win32' ? 'SystemRoot' : 'TMPDIR';
    const evidence = evidenceFor(policy);
    evidence.environment!.value.inheritedEnvironmentKeys = [key];
    evidence.environment!.value.inheritedEnvironmentValueDigests = { [key]: 'a'.repeat(64) };
    assert.equal(auditCodexPolicy(policy, evidence).decision, 'evidence-consistent');
    for (const change of [
      { inheritedEnvironmentValueDigests: {} }, { executableResolutionReviewed: false }, { environmentReviewed: false },
      { credentialsCopied: true }, { normalSettingsChanged: true }, { dedicatedHome: false },
      { serverCwd: '/different' }, { codexHome: policy.workspace }, { inheritedEnvironmentKeys: ['UNRELATED_TOKEN'] },
      ...(platform === 'win32' ? [{ windowsKeyCasingReviewed: false }] : [{ inheritedEnvironmentKeys: ['SystemRoot'] }]),
    ]) {
      const changed = structuredClone(evidence); Object.assign(changed.environment!.value, change);
      rejected(policy, changed, 'environment-unresolved');
    }
  });

  test(`${platform}: MCP requires its own evidence; a complete model tool catalog is not invented`, () => {
    const policy = createCodexPolicy(input(platform, 'definition', 'mcp-server'));
    const evidence = evidenceFor(policy);
    evidence.capabilities!.value = [{ name: 'codex', enabled: true, origin: 'builtin' }];
    assert.equal(auditCodexPolicy(policy, evidence).decision, 'evidence-consistent');
    assert.equal(evidence.threadState, undefined);
    evidence.config!.source = 'config/read'; rejected(policy, evidence, 'evidence-source-unresolved');
  });
}

test('definition, generation and saved-solver construction retain their distinct execution contracts', () => {
  const definition = createCodexPolicy(input('win32', 'definition'));
  if (definition.operation !== 'definition') throw new Error('Expected definition');
  assert.equal(definition.result, 'transport-final-json'); assert.equal(definition.modelTurn, true);
  assert.deepEqual(definition.turnPolicy, { cwd: paths.win32.workspace, approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false }, outputSchema: schema });
  assert.equal('commandExec' in definition, false); assert.equal('tools' in definition.threadStart.params, false);
  assert.equal('response_format' in definition.turnPolicy, false);
  const generation = createCodexPolicy(input('win32', 'generation'));
  if (generation.operation !== 'generation') throw new Error('Expected generation');
  assert.deepEqual(generation.sandboxPolicy, { type: 'workspaceWrite', writableRoots: [paths.win32.workspace], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true });
  assert.equal(generation.configOverrides['features.shell_tool'], true); assert.equal('outputSchema' in generation.turnPolicy, false);
  assert.equal(generation.result, 'workspace-json'); assert.equal('mcp_servers' in generation.configOverrides, false);
  const solverInput = input('win32', 'saved-solver');
  if (solverInput.operation !== 'saved-solver') throw new Error('Expected solver');
  const solver = createCodexPolicy(solverInput);
  if (solver.operation !== 'saved-solver') throw new Error('Expected solver');
  assert.deepEqual(solver.commandExec.params.command, [paths.win32.executable, solverInput.solverPath, '--input', solverInput.inputPath]);
  assert.equal(solver.commandExec.params.timeoutMs, 30_000); assert.equal(solver.modelTurn, false);
  for (const key of ['threadId', 'model', 'env', 'processId', 'tty', 'streamStdin', 'streamStdoutStderr', 'outputBytesCap', 'disableOutputCap', 'disableTimeout']) assert.equal(key in solver.commandExec.params, false);
  assert.equal('threadStart' in solver, false); assert.equal('turnPolicy' in solver, false);
  assert.equal(createCodexPolicy({ ...solverInput, writesWorkspace: true }).sandboxPolicy.type, 'workspaceWrite');
  assert.throws(() => createCodexPolicy({ ...solverInput, adapter: 'mcp-server' }), /app-server/);
});

test('unsafe paths, versions, operations, model/schema and time limits remain rejected without IO', () => {
  const definition = input('win32', 'definition'), solver = input('win32', 'saved-solver');
  if (definition.operation !== 'definition' || solver.operation !== 'saved-solver') throw new Error('Fixture');
  assert.throws(() => createCodexPolicy({ ...definition, version: '0.153.5' }), /version/);
  assert.throws(() => createCodexPolicy({ ...definition, model: '' }), /model/);
  assert.throws(() => createCodexPolicy({ ...definition, outputSchema: { type: 'string' } }), /outputSchema/);
  assert.throws(() => createCodexPolicy({ ...definition, operation: 'other' } as unknown as PolicyInput), /operation/);
  for (const timeoutMs of [0, -1, 0.5, 600_001, Infinity, NaN]) assert.throws(() => createCodexPolicy({ ...solver, timeoutMs }), /timeout/);
  for (const workspace of ['relative', 'C:\\', '\\\\host\\share', 'C:\\jobs\\..\\outside', 'C:\\jobs:stream']) assert.throws(() => createCodexPolicy({ ...definition, workspace }), /path|root|traversal/i);
  for (const codexHome of [paths.win32.workspace, paths.win32.workspace + '\\auth', 'C:\\Marginalia']) assert.throws(() => createCodexPolicy({ ...definition, codexHome }), /disjoint/);
  for (const solverPath of ['C:\\elsewhere\\solver.js', paths.win32.workspace.toLowerCase()]) assert.throws(() => createCodexPolicy({ ...solver, solverPath }), /descendants/);
  for (const platform of ['linux', 'darwin'] as const) {
    const posix = input(platform, 'generation');
    for (const workspace of ['relative', '/', '/jobs/../outside', 'C:\\jobs']) assert.throws(() => createCodexPolicy({ ...posix, workspace }), /path|root|traversal/i);
    assert.throws(() => createCodexPolicy({ ...posix, codexHome: '/jobs/one/auth' }), /disjoint/);
  }
});

test('policy snapshots are immutable and audit epochs differ from platform profile identity', () => {
  const localSchema = structuredClone(schema), base = input('win32', 'definition');
  if (base.operation !== 'definition') throw new Error('Fixture');
  const policy = createCodexPolicy({ ...base, outputSchema: localSchema }); localSchema.required.push('another');
  if (policy.operation !== 'definition') throw new Error('Fixture');
  assert.deepEqual(policy.turnPolicy.outputSchema?.required, ['definition']);
  assert.ok(Object.isFrozen(policy.configOverrides)); assert.ok(Object.isFrozen(policy.turnPolicy.sandboxPolicy)); assert.equal(Object.isFrozen(localSchema), false);
  const newer = createCodexPolicy({ ...base, auditId: 'worker-2' });
  assert.notEqual(policy.evidenceScope, newer.evidenceScope); assert.equal(policy.reviewedProfile.manifestSha256, newer.reviewedProfile.manifestSha256);
  rejected(newer, evidenceFor(policy), 'evidence-stale-or-mismatched');
  assert.notEqual(createCodexPolicy(input('linux', 'definition')).reviewedProfile.manifestSha256, createCodexPolicy(input('darwin', 'definition')).reviewedProfile.manifestSha256);
});

test('missing, incomplete, wrong-source and stale mandatory evidence fail closed', () => {
  const policy = createCodexPolicy(input('win32', 'generation'));
  for (const key of Object.keys(evidenceFor(policy)) as Exclude<keyof PolicyEvidence, 'catalog'>[]) {
    const missing = evidenceFor(policy); delete missing[key]; rejected(policy, missing, 'evidence-missing');
    for (const [field, value, code] of [['complete', false, 'evidence-incomplete'], ['scope', 'old-worker', 'evidence-stale-or-mismatched'], ['reference', '', 'evidence-source-unresolved']] as const) {
      const changed = evidenceFor(policy); Object.assign(changed[key]!, { [field]: value }); rejected(policy, changed, code);
    }
    const malformed = evidenceFor(policy); (malformed[key] as Observation<unknown>).value = null; rejected(policy, malformed);
  }
  const bootstrap = evidenceFor(policy); delete bootstrap.threadState;
  assert.equal(auditCodexPolicy(policy, bootstrap, 'bootstrap').decision, 'evidence-consistent');
  rejected(policy, bootstrap, 'evidence-missing');
});

test('catalog observation is optional but any observed unreviewed tool still vetoes dispatch', () => {
  const policy = createCodexPolicy(input('win32', 'generation'));
  const evidence = evidenceFor(policy);
  evidence.catalog = { status: 'incomplete', scope: policy.evidenceScope, source: 'instrumented-tool-catalog', reference: 'synthetic-catalog', reason: 'Partial observation only', entries: [{ name: 'exec_command', enabled: true, origin: 'builtin' }] };
  assert.equal(auditCodexPolicy(policy, evidence).decision, 'evidence-consistent');
  evidence.catalog.entries.push({ name: 'web_search', enabled: true, origin: 'builtin' });
  rejected(policy, evidence); assert.equal(auditCodexPolicy(policy, evidence).perRequestCatalogVeto, 'unsupported');
  const definition = createCodexPolicy(input('win32', 'definition')), tools = evidenceFor(definition);
  tools.catalog = { ...evidence.catalog, scope: definition.evidenceScope, entries: [{ name: 'exec_command', enabled: true, origin: 'builtin' }] };
  rejected(definition, tools);
});

test('inherited capabilities, config contradictions, extra write roots and unreviewed constraints remain blocked', () => {
  const policy = createCodexPolicy(input('win32', 'generation'));
  for (const key of ['mcp', 'skills', 'capabilities', 'instructions'] as const) for (const origin of ['inherited', 'unknown'] as const) {
    const evidence = evidenceFor(policy); evidence[key]!.value.push({ name: 'exec_command', origin, enabled: true }); rejected(policy, evidence, 'inherited-capability');
  }
  const disabled = evidenceFor(policy); disabled.mcp!.value.push({ name: 'canary', origin: 'inherited', enabled: false }); assert.equal(auditCodexPolicy(policy, disabled).decision, 'evidence-consistent');
  for (const [key, value] of [['approval_policy', 'on-request'], ['web_search', 'live'], ['sandbox_mode', 'danger-full-access']] as const) {
    const evidence = evidenceFor(policy); evidence.config!.value.values[key] = value; rejected(policy, evidence, 'config-mismatch');
  }
  for (const value of [true, 'false']) {
    const evidence = evidenceFor(policy); (evidence.config!.value.values.features as Record<string, unknown>).unreviewed = value; rejected(policy, evidence, 'unreviewed-feature');
  }
  for (const table of ['mcp_servers', 'plugins']) {
    const evidence = evidenceFor(policy); evidence.config!.value.values[table] = { canary: {} }; rejected(policy, evidence, 'inherited-capability');
  }
  const skills = evidenceFor(policy); (skills.config!.value.values.skills as Record<string, unknown>).config = [{ path: 'canary', enabled: true }]; rejected(policy, skills, 'inherited-capability');
  const roots = evidenceFor(policy); (roots.config!.value.values.sandbox_workspace_write as Record<string, unknown>).writable_roots = [policy.workspace, 'C:\\outside']; rejected(policy, roots, 'config-mismatch');
  const layers = evidenceFor(policy); layers.config!.value.layersReviewed = false; rejected(policy, layers, 'config-unresolved');
  for (const change of [{ compatible: false }, { unresolved: ['managed policy'] }]) {
    const evidence = evidenceFor(policy); Object.assign(evidence.requirements!.value, change); rejected(policy, evidence, 'requirements-unresolved');
  }
  for (const change of [{ cwd: 'C:\\outside' }, { approvalPolicy: 'on-request' }, { sandboxPolicy: { type: 'dangerFullAccess' } }]) {
    const evidence = evidenceFor(policy); Object.assign(evidence.threadState!.value, change); rejected(policy, evidence, 'thread-policy-unresolved');
  }
  const secret = evidenceFor(policy); secret.config!.value.values.web_search = 'DO-NOT-ECHO-SECRET'; assert.equal(JSON.stringify(auditCodexPolicy(policy, secret)).includes('DO-NOT-ECHO-SECRET'), false);
});

test('cancellation never claims confirmed process termination or automatic retry on any platform', () => {
  for (const platform of ['win32', 'linux', 'darwin'] as const) {
    const solver = createCodexPolicy(input(platform, 'saved-solver'));
    assert.deepEqual(cancellationFor(solver), { strategy: platform === 'win32' ? 'fence-and-timeout' : 'fence-unverified', request: null, state: 'cancel_requested', discardLateOutput: true, processStopConfirmed: false, automaticRetry: false });
    assert.equal(solver.disconnectOutcome, 'outcome_unknown'); assert.equal(solver.automaticRetry, false);
    const model = createCodexPolicy(input(platform, 'generation')), cancel = cancellationFor(model, { threadId: 'thread-1', turnId: 'turn-1' });
    assert.deepEqual(cancel.request, { method: 'turn/interrupt', params: { threadId: 'thread-1', turnId: 'turn-1' } });
    assert.equal(cancel.processStopConfirmed, false); assert.equal(cancel.discardLateOutput, true); assert.equal(cancellationFor(model).strategy, 'fence-unverified');
  }
});
