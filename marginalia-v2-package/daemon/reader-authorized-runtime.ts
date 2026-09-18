import { createHash, randomUUID } from 'node:crypto';
import type { startServer } from './server.ts';
import { createCodexRuntimeFactory, type CodexRuntimeOptions, type AuthorizedRuntimeFactory } from './jobs/runtime.ts';
import { dedicatedRuntimeIdentity, type RuntimeDiscovery } from './runtime-identity.ts';
import { PINNED_CODEX_VERSION } from './codex-policy.ts';
import { createRuntimePolicy } from './runtime-policy.ts';
import { createConsentProviderAuthorization, createObservedPolicyEvidenceCollector } from './consent/index.ts';
import { createDedicatedHostEvidenceSource } from './consent/evidence-host.ts';

type RuntimeInput = Parameters<NonNullable<Parameters<typeof startServer>[0]['runtimeFactoryBuilder']>>[0] & { dataDir: string };

export function createAuthorizedRuntime({ consent }: RuntimeInput, dependencies: Pick<CodexRuntimeOptions, 'launch'> & { discovery?: RuntimeDiscovery } = {}): AuthorizedRuntimeFactory {
  const identity = dedicatedRuntimeIdentity(dependencies.discovery);
  if (!identity) throw new Error('Install a valid Codex executable on PATH and use your ordinary Codex home directory, or configure both dedicated paths.');
  const { policyFor, jobDefaults } = createRuntimePolicy(identity.codexHome, identity.homeMode);
  const disclosureVersion = 'runtime-d2-v2:' + createHash('sha256')
    .update(JSON.stringify([identity, PINNED_CODEX_VERSION, jobDefaults.capabilities, jobDefaults.solverAuthoring])).digest('hex');
  const host = createDedicatedHostEvidenceSource();
  const collect = host.collect;
  if (identity.homeMode === 'ordinary') host.collect = async context => {
    const observations = await collect(context);
    if (observations.environment) observations.environment.value.dedicatedHome = false;
    return observations;
  };
  const evidence = createObservedPolicyEvidenceCollector({ auditEpoch: randomUUID(), host });
  if (identity.homeMode === 'ordinary') {
    const collectEvidence = evidence.collect;
    evidence.collect = async context => {
      const observations = await collectEvidence(context);
      if (observations.authentication) {
        observations.authentication.value.dedicatedHome = false;
        observations.authentication.reference = 'ordinary-account-status';
        observations.authentication.value.accountReference = observations.authentication.value.available ? 'ordinary-account-present' : 'signed-out';
      }
      return observations;
    };
  }
  const authorization = createConsentProviderAuthorization({ consent, platform: process.platform as 'win32' | 'linux' | 'darwin',
    homeMode: identity.homeMode,
    evidence, unobservedConfinement: 'reader-authorized' });
  return { ...createCodexRuntimeFactory({ ...identity, consent, authorization, dispatchReady: true, ...dependencies,
    unverified: [...host.readiness().reasons, ...(identity.homeMode === 'ordinary' ? ['Marginalia uses your own Codex setup, including its settings and tools.'] : [])], disclosureVersion,
    configOverridesFor: (job, workspace) => policyFor(workspace, job.mode, job.model, job.provider).configOverrides }), jobDefaults };
}
