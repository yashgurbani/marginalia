import { createHash } from 'node:crypto';
import type { ProviderAudit, ProviderHandle, ProviderRequest } from '../../contracts/job-runner.ts';
import type { JobSnapshot } from '../../contracts/jobs.ts';
import type { AuditStage, CodexPolicy, InventoryEntry, Observation, PolicyEvidence } from '../codex-policy.ts';
import type { RpcTransport } from '../providers/stdio.ts';
import type { PolicyEvidenceCollector } from './provider-authorization.ts';

export type HostEvidenceContext = {
  job: Readonly<JobSnapshot>;
  request: ProviderRequest;
  audit: ProviderAudit;
  stage: AuditStage;
  policy: CodexPolicy;
};

/**
 * Supplies controls unavailable from the adapter protocols themselves: effective MCP config,
 * provider environment value review, executable/profile binding and confinement probes. Returning
 * no field is an honest blocking observation, never a development exemption.
 */
export interface PolicyHostEvidenceSource {
  collect(context: HostEvidenceContext): Promise<Partial<PolicyEvidence>>;
  authorizeRecovery?(context: { job: Readonly<JobSnapshot>; handle: ProviderHandle; audit: ProviderAudit }): Promise<void>;
}

export type ObservedCollectorOptions = {
  /** Host-owned process/configuration epoch; rotate on worker restart or configuration change. */
  auditEpoch: string;
  host: PolicyHostEvidenceSource;
};

export function createObservedPolicyEvidenceCollector(options: ObservedCollectorOptions): PolicyEvidenceCollector {
  if (!options.auditEpoch.trim()) throw new Error('A host audit epoch is required.');
  const threadState = new Map<string, Observation<{ cwd: string; approvalPolicy: string; sandboxPolicy: unknown }>>();
  const mcpTools = new Map<string, unknown[]>();
  return {
    auditId({ job, request }) { return hash([options.auditEpoch, job.provider, request.jobId, job.policyKey, 'session']); },
    async collect(context) {
      const supplied = await options.host.collect(context);
      const evidence: PolicyEvidence = { ...supplied };
      if (context.job.provider === 'app-server') {
        evidence.authentication = appAuthentication(context.policy, context.audit.account);
        evidence.config = appConfig(context.policy, context.audit.config);
        evidence.requirements = appRequirements(context.policy, context.audit.requirements);
        evidence.mcp = inventory(context.policy, 'mcpServerStatus/list', context.audit.mcpServers, 'unknown');
        evidence.skills = appSkills(context.policy, context.audit.skills);
        if (context.stage === 'dispatch') evidence.threadState = threadState.get(context.request.jobId);
      } else {
        const tools = mcpTools.get(key(context.request.workspace, context.audit.codexHome)) ?? [];
        evidence.capabilities = inventory(context.policy, 'mcp-tools/list', tools, 'builtin');
        evidence.catalog ??= { status: 'incomplete', scope: context.policy.evidenceScope, source: 'mcp-tools/list', reference: 'adapter-tools-only', reason: 'MCP tools/list does not expose the complete model-visible catalog.', entries: [] };
      }
      return evidence;
    },
    async observeThread({ job, handle, response }) {
      if (handle.provider !== 'app-server' || job.provider !== 'app-server') throw new Error('thread-observation-adapter-mismatch');
      const value = normalizeThreadState(response, handle);
      threadState.set(handle.jobId, { scope: handle.auditScope ?? '', source: 'host-thread-state-audit', reference: `app-thread:${handle.threadId ?? 'unknown'}`, complete: !!value, value: value ?? { cwd: '', approvalPolicy: '', sandboxPolicy: null } });
      // The evidence scope in a provider handle is the policy epoch returned at bootstrap. If it is
      // absent or later differs from the dispatch policy, auditCodexPolicy rejects it.
    },
    async authorizeRecovery(context) {
      if (!options.host.authorizeRecovery) throw new Error('recovery-evidence-unavailable');
      await options.host.authorizeRecovery(context);
    },
    async inspectMcp(_rpc: RpcTransport, workspace: string, codexHome: string, tools: unknown[]) {
      if (!Array.isArray(tools)) throw new Error('invalid-mcp-tool-list');
      const frozen = structuredClone(tools); mcpTools.set(key(workspace, codexHome), frozen);
      return {
        workspace, codexHome, initialize: { adapter: 'mcp-server', observed: true }, account: { unavailable: true },
        config: { unavailable: true }, requirements: { unavailable: true }, skills: { unavailable: true },
        mcpServers: [], features: frozen, completeModelToolCatalog: false,
      };
    },
  };
}

/** Bundled safe default: composition works, but absent host proof keeps provider dispatch closed. */
export function unavailablePolicyHostEvidence(): PolicyHostEvidenceSource {
  return { async collect() { return {}; } };
}

function appAuthentication(policy: CodexPolicy, raw: unknown): PolicyEvidence['authentication'] {
  const account = record(raw) ? raw.account : undefined;
  return { scope: policy.evidenceScope, source: 'account/read', reference: account ? 'dedicated-account-present' : 'dedicated-account-absent', complete: true,
    value: { available: !!account, dedicatedHome: true, accountReference: account ? 'dedicated-account-present' : 'signed-out' } };
}
function appConfig(policy: CodexPolicy, raw: unknown): PolicyEvidence['config'] {
  const outer = record(raw) ? raw : {};
  const values = record(outer.config) ? outer.config : outer;
  const layersReviewed = Array.isArray(outer.layers) || Array.isArray(outer.origins);
  return { scope: policy.evidenceScope, source: 'config/read', reference: 'app-server-effective-config', complete: layersReviewed,
    value: { values, layersReviewed } };
}
function appRequirements(policy: CodexPolicy, raw: unknown): PolicyEvidence['requirements'] {
  const outer = record(raw) ? raw : undefined;
  if (!outer || !Object.hasOwn(outer, 'requirements')) return requirements(policy, false, ['requirements-response-unparsed']);
  if (outer.requirements === null) return requirements(policy, true, []);
  if (!record(outer.requirements)) return requirements(policy, false, ['requirements-value-unparsed']);
  const value = outer.requirements;
  const unresolved: string[] = [];
  allowed(value, 'allowedApprovalPolicies', policy.configOverrides.approval_policy, unresolved);
  allowed(value, 'allowedSandboxModes', policy.configOverrides.sandbox_mode, unresolved);
  allowed(value, 'allowedWindowsSandboxImplementations', policy.platform === 'win32' ? 'elevated' : undefined, unresolved);
  allowed(value, 'allowedWebSearchModes', 'disabled', unresolved);
  equalWhenSet(value, 'cliAuthCredentialsStore', policy.configOverrides.cli_auth_credentials_store, unresolved);
  equalWhenSet(value, 'allowLoginShell', policy.configOverrides.allow_login_shell, unresolved);
  if (value.additionalDeveloperInstructions !== null) unresolved.push('additionalDeveloperInstructions');
  if (record(value.featureRequirements)) for (const [name, required] of Object.entries(value.featureRequirements)) {
    if (typeof required !== 'boolean' || policy.configOverrides[`features.${name}`] !== required) unresolved.push(`featureRequirements.${name}`);
  } else if (value.featureRequirements !== null) unresolved.push('featureRequirements');
  if (record(value.network)) {
    if (value.network.enabled !== null && value.network.enabled !== false) unresolved.push('network.enabled');
    for (const [name, constraint] of Object.entries(value.network)) if (name !== 'enabled' && constraint !== null) unresolved.push(`network.${name}`);
  } else if (value.network !== null) unresolved.push('network');
  // These protocol fields have no reviewed comparison in the pinned profile. An explicit value is
  // never silently treated as compatible; null means the manager expressed no constraint there.
  for (const name of ['chatgptBaseUrl', 'allowedApprovalsReviewers', 'allowedPermissionProfiles', 'defaultPermissions',
    'computerUse', 'browserUse', 'inAppBrowser', 'hooks', 'enforceResidency', 'autoReview', 'models', 'sqliteHome',
    'logDir', 'modelCatalogJson', 'checkForUpdateOnStartup', 'feedback', 'windowsSandboxPrivateDesktop'] as const) if (value[name] !== null) unresolved.push(name);
  for (const name of ['allowManagedHooksOnly', 'allowBrowserAndComputerUse', 'allowAppshots', 'allowRemoteControl',
  ] as const) if (value[name] !== null && typeof value[name] !== 'boolean') unresolved.push(name);
  const known = new Set(['cliAuthCredentialsStore', 'chatgptBaseUrl', 'additionalDeveloperInstructions', 'allowedApprovalPolicies',
    'allowedApprovalsReviewers', 'allowedSandboxModes', 'allowedWindowsSandboxImplementations', 'allowedPermissionProfiles',
    'defaultPermissions', 'allowedWebSearchModes', 'allowManagedHooksOnly', 'allowBrowserAndComputerUse', 'allowAppshots',
    'allowRemoteControl', 'computerUse', 'browserUse', 'inAppBrowser', 'featureRequirements', 'hooks', 'enforceResidency',
    'network', 'autoReview', 'models', 'sqliteHome', 'logDir', 'modelCatalogJson', 'checkForUpdateOnStartup',
    'allowLoginShell', 'feedback', 'windowsSandboxPrivateDesktop']);
  for (const name of Object.keys(value)) if (!known.has(name)) unresolved.push(`unknown:${name}`);
  return requirements(policy, true, [...new Set(unresolved)]);
}
function requirements(policy: CodexPolicy, complete: boolean, unresolved: string[]): PolicyEvidence['requirements'] {
  return { scope: policy.evidenceScope, source: 'configRequirements/read', reference: 'app-server-config-requirements', complete,
    value: { compatible: complete && unresolved.length === 0, unresolved } };
}
function allowed(value: Record<string, unknown>, name: string, expected: unknown, unresolved: string[]) {
  const constraint = value[name];
  if (constraint === null) return;
  if (expected === undefined || !Array.isArray(constraint) || !constraint.some(item => sameValue(item, expected))) unresolved.push(name);
}
function equalWhenSet(value: Record<string, unknown>, name: string, expected: unknown, unresolved: string[]) {
  const constraint = value[name];
  if (constraint !== null && !sameValue(constraint, expected)) unresolved.push(name);
}
function sameValue(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function inventory(policy: CodexPolicy, source: string, raw: unknown[], defaultOrigin: InventoryEntry['origin']): Observation<InventoryEntry[]> {
  const entries = raw.map((item, index): InventoryEntry => {
    const value = record(item) ? item : {};
    const name = typeof value.name === 'string' ? value.name : typeof value.id === 'string' ? value.id : `unresolved-${index}`;
    const enabled = value.enabled === false || value.status === 'disabled' ? false : true;
    const origin = ['builtin', 'marginalia', 'inherited', 'unknown'].includes(String(value.origin)) ? value.origin as InventoryEntry['origin'] : defaultOrigin;
    return { name, enabled, origin };
  });
  return { scope: policy.evidenceScope, source, reference: `${source}:observed`, complete: true, value: entries };
}
function appSkills(policy: CodexPolicy, raw: unknown): Observation<InventoryEntry[]> {
  const data = record(raw) && Array.isArray(raw.data) ? raw.data : undefined;
  const matches = data?.filter(item => record(item) && typeof item.cwd === 'string' && sameWorkspace(policy, item.cwd, policy.workspace)) ?? [];
  const entry = matches.length === 1 && record(matches[0]) ? matches[0] : undefined;
  const skills = entry && Array.isArray(entry.skills) ? entry.skills : undefined;
  const errors = entry && Array.isArray(entry.errors) ? entry.errors : undefined;
  let complete = !!data && !!entry && !!skills && !!errors && errors.length === 0;
  const values: InventoryEntry[] = [];
  if (skills) skills.forEach((item, index) => {
    if (!record(item) || typeof item.name !== 'string' || !item.name.trim() || typeof item.enabled !== 'boolean' ||
        !['user', 'repo', 'system', 'admin'].includes(String(item.scope))) {
      complete = false; values.push({ name: `unresolved-skill-${index}`, enabled: true, origin: 'unknown' }); return;
    }
    values.push({ name: item.name, enabled: item.enabled, origin: item.scope === 'system' ? 'builtin' : 'inherited' });
  });
  if (errors) errors.forEach((item, index) => {
    complete = false;
    const path = record(item) && typeof item.path === 'string' && item.path.trim() ? item.path : String(index);
    values.push({ name: `skill-error:${path}`, enabled: true, origin: 'unknown' });
  });
  if (!entry || !skills || !errors) values.push({ name: 'skills-response-unresolved', enabled: true, origin: 'unknown' });
  return { scope: policy.evidenceScope, source: 'skills/list', reference: `skills/list:${policy.workspace}`, complete, value: values };
}
function normalizeThreadState(raw: unknown, handle: ProviderHandle): { cwd: string; approvalPolicy: string; sandboxPolicy: unknown } | undefined {
  const outer = record(raw) ? raw : undefined, thread = outer && record(outer.thread) ? outer.thread : undefined;
  if (!outer || !thread || typeof thread.id !== 'string' || thread.id !== handle.threadId || typeof outer.cwd !== 'string' ||
      typeof outer.approvalPolicy !== 'string' || outer.sandbox === undefined || typeof outer.model !== 'string' || outer.model !== handle.model) return;
  return { cwd: outer.cwd, approvalPolicy: outer.approvalPolicy, sandboxPolicy: structuredClone(outer.sandbox) };
}
function sameWorkspace(policy: CodexPolicy, left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '');
  return policy.platform === 'win32' ? normalize(left).toLowerCase() === normalize(right).toLowerCase() : normalize(left) === normalize(right);
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function key(workspace: string, home: string) { return `${workspace}\n${home}`; }
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
