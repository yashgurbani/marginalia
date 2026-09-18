import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { isDigest } from '../contracts/digest.ts';

/** Pure policy preparation, not an app-server client or an isolation certificate. */
export const PINNED_CODEX_VERSION = '0.153.4' as const;
export const CODEX_POLICY_VERSION = 'marginalia.codex-policy.v1' as const;
export type Platform = 'win32' | 'linux' | 'darwin';
/** Host evidence labels, not a claim that a backend was provisioned or probed. */
export type RuntimeBackend = 'windows-native' | 'linux-landlock-seccomp' | 'macos-seatbelt';
const platformBackends: Readonly<Record<Platform, RuntimeBackend>> = {
  win32: 'windows-native', linux: 'linux-landlock-seccomp', darwin: 'macos-seatbelt',
};
export type Operation = 'definition' | 'generation' | 'saved-solver';
export type PolicyAdapter = 'app-server' | 'mcp-server';
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type ClosedSandbox =
  | { readonly type: 'readOnly'; readonly networkAccess: false }
  | { readonly type: 'workspaceWrite'; readonly writableRoots: readonly string[]; readonly networkAccess: false;
      readonly excludeTmpdirEnvVar: true; readonly excludeSlashTmp: true };

type CommonInput = {
  homeMode?: 'dedicated' | 'ordinary';
  version: string;
  platform: Platform;
  adapter: PolicyAdapter;
  workspace: string;
  codexHome: string;
  /** Host-owned worker/attempt/configuration identity; replace after restart or any config change. */
  auditId: string;
};
export type PolicyInput = CommonInput & (
  | { operation: 'definition'; model: string; outputSchema: { readonly [key: string]: JsonValue } }
  | { operation: 'generation'; model: string }
  | { operation: 'saved-solver'; executable: string; solverPath: string; inputPath: string;
      writesWorkspace: boolean; timeoutMs: number }
);

type ThreadStart = {
  readonly method: 'thread/start';
  readonly params: { readonly model: string; readonly cwd: string; readonly approvalPolicy?: 'never';
    readonly sandbox?: 'read-only' | 'workspace-write'; readonly ephemeral: false };
};
/** Adapter adds threadId and granted input; these are policy fields, not a complete turn request. */
export type TurnPolicy = { readonly cwd: string; readonly approvalPolicy?: 'never'; readonly sandboxPolicy?: ClosedSandbox;
  readonly outputSchema?: { readonly [key: string]: JsonValue } };

type PolicyBase = {
  readonly homeMode?: 'dedicated' | 'ordinary';
  readonly version: typeof PINNED_CODEX_VERSION;
  readonly policyVersion: typeof CODEX_POLICY_VERSION;
  readonly platform: Platform;
  readonly adapter: PolicyAdapter;
  readonly reviewedProfile: ReviewedPolicyProfile;
  readonly workspace: string;
  readonly codexHome: string;
  readonly evidenceScope: string;
  /** Dotted CLI/config override keys. An empty MCP/skills map is deliberately NOT a reset mechanism. */
  readonly configOverrides: Readonly<Record<string, JsonValue>>;
  readonly sandboxPolicy: ClosedSandbox;
  readonly readAccess: 'not-job-confined';
  readonly requiresRuntimeVerification: true;
  readonly automaticRetry: false;
  readonly disconnectOutcome: 'outcome_unknown';
};
export type CodexPolicy = PolicyBase & (
  | { readonly operation: 'definition'; readonly modelTurn: true; readonly result: 'transport-final-json';
      readonly threadStart: ThreadStart; readonly turnPolicy: TurnPolicy }
  | { readonly operation: 'generation'; readonly modelTurn: true; readonly result: 'workspace-json';
      readonly threadStart: ThreadStart; readonly turnPolicy: TurnPolicy }
  | { readonly operation: 'saved-solver'; readonly modelTurn: false; readonly result: 'buffered-command-json';
      readonly commandExec: { readonly method: 'command/exec'; readonly params: {
        readonly command: readonly string[]; readonly cwd: string; readonly timeoutMs: number;
        readonly sandboxPolicy: ClosedSandbox;
      } } }
);

const disabledFeatures = [
  'apps', 'plugins', 'hooks', 'browser_use', 'computer_use', 'image_generation',
  'multi_agent', 'multi_agent_v2', 'memories', 'shell_snapshot', 'shell_snapshot_v2', 'code_mode', 'code_mode_host',
] as const;
const generationTools = new Set(['shell_command', 'exec_command', 'write_stdin', 'apply_patch', 'update_plan', 'view_image']);
export const REVIEWED_PROVIDER_ENVIRONMENT_KEYS = [
  'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
] as const;
const POSIX_PROVIDER_ENVIRONMENT_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL'] as const;
export type ReviewedPolicyProfile = {
  readonly id: string;
  readonly reviewRef: string;
  readonly reviewedSourceRevision: string;
  readonly manifestSha256: string;
  readonly version: typeof PINNED_CODEX_VERSION;
  readonly adapter: PolicyAdapter;
  readonly platform: Platform;
  readonly operation: Operation;
  readonly runtimeBackend: RuntimeBackend;
  readonly reviewedBuiltinTools: readonly string[];
  readonly reviewedAdapterCapabilities: readonly string[];
  readonly reviewedInstructionSources: readonly string[];
  readonly inheritedEnvironmentKeys: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly catalogRequiredForDispatch: false;
};
function reviewedProfile(adapter: PolicyAdapter, operation: Operation, platform: Platform): ReviewedPolicyProfile {
  const modelTurn = operation !== 'saved-solver';
  const capabilities = adapter === 'app-server'
    ? ['thread/start', 'thread/resume', 'turn/start', 'turn/interrupt', 'thread/read']
    : ['codex', 'codex-reply', 'codex/event'];
  const manifest: Omit<ReviewedPolicyProfile, 'manifestSha256'> = {
    id: `codex-0.153.4:${platform}:${adapter}:${operation}:review-2026-09-17`, version: PINNED_CODEX_VERSION,
    reviewRef: 'wayfinder/build-receipts/T13-pro.md', reviewedSourceRevision: '3d2ee51ca2d5db578f328aa75e20aa22c0197c9a',
    adapter, platform, operation, runtimeBackend: platformBackends[platform],
    reviewedBuiltinTools: operation === 'generation' ? [...generationTools] : [],
    reviewedAdapterCapabilities: modelTurn ? capabilities : ['command/exec'],
    reviewedInstructionSources: modelTurn ? ['marginalia-request-instructions'] : [],
    inheritedEnvironmentKeys: [...(platform === 'win32' ? REVIEWED_PROVIDER_ENVIRONMENT_KEYS : POSIX_PROVIDER_ENVIRONMENT_KEYS)],
    requiredEvidence: [
      'dedicated-auth', 'effective-config', 'capability-closure', 'instruction-manifest', 'environment',
      'model-reachable-read-confinement', 'write-confinement', 'tool-network', 'model-traffic-separation',
    ],
    catalogRequiredForDispatch: false,
  };
  return freeze({ ...manifest, manifestSha256: scope(manifest) });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}
function scope(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Lexical validation only. Existence, ACLs, junctions and symlinks need host checks. */
function absolute(path: string, platform: Platform): string {
  if (!nonempty(path)) throw new Error('Expected a nonempty absolute path.');
  const api = platform === 'win32' ? win32 : posix;
  if (!api.isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error('Absolute paths without traversal are required.');
  if (platform === 'win32' && (!/^[A-Za-z]:[\\/]/.test(path) || path.slice(2).includes(':'))) {
    throw new Error('Windows paths must be local drive paths, not UNC/device paths or alternate streams.');
  }
  const normalized = api.normalize(path);
  if (normalized === api.parse(normalized).root) throw new Error('A filesystem root cannot be a policy path.');
  return normalized.replace(/[\\/]$/, '');
}
function within(root: string, candidate: string, platform: Platform): boolean {
  const api = platform === 'win32' ? win32 : posix;
  const relative = api.relative(root, candidate);
  return relative === '' || (!api.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${api.sep}`));
}

/** Constructs requests only. It never reads files, credentials, environment or provider state. */
export function createCodexPolicy(input: PolicyInput): CodexPolicy {
  if (input.version !== PINNED_CODEX_VERSION) throw new Error('Codex version requires a new reviewed policy.');
  if (!['win32', 'linux', 'darwin'].includes(input.platform)) throw new Error('Unknown platform.');
  if (!['app-server', 'mcp-server'].includes(input.adapter)) throw new Error('Unknown provider adapter.');
  if (!['definition', 'generation', 'saved-solver'].includes(input.operation)) throw new Error('Unknown operation.');
  if (input.operation === 'saved-solver' && input.adapter !== 'app-server') throw new Error('Saved solver command execution requires the reviewed app-server adapter.');
  if (!nonempty(input.auditId)) throw new Error('A host-owned audit identity is required.');
  const workspace = absolute(input.workspace, input.platform);
  const codexHome = absolute(input.codexHome, input.platform);
  if (within(workspace, codexHome, input.platform) || within(codexHome, workspace, input.platform)) {
    throw new Error('The dedicated Codex home and job workspace must be disjoint.');
  }
  if (input.operation === 'saved-solver' && typeof input.writesWorkspace !== 'boolean') throw new Error('Declare solver write requirements.');
  const write = input.operation === 'generation' || (input.operation === 'saved-solver' && input.writesWorkspace);
  const sandboxPolicy: ClosedSandbox = write
    ? { type: 'workspaceWrite', writableRoots: [workspace], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }
    : { type: 'readOnly', networkAccess: false };
  const configOverrides: Record<string, JsonValue> = {
    approval_policy: 'never', sandbox_mode: write ? 'workspace-write' : 'read-only', web_search: 'disabled',
    project_doc_max_bytes: 0, allow_login_shell: false, cli_auth_credentials_store: 'file', notify: [],
    'sandbox_workspace_write.writable_roots': [workspace],
    'sandbox_workspace_write.network_access': false, 'sandbox_workspace_write.exclude_tmpdir_env_var': true,
    'sandbox_workspace_write.exclude_slash_tmp': true, 'shell_environment_policy.inherit': 'none',
    'features.shell_tool': input.operation === 'generation', 'agents.enabled': false,
    'skills.include_instructions': false, 'skills.bundled.enabled': false,
    'orchestrator.skills.enabled': false, 'orchestrator.mcp.enabled': false,
  };
  for (const feature of disabledFeatures) configOverrides[`features.${feature}`] = false;
  if (input.platform === 'win32') configOverrides['windows.sandbox'] = 'elevated';
  // D15: the ordinary setup is intentionally inherited, never advertised as isolated.
  const ordinary = input.homeMode === 'ordinary' && input.operation !== 'saved-solver';
  if (ordinary) for (const key of Object.keys(configOverrides)) delete configOverrides[key];
  const base = {
    ...(ordinary ? { homeMode: 'ordinary' as const } : {}),
    version: PINNED_CODEX_VERSION, policyVersion: CODEX_POLICY_VERSION, platform: input.platform,
    adapter: input.adapter, reviewedProfile: reviewedProfile(input.adapter, input.operation, input.platform),
    workspace, codexHome, configOverrides, sandboxPolicy, readAccess: 'not-job-confined' as const,
    requiresRuntimeVerification: true as const, automaticRetry: false as const, disconnectOutcome: 'outcome_unknown' as const,
  };
  if (input.operation === 'saved-solver') {
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 600_000) {
      throw new Error('Solver timeout must be an integer from 1 through 600000 ms.');
    }
    const executable = absolute(input.executable, input.platform);
    const solver = absolute(input.solverPath, input.platform);
    const data = absolute(input.inputPath, input.platform);
    const api = input.platform === 'win32' ? win32 : posix;
    if (!api.relative(workspace, solver) || !api.relative(workspace, data) || !within(workspace, solver, input.platform) || !within(workspace, data, input.platform)) {
      throw new Error('Solver and input files must be descendants of the job workspace.');
    }
    const commandExec = { method: 'command/exec' as const, params: {
      command: [executable, solver, '--input', data], cwd: workspace, timeoutMs: input.timeoutMs, sandboxPolicy,
    } };
    // No threadId, model, env overlay, processId, streaming, custom capture cap or disableTimeout.
    return freeze({ ...base, operation: 'saved-solver', modelTurn: false, result: 'buffered-command-json', commandExec,
      evidenceScope: scope([CODEX_POLICY_VERSION, input.auditId, base, commandExec]) });
  }
  if (!nonempty(input.model)) throw new Error('An explicitly selected model is required.');
  const threadStart: ThreadStart = { method: 'thread/start', params: {
    model: input.model, cwd: workspace, ...(ordinary ? {} : { approvalPolicy: 'never' as const, sandbox: write ? 'workspace-write' as const : 'read-only' as const }), ephemeral: false,
  } };
  const turnPolicy: TurnPolicy = { cwd: workspace, ...(ordinary ? {} : { approvalPolicy: 'never' as const, sandboxPolicy }) };
  if (input.operation === 'definition') {
    if (!record(input.outputSchema) || input.outputSchema.type !== 'object') throw new Error('Definition requires an object outputSchema.');
    // Clone before freezing: the caller owns its schema. Provider schema support still needs an integration test.
    const definitionTurn = { ...turnPolicy, outputSchema: structuredClone(input.outputSchema) };
    return freeze({ ...base, operation: 'definition', modelTurn: true, result: 'transport-final-json', threadStart,
      turnPolicy: definitionTurn, evidenceScope: scope([CODEX_POLICY_VERSION, input.auditId, base, threadStart, definitionTurn]) });
  }
  return freeze({ ...base, operation: 'generation', modelTurn: true, result: 'workspace-json', threadStart, turnPolicy,
    evidenceScope: scope([CODEX_POLICY_VERSION, input.auditId, base, threadStart, turnPolicy]) });
}

/** Host-normalized, redacted observations, NOT additional app-server protocol fields.
 * `complete` includes pagination, defaults, inherited layers and discovery errors.
 * A reference identifies host evidence, never a model's claim. Do not accept these from page/reply JSON.
 */
export type Observation<T> = { scope: string; source: string; reference: string; complete: boolean; value: T };
export type InventoryEntry = { name: string; enabled: boolean; origin: 'builtin' | 'marginalia' | 'inherited' | 'unknown' };
export type CatalogObservation =
  | { status: 'observed'; scope: string; source: string; reference: string; complete: true; entries: InventoryEntry[] }
  | { status: 'incomplete'; scope: string; source: string; reference: string; reason: string; entries: InventoryEntry[] }
  | { status: 'unavailable'; scope: string; source: string; reference: string; reason: string };
export type PolicyEvidence = {
  authentication?: Observation<{ available: boolean; dedicatedHome: boolean; accountReference: string }>;
  config?: Observation<{ values: Record<string, unknown>; layersReviewed: boolean }>;
  requirements?: Observation<{ compatible: boolean; unresolved: string[] }>;
  /** Model jobs only: returned thread/start or thread/resume policy, plus effective turn overrides.
   * The collector must observe these, not copy the requested policy into the observation. */
  threadState?: Observation<{ cwd: string; approvalPolicy: string; sandboxPolicy: unknown }>;
  mcp?: Observation<InventoryEntry[]>;
  skills?: Observation<InventoryEntry[]>;
  /** Non-tool side effects: hooks, apps, plugins, background agents/memory, etc. */
  capabilities?: Observation<InventoryEntry[]>;
  instructions?: Observation<InventoryEntry[]>;
  /** Observability only. MCP tools/list is recorded as incomplete, never promoted to a full model catalog. */
  catalog?: CatalogObservation;
  environment?: Observation<{
    serverCwd: string; codexHome: string; dedicatedHome: boolean; credentialsCopied: boolean;
    normalSettingsChanged: boolean; inheritedEnvironmentKeys: string[]; environmentReviewed: boolean;
    inheritedEnvironmentValueDigests: Record<string, string>; windowsKeyCasingReviewed?: boolean;
    executableResolutionReviewed: boolean;
  }>;
  runtime?: Observation<{
    version: string; adapter: PolicyAdapter; platform: Platform; sandboxPolicy: unknown; backend: RuntimeBackend;
    providerInstanceId: string; profileManifestSha256: string;
    modelReachableReadProbe: 'passed' | 'failed' | 'not-run';
    filesystemWriteProbe: 'passed' | 'failed' | 'not-run';
    closedToolNetworkProbe: 'passed' | 'failed' | 'not-run';
    modelTrafficDistinguished: boolean;
  }>;
};
export type AuditIssue = { code: string; field: string };
export type AuditStage = 'bootstrap' | 'dispatch';
export type AuditDecision = {
  decision: 'reject' | 'evidence-consistent'; issues: AuditIssue[];
  stage: AuditStage;
  bootstrapPolicySatisfied: boolean;
  dispatchPolicySatisfied: boolean;
  catalogObservation: CatalogObservation['status'];
  perRequestCatalogVeto: 'none' | 'unsupported';
  unsupportedCatalogEntries: string[];
  /** Even a positive decision reports consistency of supplied evidence, not verification by this module. */
  runtimeVerifiedHere: false;
};
function at(value: unknown, dotted: string): unknown {
  let cursor = value;
  for (const key of dotted.split('.')) {
    if (!record(cursor) || !Object.hasOwn(cursor, key)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}
function same(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(value) && value.length === expected.length && expected.every((item, i) => same(value[i], item));
  if (record(expected)) return record(value) && Object.keys(value).length === Object.keys(expected).length &&
    Object.keys(expected).every((key) => Object.hasOwn(value, key) && same(value[key], expected[key]));
  return value === expected;
}

/** No IO. Reject missing, stale, partial or contradictory evidence. Never returns credentials or config values. */
export function auditCodexPolicy(policy: CodexPolicy, evidence: PolicyEvidence, stage: AuditStage = 'dispatch'): AuditDecision {
  const issues: AuditIssue[] = [];
  const issue = (code: string, field: string) => { issues.push({ code, field }); };
  const read = (key: Exclude<keyof PolicyEvidence, 'catalog'>, source: string): unknown => {
    const item = evidence?.[key];
    if (!record(item)) { issue('evidence-missing', key); return undefined; }
    if (item.complete !== true) { issue('evidence-incomplete', key); return undefined; }
    if (item.scope !== policy.evidenceScope) { issue('evidence-stale-or-mismatched', key); return undefined; }
    if (item.source !== source || !nonempty(item.reference)) { issue('evidence-source-unresolved', key); return undefined; }
    return item.value;
  };
  const authentication = read('authentication', policy.adapter === 'app-server' ? 'account/read' : 'host-dedicated-auth-audit');
  if (!record(authentication) || authentication.available !== true || authentication.dedicatedHome !== true || !nonempty(authentication.accountReference)) {
    issue('dedicated-authentication-unavailable', 'authentication');
  }
  const config = read('config', policy.adapter === 'app-server' ? 'config/read' : 'host-effective-config-audit');
  if (!record(config) || !record(config.values) || config.layersReviewed !== true) issue('config-unresolved', 'config');
  else {
    for (const [key, value] of Object.entries(policy.configOverrides)) {
      if (!same(at(config.values, key), value)) issue('config-mismatch', key);
    }
    // A newly enabled feature is unresolved until explicitly reviewed, even if MCP is empty.
    const features = at(config.values, 'features');
    if (record(features)) for (const [key, value] of Object.entries(features)) {
      if (value !== false && !(key === 'shell_tool' && policy.operation === 'generation' && value === true)) issue('unreviewed-feature', `features.${key}`);
    }
    const skillConfig = at(config.values, 'skills.config');
    if (skillConfig !== undefined) {
      if (!Array.isArray(skillConfig)) issue('config-unresolved', 'skills.config');
      else skillConfig.forEach((entry, i) => {
        if (!record(entry) || entry.enabled !== false) issue('inherited-capability', `skills.config[${i}]`);
      });
    }
    // Missing enabled flags in discovered MCP/plugin tables mean unresolved, NOT disabled.
    for (const table of ['mcp_servers', 'plugins']) {
      const entries = at(config.values, table);
      if (entries !== undefined && !record(entries)) issue('config-unresolved', table);
      else if (record(entries)) for (const [name, entry] of Object.entries(entries)) {
        if (!record(entry) || entry.enabled !== false) issue('inherited-capability', `${table}.${name}`);
      }
    }
  }
  const requirements = read('requirements', policy.adapter === 'app-server' ? 'configRequirements/read' : 'host-config-requirements-audit');
  if (!record(requirements) || requirements.compatible !== true || !Array.isArray(requirements.unresolved) || requirements.unresolved.length) {
    issue('requirements-unresolved', 'requirements');
  }
  if (stage === 'dispatch' && policy.modelTurn && policy.adapter === 'app-server') {
    const thread = read('threadState', 'host-thread-state-audit');
    if (!record(thread) || thread.cwd !== policy.workspace || thread.approvalPolicy !== 'never' ||
        !same(thread.sandboxPolicy, policy.sandboxPolicy)) issue('thread-policy-unresolved', 'threadState');
  }
  const inventory = (key: 'mcp' | 'skills' | 'capabilities' | 'instructions', source: string, allowed: ReadonlySet<string>, required = true) => {
    if (!required && evidence[key] === undefined) return;
    const entries = read(key, source);
    if (!Array.isArray(entries)) { issue('inventory-unresolved', key); return; }
    entries.forEach((entry, i) => {
      const field = `${key}[${i}]`;
      if (!record(entry) || !nonempty(entry.name) || typeof entry.enabled !== 'boolean' ||
          !['builtin', 'marginalia', 'inherited', 'unknown'].includes(String(entry.origin))) { issue('inventory-unresolved', field); return; }
      if (!entry.enabled) return;
      if (entry.origin === 'inherited' || entry.origin === 'unknown') { issue('inherited-capability', field); return; }
      if (allowed.has(entry.name) && (entry.origin === 'builtin' || entry.origin === 'marginalia')) return;
      issue('capability-not-allowed', field);
    });
  };
  const none = new Set<string>();
  if (policy.adapter === 'app-server') {
    inventory('mcp', 'mcpServerStatus/list', none);
    inventory('skills', 'skills/list', none);
    inventory('capabilities', 'host-capability-audit', new Set(policy.reviewedProfile.reviewedAdapterCapabilities));
    inventory('instructions', 'thread-instruction-audit', new Set(policy.reviewedProfile.reviewedInstructionSources));
  } else {
    // An MCP process cannot borrow app-server inventory observations. Its supported tools/list
    // surface is checked against the pinned adapter profile and is still not a full model catalog.
    inventory('capabilities', 'mcp-tools/list', new Set(policy.reviewedProfile.reviewedAdapterCapabilities));
    inventory('mcp', 'host-mcp-config-audit', none);
    inventory('skills', 'host-skill-config-audit', none);
    inventory('instructions', 'host-instruction-config-audit', new Set(policy.reviewedProfile.reviewedInstructionSources));
  }
  const catalog = evidence.catalog ?? { status: 'unavailable' as const, scope: policy.evidenceScope, source: 'not-observed', reference: 'none', reason: 'No complete model-visible catalog endpoint was established.' };
  const unsupportedCatalogEntries: string[] = [];
  if (catalog.scope !== policy.evidenceScope || !nonempty(catalog.source) || !nonempty(catalog.reference)) issue('catalog-observation-invalid', 'catalog');
  if (catalog.status === 'observed' || catalog.status === 'incomplete') {
    if ((catalog.status === 'observed' && catalog.complete !== true) || !Array.isArray(catalog.entries)) issue('catalog-observation-invalid', 'catalog');
    else for (const [index, entry] of catalog.entries.entries()) {
      if (!record(entry) || !nonempty(entry.name) || typeof entry.enabled !== 'boolean' || !['builtin', 'marginalia', 'inherited', 'unknown'].includes(String(entry.origin))) {
        issue('catalog-observation-invalid', `catalog.entries[${index}]`); continue;
      }
      if (!entry.enabled) continue;
      const reviewed = entry.origin === 'builtin' && policy.reviewedProfile.reviewedBuiltinTools.includes(entry.name);
      if (!reviewed) unsupportedCatalogEntries.push(entry.name);
    }
    if (catalog.status === 'incomplete' && !nonempty(catalog.reason)) issue('catalog-observation-invalid', 'catalog.reason');
  } else if (!nonempty(catalog.reason)) issue('catalog-observation-invalid', 'catalog.reason');
  const environment = read('environment', 'host-environment-audit');
  const allowedEnvironment = new Set<string>(policy.reviewedProfile.inheritedEnvironmentKeys);
  const environmentDigests = record(environment) && record(environment.inheritedEnvironmentValueDigests)
    ? environment.inheritedEnvironmentValueDigests : undefined;
  if (!record(environment) || environment.serverCwd !== policy.workspace || environment.codexHome !== policy.codexHome ||
      environment.dedicatedHome !== true || environment.credentialsCopied !== false || environment.normalSettingsChanged !== false ||
      environment.environmentReviewed !== true || !Array.isArray(environment.inheritedEnvironmentKeys) ||
      environment.inheritedEnvironmentKeys.some(key => typeof key !== 'string' || !allowedEnvironment.has(key)) ||
      !environmentDigests || (policy.platform === 'win32' && environment.windowsKeyCasingReviewed !== true) ||
      environment.executableResolutionReviewed !== true || environment.inheritedEnvironmentKeys.some(key => !isDigest(String(environmentDigests[key] ?? '')))) {
    issue('environment-unresolved', 'environment');
  }
  const runtime = read('runtime', 'controlled-sandbox-probe');
  if (!record(runtime) || runtime.version !== PINNED_CODEX_VERSION || runtime.adapter !== policy.adapter ||
      runtime.platform !== policy.platform || runtime.backend !== policy.reviewedProfile.runtimeBackend ||
      !nonempty(runtime.providerInstanceId) || runtime.profileManifestSha256 !== policy.reviewedProfile.manifestSha256 ||
      !same(runtime.sandboxPolicy, policy.sandboxPolicy) || runtime.modelReachableReadProbe !== 'passed' || runtime.filesystemWriteProbe !== 'passed' ||
      runtime.closedToolNetworkProbe !== 'passed' || runtime.modelTrafficDistinguished !== true) issue('runtime-evidence-unresolved', 'runtime');
  const perRequestCatalogVeto = unsupportedCatalogEntries.length ? 'unsupported' : 'none';
  const bootstrapPolicySatisfied = issues.length === 0;
  const dispatchPolicySatisfied = stage === 'dispatch' && bootstrapPolicySatisfied;
  return {
    decision: bootstrapPolicySatisfied && perRequestCatalogVeto === 'none' ? 'evidence-consistent' : 'reject',
    issues, stage, bootstrapPolicySatisfied, dispatchPolicySatisfied, catalogObservation: catalog.status, perRequestCatalogVeto,
    unsupportedCatalogEntries, runtimeVerifiedHere: false,
  };
}

export type CancellationDecision = {
  strategy: 'interrupt-and-fence' | 'fence-and-timeout' | 'fence-unverified';
  request: { method: 'turn/interrupt'; params: { threadId: string; turnId: string } } | null;
  state: 'cancel_requested'; discardLateOutput: true; processStopConfirmed: false; automaticRetry: false;
};
/** Windows 0.153.4 native command/exec cannot stream or /terminate. An acknowledgement is not a terminal event. */
export function cancellationFor(policy: CodexPolicy, turn?: { threadId: string; turnId: string }): CancellationDecision {
  const common = { state: 'cancel_requested' as const, discardLateOutput: true as const, processStopConfirmed: false as const, automaticRetry: false as const };
  if (policy.operation === 'saved-solver') return { ...common,
    strategy: policy.platform === 'win32' ? 'fence-and-timeout' : 'fence-unverified', request: null };
  if (!turn || !nonempty(turn.threadId) || !nonempty(turn.turnId)) return { ...common, strategy: 'fence-unverified', request: null };
  return { ...common, strategy: 'interrupt-and-fence', request: { method: 'turn/interrupt', params: { threadId: turn.threadId, turnId: turn.turnId } } };
}
