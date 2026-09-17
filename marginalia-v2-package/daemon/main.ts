import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './server.ts';
import { createInterface } from 'node:readline';
import { createDiagnostics } from './diagnostics.ts';
import { pathToFileURL } from 'node:url';
import type { AuthorizedRuntimeFactory } from './jobs/runtime.ts';
import { randomUUID } from 'node:crypto';
import { createCodexRuntimeFactory } from './jobs/runtime.ts';
import { createConsentProviderAuthorization, createObservedPolicyEvidenceCollector, unavailablePolicyHostEvidence } from './consent/index.ts';

const dataDir = resolve(process.env.MARGINALIA_DATA_DIR ?? '.local');
mkdirSync(dataDir, { recursive: true });
const port = Number(process.env.MARGINALIA_PORT ?? 43120);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MARGINALIA_PORT must be between 1 and 65535.');
const diagnostics = createDiagnostics();
const runtimeModule = process.env.MARGINALIA_AUTHORIZED_RUNTIME_MODULE;
const runtimeFactoryBuilder = async ({ store, consent }: Parameters<NonNullable<Parameters<typeof startServer>[0]['runtimeFactoryBuilder']>>[0]) => {
  if (runtimeModule) {
    const module = await import(pathToFileURL(resolve(runtimeModule)).href) as { createAuthorizedRuntime?: (input: { dataDir: string; store: typeof store; consent: typeof consent }) => Promise<AuthorizedRuntimeFactory> | AuthorizedRuntimeFactory };
    if (typeof module.createAuthorizedRuntime !== 'function') throw new Error('The authorized runtime module must export createAuthorizedRuntime().');
    return module.createAuthorizedRuntime({ dataDir, store, consent });
  }
  const executable = process.env.MARGINALIA_CODEX_EXECUTABLE;
  if (!executable) return undefined;
  const evidence = createObservedPolicyEvidenceCollector({ auditEpoch: randomUUID(), host: unavailablePolicyHostEvidence() });
  const authorization = createConsentProviderAuthorization({ consent, platform: process.platform as 'win32' | 'linux' | 'darwin', evidence });
  return createCodexRuntimeFactory({ executable: resolve(executable), codexHome: resolve('D:/MarginaliaRuntime/T02'), consent, authorization,
    dispatchReady: false, unavailableReason: 'The bundled policy evidence source is intentionally unavailable until dedicated sign-in and host confinement evidence are verified.' });
};
const policyKey = process.env.MARGINALIA_POLICY_KEY;
const jobDefaults = policyKey && /^[a-f0-9]{64}$/.test(policyKey)
  ? { provider: 'app-server' as const, mode: 'structured-final' as const, policyKey, capabilities: [] } : undefined;
const server = await startServer({ database: resolve(dataDir, 'marginalia.sqlite'), port, webRoot: resolve('webapp/dist'), diagnostics,
  jobWorkspaceRoot: resolve(dataDir, 'jobs'), runtimeFactoryBuilder, jobDefaults });
console.log(`Marginalia local helper: ${server.origin}`);
console.log(`Pairing code: ${server.challenge} (valid for five minutes, one use)`);
console.log(server.jobs.available ? 'Reading and notes are ready. Codex execution is configured but remains subject to current consent and runtime checks.'
  : 'Reading and notes are ready. Codex execution is unavailable until an authorized runtime is configured.');
console.log('Enter pair here to renew the pairing code. This replaces any unused code.');
void diagnostics().then(result => console.log(`Codex: ${result.status}; sign-in: ${result.login}. Execution remains unverified.`));
const terminal = createInterface({ input: process.stdin });
terminal.on('line', line => {
  if (line.trim() === 'pair') console.log(`Pairing code: ${server.pairing.issue()} (valid for five minutes, one use)`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { terminal.close(); await server.close(); process.exit(0); });
