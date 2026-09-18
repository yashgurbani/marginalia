import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ReplyCapability } from '../contracts/reply.ts';
import { startServer } from './server.ts';
import { createInterface } from 'node:readline';
import { createDiagnostics } from './diagnostics.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AuthorizedRuntimeFactory } from './jobs/runtime.ts';
import { randomUUID } from 'node:crypto';
import { createCodexRuntimeFactory } from './jobs/runtime.ts';
import { createConsentProviderAuthorization, createObservedPolicyEvidenceCollector } from './consent/index.ts';
import { createDedicatedHostEvidenceSource } from './consent/evidence-host.ts';
import { modeForIntent } from './jobs/mode.ts';
import { createCodexPolicy, PINNED_CODEX_VERSION, type JsonValue } from './codex-policy.ts';
import { policyFingerprint } from './providers/policy-gate.ts';

const userDataRoot = process.platform === 'win32' ? process.env.LOCALAPPDATA
  : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
const dataDir = process.env.MARGINALIA_DATA_DIR ?? (userDataRoot && isAbsolute(userDataRoot) ? join(userDataRoot, 'Marginalia') : join(homedir(), '.marginalia'));
if (!isAbsolute(dataDir)) throw new Error('MARGINALIA_DATA_DIR must be absolute.');
mkdirSync(dataDir, { recursive: true });
const canonicalDataDir = realpathSync(dataDir);
const port = Number(process.env.MARGINALIA_PORT ?? 43120);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MARGINALIA_PORT must be between 1 and 65535.');
function dedicatedRuntimeIdentity() {
  const executable = process.env.MARGINALIA_CODEX_EXECUTABLE, home = process.env.MARGINALIA_CODEX_HOME;
  if (!executable || !home || !isAbsolute(executable) || !isAbsolute(home) ||
    (process.platform === 'win32' && !/\.exe$/i.test(executable))) return undefined;
  try {
    const identity = { executable: realpathSync(executable), codexHome: realpathSync(home) };
    if (!statSync(identity.executable).isFile() || !statSync(identity.codexHome).isDirectory()) return undefined;
    const ambient = [join(homedir(), '.codex'), process.env.CODEX_HOME].filter((v): v is string => !!v);
    const nested = (a: string, b: string) => { const r = relative(a, b); return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
    if (ambient.some(value => {
      let actual: string; try { actual = realpathSync(value); } catch { actual = resolve(value); }
      return nested(actual, identity.codexHome) || nested(identity.codexHome, actual);
    })) return undefined;
    return identity;
  } catch { return undefined; }
}
const runtimeIdentity = dedicatedRuntimeIdentity();
const runtimeModule = process.env.MARGINALIA_AUTHORIZED_RUNTIME_MODULE;
const hostEvidence = createDedicatedHostEvidenceSource();
const installationDiagnostics = createDiagnostics(runtimeModule ? undefined : runtimeIdentity);
const diagnostics = async (refresh = false) => ({ ...await installationDiagnostics(refresh),
  policyEvidence: runtimeModule ? { status: 'external-runtime-not-verified-here' } : { status: 'incomplete', missing: hostEvidence.readiness().reasons } });
const runtimeFactoryBuilder = async ({ store, consent }: Parameters<NonNullable<Parameters<typeof startServer>[0]['runtimeFactoryBuilder']>>[0]) => {
  if (runtimeModule) {
    const module = await import(pathToFileURL(resolve(runtimeModule)).href) as { createAuthorizedRuntime?: (input: { dataDir: string; store: typeof store; consent: typeof consent }) => Promise<AuthorizedRuntimeFactory> | AuthorizedRuntimeFactory };
    if (typeof module.createAuthorizedRuntime !== 'function') throw new Error('The authorized runtime module must export createAuthorizedRuntime().');
    const factory = await module.createAuthorizedRuntime({ dataDir: canonicalDataDir, store, consent });
    if (factory.consent !== consent || !factory.jobDefaults) throw new Error('An authorized runtime must use the provided consent authority and supply its host-owned jobDefaults.');
    return factory;
  }
  if (!runtimeIdentity) return undefined;
  const evidence = createObservedPolicyEvidenceCollector({ auditEpoch: randomUUID(), host: hostEvidence });
  const authorization = createConsentProviderAuthorization({ consent, platform: process.platform as 'win32' | 'linux' | 'darwin', evidence });
  return createCodexRuntimeFactory({ ...runtimeIdentity, consent, authorization,
    dispatchReady: hostEvidence.readiness().ready, readiness: () => hostEvidence.readiness(),
    configOverridesFor: (job, workspace) => policyFor(workspace, job.mode, job.model, job.provider).configOverrides });
};
const policyAuditEpoch = randomUUID();
let definitionSchema: Record<string, JsonValue> | undefined;
function policyFor(workspace: string, mode: 'structured-final' | 'workspace-files', model: string, provider: 'app-server' | 'mcp-server') {
  if (!runtimeIdentity) throw new Error('No dedicated runtime identity is available.');
  const common = { version: PINNED_CODEX_VERSION, platform: process.platform as 'win32' | 'linux' | 'darwin',
    adapter: provider, model, workspace, codexHome: runtimeIdentity.codexHome, auditId: policyAuditEpoch };
  if (mode === 'structured-final') {
    definitionSchema ??= JSON.parse(readFileSync(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8')) as Record<string, JsonValue>;
    return createCodexPolicy({ ...common, operation: 'definition', outputSchema: definitionSchema });
  }
  return createCodexPolicy({ ...common, operation: 'generation' });
}
const jobDefaults = runtimeIdentity && !runtimeModule ? {
  provider: 'app-server' as const, mode: 'workspace-files' as const, modeFor: modeForIntent, capabilities: ['samples', 'solver', 'media.audio', 'media.image', 'media.video', 'network.citations', 'network.shelf'] satisfies ReplyCapability[],
  policyFor: (workspace: string, mode: 'structured-final' | 'workspace-files', model: string, provider: 'app-server' | 'mcp-server') => policyFingerprint(policyFor(workspace, mode, model, provider)),
} : undefined;
const server = await startServer({ database: join(canonicalDataDir, 'marginalia.sqlite'), port, webRoot: fileURLToPath(new URL('../webapp/dist', import.meta.url)), diagnostics,
  jobWorkspaceRoot: join(canonicalDataDir, 'jobs'), runtimeFactoryBuilder, jobDefaults }).catch((error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
    console.error(`Another program is using port ${port}. Close it, or start Marginalia on another port. Set MARGINALIA_PORT and use the same port in the browser's helper address.`);
    process.exit(1);
  }
  throw error;
});
console.log(`Marginalia local helper: ${server.origin}`);
console.log(`Pairing code: ${server.challenge} (valid for five minutes, one use)`);
console.log(server.jobs.available ? 'Reading and notes are ready. Codex execution is configured but remains subject to current consent and runtime checks.'
  : 'Reading and notes are ready. Codex execution is unavailable until an authorized runtime is configured.');
console.log('Enter pair here to renew the pairing code. This replaces any unused code.');
void diagnostics().then(result => console.log(`Codex: ${result.status}; sign-in: ${result.login}. Execution remains unverified.`))
  .catch(() => console.log('Codex diagnostics are unavailable. Execution remains unverified.'));
const terminal = createInterface({ input: process.stdin });
terminal.on('line', line => {
  if (line.trim() === 'pair') console.log(`Pairing code: ${server.pairing.issue()} (valid for five minutes, one use)`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { terminal.close(); await server.close(); process.exit(0); });
