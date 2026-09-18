import { randomUUID } from 'node:crypto';
import type { startServer } from './server.ts';
import { createCodexRuntimeFactory, type AuthorizedRuntimeFactory } from './jobs/runtime.ts';
import { dedicatedRuntimeIdentity } from './runtime-identity.ts';
import { createRuntimePolicy } from './runtime-policy.ts';
import { createConsentProviderAuthorization, createObservedPolicyEvidenceCollector } from './consent/index.ts';
import { createDedicatedHostEvidenceSource } from './consent/evidence-host.ts';

type RuntimeInput = Parameters<NonNullable<Parameters<typeof startServer>[0]['runtimeFactoryBuilder']>>[0] & { dataDir: string };
let announced = false;

export function createAuthorizedRuntime({ consent }: RuntimeInput): AuthorizedRuntimeFactory {
  if (process.env.MARGINALIA_READER_AUTHORIZED_UNCONFINED !== 'I-UNDERSTAND') {
    throw new Error('Reader-authorized runtime requires MARGINALIA_READER_AUTHORIZED_UNCONFINED=I-UNDERSTAND.');
  }
  const identity = dedicatedRuntimeIdentity();
  if (!identity) throw new Error('Reader-authorized runtime requires valid dedicated MARGINALIA_CODEX_EXECUTABLE and MARGINALIA_CODEX_HOME.');
  if (!announced) {
    console.error('READER-AUTHORIZED RUNTIME: solver confinement is requested but NOT observed.\nYou approved this mode with MARGINALIA_READER_AUTHORIZED_UNCONFINED.\nEvery ask still shows the exact outgoing text and recipient for your approval.');
    announced = true;
  }
  const { policyFor, jobDefaults } = createRuntimePolicy(identity.codexHome);
  const evidence = createObservedPolicyEvidenceCollector({ auditEpoch: randomUUID(), host: createDedicatedHostEvidenceSource() });
  const authorization = createConsentProviderAuthorization({ consent, platform: process.platform as 'win32' | 'linux' | 'darwin',
    evidence, unobservedConfinement: 'reader-authorized' });
  return { ...createCodexRuntimeFactory({ ...identity, consent, authorization, dispatchReady: true,
    configOverridesFor: (job, workspace) => policyFor(workspace, job.mode, job.model, job.provider).configOverrides }), jobDefaults };
}
