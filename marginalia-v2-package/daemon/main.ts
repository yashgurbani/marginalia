import { dedicatedRuntimeIdentity } from './runtime-identity.ts';
import { createRuntimePolicy } from './runtime-policy.ts';
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { startServer } from './server.ts';
import { createInterface } from 'node:readline';
import { createDiagnostics } from './diagnostics.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AuthorizedRuntimeFactory } from './jobs/runtime.ts';
import { randomUUID } from 'node:crypto';
import { createCodexRuntimeFactory } from './jobs/runtime.ts';
import { createConsentProviderAuthorization, createObservedPolicyEvidenceCollector } from './consent/index.ts';
import { createDedicatedHostEvidenceSource } from './consent/evidence-host.ts';
import { launchProvider } from './providers/runtime.ts';
import { inspectAppServer } from './providers/preflight.ts';
import { createLazySolverTransport } from './solver/index.ts';
import { ensurePrivateDataDirectory, runShutdown, shutdownSignals } from './shutdown.ts';
import { ReaderMigrationError } from './store.ts';

const userDataRoot = process.platform === 'win32' ? process.env.LOCALAPPDATA
  : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
const dataDir = process.env.MARGINALIA_DATA_DIR ?? (userDataRoot && isAbsolute(userDataRoot) ? join(userDataRoot, 'Marginalia') : join(homedir(), '.marginalia'));
if (!isAbsolute(dataDir)) throw new Error('MARGINALIA_DATA_DIR must be absolute.');
ensurePrivateDataDirectory(dataDir);
const canonicalDataDir = realpathSync(dataDir);
const solverProbeRoot = join(canonicalDataDir, 'confinement-probes');
mkdirSync(solverProbeRoot, { recursive: true, mode: 0o700 });
const port = Number(process.env.MARGINALIA_PORT ?? 43120);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MARGINALIA_PORT must be between 1 and 65535.');
const runtimeIdentity = dedicatedRuntimeIdentity();
const runtimePolicy = runtimeIdentity ? createRuntimePolicy(runtimeIdentity.codexHome) : undefined;
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
    configOverridesFor: (job, workspace) => runtimePolicy!.policyFor(workspace, job.mode, job.model, job.provider).configOverrides });
};
const jobDefaults = runtimePolicy && !runtimeModule ? runtimePolicy.jobDefaults : undefined;
const solverTransport = runtimeIdentity && !runtimeModule ? createLazySolverTransport({
  launch: () => launchProvider('app-server', { ...runtimeIdentity, workspace: canonicalDataDir, timeoutMs: 60_000 }),
  inspect: rpc => inspectAppServer(rpc, canonicalDataDir, runtimeIdentity.codexHome),
  rpcTimeoutMs: 60_000,
}) : undefined;
const server = await startServer({ database: join(canonicalDataDir, 'marginalia.sqlite'), port, webRoot: fileURLToPath(new URL('../webapp/dist', import.meta.url)), diagnostics,
  jobWorkspaceRoot: join(canonicalDataDir, 'jobs'), runtimeFactoryBuilder, jobDefaults,
  solverTransport, solverRpc: solverTransport, solverProbeRoot }).catch((error: unknown) => {
  solverTransport?.close();
  if (error instanceof ReaderMigrationError) {
    console.error(error.message);
    if (error.backupPath) console.error(`Backup: ${error.backupPath}`);
    console.error('Recovery: after resolving the saved database, acknowledge the retained backup with ReaderStore.resolveRecoveryBackup().');
    process.exit(1);
  }
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
let shutdown: Promise<void> | undefined;
for (const signal of shutdownSignals(process.platform)) process.once(signal, () => {
  shutdown ??= runShutdown({
    closeTerminal: () => terminal.close(),
    closeServer: () => server.close(),
    closeSolver: () => solverTransport?.close(),
    exit: code => process.exit(code),
  });
});
